import { useParams } from "react-router-dom";
import MessageView from "@/modules/chat/MessageView";
import { MessageSquare } from "lucide-react";

export default function ChatPage() {
  const { conversationId } = useParams();

  if (!conversationId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4
                      text-surface-200/30
                      bg-[radial-gradient(ellipse_at_center,rgba(124,106,247,0.03),transparent)]">
        <MessageSquare size={48} strokeWidth={1} />
        <div className="text-center">
          <p className="text-sm font-medium">Select a conversation</p>
          <p className="text-xs mt-1">Choose from the list on the left to start chatting</p>
        </div>
      </div>
    );
  }

  return <MessageView conversationId={conversationId} />;
}
