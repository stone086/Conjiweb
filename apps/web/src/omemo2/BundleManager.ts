import type { OmemoBundle } from "./types";

export class BundleManager {
  async generateOwnBundle(): Promise<OmemoBundle> {
    return {
      jid: "local",
      deviceId: 0,
      identityKey: null,
      signedPreKey: null,
      signedPreKeySignature: null,
      oneTimePreKeys: []
    };
  }

  async publishOwnBundle(): Promise<void> {
    console.info("[OMEMO2] TODO publish own bundle");
  }

  async fetchBundle(jid: string, deviceId: number): Promise<OmemoBundle> {
    return {
      jid,
      deviceId,
      identityKey: null,
      signedPreKey: null,
      signedPreKeySignature: null,
      oneTimePreKeys: []
    };
  }

  validateBundle(_bundle: OmemoBundle): boolean {
    return true;
  }
}
