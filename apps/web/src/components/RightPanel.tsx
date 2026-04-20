import { useState } from "react";
import { useChatStore, Conversation } from "@/stores/chatStore";
import { useRosterStore } from "@/stores/rosterStore";
import { useAccountStore } from "@/stores/accountStore";
import { useGroupStore, MucMember } from "@/stores/groupStore";
import { aiApi } from "@/services/api";
import { X, Bot, Users, FileText, Info, Crown, Shield, Loader } from "lucide-react";
import { clsx } from "clsx";
import toast from "react-hot-toast";
import { useLanguage } from "@/utils/i18n";

type RightTab = "info" | "members" | "files" | "ai";

interface RightPanelProps {
  conversationId: string;
  onClose: () => void;
}

function AiSummaryTab({ conversationId }: { conversationId: string }) {
  const { t } = useLanguage();
  const messages = useChatStore((s) => s.messages[conversationId] ?? []);
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<{ summary: string; key_points: string[] } | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const summarize = async () => {
    if (!messages.length) {
      toast(t("right.noMessagesToSummarize"));
      return;
    }
    setLoading(true);
    try {
      const texts = messages.map((m) => m.body).filter(Boolean).slice(-50);
      const res = await aiApi.summarize(texts, conversationId);
      setSummary(res);
    } catch {
      toast.error(t("right.aiUnavailable"));
    } finally {
      setLoading(false);
    }
  };

  const getSmartReplies = async () => {
    const last = messages[messages.length - 1];
    if (!last) return;
    try {
      const res = await aiApi.smartReply(last.body);
      setSuggestions(res.suggestions ?? []);
    } catch {
      toast.error(t("right.aiUnavailable"));
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <button onClick={summarize} disabled={loading} className="btn-primary w-full flex items-center justify-center gap-2 text-sm">
          {loading ? <Loader size={14} className="animate-spin" /> : <Bot size={14} />}
          {loading ? t("right.summarizing") : t("right.summarizeConversation")}
        </button>
        {summary && (
          <div className="mt-3 flex flex-col gap-3">
            <div className="glass rounded-xl p-3">
              <p className="text-xs font-semibold text-surface-200/60 uppercase tracking-wide mb-1">{t("right.summary")}</p>
              <p className="text-sm text-surface-50 leading-relaxed">{summary.summary}</p>
            </div>
            {summary.key_points.length > 0 && (
              <div className="glass rounded-xl p-3">
                <p className="text-xs font-semibold text-surface-200/60 uppercase tracking-wide mb-2">{t("right.keyPoints")}</p>
                <ul className="flex flex-col gap-1">
                  {summary.key_points.map((pt, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-surface-200/80">
                      <span className="text-accent mt-0.5">•</span> {pt}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>

      <div>
        <button onClick={getSmartReplies} className="btn-ghost w-full flex items-center justify-center gap-2 text-sm border border-white/10">
          <Bot size={14} /> {t("right.smartReplySuggestions")}
        </button>
        {suggestions.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => setComposerDraft(conversationId, s)}
                className="w-full text-left text-xs px-3 py-2 rounded-lg bg-surface-800/50 hover:bg-surface-800 border border-white/5 text-surface-200/80"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="text-[10px] text-surface-200/25 text-center">{t("right.llmTip")}</p>
    </div>
  );
}

function MembersTab({ roomJid }: { roomJid: string }) {
  const { t } = useLanguage();
  const members = useGroupStore((s) => s.members[roomJid] ?? []);

  const roleLabel: Record<MucMember["affiliation"], string> = {
    owner: t("right.owner"),
    admin: t("right.admin"),
    member: t("right.member"),
    none: t("right.guest"),
  };

  if (members.length === 0) {
    return (
      <div className="p-4 text-center text-sm text-surface-200/30">
        <Users size={20} className="mx-auto mb-2 opacity-30" />
        {t("right.joinToSeeMembers")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 p-2">
      {members.map((m) => (
        <div key={m.jid} className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-white/4">
          <div className="w-7 h-7 rounded-full bg-surface-800 flex items-center justify-center text-xs font-medium uppercase text-surface-200">
            {m.nickname[0]}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-surface-50 truncate">{m.nickname}</p>
            <p className="text-xs text-surface-200/40">{roleLabel[m.affiliation]}</p>
          </div>
          {m.affiliation === "owner" && <Crown size={12} className="text-yellow-400 flex-shrink-0" />}
          {m.affiliation === "admin" && <Shield size={12} className="text-accent-soft flex-shrink-0" />}
        </div>
      ))}
    </div>
  );
}

function InfoTab({ conversation }: { conversation: Conversation }) {
  const { t } = useLanguage();
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const contact = useRosterStore((s) =>
    activeAccountId ? s.getContact(activeAccountId, conversation.peerJid) : undefined
  );
  const room = useGroupStore((s) => s.rooms[conversation.peerJid]);

  return (
    <div className="p-4 flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 py-2">
        <div className="w-16 h-16 rounded-full bg-surface-800 flex items-center justify-center text-2xl font-bold uppercase text-surface-200">
          {(conversation.title ?? conversation.peerJid)[0]}
        </div>
        <div className="text-center">
          <p className="font-semibold text-surface-50">{conversation.title ?? conversation.peerJid}</p>
          <p className="text-xs text-surface-200/40 mt-0.5">{conversation.peerJid}</p>
        </div>
        {contact && (
          <span className={clsx("text-xs px-2 py-0.5 rounded-full", contact.presence === "available" ? "bg-success/20 text-success" : "bg-surface-800 text-surface-200/50")}>
            {contact.presence}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {contact?.statusText && (
          <div className="glass rounded-lg p-3">
            <p className="text-xs text-surface-200/40 mb-1">{t("right.status")}</p>
            <p className="text-sm text-surface-50">{contact.statusText}</p>
          </div>
        )}
        {room?.subject && (
          <div className="glass rounded-lg p-3">
            <p className="text-xs text-surface-200/40 mb-1">{t("right.roomSubject")}</p>
            <p className="text-sm text-surface-50">{room.subject}</p>
          </div>
        )}
        <div className="glass rounded-lg p-3">
          <p className="text-xs text-surface-200/40 mb-1">{t("right.type")}</p>
          <p className="text-sm text-surface-50 capitalize">{conversation.type}</p>
        </div>
      </div>
    </div>
  );
}

export default function RightPanel({ conversationId, onClose }: RightPanelProps) {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<RightTab>("info");
  const conversation = useChatStore((s) => s.conversations[conversationId]);

  if (!conversation) return null;

  const tabs: { id: RightTab; icon: React.ReactNode; label: string }[] = [
    { id: "info", icon: <Info size={14} />, label: t("right.info") },
    ...(conversation.type === "group" ? [{ id: "members" as RightTab, icon: <Users size={14} />, label: t("right.members") }] : []),
    { id: "files", icon: <FileText size={14} />, label: t("right.files") },
    { id: "ai", icon: <Bot size={14} />, label: t("right.ai") },
  ];

  return (
    <div className="w-72 flex-shrink-0 flex flex-col border-l border-white/5 bg-surface-900/30 h-full">
      <div className="flex items-center justify-between px-3 py-3 border-b border-white/5">
        <span className="text-sm font-semibold text-surface-50 truncate">{conversation.title ?? conversation.peerJid}</span>
        <button onClick={onClose} className="p-1.5 rounded hover:bg-white/5 text-surface-200/40 hover:text-surface-200">
          <X size={14} />
        </button>
      </div>

      <div className="flex border-b border-white/5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={clsx(
              "flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs transition-colors",
              activeTab === tab.id ? "text-accent-soft border-b-2 border-accent" : "text-surface-200/40 hover:text-surface-200",
            )}
            title={tab.label}
          >
            {tab.icon}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {activeTab === "info" && <InfoTab conversation={conversation} />}
        {activeTab === "members" && <MembersTab roomJid={conversation.peerJid} />}
        {activeTab === "ai" && <AiSummaryTab conversationId={conversationId} />}
        {activeTab === "files" && (
          <div className="p-4 text-center text-sm text-surface-200/30 mt-4">
            <FileText size={20} className="mx-auto mb-2 opacity-30" />
            {t("right.fileHistorySoon")}
          </div>
        )}
      </div>
    </div>
  );
}


