import { OmemoStore } from "./OmemoStore";
import { BundleManager } from "./BundleManager";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export class SessionManager {
  constructor(
    private readonly store: OmemoStore,
    private readonly bundles: BundleManager
  ) {}

  async ensureSession(jid: string, deviceId: number): Promise<unknown> {
    const existing = await this.store.loadSession(jid, deviceId);
    if (existing) return existing;

    const bundle = await this.bundles.fetchBundle(jid, deviceId);
    if (!this.bundles.validateBundle(bundle)) {
      throw new Error(`Invalid OMEMO bundle: ${jid}/${deviceId}`);
    }

    const session = {
      createdAt: Date.now(),
      note: "TODO: replace with real Signal session record"
    };

    await this.store.saveSession(jid, deviceId, session);
    return session;
  }

  async encryptKeyForDevice(jid: string, deviceId: number, messageKey: Uint8Array): Promise<string> {
    await this.ensureSession(jid, deviceId);
    return bytesToBase64(messageKey);
  }

  async decryptKeyFromDevice(jid: string, senderDeviceId: number, encryptedKey: string): Promise<Uint8Array> {
    await this.ensureSession(jid, senderDeviceId);
    return base64ToBytes(encryptedKey);
  }
}
