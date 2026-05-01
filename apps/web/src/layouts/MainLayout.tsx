import { Outlet, useLocation, useParams, useSearchParams } from "react-router-dom";
import { useEffect, useState, lazy, Suspense } from "react";
import { clsx } from "clsx";
import Sidebar from "@/components/Sidebar";
import ConversationList from "@/modules/chat/ConversationList";
import RosterPanel from "@/modules/roster/RosterPanel";
import GroupPanel from "@/modules/group/GroupPanel";
import TopBar from "@/components/TopBar";
import { useLanguage } from "@/utils/i18n";
const RightPanel = lazy(() => import("@/components/RightPanel"));

type LeftTab = "chats" | "contacts" | "groups";

export default function MainLayout() {
  const { t } = useLanguage();
  const [leftTab, setLeftTab] = useState<LeftTab>("chats");
  const [showRight, setShowRight] = useState(false);
  const { conversationId } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const hasActiveConversation = !!conversationId;
  const isChatSurfaceRoute = location.pathname === "/" || location.pathname.startsWith("/chat");
  const shouldHideLeftPanelOnMobile = hasActiveConversation || !isChatSurfaceRoute;

  useEffect(() => {
    if (searchParams.get("add_contact")) setLeftTab("contacts");
  }, [searchParams]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg">
      <Sidebar />

      <div
        className={clsx(
          "w-80 flex-shrink-0 flex-col border-r border-border bg-surface-900",
          shouldHideLeftPanelOnMobile ? "hidden md:flex" : "flex"
        )}
      >
        <div className="flex h-[52px] border-b border-border flex-shrink-0 bg-surface-2">
          {(["chats", "contacts", "groups"] as LeftTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setLeftTab(tab)}
              className={`flex-1 text-[13.5px] font-medium transition-colors ${
                leftTab === tab
                  ? "text-text font-semibold shadow-[inset_0_-2px_0_#15161c]"
                  : "text-text-3 hover:text-text"
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
          onToggleRight={() => setShowRight((v) => !v)}
          showRightToggle={!!conversationId}
        />
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <Outlet />
          </div>
          {showRight && conversationId && (
            <Suspense fallback={<div className="w-[22rem] border-l border-border bg-surface-900" />}>
              <RightPanel conversationId={conversationId} onClose={() => setShowRight(false)} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
