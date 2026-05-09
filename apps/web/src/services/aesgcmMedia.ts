/**
 * aesgcmMedia.ts — Fetch and decrypt aesgcm:// URLs (XEP-0454 OMEMO Media Sharing).
 *
 * An aesgcm:// URL has the form:
 *   aesgcm://files.example.com/abc123.jpg#48HEXCHARS_OR_88HEXCHARS
 *
 * The fragment contains key material in hex:
 *   - 48 hex chars  (24 bytes): 12-byte IV + 16-byte AES-128 key  (older)
 *   - 88 hex chars  (44 bytes): 12-byte IV + 32-byte AES-256 key  (current — Conversations 2.6+)
 *   - 96 hex chars  (48 bytes): 16-byte IV + 32-byte AES-256 key  (some clients)
 *
 * The encrypted blob is downloaded over plain HTTPS, decrypted with AES-GCM,
 * and exposed as an Object URL the browser can load into <img>/<audio>/<video>.
 *
 * Cache: each URL is decrypted once per session; result is held as a blob URL.
 * Caller is responsible for revoking the URL when the message scrolls away
 * (or just letting the page lifecycle handle it).
 */

interface AesgcmParts {
  /** https URL of the encrypted blob */
  ciphertextUrl: string;
  /** AES-GCM IV (12 or 16 bytes) */
  iv: Uint8Array;
  /** AES key (16 or 32 bytes) */
  key: Uint8Array;
  /** filename from URL path (best-effort) */
  fileName: string;
}

/**
 * Parse an aesgcm:// URL into its parts.
 * Returns null on any malformed input.
 */
export function parseAesgcmUrl(raw: string): AesgcmParts | null {
  const text = (raw || "").trim();
  if (!text.startsWith("aesgcm://")) return null;
  const rest = text.slice("aesgcm://".length);
  const hashIdx = rest.indexOf("#");
  if (hashIdx < 0) return null;

  const pathPart = rest.slice(0, hashIdx);
  const hex = rest.slice(hashIdx + 1).trim().toLowerCase();
  if (!/^[0-9a-f]+$/.test(hex)) return null;

  // Decode hex into bytes
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }

  // Layout matrix:
  //  24 bytes (48 hex)  → 12B IV + 16B key (AES-128)
  //  44 bytes (88 hex)  → 12B IV + 32B key (AES-256, current)
  //  48 bytes (96 hex)  → 16B IV + 32B key (AES-256, some clients)
  let iv: Uint8Array;
  let key: Uint8Array;
  if (bytes.length === 24) {
    iv = bytes.slice(0, 12);
    key = bytes.slice(12);
  } else if (bytes.length === 44) {
    iv = bytes.slice(0, 12);
    key = bytes.slice(12);
  } else if (bytes.length === 48) {
    iv = bytes.slice(0, 16);
    key = bytes.slice(16);
  } else {
    return null;
  }

  // The path portion goes through https. If pathPart already starts with
  // "https://" or has a scheme, preserve as-is; otherwise prepend https://.
  let ciphertextUrl: string;
  if (/^https?:\/\//i.test(pathPart)) {
    ciphertextUrl = pathPart;
  } else {
    ciphertextUrl = `https://${pathPart}`;
  }

  const fileName = (pathPart.split("/").pop() || "file").split("?")[0];

  return { ciphertextUrl, iv, key, fileName };
}

/** Cache of decrypted blob URLs keyed by aesgcm:// URL */
const blobUrlCache = new Map<string, string>();

/** Pending decryptions keyed by aesgcm URL — share work between concurrent callers */
const inflight = new Map<string, Promise<string>>();

/**
 * Fetch and decrypt an aesgcm:// URL, returning a blob: URL the browser can render.
 *
 * Throws on network error, key length mismatch, or AES-GCM auth failure
 * (which usually means key/IV wrong or ciphertext tampered).
 */
export async function fetchAndDecryptAesgcm(
  rawUrl: string,
  opts?: { signal?: AbortSignal; accountId?: string | null },
): Promise<string> {
  const cached = blobUrlCache.get(rawUrl);
  if (cached) return cached;

  const existing = inflight.get(rawUrl);
  if (existing) return existing;

  const promise = (async () => {
    const parts = parseAesgcmUrl(rawUrl);
    if (!parts) throw new Error("Invalid aesgcm:// URL");

    // If the ciphertext URL is hosted on our own /files/ proxy (which is now
    // gated by nginx auth_request), append the user's bearer token as ?t=<token>
    // so the request is allowed through. Cross-origin URLs (e.g. peer's HTTP
    // upload service) are fetched without credentials as before.
    let downloadUrl = parts.ciphertextUrl;
    let useCredentials: RequestCredentials = "omit";
    try {
      const u = new URL(parts.ciphertextUrl, window.location.origin);
      if (u.origin === window.location.origin && u.pathname.startsWith("/files/")) {
        const { signedFilesUrl } = await import("./api");
        downloadUrl = signedFilesUrl(parts.ciphertextUrl, opts?.accountId ?? null);
        useCredentials = "same-origin";
      }
    } catch {}

    // 1. Download ciphertext
    const resp = await fetch(downloadUrl, {
      signal: opts?.signal,
      credentials: useCredentials,
      cache: "force-cache",
    });
    if (!resp.ok) {
      throw new Error(`Download failed: HTTP ${resp.status}`);
    }
    const ciphertext = await resp.arrayBuffer();

    // 2. Import key
    let cryptoKey: CryptoKey;
    try {
      const rawKey = new Uint8Array(parts.key);
      cryptoKey = await globalThis.crypto.subtle.importKey(
        "raw",
        rawKey,
        { name: "AES-GCM", length: parts.key.length * 8 },
        false,
        ["decrypt"],
      );
    } catch (e) {
      throw new Error(`Key import failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    // 3. Decrypt — WebCrypto AES-GCM expects ciphertext with the 16-byte tag
    // appended at the end, which is exactly what XEP-0454 produces.
    let plaintext: ArrayBuffer;
    try {
      plaintext = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: new Uint8Array(parts.iv), tagLength: 128 },
        cryptoKey,
        ciphertext,
      );
    } catch (e) {
      throw new Error(`AES-GCM decrypt failed (key/IV mismatch or tampered): ${e instanceof Error ? e.message : String(e)}`);
    }

    // 4. Wrap as blob — no Content-Type since we don't know it from XEP-0454.
    // Browser will sniff for <img>/<audio> elements based on data.
    const blob = new Blob([plaintext]);
    const blobUrl = URL.createObjectURL(blob);
    blobUrlCache.set(rawUrl, blobUrl);
    return blobUrl;
  })();

  inflight.set(rawUrl, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(rawUrl);
  }
}

/**
 * Release the cached blob URL for a given aesgcm:// URL.
 * Call when a message is removed from view, or on logout.
 */
export function revokeAesgcmBlobUrl(rawUrl: string): void {
  const url = blobUrlCache.get(rawUrl);
  if (url) {
    try {
      URL.revokeObjectURL(url);
    } catch {}
    blobUrlCache.delete(rawUrl);
  }
}

/**
 * Release ALL cached blob URLs. Useful on account switch / logout.
 */
export function revokeAllAesgcmBlobs(): void {
  for (const url of blobUrlCache.values()) {
    try {
      URL.revokeObjectURL(url);
    } catch {}
  }
  blobUrlCache.clear();
}

/**
 * Encrypt a Blob using a fresh random AES-256 key + 12-byte IV.
 * Returns ciphertext + the URL fragment (`#hex`) that should be appended
 * to the upload URL to form an `aesgcm://` link.
 *
 * Used when sending an attachment that needs OMEMO-style transport encryption.
 */
export async function encryptForAesgcm(plaintext: Blob): Promise<{
  ciphertext: Blob;
  fragment: string;
}> {
  const keyBytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength),
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const plaintextBuf = await plaintext.arrayBuffer();
  const ciphertextBuf = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    cryptoKey,
    plaintextBuf,
  );

  // Fragment = hex(iv) + hex(key); 12 + 32 bytes = 88 hex chars
  const toHex = (b: Uint8Array): string =>
    Array.from(b)
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  const fragment = toHex(iv) + toHex(keyBytes);

  return {
    ciphertext: new Blob([ciphertextBuf], { type: "application/octet-stream" }),
    fragment,
  };
}
