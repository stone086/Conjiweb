import { Outlet, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { clsx } from "clsx";
import Sidebar from "@/components/Sidebar";
import ConversationList from "@/modules/chat/ConversationList";
import RosterPanel from "@/modules/roster/RosterPanel";
import GroupPanel from "@/modules/group/GroupPanel";
import TopBar from "@/components/TopBar";
import RightPanel from "@/components/RightPanel";
import { useLanguage } from "@/utils/i18n";

type LeftTab = "chats" | "contacts" | "groups";

export default function MainLayout() {
  const { t } = useLanguage();
  const [leftTab, setLeftTab] = useState<LeftTab>("chats");
  const [showRight, setShowRight] = useState(false);
  const [showLeftDrawer, setShowLeftDrawer] = useState(false);
  const { conversationId } = useParams();

  useEffect(() => {
    if (conversationId) setShowLeftDrawer(false);
  }, [conversationId]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-surface-950">
      <div className="hidden md:block">
        <Sidebar />
      </div>

      {showLeftDrawer && (
        <button
          className="md:hidden fixed inset-0 bg-black/45 z-20"
          onClick={() => setShowLeftDrawer(false)}
          aria-label="Close conversations panel"
        />
      )}

      <div
        className={clsx(
          "flex-shrink-0 flex flex-col border-r border-white/5 bg-surface-900/95 md:bg-surface-900/50 z-30",
          "fixed md:static inset-y-0 left-0 w-[82vw] max-w-[20rem] md:w-72 transform transition-transform",
          showLeftDrawer ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        )}
      >
        <div className="flex border-b border-white/5 flex-shrink-0">
          {(["chats", "contacts", "groups"] as LeftTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => {
                setLeftTab(tab);
                setShowLeftDrawer(true);
              }}
              className={`flex-1 py-2.5 text-xs font-medium transition-colors ${
                leftTab === tab
                  ? "text-accent-soft border-b-2 border-accent"
                  : "text-surface-200/40 hover:text-surface-200"
              }`}
            >
              {tab === "chats" ? t("lefttab.chats") : tab === "contacts" ? t("lefttab.contacts") : t("lefttab.groups")}
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
          onToggleLeft={() => setShowLeftDrawer((v) => !v)}
          showLeftToggle
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
