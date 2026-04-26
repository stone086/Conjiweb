import { clearLocalMessageHistory, pruneLocalMessagesBefore } from "@/services/localDb";
import { useChatStore } from "@/stores/chatStore";
import { useAccountStore } from "@/stores/accountStore";
import { messagesApi } from "@/services/api";

const HISTORY_RETENTION_DAYS_KEY = "conjiweb-history-retention-days";
const DEFAULT_RETENTION_DAYS = 30;

export function getStoredHistoryRetentionDays(): number {
  const raw = localStorage.getItem(HISTORY_RETENTION_DAYS_KEY);
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_RETENTION_DAYS;
  return parsed;
}

export function setStoredHistoryRetentionDays(days: number) {
  const safe = Number.isFinite(days) && days >= 0 ? Math.floor(days) : DEFAULT_RETENTION_DAYS;
  localStorage.setItem(HISTORY_RETENTION_DAYS_KEY, String(safe));
}

export async function clearAllHistoryNow() {
  const accounts = useAccountStore.getState().accounts;
  if (accounts.length > 0) {
    const results = await Promise.allSettled(accounts.map((account) => messagesApi.clearHistory(account.id)));
    const failed = results.some((result) => result.status === "rejected");
    if (failed) {
      throw new Error("Failed to clear server message history");
    }
  }
  await clearLocalMessageHistory();
  useChatStore.getState().clearAllHistory();
}

export async function applyHistoryRetention(days: number) {
  if (!Number.isFinite(days) || days <= 0) return;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  await pruneLocalMessagesBefore(cutoff);
  useChatStore.getState().pruneHistoryOlderThan(cutoff);
}

export async function applyConfiguredHistoryRetention() {
  await applyHistoryRetention(getStoredHistoryRetentionDays());
}
