import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccountStore } from "@/stores/accountStore";
import { useChatStore } from "@/stores/chatStore";
import { MucMember, MucRoom, useGroupStore } from "@/stores/groupStore";
import { getClient, MucDiscoveryItem } from "@/services/xmppAdapter";
import { clsx } from "clsx";
import { Users, Plus, Hash, LogOut, Settings, Crown, Shield, UserPlus, Compass, RefreshCw } from "lucide-react";
import toast from "react-hot-toast";
import { useLanguage } from "@/utils/i18n";
import { generateConversationId } from "@/utils/helpers";

function RoleIcon({ role, affiliation }: { role: MucMember["role"]; affiliation: MucMember["affiliation"] }) {
  if (affiliation === "owner") return <Crown size={10} className="text-yellow-400" />;
  if (affiliation === "admin") return <Shield size={10} className="text-accent-soft" />;
  if (role === "moderator") return <Shield size={10} className="text-blue-400" />;
  return null;
}

function RoomCard({ room, onInvite }: { room: MucRoom; onInvite: (room: MucRoom) => void }) {
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
      toast.error(t("account.connectFirst"));
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
          <button onClick={(e) => { e.stopPropagation(); onInvite(room); }}
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
  const [showDiscover, setShowDiscover] = useState(false);
  const [inviteRoom, setInviteRoom] = useState<MucRoom | null>(null);
  const [joinForm, setJoinForm] = useState({ jid: "", nickname: "" });
  const [createForm, setCreateForm] = useState({ name: "", server: "conference.localhost" });
  const [inviteForm, setInviteForm] = useState({ jid: "", reason: "" });
  const [discoverServer, setDiscoverServer] = useState("conference.localhost");
  const [discovering, setDiscovering] = useState(false);
  const [discoveredRooms, setDiscoveredRooms] = useState<MucDiscoveryItem[]>([]);
  const rooms = useGroupStore((s) => Object.values(s.rooms));
  const upsertRoom = useGroupStore((s) => s.upsertRoom);
  const upsertConversation = useChatStore((s) => s.upsertConversation);
  const navigate = useNavigate();
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const accounts = useAccountStore((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.id === activeAccountId);
  const defaultServer = useMemo(() => {
    const domain = activeAccount?.jid.includes("@")
      ? activeAccount.jid.split("@")[1]
      : (import.meta.env.VITE_XMPP_DOMAIN ?? "");
    return domain ? `conference.${domain}` : "conference.localhost";
  }, [activeAccount?.jid]);

  const defaultNickname = activeAccount?.jid.split("@")[0] ?? "user";

  useEffect(() => {
    setCreateForm((prev) => ({ ...prev, server: defaultServer }));
    setDiscoverServer(defaultServer);
  }, [defaultServer]);

  const joinRoomNow = (roomJid: string, roomName: string, nickname: string) => {
    if (!activeAccountId) {
      toast.error(t("account.noActive"));
      return false;
    }
    const client = getClient(activeAccountId);
    if (!client) {
      toast.error(t("account.connectFirst"));
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
    setCreateForm({ name: "", server: defaultServer });
    setShowCreate(false);
    toast.success(t("group.joined"));
  };

  const handleDiscover = async () => {
    if (!activeAccountId) {
      toast.error(t("account.noActive"));
      return;
    }
    const client = getClient(activeAccountId);
    if (!client?.connected) {
      toast.error(t("chat.notConnected"));
      return;
    }
    setDiscovering(true);
    try {
      const rooms = await client.discoverRooms(discoverServer.trim());
      setDiscoveredRooms(rooms);
      if (rooms.length === 0) toast(t("group.discoverEmpty"));
    } catch (error: any) {
      toast.error(error?.message ?? t("group.discoverFailed"));
    } finally {
      setDiscovering(false);
    }
  };

  const handleInvite = () => {
    if (!activeAccountId || !inviteRoom) return;
    if (!inviteForm.jid.trim()) {
      toast.error(t("group.invitePrompt"));
      return;
    }
    try {
      const client = getClient(activeAccountId);
      client?.inviteToRoom(inviteRoom.jid, inviteForm.jid.trim(), inviteForm.reason.trim());
      toast.success(`${t("group.invited")}: ${inviteForm.jid.trim()}`);
      setInviteForm({ jid: "", reason: "" });
      setInviteRoom(null);
    } catch (error: any) {
      toast.error(error?.message ?? t("group.inviteFailed"));
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-3 border-b border-white/5">
        <h2 className="text-sm font-semibold text-surface-50 flex items-center gap-2">
          <Users size={14} /> {t("group.title")}
        </h2>
        <div className="flex gap-1">
          <button onClick={() => { setShowDiscover(!showDiscover); setShowJoin(false); setShowCreate(false); }}
            className="p-1.5 rounded hover:bg-white/5 text-surface-200/50 hover:text-surface-200"
            title={t("group.discover")}>
            <Compass size={14} />
          </button>
          <button onClick={() => { setShowJoin(!showJoin); setShowCreate(false); setShowDiscover(false); }}
            className="p-1.5 rounded hover:bg-white/5 text-surface-200/50 hover:text-surface-200"
            title={t("group.joinRoom")}>
            <Hash size={14} />
          </button>
          <button onClick={() => { setShowCreate(!showCreate); setShowJoin(false); setShowDiscover(false); }}
            className="p-1.5 rounded hover:bg-white/5 text-surface-200/50 hover:text-surface-200"
            title={t("group.createRoom")}>
            <Plus size={14} />
          </button>
        </div>
      </div>

      {showDiscover && (
        <div className="px-3 py-3 border-b border-white/5 flex flex-col gap-2 animate-fade-in">
          <p className="text-xs text-surface-200/50 font-medium">{t("group.discoverTitle")}</p>
          <div className="flex gap-2">
            <input
              value={discoverServer}
              onChange={(e) => setDiscoverServer(e.target.value)}
              placeholder={defaultServer}
              className="input-field text-xs py-1.5 flex-1"
            />
            <button
              onClick={handleDiscover}
              disabled={discovering}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              <RefreshCw size={12} className={clsx(discovering && "animate-spin")} />
              {t("group.discover")}
            </button>
          </div>
          {discoveredRooms.length > 0 && (
            <div className="flex flex-col gap-1 pt-1">
              {discoveredRooms.map((room) => {
                const existing = rooms.find((r) => r.jid === room.jid);
                return (
                  <button
                    key={room.jid}
                    onClick={() => joinRoomNow(room.jid, room.name ?? room.jid.split("@")[0], defaultNickname)}
                    className="w-full flex items-center gap-2 rounded-lg border border-white/5 bg-surface-900/50 px-2.5 py-2 text-left hover:bg-white/5"
                  >
                    <Hash size={13} className="text-surface-200/40 flex-shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-semibold text-surface-50 truncate">{room.name ?? room.jid.split("@")[0]}</span>
                      <span className="block text-[11px] text-surface-200/40 truncate">{room.jid}</span>
                    </span>
                    {existing?.joined && <span className="text-[10px] text-accent-soft flex-shrink-0">{t("group.joined")}</span>}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {showJoin && (
        <div className="px-3 py-3 border-b border-white/5 flex flex-col gap-2 animate-fade-in">
          <p className="text-xs text-surface-200/50 font-medium">{t("group.joinRoomTitle")}</p>
          <input value={joinForm.jid} onChange={(e) => setJoinForm({ ...joinForm, jid: e.target.value })}
            placeholder={t("group.roomJidPlaceholder")}
            className="input-field text-xs py-1.5" />
          <input value={joinForm.nickname} onChange={(e) => setJoinForm({ ...joinForm, nickname: e.target.value })}
            placeholder={`${t("group.nicknameDefault")} ${defaultNickname}`}
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
            placeholder={t("group.roomNamePlaceholder")}
            className="input-field text-xs py-1.5" />
          <input value={createForm.server} onChange={(e) => setCreateForm({ ...createForm, server: e.target.value })}
            placeholder={defaultServer}
            className="input-field text-xs py-1.5" />
          <div className="flex gap-2">
            <button onClick={handleCreate} className="btn-primary text-xs py-1.5 flex-1">{t("group.create")}</button>
            <button onClick={() => setShowCreate(false)} className="btn-ghost text-xs py-1.5">{t("group.cancel")}</button>
          </div>
        </div>
      )}

      {inviteRoom && (
        <div className="px-3 py-3 border-b border-white/5 flex flex-col gap-2 animate-fade-in">
          <p className="text-xs text-surface-200/50 font-medium">{t("group.invite")} {inviteRoom.name}</p>
          <input
            value={inviteForm.jid}
            onChange={(e) => setInviteForm((prev) => ({ ...prev, jid: e.target.value }))}
            placeholder={t("group.inviteJidPlaceholder")}
            className="input-field text-xs py-1.5"
          />
          <input
            value={inviteForm.reason}
            onChange={(e) => setInviteForm((prev) => ({ ...prev, reason: e.target.value }))}
            placeholder={t("group.inviteReasonOptional")}
            className="input-field text-xs py-1.5"
          />
          <div className="flex gap-2">
            <button onClick={handleInvite} className="btn-primary text-xs py-1.5 flex-1">{t("group.invite")}</button>
            <button
              onClick={() => {
                setInviteRoom(null);
                setInviteForm({ jid: "", reason: "" });
              }}
              className="btn-ghost text-xs py-1.5"
            >
              {t("group.cancel")}
            </button>
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
          rooms.map((room) => <RoomCard key={room.jid} room={room} onInvite={setInviteRoom} />)
        )}
      </div>
    </div>
  );
}
