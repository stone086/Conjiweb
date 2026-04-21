import { normalizeBareJid } from "@/utils/helpers";

const KEY_PREFIX = "conjiweb-e2ee-keypair:";
const PEER_PREFIX = "conjiweb-e2ee-peer:";
const KEY_EXCHANGE_PREFIX = "[[E2EEKEY1]]";
const CIPHER_PREFIX = "[[E2EE1]]";

interface StoredKeyPair {
  privateJwk: JsonWebKey;
  publicRawB64: string;
}

function keyPairStoreKey(accountId: string) {
  return `${KEY_PREFIX}${accountId}`;
}

function peerStoreKey(accountId: string) {
  return `${PEER_PREFIX}${accountId}`;
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

function getPeerMap(accountId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(peerStoreKey(accountId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

function setPeerMap(accountId: string, peers: Record<string, string>) {
  localStorage.setItem(peerStoreKey(accountId), JSON.stringify(peers));
}

export async function getOrCreateLocalKeyPair(accountId: string): Promise<StoredKeyPair> {
  const storeKey = keyPairStoreKey(accountId);
  const existing = localStorage.getItem(storeKey);
  if (existing) {
    try {
      const parsed = JSON.parse(existing) as StoredKeyPair;
      if (parsed?.privateJwk && parsed?.publicRawB64) return parsed;
    } catch {
      // fall through and regenerate
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

async function importPrivateKey(privateJwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"]);
}

async function importPublicKey(rawB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromB64Buffer(rawB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
}

async function deriveAesKey(accountId: string, peerJid: string): Promise<CryptoKey | null> {
  const normalizedPeer = normalizeBareJid(peerJid);
  const peers = getPeerMap(accountId);
  const peerRawB64 = peers[normalizedPeer];
  if (!peerRawB64) return null;
  const local = await getOrCreateLocalKeyPair(accountId);
  const privateKey = await importPrivateKey(local.privateJwk);
  const publicKey = await importPublicKey(peerRawB64);
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: publicKey },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function buildKeyExchangePayload(accountId: string): Promise<string> {
  const local = await getOrCreateLocalKeyPair(accountId);
  return `${KEY_EXCHANGE_PREFIX}${local.publicRawB64}`;
}

export function parseKeyExchangePayload(body: string): string | null {
  if (!body.startsWith(KEY_EXCHANGE_PREFIX)) return null;
  const raw = body.slice(KEY_EXCHANGE_PREFIX.length).trim();
  return raw || null;
}

export function storePeerPublicKey(accountId: string, peerJid: string, publicRawB64: string) {
  const normalizedPeer = normalizeBareJid(peerJid);
  const peers = getPeerMap(accountId);
  peers[normalizedPeer] = publicRawB64;
  setPeerMap(accountId, peers);
}

export async function encryptBodyForPeer(
  accountId: string,
  peerJid: string,
  plainText: string
): Promise<{ encryptedBody: string; usedPeerKey: boolean }> {
  const aesKey = await deriveAesKey(accountId, peerJid);
  if (!aesKey) return { encryptedBody: plainText, usedPeerKey: false };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plainText);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aesKey, encoded));
  const payload = JSON.stringify({
    iv: toB64(iv),
    ct: toB64(cipher),
  });
  return { encryptedBody: `${CIPHER_PREFIX}${payload}`, usedPeerKey: true };
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
  const aesKey = await deriveAesKey(accountId, peerJid);
  if (!aesKey) return null;
  try {
    const raw = body.slice(CIPHER_PREFIX.length);
    const parsed = JSON.parse(raw) as { iv: string; ct: string };
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromB64Buffer(parsed.iv) },
      aesKey,
      fromB64Buffer(parsed.ct)
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
