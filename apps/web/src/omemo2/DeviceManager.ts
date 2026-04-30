import { OmemoStore } from "./OmemoStore";
import type { OmemoDevice } from "./types";

export class DeviceManager {
  constructor(private readonly store: OmemoStore) {}

  async publishOwnDeviceList(): Promise<void> {
    console.info("[OMEMO2] TODO publish own device list", this.store.getCurrentDeviceId());
  }

  async fetchDeviceList(jid: string): Promise<OmemoDevice[]> {
    return [{ jid, deviceId: 1001, label: "placeholder-device" }];
  }

  async getTargetDevices(toJid: string): Promise<OmemoDevice[]> {
    const remoteDevices = await this.fetchDeviceList(toJid);
    return remoteDevices;
  }
}
