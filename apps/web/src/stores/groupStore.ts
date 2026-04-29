import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface MucRoom {
  jid: string;
  name: string;
  nickname: string;
  description?: string;
  memberCount?: number;
  isPublic: boolean;
  joined: boolean;
  subject?: string;
}

export interface MucMember {
  jid: string;
  nickname: string;
  role: "moderator" | "participant" | "visitor";
  affiliation: "owner" | "admin" | "member" | "none";
  presence: "available" | "away" | "unavailable";
}

interface GroupState {
  rooms: Record<string, MucRoom>;
  members: Record<string, MucMember[]>;
  upsertRoom: (room: MucRoom) => void;
  removeRoom: (jid: string) => void;
  setMembers: (roomJid: string, members: MucMember[]) => void;
  updateRoomSubject: (roomJid: string, subject: string) => void;
}

export const useGroupStore = create<GroupState>()(
  persist(
    (set) => ({
      rooms: {},
      members: {},
      upsertRoom: (room) => set((s) => ({ rooms: { ...s.rooms, [room.jid]: room } })),
      removeRoom: (jid) =>
        set((s) => {
          const nextRooms = { ...s.rooms };
          const nextMembers = { ...s.members };
          delete nextRooms[jid];
          delete nextMembers[jid];
          return { rooms: nextRooms, members: nextMembers };
        }),
      setMembers: (roomJid, members) => set((s) => ({ members: { ...s.members, [roomJid]: members } })),
      updateRoomSubject: (roomJid, subject) =>
        set((s) => ({
          rooms: s.rooms[roomJid] ? { ...s.rooms, [roomJid]: { ...s.rooms[roomJid], subject } } : s.rooms,
        })),
    }),
    { name: "conjiweb-groups" }
  )
);
