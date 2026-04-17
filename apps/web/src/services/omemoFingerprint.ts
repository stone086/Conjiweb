const DEVICE_ID_KEY = "conjiweb-omemo-device-id";

function getOrCreateDeviceId(): string {
  const existing = localStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const created = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  localStorage.setItem(DEVICE_ID_KEY, created);
  return created;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function formatFingerprint(hex: string): string {
  return hex.match(/.{1,4}/g)?.join(" ") ?? hex;
}

export async function getOmemoFingerprintForJid(jid: string): Promise<string> {
  const normalizedJid = jid.trim().toLowerCase();
  const deviceId = getOrCreateDeviceId();
  const seed = `${normalizedJid}|${deviceId}`;
  const encoded = new TextEncoder().encode(seed);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  const hex = toHex(new Uint8Array(digest)).toUpperCase();
  return formatFingerprint(hex);
}
