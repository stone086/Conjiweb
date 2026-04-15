import { Outlet, useParams } from "react-router-dom";
import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import ConversationList from "@/modules/chat/ConversationList";
import RosterPanel from "@/modules/roster/RosterPanel";
import GroupPanel from "@/modules/group/GroupPanel";
import TopBar from "@/components/TopBar";
import RightPanel from "@/components/RightPanel";

type LeftTab = "chats" | "contacts" | "groups";

export default function MainLayout() {
  const [leftTab, setLeftTab] = useState<LeftTab>("chats");
  const [showRight, setShowRight] = useState(false);
  const { conversationId } = useParams();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-950">
      <Sidebar />

      <div className="w-72 flex-shrink-0 flex flex-col border-r border-white/5 bg-surface-900/50">
        <div className="flex border-b border-white/5 flex-shrink-0">
          {(["chats", "contacts", "groups"] as LeftTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setLeftTab(tab)}
              className={`flex-1 py-2.5 text-xs font-medium capitalize transition-colors ${
                leftTab === tab
                  ? "text-accent-soft border-b-2 border-accent"
                  : "text-surface-200/40 hover:text-surface-200"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-hidden">
          {leftTab === "chats" && <ConversationList />}
          {leftTab === "contacts" && <RosterPanel />}
          {leftTab === "groups" && <GroupPanel />}
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          onToggleRight={() => setShowRight((v) => !v)}
          showRightToggle={!!conversationId}
        />
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <Outlet />
          </div>
          {showRight && conversationId && (
            <RightPanel conversationId={conversationId} onClose={() => setShowRight(false)} />
          )}
        </div>
      </div>
    </div>
  );
}
