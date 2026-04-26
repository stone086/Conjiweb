import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import MessageView from "@/modules/chat/MessageView";
import CallView from "@/modules/call/CallView";
import { MessageSquare } from "lucide-react";
import { useLanguage } from "@/utils/i18n";
import { useChatStore } from "@/stores/chatStore";
import { callManager, JingleSession } from "@/services/jingle";

export default function ChatPage() {
  const { t } = useLanguage();
  const { conversationId } = useParams();
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const [activeCall, setActiveCall] = useState<JingleSession | null>(null);

  useEffect(() => {
    setActiveConversation(conversationId ?? null);
  }, [conversationId, setActiveConversation]);

  // Listen for incoming calls and active call ending
  useEffect(() => {
    callManager.on("incoming", (session) => setActiveCall(session));
    callManager.on("ended", (session) => {
      if (activeCall?.info.id === session.info.id) {
        setActiveCall(null);
      }
    });
  }, [activeCall]);

  if (!conversationId) {
    return (
      <>
        <div className="flex flex-col items-center justify-center h-full gap-4
                        text-surface-200/30
                        bg-[radial-gradient(ellipse_at_center,rgba(124,106,247,0.03),transparent)]">
          <MessageSquare size={48} strokeWidth={1} />
          <div className="text-center">
            <p className="text-sm font-medium">{t("chat.selectConversation")}</p>
            <p className="text-xs mt-1">{t("chat.chooseConversation")}</p>
          </div>
        </div>
        {activeCall && <CallView session={activeCall} onClose={() => setActiveCall(null)} />}
      </>
    );
  }

  return (
    <>
      <MessageView conversationId={conversationId} />
      {activeCall && <CallView session={activeCall} onClose={() => setActiveCall(null)} />}
    </>
  );
}
