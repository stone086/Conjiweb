export type OmemoTrustState = "trusted" | "untrusted" | "blocked" | "unknown";

export interface OmemoDevice {
  jid: string;
  deviceId: number;
  label?: string;
  lastSeenAt?: number;
}

export interface OmemoBundle {
  jid: string;
  deviceId: number;
  identityKey: unknown;
  signedPreKey: unknown;
  signedPreKeySignature: unknown;
  oneTimePreKeys: unknown[];
}

export interface OmemoEncryptedKey {
  rid: number;
  key: string;
  preKey?: boolean;
}

export interface OmemoEncryptedPayload {
  sid: number;
  keys: OmemoEncryptedKey[];
  payload: string;
}

export interface OmemoParsedMessage {
  senderDeviceId: number;
  keys: OmemoEncryptedKey[];
  payload: string;
}
