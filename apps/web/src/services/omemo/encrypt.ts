/**
 * omemo/encrypt.ts - Backward-compatible browser entry for OMEMO encryption.
 *
 * The real reusable logic now lives in src/core/omemo/engine.ts.
 * This file keeps the old exported function names, so existing native UI/XMPP
 * code can keep importing establishSession(), encryptForDevices(), and
 * decryptEnvelope() without any change.
 */
import {
  OmemoEngine,
  NS_OMEMO,
  type EncryptedEnvelope,
  type PeerBundleInput,
  type PeerDeviceInput,
} from "../../core/omemo/engine";
import { browserCrypto } from "../../adapters/browser-crypto";
import { createBrowserOmemoStore } from "../../adapters/browser-omemo-store";

const browserOmemoEngine = new OmemoEngine({
  createStore: createBrowserOmemoStore,
  crypto: browserCrypto,
});

/**
 * Establish a libsignal session with a peer device using their published bundle.
 * Required before the first message to that device.
 */
export async function establishSession(
  accountId: string,
  peerJid: string,
  peerBundle: PeerBundleInput
): Promise<void> {
  return browserOmemoEngine.establishSession(accountId, peerJid, peerBundle);
}

/**
 * Encrypt a plaintext for one or more peer devices.
 * Returns an OMEMO envelope ready for stanza serialization.
 */
export async function encryptForDevices(
  accountId: string,
  ownDeviceId: number,
  plaintext: string,
  peerDevices: PeerDeviceInput[]
): Promise<EncryptedEnvelope> {
  return browserOmemoEngine.encryptForDevices(accountId, ownDeviceId, plaintext, peerDevices);
}

/**
 * Decrypt an incoming OMEMO envelope addressed to us.
 * Returns the plaintext or null if no key for our device.
 */
export async function decryptEnvelope(
  accountId: string,
  ownDeviceId: number,
  senderJid: string,
  envelope: EncryptedEnvelope
): Promise<string | null> {
  return browserOmemoEngine.decryptEnvelope(accountId, ownDeviceId, senderJid, envelope);
}

export { NS_OMEMO, browserOmemoEngine };
export type { EncryptedEnvelope };
