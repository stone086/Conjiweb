import type { OmemoTrustState } from "./types";

export class OmemoStore {
  private accountJid: string | null = null;
  private ownDeviceId: number | null = null;

  async ensureIdentity(accountJid: string): Promise<{ accountJid: string; deviceId: number }> {
    this.accountJid = accountJid;

    const deviceKey = `conjiweb2:deviceId:${accountJid}`;
    const existingDeviceId = localStorage.getItem(deviceKey);

    if (existingDeviceId) {
      this.ownDeviceId = Number(existingDeviceId);
    } else {
      this.ownDeviceId = Math.floor(Math.random() * 2147483646) + 1;
      localStorage.setItem(deviceKey, String(this.ownDeviceId));
    }

    const identityKey = `conjiweb2:identity:${accountJid}`;
    if (!localStorage.getItem(identityKey)) {
      localStorage.setItem(identityKey, JSON.stringify({
        createdAt: Date.now(),
        note: "TODO: replace with real Signal identity key pair"
      }));
    }

    return { accountJid, deviceId: this.ownDeviceId };
  }

  getCurrentAccountJid(): string {
    if (!this.accountJid) throw new Error("OMEMO2 account is not initialized.");
    return this.accountJid;
  }

  getCurrentDeviceId(): number {
    if (!this.ownDeviceId) throw new Error("OMEMO2 device is not initialized.");
    return this.ownDeviceId;
  }

  async loadSession(jid: string, deviceId: number): Promise<unknown | null> {
    const raw = localStorage.getItem(`conjiweb2:session:${jid}:${deviceId}`);
    return raw ? JSON.parse(raw) : null;
  }

  async saveSession(jid: string, deviceId: number, record: unknown): Promise<void> {
    localStorage.setItem(`conjiweb2:session:${jid}:${deviceId}`, JSON.stringify(record));
  }

  async getTrust(jid: string, deviceId: number): Promise<OmemoTrustState> {
    return (localStorage.getItem(`conjiweb2:trust:${jid}:${deviceId}`) as OmemoTrustState | null) ?? "unknown";
  }

  async setTrust(jid: string, deviceId: number, state: OmemoTrustState): Promise<void> {
    localStorage.setItem(`conjiweb2:trust:${jid}:${deviceId}`, state);
  }
}
