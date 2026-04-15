import { useNavigate, useParams } from "react-router-dom";
import { useChatStore } from "@/stores/chatStore";
import { useAccountStore } from "@/stores/accountStore";
import { formatDistanceToNow } from "date-fns";
import { clsx } from "clsx";
import { Users, User, MessageSquare } from "lucide-react";

function ConvIcon({ type }: { type: string }) {
  if (type === "group") return <Users size={14} />;
  return <User size={14} />;
}

export default function ConversationList() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const conversations = useChatStore((s) => Object.values(s.conversations));
  const setActive = useChatStore((s) => s.setActiveConversation);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);

  const filtered = conversations
    .filter((c) => c.accountId === activeAccountId)
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));

  const handleSelect = (id: string) => {
    setActive(id);
    navigate(`/chat/${id}`);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <h2 className="text-sm font-semibold text-surface-50">Conversations</h2>
        <span className="text-xs text-surface-200/40">{filtered.length}</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-surface-200/30">
            <MessageSquare size={24} />
            <span className="text-xs">No conversations yet</span>
          </div>
        ) : (
          filtered.map((conv) => (
            <button
              key={conv.id}
              onClick={() => handleSelect(conv.id)}
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2.5 transition-all duration-100 text-left",
                conversationId === conv.id
                  ? "bg-accent/10 border-r-2 border-accent"
                  : "hover:bg-white/4"
              )}
            >
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                <div className="w-9 h-9 rounded-full bg-surface-800 flex items-center
                                justify-center text-surface-200 text-sm font-medium uppercase">
                  {conv.title?.[0] ?? conv.peerJid?.[0] ?? "?"}
                </div>
                <span className={clsx("presence-dot absolute -bottom-0.5 -right-0.5", "available")} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-surface-50 truncate">
                    {conv.title ?? conv.peerJid}
                  </span>
                  {conv.lastMessageAt && (
                    <span className="text-[10px] text-surface-200/40 flex-shrink-0 ml-1">
                      {formatDistanceToNow(conv.lastMessageAt, { addSuffix: false })}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-0.5">
                  <span className="text-xs text-surface-200/50 truncate">
                    {conv.lastMessage ?? "No messages yet"}
                  </span>
                  {conv.unreadCount > 0 && (
                    <span className="badge flex-shrink-0 ml-1">{conv.unreadCount}</span>
                  )}
                </div>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
