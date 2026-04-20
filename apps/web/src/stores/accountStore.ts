import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PresenceType = "available" | "away" | "dnd" | "unavailable";

export interface XmppAccount {
  id: string;
  jid: string;
  domain: string;
  password?: string;
  is_enabled?: boolean;
  displayName?: string;
  avatarUrl?: string;
  presence: PresenceType;
  connected: boolean;
}

interface AccountState {
  accounts: XmppAccount[];
  activeAccountId: string | null;
  addAccount: (account: Omit<XmppAccount, "presence" | "connected">) => void;
  removeAccount: (id: string) => void;
  setActiveAccount: (id: string) => void;
  updatePresence: (id: string, presence: PresenceType) => void;
  setConnected: (id: string, connected: boolean) => void;
}

export const useAccountStore = create<AccountState>()(
  persist(
    (set) => ({
      accounts: [],
      activeAccountId: null,

      addAccount: (account) =>
        set((s) => ({
          accounts: [
            ...s.accounts,
            {
              id: account.id,
              jid: account.jid,
              domain: account.domain,
              displayName: account.displayName,
              avatarUrl: account.avatarUrl,
              is_enabled: account.is_enabled ?? true,
              presence: "available",
              connected: false,
            },
          ],
          activeAccountId: s.activeAccountId ?? account.id,
        })),

      removeAccount: (id) =>
        set((s) => {
          sessionStorage.removeItem(`${PASSWORD_KEY_PREFIX}${id}`);
          return {
            accounts: s.accounts.filter((a) => a.id !== id),
            activeAccountId:
              s.activeAccountId === id
                ? s.accounts.find((a) => a.id !== id)?.id ?? null
                : s.activeAccountId,
          };
        }),

      setActiveAccount: (id) => set({ activeAccountId: id }),

      updatePresence: (id, presence) =>
        set((s) => ({
          accounts: s.accounts.map((a) => (a.id === id ? { ...a, presence } : a)),
        })),

      setConnected: (id, connected) =>
        set((s) => ({
          accounts: s.accounts.map((a) => (a.id === id ? { ...a, connected } : a)),
        })),
    }),
    {
      name: "conjiweb-accounts",
      partialize: (state) => ({
        accounts: state.accounts.map(({ password, ...rest }) => rest),
        activeAccountId: state.activeAccountId,
      }),
    }
  )
);

const PASSWORD_KEY_PREFIX = "conjiweb-account-password:";

export function setAccountPassword(accountId: string, password: string) {
  sessionStorage.setItem(`${PASSWORD_KEY_PREFIX}${accountId}`, password);
}

export function getAccountPassword(accountId: string): string | null {
  return sessionStorage.getItem(`${PASSWORD_KEY_PREFIX}${accountId}`);
}

export function clearAccountPassword(accountId: string) {
  sessionStorage.removeItem(`${PASSWORD_KEY_PREFIX}${accountId}`);
}
