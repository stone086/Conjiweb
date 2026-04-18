import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeBareJid } from "@/utils/helpers";

export type SubscriptionState = "both" | "from" | "to" | "none" | "remove";

export interface RosterContact {
  jid: string;
  name?: string;
  groups: string[];
  subscription: SubscriptionState;
  pendingIncoming?: boolean;
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
  markPendingIncoming: (jid: string) => void;
}

export const useRosterStore = create<RosterState>()(
  persist(
    (set) => ({
      contacts: {},

      setContacts: (contacts) =>
        set({
          contacts: Object.fromEntries(
            contacts.map((c) => {
              const jid = normalizeBareJid(c.jid);
              return [jid, { ...c, jid }];
            })
          ),
        }),

      updatePresence: (jid, presence, statusText) =>
        set((s) => {
          const key = normalizeBareJid(jid);
          const existing = s.contacts[key];
          if (!existing) return s;
          return {
            contacts: {
              ...s.contacts,
              [key]: { ...existing, presence, statusText, lastSeenAt: Date.now() },
            },
          };
        }),

      upsertContact: (contact) =>
        set((s) => {
          const jid = normalizeBareJid(contact.jid);
          const existing = s.contacts[jid];
          return {
            contacts: {
              ...s.contacts,
              [jid]: {
                ...(existing ?? {}),
                ...contact,
                jid,
              },
            },
          };
        }),

      removeContact: (jid) =>
        set((s) => {
          const key = normalizeBareJid(jid);
          const next = { ...s.contacts };
          delete next[key];
          return { contacts: next };
        }),

      blockContact: (jid) =>
        set((s) => {
          const key = normalizeBareJid(jid);
          return {
            contacts: s.contacts[key]
              ? { ...s.contacts, [key]: { ...s.contacts[key], isBlocked: true, pendingIncoming: false } }
              : s.contacts,
          };
        }),

      unblockContact: (jid) =>
        set((s) => {
          const key = normalizeBareJid(jid);
          return {
            contacts: s.contacts[key]
              ? { ...s.contacts, [key]: { ...s.contacts[key], isBlocked: false } }
              : s.contacts,
          };
        }),

      markPendingIncoming: (jid) =>
        set((s) => ({
          contacts: {
            ...s.contacts,
            [normalizeBareJid(jid)]: {
              ...(s.contacts[normalizeBareJid(jid)] ?? {}),
              jid: normalizeBareJid(jid),
              groups: [],
              subscription: s.contacts[normalizeBareJid(jid)]?.subscription ?? "none",
              presence: s.contacts[normalizeBareJid(jid)]?.presence ?? "unavailable",
              isBlocked: s.contacts[normalizeBareJid(jid)]?.isBlocked ?? false,
              pendingIncoming: true,
            },
          },
        })),
    }),
    { name: "conjiweb-roster" }
  )
);
