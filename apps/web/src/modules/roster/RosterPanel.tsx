import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useRosterStore, RosterContact } from "@/stores/rosterStore";
import { useAccountStore } from "@/stores/accountStore";
import { useChatStore } from "@/stores/chatStore";
import { getClient } from "@/services/xmppAdapter";
import { clsx } from "clsx";
import {
  Search, UserPlus, MoreVertical, MessageSquare,
  Ban, Trash2, ChevronDown, ChevronRight, Users,
} from "lucide-react";
import toast from "react-hot-toast";

function PresenceDot({ presence }: { presence: RosterContact["presence"] }) {
  const colors: Record<string, string> = {
    available: "bg-green-400",
    away: "bg-yellow-400",
    dnd: "bg-red-400",
    xa: "bg-orange-400",
    unavailable: "bg-surface-200/30",
  };
  return <span className={clsx("w-2.5 h-2.5 rounded-full border-2 border-surface-900 flex-shrink-0", colors[presence] ?? colors.unavailable)} />;
}

function ContactRow({ contact, onChat }: { contact: RosterContact; onChat: (jid: string) => void }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const blockContact = useRosterStore((s) => s.blockContact);
  const removeContact = useRosterStore((s) => s.removeContact);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);

  const handleRemove = () => {
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    client?.removeContact(contact.jid);
    removeContact(contact.jid);
    toast.success("Contact removed");
  };

  return (
    <div className="relative flex items-center gap-3 px-3 py-2 hover:bg-white/4 group rounded-lg mx-1 cursor-pointer"
      onClick={() => onChat(contact.jid)}>
      {/* Avatar */}
      <div className="relative flex-shrink-0">
        <div className="w-8 h-8 rounded-full bg-surface-800 flex items-center justify-center
                        text-sm font-medium uppercase text-surface-200">
          {(contact.name ?? contact.jid)[0]}
        </div>
        <PresenceDot presence={contact.presence} />
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-surface-50 truncate font-medium">
          {contact.name ?? contact.jid.split("@")[0]}
        </p>
        <p className="text-xs text-surface-200/40 truncate">
          {contact.statusText ?? contact.presence}
        </p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}>
        <button onClick={() => onChat(contact.jid)}
          className="p-1.5 rounded hover:bg-white/5 text-surface-200/50 hover:text-surface-200">
          <MessageSquare size={13} />
        </button>
        <div className="relative">
          <button onClick={() => setMenuOpen(!menuOpen)}
            className="p-1.5 rounded hover:bg-white/5 text-surface-200/50 hover:text-surface-200">
            <MoreVertical size={13} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-6 z-50 glass rounded-lg py-1 w-36 shadow-xl border border-white/10">
              <button onClick={() => { blockContact(contact.jid); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-surface-200 hover:bg-white/5">
                <Ban size={12} /> Block
              </button>
              <button onClick={() => { handleRemove(); setMenuOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-danger hover:bg-white/5">
                <Trash2 size={12} /> Remove
              </button>
            </div>
          )}
        </div>
      </div>

      {contact.isBlocked && (
        <span className="text-[10px] text-danger/70 flex-shrink-0">Blocked</span>
      )}
    </div>
  );
}

function GroupSection({ name, contacts, onChat }: {
  name: string; contacts: RosterContact[]; onChat: (jid: string) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div>
      <button onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-[10px] font-semibold
                   text-surface-200/40 uppercase tracking-wider hover:text-surface-200/60">
        {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
        {name} ({contacts.length})
      </button>
      {!collapsed && contacts.map((c) => (
        <ContactRow key={c.jid} contact={c} onChat={onChat} />
      ))}
    </div>
  );
}

export default function RosterPanel() {
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [newJid, setNewJid] = useState("");
  const contacts = useRosterStore((s) => Object.values(s.contacts));
  const upsertContact = useRosterStore((s) => s.upsertContact);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const upsertConversation = useChatStore((s) => s.upsertConversation);
  const navigate = useNavigate();

  const filtered = useMemo(() =>
    contacts.filter((c) =>
      !query || c.jid.includes(query) || (c.name ?? "").toLowerCase().includes(query.toLowerCase())
    ), [contacts, query]);

  const grouped = useMemo(() => {
    const groups: Record<string, RosterContact[]> = { Online: [], Offline: [] };
    filtered.forEach((c) => {
      const g = c.groups[0] ?? (c.presence === "available" ? "Online" : "Offline");
      if (!groups[g]) groups[g] = [];
      groups[g].push(c);
    });
    return groups;
  }, [filtered]);

  const startChat = (jid: string) => {
    if (!activeAccountId) return;
    const convId = `${activeAccountId}:${jid}`;
    const contact = contacts.find((c) => c.jid === jid);
    upsertConversation({
      id: convId,
      accountId: activeAccountId,
      type: "private",
      peerJid: jid,
      title: contact?.name ?? jid.split("@")[0],
      unreadCount: 0,
      pinned: false,
    });
    navigate(`/chat/${convId}`);
  };

  const addContact = () => {
    if (!newJid.trim() || !activeAccountId) return;
    const client = getClient(activeAccountId);
    client?.addContact(newJid.trim());
    upsertContact({
      jid: newJid.trim(),
      groups: [],
      subscription: "none",
      presence: "unavailable",
      isBlocked: false,
    });
    toast.success(`Added ${newJid}`);
    setNewJid("");
    setShowAdd(false);
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-3 border-b border-white/5">
        <h2 className="text-sm font-semibold text-surface-50 flex items-center gap-2">
          <Users size={14} /> Contacts
        </h2>
        <button onClick={() => setShowAdd(!showAdd)}
          className="p-1.5 rounded hover:bg-white/5 text-surface-200/50 hover:text-surface-200">
          <UserPlus size={14} />
        </button>
      </div>

      {showAdd && (
        <div className="px-3 py-2 border-b border-white/5 flex gap-2">
          <input value={newJid} onChange={(e) => setNewJid(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addContact()}
            placeholder="user@example.com"
            className="input-field text-xs flex-1 py-1.5" />
          <button onClick={addContact} className="btn-primary text-xs py-1.5 px-3">Add</button>
        </div>
      )}

      <div className="px-3 py-2 border-b border-white/5">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-surface-200/30" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search contacts..."
            className="w-full pl-7 pr-3 py-1.5 text-xs bg-surface-900 rounded-lg
                       border border-white/5 text-surface-50 placeholder:text-surface-200/30
                       focus:outline-none focus:ring-1 focus:ring-accent/30" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {Object.entries(grouped).map(([group, list]) =>
          list.length > 0 && (
            <GroupSection key={group} name={group} contacts={list} onChat={startChat} />
          )
        )}
        {contacts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-surface-200/30">
            <Users size={20} />
            <span className="text-xs">No contacts yet</span>
          </div>
        )}
      </div>
    </div>
  );
}
