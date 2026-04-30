import { OmemoStore } from "./OmemoStore";
import { DeviceManager } from "./DeviceManager";
import { BundleManager } from "./BundleManager";
import { SessionManager } from "./SessionManager";
import { TrustManager } from "./TrustManager";
import { OmemoXml } from "./OmemoXml";
import { OmemoEncryptor } from "./OmemoEncryptor";
import { OmemoDecryptor } from "./OmemoDecryptor";

export class OmemoCore {
  private initialized = false;

  constructor(
    public readonly store: OmemoStore,
    public readonly devices: DeviceManager,
    public readonly bundles: BundleManager,
    public readonly sessions: SessionManager,
    public readonly trust: TrustManager,
    public readonly xml: OmemoXml,
    public readonly encryptor: OmemoEncryptor,
    public readonly decryptor: OmemoDecryptor
  ) {}

  static create(): OmemoCore {
    const store = new OmemoStore();
    const devices = new DeviceManager(store);
    const bundles = new BundleManager();
    const sessions = new SessionManager(store, bundles);
    const trust = new TrustManager(store);
    const xml = new OmemoXml();
    const encryptor = new OmemoEncryptor(store, devices, sessions, trust, xml);
    const decryptor = new OmemoDecryptor(store, sessions, xml);
    return new OmemoCore(store, devices, bundles, sessions, trust, xml, encryptor, decryptor);
  }

  async init(accountJid: string): Promise<void> {
    await this.store.ensureIdentity(accountJid);
    await this.devices.publishOwnDeviceList();
    await this.bundles.publishOwnBundle();
    this.initialized = true;
  }

  ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("OMEMO2 Core is not initialized.");
    }
  }

  async encryptMessage(toJid: string, plaintext: string): Promise<string> {
    this.ensureInitialized();
    return this.encryptor.encrypt(toJid, plaintext);
  }

  async decryptMessage(fromJid: string, stanzaXml: string): Promise<string> {
    this.ensureInitialized();
    return this.decryptor.decrypt(fromJid, stanzaXml);
  }
}
