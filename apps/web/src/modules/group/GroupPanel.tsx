import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccountStore } from "@/stores/accountStore";
import { useChatStore } from "@/stores/chatStore";
import { getClient } from "@/services/xmppAdapter";
import { clsx } from "clsx";
import { Users, Plus, Hash, LogOut, Settings, Crown, Shield } from "lucide-react";
import toast from "react-hot-toast";
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
  members: Record<string, MucMember[]>; // keyed by roomJid
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
      removeRoom: (jid) => set((s) => {
        const r = { ...s.rooms }; delete r[jid]; return { rooms: r };
      }),
      setMembers: (roomJid, members) => set((s) => ({ members: { ...s.members, [roomJid]: members } })),
      updateRoomSubject: (roomJid, subject) => set((s) => ({
        rooms: s.rooms[roomJid] ? { ...s.rooms, [roomJid]: { ...s.rooms[roomJid], subject } } : s.rooms,
      })),
    }),
    { name: "conjiweb-groups" }
  )
);

function RoleIcon({ role, affiliation }: { role: MucMember["role"]; affiliation: MucMember["affiliation"] }) {
  if (affiliation === "owner") return <Crown size={10} className="text-yellow-400" />;
  if (affiliation === "admin") return <Shield size={10} className="text-accent-soft" />;
  if (role === "moderator") return <Shield size={10} className="text-blue-400" />;
  return null;
}

function RoomCard({ room }: { room: MucRoom }) {
  const navigate = useNavigate();
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const upsertConversation = useChatStore((s) => s.upsertConversation);
  const removeRoom = useGroupStore((s) => s.removeRoom);
  const upsertRoom = useGroupStore((s) => s.upsertRoom);

  const join = () => {
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    client?.joinRoom(room.jid, room.nickname);
    upsertRoom({ ...room, joined: true });
    const convId = `${activeAccountId}:${room.jid}`;
    upsertConversation({
      id: convId,
      accountId: activeAccountId,
      type: "group",
      peerJid: room.jid,
      title: room.name,
      unreadCount: 0,
      pinned: false,
    });
    navigate(`/chat/${convId}`);
  };

  const leave = () => {
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    client?.leaveRoom(room.jid, room.nickname);
    upsertRoom({ ...room, joined: false });
    toast("Left room");
  };

  return (
    <div className={clsx(
      "glass rounded-xl p-4 flex items-start gap-3 cursor-pointer hover:bg-white/4 transition-colors",
      room.joined && "border-accent/20"
    )} onClick={join}>
      <div className="w-10 h-10 rounded-xl bg-surface-800 flex items-center justify-center flex-shrink-0">
        <Hash size={16} className="text-surface-200/60" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-surface-50 truncate">{room.name}</p>
          {room.joined && <span className="text-[10px] text-accent-soft flex-shrink-0">Joined</span>}
        </div>
        <p className="text-xs text-surface-200/40 truncate">{room.jid}</p>
        {room.subject && <p className="text-xs text-surface-200/50 mt-1 truncate">{room.subject}</p>}
        {room.memberCount && (
          <p className="text-xs text-surface-200/30 mt-0.5 flex items-center gap-1">
            <Users size={10} /> {room.memberCount} members
          </p>
        )}
      </div>
      {room.joined && (
        <button onClick={(e) => { e.stopPropagation(); leave(); }}
          className="p-1.5 rounded hover:bg-white/5 text-surface-200/30 hover:text-danger flex-shrink-0"
          title="Leave room">
          <LogOut size={13} />
        </button>
      )}
    </div>
  );
}

export default function GroupPanel() {
  const [showJoin, setShowJoin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [joinForm, setJoinForm] = useState({ jid: "", nickname: "" });
  const [createForm, setCreateForm] = useState({ name: "", server: "conference.localhost" });
  const rooms = useGroupStore((s) => Object.values(s.rooms));
  const upsertRoom = useGroupStore((s) => s.upsertRoom);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  const defaultNickname = activeAccount?.jid.split("@")[0] ?? "user";

  const handleJoin = () => {
    if (!joinForm.jid.trim()) { toast.error("Room JID required"); return; }
    const nick = joinForm.nickname.trim() || defaultNickname;
    const room: MucRoom = {
      jid: joinForm.jid.trim(),
      name: joinForm.jid.split("@")[0],
      nickname: nick,
      isPublic: true,
      joined: false,
    };
    upsertRoom(room);
    setJoinForm({ jid: "", nickname: "" });
    setShowJoin(false);
    toast.success("Room added. Click to join.");
  };

  const handleCreate = () => {
    if (!createForm.name.trim()) { toast.error("Room name required"); return; }
    const slug = createForm.name.toLowerCase().replace(/\s+/g, "-");
    const room: MucRoom = {
      jid: `${slug}@${createForm.server}`,
      name: createForm.name.trim(),
      nickname: defaultNickname,
      isPublic: true,
      joined: false,
    };
    upsertRoom(room);
    setCreateForm({ name: "", server: "conference.localhost" });
    setShowCreate(false);
    toast.success("Room created. Click to join.");
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-3 border-b border-white/5">
        <h2 className="text-sm font-semibold text-surface-50 flex items-center gap-2">
          <Users size={14} /> Group Chats
        </h2>
        <div className="flex gap-1">
          <button onClick={() => { setShowJoin(!showJoin); setShowCreate(false); }}
            className="p-1.5 rounded hover:bg-white/5 text-surface-200/50 hover:text-surface-200"
            title="Join room">
            <Hash size={14} />
          </button>
          <button onClick={() => { setShowCreate(!showCreate); setShowJoin(false); }}
            className="p-1.5 rounded hover:bg-white/5 text-surface-200/50 hover:text-surface-200"
            title="Create room">
            <Plus size={14} />
          </button>
        </div>
      </div>

      {showJoin && (
        <div className="px-3 py-3 border-b border-white/5 flex flex-col gap-2 animate-fade-in">
          <p className="text-xs text-surface-200/50 font-medium">Join a room</p>
          <input value={joinForm.jid} onChange={(e) => setJoinForm({ ...joinForm, jid: e.target.value })}
            placeholder="room@conference.example.com"
            className="input-field text-xs py-1.5" />
          <input value={joinForm.nickname} onChange={(e) => setJoinForm({ ...joinForm, nickname: e.target.value })}
            placeholder={`Nickname (default: ${defaultNickname})`}
            className="input-field text-xs py-1.5" />
          <div className="flex gap-2">
            <button onClick={handleJoin} className="btn-primary text-xs py-1.5 flex-1">Join</button>
            <button onClick={() => setShowJoin(false)} className="btn-ghost text-xs py-1.5">Cancel</button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="px-3 py-3 border-b border-white/5 flex flex-col gap-2 animate-fade-in">
          <p className="text-xs text-surface-200/50 font-medium">Create a room</p>
          <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            placeholder="Room name"
            className="input-field text-xs py-1.5" />
          <input value={createForm.server} onChange={(e) => setCreateForm({ ...createForm, server: e.target.value })}
            placeholder="conference.localhost"
            className="input-field text-xs py-1.5" />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="btn-primary text-xs py-1.5 flex-1">Create</button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost text-xs py-1.5">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-surface-200/30">
            <Hash size={20} />
            <span className="text-xs">No rooms joined</span>
          </div>
        ) : (
          rooms.map((room) => <RoomCard key={room.jid} room={room} />)
        )}
      </div>
    </div>
  );
}
