import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SubscriptionState = "both" | "from" | "to" | "none" | "remove";

export interface RosterContact {
  jid: string;
  name?: string;
  groups: string[];
  subscription: SubscriptionState;
  presence: "available" | "away" | "dnd" | "xa" | "unavailable";
  statusText?: string;
  avatarUrl?: string;
  lastSeenAt?: number;
  isBlocked: boolean;
}

interface RosterState {
  contacts: Record<string, RosterContact>; // keyed by jid
  setContacts: (contacts: RosterContact[]) => void;
  updatePresence: (jid: string, presence: RosterContact["presence"], statusText?: string) => void;
  upsertContact: (contact: RosterContact) => void;
  removeContact: (jid: string) => void;
  blockContact: (jid: string) => void;
  unblockContact: (jid: string) => void;
}

export const useRosterStore = create<RosterState>()(
  persist(
    (set) => ({
      contacts: {},

      setContacts: (contacts) =>
        set({
          contacts: Object.fromEntries(contacts.map((c) => [c.jid, c])),
        }),

      updatePresence: (jid, presence, statusText) =>
        set((s) => {
          const existing = s.contacts[jid];
          if (!existing) return s;
          return {
            contacts: {
              ...s.contacts,
              [jid]: { ...existing, presence, statusText, lastSeenAt: Date.now() },
            },
          };
        }),

      upsertContact: (contact) =>
        set((s) => ({
          contacts: { ...s.contacts, [contact.jid]: contact },
        })),

      removeContact: (jid) =>
        set((s) => {
          const next = { ...s.contacts };
          delete next[jid];
          return { contacts: next };
        }),

      blockContact: (jid) =>
        set((s) => ({
          contacts: s.contacts[jid]
            ? { ...s.contacts, [jid]: { ...s.contacts[jid], isBlocked: true } }
            : s.contacts,
        })),

      unblockContact: (jid) =>
        set((s) => ({
          contacts: s.contacts[jid]
            ? { ...s.contacts, [jid]: { ...s.contacts[jid], isBlocked: false } }
            : s.contacts,
        })),
    }),
    { name: "conjiweb-roster" }
  )
);
