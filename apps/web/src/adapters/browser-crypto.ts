/**
 * adapters/browser-crypto.ts
 *
 * Browser WebCrypto implementation for the platform-neutral OMEMO engine.
 */
import type { OmemoCryptoAdapter } from "../core/omemo/engine";

function toOwnedArrayBuffer(view: Uint8Array | ArrayBuffer): ArrayBuffer {
  if (view instanceof ArrayBuffer) return view;
  const copy = new Uint8Array(view.byteLength);
  copy.set(view);
  return copy.buffer;
}

export const browserCrypto: OmemoCryptoAdapter = {
  randomBytes(length: number): Uint8Array {
    return globalThis.crypto.getRandomValues(new Uint8Array(length));
  },

  async generateAesKey(): Promise<CryptoKey> {
    return globalThis.crypto.subtle.generateKey(
      { name: "AES-GCM", length: 128 },
      true,
      ["encrypt", "decrypt"]
    );
  },

  async exportAesKey(key: CryptoKey): Promise<ArrayBuffer> {
    return globalThis.crypto.subtle.exportKey("raw", key);
  },

  async importAesKey(raw: ArrayBuffer): Promise<CryptoKey> {
    return globalThis.crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM", length: 128 },
      false,
      ["decrypt"]
    );
  },

  async encryptAesGcm({ key, iv, plaintext }): Promise<ArrayBuffer> {
    return globalThis.crypto.subtle.encrypt(
      { name: "AES-GCM", iv: toOwnedArrayBuffer(iv), tagLength: 128 },
      key,
      toOwnedArrayBuffer(plaintext)
    );
  },

  async decryptAesGcm({ key, iv, ciphertextWithTag }): Promise<ArrayBuffer> {
    return globalThis.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toOwnedArrayBuffer(iv), tagLength: 128 },
      key,
      ciphertextWithTag
    );
  },
};
