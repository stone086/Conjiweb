/**
 * OMEMO compatibility wrapper.
 *
 * This repo currently uses services/e2ee.ts as the active crypto path.
 * Keep this file's API surface stable for xmppBridge imports.
 */
import {
  encryptOmemoEnvelopeForPeer,
  decryptOmemoEnvelopeFromPeer,
  type OmemoBundle,
  type OmemoEnvelope,
} from "@/services/e2ee";

export const NS_OMEMO = "urn:xmpp:omemo:2";

export interface PeerBundleInput {
  deviceId: number;
  identityKey: ArrayBuffer;
  signedPreKeyId: number;
  signedPreKey: ArrayBuffer;
  signedPreKeySignature: ArrayBuffer;
  preKey?: {
    keyId: number;
    publicKey: ArrayBuffer;
  };
}

export interface PeerDeviceInput {
  peerJid: string;
  deviceId: number;
}

export interface EncryptedEnvelope {
  sid: number;
  iv: ArrayBuffer;
  payload: ArrayBuffer;
  keys: Array<{
    rid: number;
    isPreKey: boolean;
    body: ArrayBuffer;
  }>;
}

function abToB64(ab: ArrayBuffer): string {
  const bytes = new Uint8Array(ab);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function b64ToAb(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function toLegacyBundle(bundle: PeerBundleInput): OmemoBundle {
  const preKeys = bundle.preKey
    ? [{ preKeyId: bundle.preKey.keyId, value: abToB64(bundle.preKey.publicKey) }]
    : [];
  return {
    deviceId: bundle.deviceId,
    signedPreKeyId: bundle.signedPreKeyId,
    signedPreKeyPublic: abToB64(bundle.signedPreKey),
    signedPreKeySignature: abToB64(bundle.signedPreKeySignature),
    identityKey: abToB64(bundle.identityKey),
    preKeys,
  };
}

/**
 * Kept for API compatibility. In current implementation, we persist peer bundle.
 */
export async function establishSession(accountId: string, peerJid: string, peerBundle: PeerBundleInput): Promise<void> {
  const { storePeerOmemoBundle } = await import("@/services/e2ee");
  await storePeerOmemoBundle(accountId, peerJid, toLegacyBundle(peerBundle));
}

/**
 * Encrypt plaintext for peer devices.
 * Current e2ee path returns legacy envelope shape; convert to ArrayBuffer shape.
 */
export async function encryptForDevices(
  accountId: string,
  _ownDeviceId: number,
  plaintext: string,
  peerDevices: PeerDeviceInput[]
): Promise<EncryptedEnvelope> {
  const peerJid = peerDevices[0]?.peerJid;
  if (!peerJid) throw new Error("No peer devices provided");
  const result = await encryptOmemoEnvelopeForPeer(accountId, peerJid, plaintext);
  const envelope = result.envelope;
  if (!envelope) throw new Error("OMEMO encryption failed");

  return {
    sid: envelope.sid,
    iv: b64ToAb(envelope.iv),
    payload: b64ToAb(envelope.payload),
    keys: envelope.keys.map((k: { rid: number; value: string; prekey?: boolean }) => ({
      rid: k.rid,
      isPreKey: k.prekey === true,
      body: b64ToAb(k.value),
    })),
  };
}

export async function decryptEnvelope(
  accountId: string,
  _ownDeviceId: number,
  senderJid: string,
  envelope: EncryptedEnvelope
): Promise<string | null> {
  const legacyEnvelope: OmemoEnvelope = {
    namespace: "eu.siacs.conversations.axolotl",
    sid: envelope.sid,
    iv: abToB64(envelope.iv),
    payload: abToB64(envelope.payload),
    keys: envelope.keys.map((k) => ({
      rid: k.rid,
      value: abToB64(k.body),
      prekey: k.isPreKey,
    })),
  };
  return decryptOmemoEnvelopeFromPeer(accountId, senderJid, legacyEnvelope);
}
