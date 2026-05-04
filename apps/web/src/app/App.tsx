import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import { useAccountStore } from "@/stores/accountStore";
import { useChatStore } from "@/stores/chatStore";
import { useXmppReconnect } from "@/hooks/useXmppReconnect";
import { usePWA } from "@/hooks/usePWA";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import MainLayout from "@/layouts/MainLayout";
import LoginPage from "@/pages/LoginPage";
import ChatPage from "@/pages/ChatPage";
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const AdminPage = lazy(() => import("@/pages/AdminPage"));
const PluginsPage = lazy(() => import("@/pages/PluginsPage"));
const StarredPage = lazy(() => import("@/pages/StarredPage"));
const CallHistoryPage = lazy(() => import("@/pages/CallHistoryPage"));
const DiscoveryPage = lazy(() => import("@/pages/DiscoveryPage"));

function AuthGuard({ children }: { children: React.ReactNode }) {
  const accounts = useAccountStore((s) => s.accounts);
  const activeId = useAccountStore((s) => s.activeAccountId);
  if (!activeId || accounts.length === 0) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppInner() {
  const location = useLocation();
  const reconnectEnabled = !location.pathname.startsWith("/login");
  useXmppReconnect(reconnectEnabled);
  usePWA();
  const mergeDuplicatePrivateConversations = useChatStore((s) => s.mergeDuplicatePrivateConversations);
  const [browserOnline, setBrowserOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);

  useEffect(() => {
    mergeDuplicatePrivateConversations();
  }, [mergeDuplicatePrivateConversations]);

  useEffect(() => {
    const onOnline = () => setBrowserOnline(true);
    const onOffline = () => setBrowserOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<AuthGuard><MainLayout /></AuthGuard>}>
          <Route
            index
            element={
              <ErrorBoundary>
                <ChatPage />
              </ErrorBoundary>
            }
          />
          <Route
            path="chat/:conversationId?"
            element={
              <ErrorBoundary>
                <ChatPage />
              </ErrorBoundary>
            }
          />
          <Route path="settings" element={<Suspense fallback={null}><SettingsPage /></Suspense>} />
          <Route path="plugins" element={<Suspense fallback={null}><PluginsPage /></Suspense>} />
          <Route path="starred" element={<Suspense fallback={null}><StarredPage /></Suspense>} />
          <Route path="calls" element={<Suspense fallback={null}><CallHistoryPage /></Suspense>} />
          <Route path="discovery" element={<Suspense fallback={null}><DiscoveryPage /></Suspense>} />
          <Route path="admin" element={<Suspense fallback={null}><AdminPage /></Suspense>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!browserOnline && (
        <div className="fixed bottom-0 left-0 right-0 z-50 bg-danger/90 text-white text-xs text-center py-1.5">
          You are offline
        </div>
      )}
    </>
  );
}

export default function App() {
  return <AppInner />;
}
