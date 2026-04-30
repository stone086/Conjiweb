import { OmemoStore } from "./OmemoStore";
import type { OmemoTrustState } from "./types";

export class TrustManager {
  constructor(private readonly store: OmemoStore) {}

  async getTrustState(jid: string, deviceId: number): Promise<OmemoTrustState> {
    return this.store.getTrust(jid, deviceId);
  }

  async trustDevice(jid: string, deviceId: number): Promise<void> {
    await this.store.setTrust(jid, deviceId, "trusted");
  }

  async untrustDevice(jid: string, deviceId: number): Promise<void> {
    await this.store.setTrust(jid, deviceId, "untrusted");
  }

  async blockDevice(jid: string, deviceId: number): Promise<void> {
    await this.store.setTrust(jid, deviceId, "blocked");
  }
}
