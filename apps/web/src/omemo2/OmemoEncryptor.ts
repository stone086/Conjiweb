import { DeviceManager } from "./DeviceManager";
import { SessionManager } from "./SessionManager";
import { TrustManager } from "./TrustManager";
import { OmemoStore } from "./OmemoStore";
import { OmemoXml } from "./OmemoXml";
import { encryptPayload, generateMessageKey } from "./aesGcm";

export class OmemoEncryptor {
  constructor(
    private readonly store: OmemoStore,
    private readonly devices: DeviceManager,
    private readonly sessions: SessionManager,
    private readonly trust: TrustManager,
    private readonly xml: OmemoXml
  ) {}

  async encrypt(toJid: string, plaintext: string): Promise<string> {
    const targetDevices = await this.devices.getTargetDevices(toJid);
    const messageKey = generateMessageKey();
    const payload = await encryptPayload(plaintext, messageKey);
    const keys = [];

    for (const device of targetDevices) {
      const state = await this.trust.getTrustState(device.jid, device.deviceId);
      if (state === "blocked") continue;

      const encryptedKey = await this.sessions.encryptKeyForDevice(device.jid, device.deviceId, messageKey);
      keys.push({ rid: device.deviceId, key: encryptedKey, preKey: state !== "trusted" });
    }

    return this.xml.buildEncryptedMessageXml({
      sid: this.store.getCurrentDeviceId(),
      keys,
      payload
    });
  }
}
