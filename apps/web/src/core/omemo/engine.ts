/**
 * core/omemo/engine.ts
 *
 * Platform-neutral OMEMO message engine.
 *
 * The engine keeps the OMEMO encryption/decryption flow in one reusable place,
 * but it does not create browser-only dependencies by itself. Storage and crypto
 * are injected through adapters, so the same engine can later be reused by the
 * browser native app, Node, Docker, Electron, or a backend service.
 */
import { SignalProtocolAddress } from "@privacyresearch/libsignal-protocol-typescript";
import { SessionBuilder } from "@privacyresearch/libsignal-protocol-typescript/lib/session-builder";
import { SessionCipher } from "@privacyresearch/libsignal-protocol-typescript/lib/session-cipher";

export const NS_OMEMO = "eu.siacs.conversations.axolotl";

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

export interface PeerBundleInput {
  deviceId: number;
  identityKey: ArrayBuffer;
  signedPreKeyId: number;
  signedPreKey: ArrayBuffer;
  signedPreKeySignature: ArrayBuffer;
  preKey?: { keyId: number; publicKey: ArrayBuffer };
}

export interface PeerDeviceInput {
  peerJid: string;
  deviceId: number;
}

export interface OmemoCryptoAdapter {
  randomBytes(length: number): Uint8Array;
  generateAesKey(): Promise<CryptoKey>;
  exportAesKey(key: CryptoKey): Promise<ArrayBuffer>;
  importAesKey(raw: ArrayBuffer): Promise<CryptoKey>;
  encryptAesGcm(params: {
    key: CryptoKey;
    iv: Uint8Array | ArrayBuffer;
    plaintext: Uint8Array;
  }): Promise<ArrayBuffer>;
  decryptAesGcm(params: {
    key: CryptoKey;
    iv: Uint8Array | ArrayBuffer;
    ciphertextWithTag: ArrayBuffer;
  }): Promise<ArrayBuffer>;
}

export type OmemoStoreFactory<TStore = unknown> = (accountId: string) => TStore;

export interface OmemoEngineDeps<TStore = unknown> {
  createStore: OmemoStoreFactory<TStore>;
  crypto: OmemoCryptoAdapter;
}

export class OmemoEngine<TStore = unknown> {
  constructor(private readonly deps: OmemoEngineDeps<TStore>) {
    if (!deps?.createStore) throw new Error("OMEMO store adapter is required");
    if (!deps?.crypto) throw new Error("OMEMO crypto adapter is required");
  }

  /**
   * Establish a libsignal session with a peer device using their published bundle.
   * Required before the first message to that device.
   */
  async establishSession(accountId: string, peerJid: string, peerBundle: PeerBundleInput): Promise<void> {
    const store = this.deps.createStore(accountId);
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
  async encryptForDevices(
    accountId: string,
    ownDeviceId: number,
    plaintext: string,
    peerDevices: PeerDeviceInput[]
  ): Promise<EncryptedEnvelope> {
    const store = this.deps.createStore(accountId);
    const crypto = this.deps.crypto;

    // Generate AES key + IV.
    const aesKey = await crypto.generateAesKey();
    const iv = crypto.randomBytes(16);

    // Encrypt plaintext with AES-GCM.
    const encoder = new TextEncoder();
    const ciphertext = await crypto.encryptAesGcm({
      key: aesKey,
      iv,
      plaintext: encoder.encode(plaintext),
    });

    // GCM auth tag is appended to ciphertext; XEP-0384 wants tag concatenated
    // with the AES key when wrapping (per OMEMO 0.3+).
    const aesKeyRaw = await crypto.exportAesKey(aesKey);
    const ctBytes = new Uint8Array(ciphertext);
    const payload = ctBytes.slice(0, ctBytes.length - 16);
    const tag = ctBytes.slice(ctBytes.length - 16);

    // Wrap: AES key || tag (32 bytes) is encrypted for each recipient device.
    const keyAndTag = new Uint8Array(aesKeyRaw.byteLength + tag.byteLength);
    keyAndTag.set(new Uint8Array(aesKeyRaw), 0);
    keyAndTag.set(tag, aesKeyRaw.byteLength);

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
      iv: toOwnedArrayBuffer(iv),
      payload: toOwnedArrayBuffer(payload),
      keys,
    };
  }

  /**
   * Decrypt an incoming OMEMO envelope addressed to us.
   * Returns the plaintext or null if no key for our device.
   */
  async decryptEnvelope(
    accountId: string,
    ownDeviceId: number,
    senderJid: string,
    envelope: EncryptedEnvelope
  ): Promise<string | null> {
    const store = this.deps.createStore(accountId);
    const crypto = this.deps.crypto;
    const ourKey = envelope.keys.find((k) => k.rid === ownDeviceId);
    if (!ourKey) return null;

    // Decrypt the wrapped AES key + GCM tag.
    const address = new SignalProtocolAddress(senderJid, envelope.sid);
    const cipher = new SessionCipher(store as any, address);
    let keyAndTag: ArrayBuffer;
    if (ourKey.isPreKey) {
      keyAndTag = await cipher.decryptPreKeyWhisperMessage(arrayBufferToString(ourKey.body), "binary");
    } else {
      keyAndTag = await cipher.decryptWhisperMessage(arrayBufferToString(ourKey.body), "binary");
    }

    // Split into AES key (16 bytes) + tag (16 bytes).
    const ktBytes = new Uint8Array(keyAndTag);
    const aesKeyRaw = ktBytes.slice(0, 16);
    const tag = ktBytes.slice(16, 32);

    // Reconstruct ciphertext + tag for AES-GCM decrypt.
    const payloadBytes = new Uint8Array(envelope.payload);
    const ctWithTag = new Uint8Array(payloadBytes.byteLength + tag.byteLength);
    ctWithTag.set(payloadBytes, 0);
    ctWithTag.set(tag, payloadBytes.byteLength);

    const aesKey = await crypto.importAesKey(toOwnedArrayBuffer(aesKeyRaw));
    const plaintext = await crypto.decryptAesGcm({
      key: aesKey,
      iv: envelope.iv,
      ciphertextWithTag: toOwnedArrayBuffer(ctWithTag),
    });

    return new TextDecoder().decode(plaintext);
  }
}

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

function toOwnedArrayBuffer(view: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (view instanceof ArrayBuffer) return view;
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}
