import { create } from "zustand";
import { persist } from "zustand/middleware";

export type PresenceType = "available" | "away" | "dnd" | "unavailable";

export interface XmppAccount {
  id: string;
  jid: string;
  domain: string;
  password: string; // stored encrypted in production - use keychain
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
            { ...account, presence: "available", connected: false },
          ],
          activeAccountId: s.activeAccountId ?? account.id,
        })),

      removeAccount: (id) =>
        set((s) => ({
          accounts: s.accounts.filter((a) => a.id !== id),
          activeAccountId:
            s.activeAccountId === id
              ? s.accounts.find((a) => a.id !== id)?.id ?? null
              : s.activeAccountId,
        })),

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
    { name: "wgv3-accounts" }
  )
);
