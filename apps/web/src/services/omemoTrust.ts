import { normalizeBareJid } from "@/utils/helpers";
import type { OmemoDeviceFingerprint } from "@/services/omemoFingerprint";

const TRUST_PREFIX = "conjiweb-omemo-trust:";

interface TrustRecord {
  fingerprint: string;
  trusted: boolean;
  verifiedAt?: number;
}

type TrustMap = Record<string, TrustRecord>;

function key(accountId: string) {
  return `${TRUST_PREFIX}${accountId}`;
}

function id(peerJid: string, deviceId: number) {
  return `${normalizeBareJid(peerJid)}:${deviceId}`;
}

function load(accountId: string): TrustMap {
  try {
    const raw = localStorage.getItem(key(accountId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed as TrustMap : {};
  } catch {
    return {};
  }
}

function save(accountId: string, map: TrustMap) {
  localStorage.setItem(key(accountId), JSON.stringify(map));
}

export function setPeerDeviceTrust(
  accountId: string,
  peerJid: string,
  deviceId: number,
  fingerprint: string,
  trusted: boolean
) {
  const map = load(accountId);
  map[id(peerJid, deviceId)] = {
    fingerprint,
    trusted,
    verifiedAt: trusted ? Date.now() : undefined,
  };
  save(accountId, map);
}

export function isPeerDeviceTrusted(
  accountId: string,
  peerJid: string,
  deviceId: number,
  fingerprint: string
): boolean {
  const map = load(accountId);
  const record = map[id(peerJid, deviceId)];
  if (!record) return false;
  if (record.fingerprint !== fingerprint) return false;
  return record.trusted;
}

export function getUntrustedPeerDevices(
  accountId: string,
  peerJid: string,
  devices: OmemoDeviceFingerprint[]
): OmemoDeviceFingerprint[] {
  return devices.filter((item) => !isPeerDeviceTrusted(accountId, peerJid, item.deviceId, item.fingerprint));
}
