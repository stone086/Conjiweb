import { useParams } from "react-router-dom";
import MessageView from "@/modules/chat/MessageView";
import { MessageSquare } from "lucide-react";
import { useLanguage } from "@/utils/i18n";

export default function ChatPage() {
  const { t } = useLanguage();
  const { conversationId } = useParams();

  if (!conversationId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4
                      text-surface-200/30
                      bg-[radial-gradient(ellipse_at_center,rgba(124,106,247,0.03),transparent)]">
        <MessageSquare size={48} strokeWidth={1} />
        <div className="text-center">
          <p className="text-sm font-medium">{t("chat.selectConversation")}</p>
          <p className="text-xs mt-1">{t("chat.chooseConversation")}</p>
        </div>
      </div>
    );
  }

  return <MessageView conversationId={conversationId} />;
}
