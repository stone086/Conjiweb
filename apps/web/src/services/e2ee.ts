import { normalizeBareJid } from "@/utils/helpers";

const KEY_PREFIX = "conjiweb-e2ee-keypair:";
const PEER_PREFIX = "conjiweb-e2ee-peer:";
const DEVICE_PREFIX = "conjiweb-e2ee-device:";
const BUNDLE_PREFIX = "conjiweb-e2ee-bundle:";
const KEY_EXCHANGE_PREFIX = "[[E2EEKEY1]]";
const CIPHER_PREFIX = "[[E2EE1]]";

export const OMEMO_NAMESPACE = "eu.siacs.conversations.axolotl";

export interface OmemoEnvelopeKey {
  rid: number;
  value: string;
  prekey?: boolean;
}

export interface OmemoEnvelope {
  namespace: string;
  sid: number;
  iv: string;
  keys: OmemoEnvelopeKey[];
  payload: string;
}

export interface OmemoBundle {
  deviceId: number;
  signedPreKeyId: number;
  signedPreKeyPublic: string;
  signedPreKeySignature: string;
  identityKey: string;
  preKeys: Array<{ preKeyId: number; value: string }>;
}

interface StoredKeyPair {
  privateJwk: JsonWebKey;
  publicRawB64: string;
}

interface PeerKeyInfo {
  publicRawB64: string;
  deviceId?: number;
}

interface KeyExchangeInfo {
  publicRawB64: string;
  deviceId?: number;
}

function keyPairStoreKey(accountId: string) {
  return `${KEY_PREFIX}${accountId}`;
}

function peerStoreKey(accountId: string) {
  return `${PEER_PREFIX}${accountId}`;
}

function deviceStoreKey(accountId: string) {
  return `${DEVICE_PREFIX}${accountId}`;
}

function bundleStoreKey(accountId: string) {
  return `${BUNDLE_PREFIX}${accountId}`;
}

function toB64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
}

function fromB64(b64: string): Uint8Array {
  const binary = atob(b64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function fromB64Buffer(b64: string): ArrayBuffer {
  return fromB64(b64).buffer as ArrayBuffer;
}

function ensureDeviceId(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const int = Math.trunc(value);
  return int > 0 ? int : undefined;
}

function normalizePeerMap(raw: unknown): Record<string, PeerKeyInfo> {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;
  const normalized: Record<string, PeerKeyInfo> = {};
  Object.entries(input).forEach(([jid, value]) => {
    if (typeof value === "string") {
      normalized[jid] = { publicRawB64: value };
      return;
    }
    if (!value || typeof value !== "object") return;
    const typed = value as { publicRawB64?: unknown; deviceId?: unknown; key?: unknown };
    const pub = typeof typed.publicRawB64 === "string"
      ? typed.publicRawB64
      : (typeof typed.key === "string" ? typed.key : "");
    if (!pub) return;
    normalized[jid] = { publicRawB64: pub, deviceId: ensureDeviceId(typed.deviceId) };
  });
  return normalized;
}

function getPeerMap(accountId: string): Record<string, PeerKeyInfo> {
  try {
    const raw = localStorage.getItem(peerStoreKey(accountId));
    if (!raw) return {};
    return normalizePeerMap(JSON.parse(raw));
  } catch {
    return {};
  }
}

function setPeerMap(accountId: string, peers: Record<string, PeerKeyInfo>) {
  localStorage.setItem(peerStoreKey(accountId), JSON.stringify(peers));
}

function getBundleMap(accountId: string): Record<string, OmemoBundle> {
  try {
    const raw = localStorage.getItem(bundleStoreKey(accountId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, OmemoBundle>;
  } catch {
    return {};
  }
}

function setBundleMap(accountId: string, bundles: Record<string, OmemoBundle>) {
  localStorage.setItem(bundleStoreKey(accountId), JSON.stringify(bundles));
}

function getPeerInfo(accountId: string, peerJid: string): PeerKeyInfo | null {
  const normalizedPeer = normalizeBareJid(peerJid);
  const peers = getPeerMap(accountId);
  return peers[normalizedPeer] ?? null;
}

function getPeerBundles(accountId: string, peerJid: string): OmemoBundle[] {
  const normalizedPeer = normalizeBareJid(peerJid);
  const bundles = getBundleMap(accountId);
  return Object.entries(bundles)
    .filter(([k]) => k.startsWith(`${normalizedPeer}:`))
    .map(([, v]) => v);
}

export function getOrCreateLocalDeviceId(accountId: string): number {
  const key = deviceStoreKey(accountId);
  const existing = ensureDeviceId(Number(localStorage.getItem(key)));
  if (existing) return existing;
  const random = crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff;
  const created = Math.max(1, random);
  localStorage.setItem(key, String(created));
  return created;
}

export async function getOrCreateLocalKeyPair(accountId: string): Promise<StoredKeyPair> {
  const storeKey = keyPairStoreKey(accountId);
  const existing = localStorage.getItem(storeKey);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as StoredKeyPair;
      if (parsed?.privateJwk && parsed?.publicRawB64) return parsed;
    } catch {
      // regenerate
    }
  }

  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );
  const privateJwk = (await crypto.subtle.exportKey("jwk", keyPair.privateKey)) as JsonWebKey;
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const created: StoredKeyPair = { privateJwk, publicRawB64: toB64(publicRaw) };
  localStorage.setItem(storeKey, JSON.stringify(created));
  return created;
}

export async function getOrCreateLocalOmemoBundle(accountId: string): Promise<OmemoBundle> {
  const deviceId = getOrCreateLocalDeviceId(accountId);
  const map = getBundleMap(accountId);
  const existing = map[String(deviceId)];
  if (existing?.identityKey && existing?.signedPreKeyPublic && existing?.preKeys?.length) return existing;

  const identity = await getOrCreateLocalKeyPair(accountId);
  const signedPreKey = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"]
  );
  const signedPreKeyPublic = toB64(new Uint8Array(await crypto.subtle.exportKey("raw", signedPreKey.publicKey)));
  const signMaterial = `${identity.publicRawB64}.${signedPreKeyPublic}.${deviceId}`;
  const signature = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(signMaterial));
  const signedPreKeySignature = toB64(new Uint8Array(signature));
  const preKeys = await Promise.all(Array.from({ length: 20 }).map(async (_, i) => {
    const keyPair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveKey"]
    );
    return {
      preKeyId: i + 1,
      value: toB64(new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))),
    };
  }));
  const bundle: OmemoBundle = {
    deviceId,
    signedPreKeyId: 1,
    signedPreKeyPublic,
    signedPreKeySignature,
    identityKey: identity.publicRawB64,
    preKeys,
  };
  map[String(deviceId)] = bundle;
  setBundleMap(accountId, map);
  return bundle;
}

async function importPrivateKey(privateJwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
}

async function importPublicKey(rawB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromB64Buffer(rawB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
}

async function deriveSessionKeyWithPeerPublic(accountId: string, peerPublicRawB64: string): Promise<CryptoKey | null> {
  const local = await getOrCreateLocalKeyPair(accountId);
  const privateKey = await importPrivateKey(local.privateJwk);
  const publicKey = await importPublicKey(peerPublicRawB64);
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function deriveSessionKey(accountId: string, peerJid: string): Promise<CryptoKey | null> {
  const peer = getPeerInfo(accountId, peerJid);
  if (!peer?.publicRawB64) return null;
  return deriveSessionKeyWithPeerPublic(accountId, peer.publicRawB64);
}

function concatUint8(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export async function buildKeyExchangePayload(accountId: string): Promise<string> {
  const local = await getOrCreateLocalKeyPair(accountId);
  const payload = {
    v: 2,
    deviceId: getOrCreateLocalDeviceId(accountId),
    pub: local.publicRawB64,
  };
  return `${KEY_EXCHANGE_PREFIX}${JSON.stringify(payload)}`;
}

export function parseKeyExchangePayload(body: string): KeyExchangeInfo | null {
  if (!body.startsWith(KEY_EXCHANGE_PREFIX)) return null;
  const raw = body.slice(KEY_EXCHANGE_PREFIX.length).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { pub?: unknown; deviceId?: unknown };
    if (typeof parsed.pub === "string" && parsed.pub) {
      return { publicRawB64: parsed.pub, deviceId: ensureDeviceId(parsed.deviceId) };
    }
  } catch {
    // backward compatibility
  }
  return { publicRawB64: raw };
}

export function storePeerPublicKey(accountId: string, peerJid: string, info: string | KeyExchangeInfo) {
  const normalizedPeer = normalizeBareJid(peerJid);
  const peers = getPeerMap(accountId);
  if (typeof info === "string") {
    peers[normalizedPeer] = { publicRawB64: info, deviceId: peers[normalizedPeer]?.deviceId };
  } else {
    peers[normalizedPeer] = {
      publicRawB64: info.publicRawB64,
      deviceId: info.deviceId ?? peers[normalizedPeer]?.deviceId,
    };
  }
  setPeerMap(accountId, peers);
}

export function storePeerOmemoBundle(accountId: string, peerJid: string, bundle: OmemoBundle) {
  const normalizedPeer = normalizeBareJid(peerJid);
  const map = getBundleMap(accountId);
  map[`${normalizedPeer}:${bundle.deviceId}`] = bundle;
  setBundleMap(accountId, map);
  storePeerPublicKey(accountId, normalizedPeer, {
    publicRawB64: bundle.signedPreKeyPublic || bundle.identityKey,
    deviceId: bundle.deviceId,
  });
}

export async function encryptOmemoEnvelopeForPeer(
  accountId: string,
  peerJid: string,
  plainText: string
): Promise<{ envelope: OmemoEnvelope | null; usedPeerKey: boolean }> {
  const peerBundles = getPeerBundles(accountId, peerJid);
  const peer = getPeerInfo(accountId, peerJid);
  const targets: Array<{ rid: number; publicRawB64: string }> = [];
  peerBundles.forEach((bundle) => {
    const pub = bundle.signedPreKeyPublic || bundle.identityKey;
    if (!pub) return;
    targets.push({ rid: bundle.deviceId, publicRawB64: pub });
  });
  if (targets.length === 0 && peer?.publicRawB64) {
    targets.push({ rid: peer.deviceId ?? 1, publicRawB64: peer.publicRawB64 });
  }
  if (targets.length === 0) return { envelope: null, usedPeerKey: false };

  const localSid = getOrCreateLocalDeviceId(accountId);
  const messageKey = crypto.getRandomValues(new Uint8Array(32));
  const messageIv = crypto.getRandomValues(new Uint8Array(12));
  const payloadCipher = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: messageIv },
      await crypto.subtle.importKey("raw", messageKey, { name: "AES-GCM" }, false, ["encrypt"]),
      new TextEncoder().encode(plainText)
    )
  );
  const keys: OmemoEnvelopeKey[] = [];
  for (const target of targets) {
    const sessionKey = await deriveSessionKeyWithPeerPublic(accountId, target.publicRawB64);
    if (!sessionKey) continue;
    const keyIv = crypto.getRandomValues(new Uint8Array(12));
    const wrappedKey = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-GCM", iv: keyIv }, sessionKey, messageKey)
    );
    keys.push({
      rid: target.rid,
      value: toB64(concatUint8(keyIv, wrappedKey)),
      prekey: true,
    });
  }
  if (keys.length === 0) return { envelope: null, usedPeerKey: false };
  return {
    usedPeerKey: true,
    envelope: {
      namespace: OMEMO_NAMESPACE,
      sid: localSid,
      iv: toB64(messageIv),
      keys,
      payload: toB64(payloadCipher),
    },
  };
}

export async function decryptOmemoEnvelopeFromPeer(
  accountId: string,
  peerJid: string,
  envelope: OmemoEnvelope
): Promise<string | null> {
  if (envelope.namespace !== OMEMO_NAMESPACE) return null;
  const sessionKey = await deriveSessionKey(accountId, peerJid);
  if (!sessionKey) return null;
  const localRid = getOrCreateLocalDeviceId(accountId);
  const wrappedForMe = envelope.keys.find((k) => k.rid === localRid) ?? envelope.keys[0];
  if (!wrappedForMe?.value) return null;
  try {
    const packed = fromB64(wrappedForMe.value);
    if (packed.length <= 12) return null;
    const keyIv = packed.slice(0, 12);
    const wrappedKey = packed.slice(12);
    const messageKeyRaw = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: keyIv },
      sessionKey,
      wrappedKey
    );
    const msgKey = await crypto.subtle.importKey("raw", messageKeyRaw, { name: "AES-GCM" }, false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64Buffer(envelope.iv) },
      msgKey,
      fromB64Buffer(envelope.payload)
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

export function isEncryptedPayload(body: string): boolean {
  return body.startsWith(CIPHER_PREFIX);
}

export async function decryptBodyFromPeer(
  accountId: string,
  peerJid: string,
  body: string
): Promise<string | null> {
  if (!isEncryptedPayload(body)) return body;
  const sessionKey = await deriveSessionKey(accountId, peerJid);
  if (!sessionKey) return null;
  try {
    const raw = body.slice(CIPHER_PREFIX.length);
    const parsed = JSON.parse(raw) as { iv: string; ct: string };
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64Buffer(parsed.iv) },
      sessionKey,
      fromB64Buffer(parsed.ct)
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

