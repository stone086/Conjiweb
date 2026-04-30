/**
 * adapters/browser-omemo-store.ts
 *
 * Browser IndexedDB-backed storage adapter for the platform-neutral OMEMO engine.
 */
import { OmemoStore } from "../services/omemo/store";

export function createBrowserOmemoStore(accountId: string): OmemoStore {
  return new OmemoStore(accountId);
}
