import { Link } from "react-router-dom";
import { format } from "date-fns";
import { Star } from "lucide-react";
import { useChatStore } from "@/stores/chatStore";
import { useAccountStore } from "@/stores/accountStore";
import { useLanguage } from "@/utils/i18n";

export default function StarredPage() {
  const { t } = useLanguage();
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const conversations = useChatStore((s) => s.conversations);
  const allMessages = useChatStore((s) => s.messages);

  const starred = Object.values(allMessages)
    .flat()
    .filter((m) => m.starred)
    .filter((m) => {
      const conv = conversations[m.conversationId];
      return conv && conv.accountId === activeAccountId;
    })
    .sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <div className="flex items-center gap-3 mb-2">
          <Star size={18} className="text-warn" />
          <h1 className="text-xl font-bold text-surface-50">
            {t("starred.title")}
          </h1>
        </div>

        {starred.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-surface-200/30">
            <Star size={32} />
            <p className="text-sm">{t("starred.empty")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {starred.map((msg) => {
              const conv = conversations[msg.conversationId];
              const mid = `?mid=${encodeURIComponent(msg.id)}`;
              return (
                <Link
                  key={msg.id}
                  to={`/chat/${msg.conversationId}${mid}`}
                  className="glass rounded-xl p-4 hover:bg-white/5 transition-colors block"
                >
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <span className="text-xs font-medium text-accent-soft truncate">
                      {conv?.title ?? conv?.peerJid ?? msg.conversationId}
                    </span>
                    <span className="text-[10px] text-surface-200/30 flex-shrink-0">
                      {format(msg.timestamp, "yyyy-MM-dd HH:mm")}
                    </span>
                  </div>
                  <p className="text-sm text-surface-50 leading-relaxed line-clamp-3 break-words">
                    {msg.body || (msg.attachments?.length ? `[${msg.attachments[0].fileName}]` : "")}
                  </p>
                  {msg.editedAt && (
                    <span className="text-[10px] text-surface-200/30 mt-1 block">edited</span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
