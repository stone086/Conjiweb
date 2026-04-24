import { getLocalOmemoIdentityKey, listPeerOmemoBundles } from "@/services/e2ee";

export interface OmemoDeviceFingerprint {
  deviceId: number;
  fingerprint: string;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function formatFingerprint(hex: string): string {
  return hex.match(/.{1,4}/g)?.join(" ") ?? hex;
}

export async function fingerprintFromIdentityKeyB64(identityKeyB64: string): Promise<string> {
  const raw = Uint8Array.from(atob(identityKeyB64), (ch) => ch.charCodeAt(0));
  const digest = await crypto.subtle.digest("SHA-256", raw);
  const hex = toHex(new Uint8Array(digest)).toUpperCase();
  return formatFingerprint(hex);
}

export async function getOmemoFingerprintForJid(_jid: string, accountId?: string): Promise<string> {
  if (!accountId) return "-";
  const identityKey = await getLocalOmemoIdentityKey(accountId);
  return fingerprintFromIdentityKeyB64(identityKey);
}

export async function getPeerOmemoFingerprints(
  accountId: string,
  peerJid: string
): Promise<OmemoDeviceFingerprint[]> {
  const bundles = listPeerOmemoBundles(accountId, peerJid);
  const values = await Promise.all(
    bundles.map(async (bundle) => ({
      deviceId: bundle.deviceId,
      fingerprint: await fingerprintFromIdentityKeyB64(bundle.identityKey),
    }))
  );
  return values.sort((a, b) => a.deviceId - b.deviceId);
}
