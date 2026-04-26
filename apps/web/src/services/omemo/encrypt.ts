/**
 * omemo/encrypt.ts - Message encryption and decryption per XEP-0384.
 *
 * Encryption flow:
 *   1. Generate a random 16-byte AES key + 16-byte IV
 *   2. AES-128-GCM encrypt the plaintext with that key
 *   3. For each recipient device, encrypt the AES key with the
 *      Double Ratchet session (libsignal SessionCipher)
 *   4. Build the OMEMO <encrypted> stanza with all wrapped keys + payload
 *
 * Decryption flow:
 *   1. Find our deviceId in the <header> <key> entries
 *   2. Use SessionCipher.decryptPreKeyWhisperMessage or decryptWhisperMessage
 *      to recover the AES key
 *   3. AES-128-GCM decrypt the payload
 *
 * Session establishment uses X3DH (handled by libsignal SessionBuilder).
 */
import { SignalProtocolAddress } from "@privacyresearch/libsignal-protocol-typescript";
import { SessionBuilder } from "@privacyresearch/libsignal-protocol-typescript/lib/session-builder";
import { SessionCipher } from "@privacyresearch/libsignal-protocol-typescript/lib/session-cipher";
import { OmemoStore } from "./store";
import type { OmemoBundle } from "./keys";

const NS_OMEMO = "eu.siacs.conversations.axolotl";

export interface EncryptedEnvelope {
  sid: number;
  iv: ArrayBuffer;
  payload: ArrayBuffer;
  keys: {
    rid: number;
    isPreKey: boolean;
    body: ArrayBuffer;
  }[];
}

/**
 * Establish a libsignal session with a peer device using their published bundle.
 * Required before the first message to that device.
 */
export async function establishSession(
  accountId: string,
  peerJid: string,
  peerBundle: {
    deviceId: number;
    identityKey: ArrayBuffer;
    signedPreKeyId: number;
    signedPreKey: ArrayBuffer;
    signedPreKeySignature: ArrayBuffer;
    preKey?: { keyId: number; publicKey: ArrayBuffer };
  }
): Promise<void> {
  const store = new OmemoStore(accountId);
  const address = new SignalProtocolAddress(peerJid, peerBundle.deviceId);
  const builder = new SessionBuilder(store as any, address);
  await builder.processPreKey({
    registrationId: peerBundle.deviceId,
    identityKey: peerBundle.identityKey,
    signedPreKey: {
      keyId: peerBundle.signedPreKeyId,
      publicKey: peerBundle.signedPreKey,
      signature: peerBundle.signedPreKeySignature,
    },
    preKey: peerBundle.preKey,
  });
}

/**
 * Encrypt a plaintext for one or more peer devices.
 * Returns an OMEMO envelope ready for stanza serialization.
 */
export async function encryptForDevices(
  accountId: string,
  ownDeviceId: number,
  plaintext: string,
  peerDevices: { peerJid: string; deviceId: number }[]
): Promise<EncryptedEnvelope> {
  const store = new OmemoStore(accountId);

  // Generate AES key + IV
  const aesKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 128 },
    true,
    ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(16));

  // Encrypt plaintext with AES-GCM
  const encoder = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    aesKey,
    encoder.encode(plaintext)
  );

  // GCM auth tag is appended to ciphertext; XEP-0384 wants tag concatenated
  // with the AES key when wrapping (per OMEMO 0.3+).
  const aesKeyRaw = await crypto.subtle.exportKey("raw", aesKey);
  // tag = last 16 bytes of ciphertext output
  const ctBytes = new Uint8Array(ciphertext);
  const payload = ctBytes.slice(0, ctBytes.length - 16);
  const tag = ctBytes.slice(ctBytes.length - 16);

  // Wrap: AES key || tag (32 bytes) is what we encrypt for each recipient
  const keyAndTag = new Uint8Array(aesKeyRaw.byteLength + tag.byteLength);
  keyAndTag.set(new Uint8Array(aesKeyRaw), 0);
  keyAndTag.set(tag, aesKeyRaw.byteLength);

  // For each recipient device, encrypt keyAndTag using libsignal session
  const keys: EncryptedEnvelope["keys"] = [];
  for (const { peerJid, deviceId } of peerDevices) {
    const address = new SignalProtocolAddress(peerJid, deviceId);
    const cipher = new SessionCipher(store as any, address);
    const wrapped = await cipher.encrypt(keyAndTag.buffer);
    keys.push({
      rid: deviceId,
      // type 3 = PreKeyWhisperMessage (initial session message)
      // type 1 = WhisperMessage (subsequent)
      isPreKey: wrapped.type === 3,
      body: stringToArrayBuffer(wrapped.body ?? ""),
    });
  }

  return {
    sid: ownDeviceId,
    iv: iv.buffer,
    payload: payload.buffer,
    keys,
  };
}

/**
 * Decrypt an incoming OMEMO envelope addressed to us.
 * Returns the plaintext or null if no key for our device.
 */
export async function decryptEnvelope(
  accountId: string,
  ownDeviceId: number,
  senderJid: string,
  envelope: EncryptedEnvelope
): Promise<string | null> {
  const store = new OmemoStore(accountId);
  const ourKey = envelope.keys.find((k) => k.rid === ownDeviceId);
  if (!ourKey) return null;

  // Decrypt the wrapped key+tag
  const address = new SignalProtocolAddress(senderJid, envelope.sid);
  const cipher = new SessionCipher(store as any, address);
  let keyAndTag: ArrayBuffer;
  if (ourKey.isPreKey) {
    keyAndTag = await cipher.decryptPreKeyWhisperMessage(arrayBufferToString(ourKey.body), "binary");
  } else {
    keyAndTag = await cipher.decryptWhisperMessage(arrayBufferToString(ourKey.body), "binary");
  }

  // Split into AES key (16 bytes) + tag (16 bytes)
  const ktBytes = new Uint8Array(keyAndTag);
  const aesKeyRaw = ktBytes.slice(0, 16);
  const tag = ktBytes.slice(16, 32);

  // Reconstruct ciphertext + tag for AES-GCM decrypt
  const payloadBytes = new Uint8Array(envelope.payload);
  const ctWithTag = new Uint8Array(payloadBytes.byteLength + tag.byteLength);
  ctWithTag.set(payloadBytes, 0);
  ctWithTag.set(tag, payloadBytes.byteLength);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    aesKeyRaw.buffer,
    { name: "AES-GCM", length: 128 },
    false,
    ["decrypt"]
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: envelope.iv, tagLength: 128 },
    aesKey,
    ctWithTag.buffer
  );
  return new TextDecoder().decode(plaintext);
}

// Helpers ----------------------------------------------------------
function stringToArrayBuffer(s: string): ArrayBuffer {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i) & 0xff;
  return bytes.buffer;
}

function arrayBufferToString(b: ArrayBuffer): string {
  const bytes = new Uint8Array(b);
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

export { NS_OMEMO };
