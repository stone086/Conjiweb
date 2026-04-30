import { OmemoStore } from "./OmemoStore";
import { SessionManager } from "./SessionManager";
import { OmemoXml } from "./OmemoXml";
import { decryptPayload } from "./aesGcm";

export class OmemoDecryptor {
  constructor(
    private readonly store: OmemoStore,
    private readonly sessions: SessionManager,
    private readonly xml: OmemoXml
  ) {}

  async decrypt(fromJid: string, stanzaXml: string): Promise<string> {
    const parsed = this.xml.parseEncryptedMessageXml(stanzaXml);
    const currentDeviceId = this.store.getCurrentDeviceId();
    const matchingKey = parsed.keys.find((item) => item.rid === currentDeviceId);

    if (!matchingKey) {
      throw new Error(`No OMEMO key for current device: ${currentDeviceId}`);
    }

    const messageKey = await this.sessions.decryptKeyFromDevice(fromJid, parsed.senderDeviceId, matchingKey.key);
    return decryptPayload(parsed.payload, messageKey);
  }
}
