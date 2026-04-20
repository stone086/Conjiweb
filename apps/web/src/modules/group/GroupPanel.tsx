import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccountStore } from "@/stores/accountStore";
import { useChatStore } from "@/stores/chatStore";
import { getClient } from "@/services/xmppAdapter";
import { clsx } from "clsx";
import { Users, Plus, Hash, LogOut, Settings, Crown, Shield, UserPlus } from "lucide-react";
import toast from "react-hot-toast";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useLanguage } from "@/utils/i18n";
import { generateConversationId } from "@/utils/helpers";

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
  const { t } = useLanguage();
  const navigate = useNavigate();
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const upsertConversation = useChatStore((s) => s.upsertConversation);
  const removeRoom = useGroupStore((s) => s.removeRoom);
  const upsertRoom = useGroupStore((s) => s.upsertRoom);

  const join = () => {
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    if (!client) {
      toast.error("Connect this account first");
      return;
    }
    client?.joinRoom(room.jid, room.nickname);
    upsertRoom({ ...room, joined: true });
    const convId = generateConversationId(activeAccountId, room.jid);
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
    toast(t("group.leftRoom"));
  };

  const invite = () => {
    if (!activeAccountId || !room.joined) return;
    const inviteeJid = window.prompt(t("group.invitePrompt"));
    if (!inviteeJid?.trim()) return;
    const reason = window.prompt(t("group.inviteReasonOptional")) ?? "";
    try {
      const client = getClient(activeAccountId);
      client?.inviteToRoom(room.jid, inviteeJid.trim(), reason);
      toast.success(`${t("group.invited")}: ${inviteeJid.trim()}`);
    } catch (error: any) {
      toast.error(error?.message ?? t("group.inviteFailed"));
    }
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
          {room.joined && <span className="text-[10px] text-accent-soft flex-shrink-0">{t("group.joined")}</span>}
        </div>
        <p className="text-xs text-surface-200/40 truncate">{room.jid}</p>
        {room.subject && <p className="text-xs text-surface-200/50 mt-1 truncate">{room.subject}</p>}
        {room.memberCount && (
          <p className="text-xs text-surface-200/30 mt-0.5 flex items-center gap-1">
            <Users size={10} /> {room.memberCount} {t("group.members")}
          </p>
        )}
      </div>
      {room.joined && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={(e) => { e.stopPropagation(); invite(); }}
            className="p-1.5 rounded hover:bg-white/5 text-surface-200/30 hover:text-accent-soft"
            title={t("group.invite")}>
            <UserPlus size={13} />
          </button>
          <button onClick={(e) => { e.stopPropagation(); leave(); }}
            className="p-1.5 rounded hover:bg-white/5 text-surface-200/30 hover:text-danger"
            title={t("group.leave")}>
            <LogOut size={13} />
          </button>
        </div>
      )}
    </div>
  );
}

export default function GroupPanel() {
  const { t } = useLanguage();
  const [showJoin, setShowJoin] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [joinForm, setJoinForm] = useState({ jid: "", nickname: "" });
  const [createForm, setCreateForm] = useState({ name: "", server: "conference.localhost" });
  const rooms = useGroupStore((s) => Object.values(s.rooms));
  const upsertRoom = useGroupStore((s) => s.upsertRoom);
  const upsertConversation = useChatStore((s) => s.upsertConversation);
  const navigate = useNavigate();
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);

  const defaultNickname = activeAccount?.jid.split("@")[0] ?? "user";

  const joinRoomNow = (roomJid: string, roomName: string, nickname: string) => {
    if (!activeAccountId) {
      toast.error("No active account");
      return false;
    }
    const client = getClient(activeAccountId);
    if (!client) {
      toast.error("Connect this account first");
      return false;
    }

    client.joinRoom(roomJid, nickname);
    upsertRoom({
      jid: roomJid,
      name: roomName,
      nickname,
      isPublic: true,
      joined: true,
    });
    const convId = generateConversationId(activeAccountId, roomJid);
    upsertConversation({
      id: convId,
      accountId: activeAccountId,
      type: "group",
      peerJid: roomJid,
      title: roomName,
      unreadCount: 0,
      pinned: false,
    });
    navigate(`/chat/${convId}`);
    return true;
  };

  const handleJoin = () => {
    if (!joinForm.jid.trim()) { toast.error(t("group.jidRequired")); return; }
    const nick = joinForm.nickname.trim() || defaultNickname;
    const roomJid = joinForm.jid.trim();
    const roomName = roomJid.split("@")[0];
    if (!joinRoomNow(roomJid, roomName, nick)) return;
    setJoinForm({ jid: "", nickname: "" });
    setShowJoin(false);
    toast.success(t("group.joined"));
  };

  const handleCreate = () => {
    if (!createForm.name.trim()) { toast.error(t("group.nameRequired")); return; }
    const slug = createForm.name.toLowerCase().replace(/\s+/g, "-");
    const roomJid = `${slug}@${createForm.server}`;
    const roomName = createForm.name.trim();
    if (!joinRoomNow(roomJid, roomName, defaultNickname)) return;
    setCreateForm({ name: "", server: "conference.localhost" });
    setShowCreate(false);
    toast.success(t("group.joined"));
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-3 border-b border-white/5">
        <h2 className="text-sm font-semibold text-surface-50 flex items-center gap-2">
          <Users size={14} /> {t("group.title")}
        </h2>
        <div className="flex gap-1">
          <button onClick={() => { setShowJoin(!showJoin); setShowCreate(false); }}
            className="p-1.5 rounded hover:bg-white/5 text-surface-200/50 hover:text-surface-200"
            title={t("group.joinRoom")}>
            <Hash size={14} />
          </button>
          <button onClick={() => { setShowCreate(!showCreate); setShowJoin(false); }}
            className="p-1.5 rounded hover:bg-white/5 text-surface-200/50 hover:text-surface-200"
            title={t("group.createRoom")}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      {showJoin && (
        <div className="px-3 py-3 border-b border-white/5 flex flex-col gap-2 animate-fade-in">
          <p className="text-xs text-surface-200/50 font-medium">{t("group.joinRoomTitle")}</p>
          <input value={joinForm.jid} onChange={(e) => setJoinForm({ ...joinForm, jid: e.target.value })}
            placeholder="room@conference.example.com"
            className="input-field text-xs py-1.5" />
          <input value={joinForm.nickname} onChange={(e) => setJoinForm({ ...joinForm, nickname: e.target.value })}
            placeholder={`${t("group.nicknameDefault")} ${defaultNickname})`}
            className="input-field text-xs py-1.5" />
          <div className="flex gap-2">
            <button onClick={handleJoin} className="btn-primary text-xs py-1.5 flex-1">{t("group.join")}</button>
            <button onClick={() => setShowJoin(false)} className="btn-ghost text-xs py-1.5">{t("group.cancel")}</button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="px-3 py-3 border-b border-white/5 flex flex-col gap-2 animate-fade-in">
          <p className="text-xs text-surface-200/50 font-medium">{t("group.createRoomTitle")}</p>
          <input value={createForm.name} onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
            placeholder="Room name"
            className="input-field text-xs py-1.5" />
          <input value={createForm.server} onChange={(e) => setCreateForm({ ...createForm, server: e.target.value })}
            placeholder="conference.localhost"
            className="input-field text-xs py-1.5" />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="btn-primary text-xs py-1.5 flex-1">{t("group.create")}</button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost text-xs py-1.5">{t("group.cancel")}</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2">
        {rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-surface-200/30">
            <Hash size={20} />
            <span className="text-xs">{t("group.empty")}</span>
          </div>
        ) : (
          rooms.map((room) => <RoomCard key={room.jid} room={room} />)
        )}
      </div>
    </div>
  );
}
