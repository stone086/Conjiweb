import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState, lazy, Suspense } from "react";
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

function LazyPage({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<div className="h-full w-full bg-bg" />}>{children}</Suspense>;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const accounts = useAccountStore((s) => s.accounts);
  const activeId = useAccountStore((s) => s.activeAccountId);
  if (!activeId || accounts.length === 0) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppInner() {
  useXmppReconnect();
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
          <Route path="settings" element={<LazyPage><SettingsPage /></LazyPage>} />
          <Route path="plugins" element={<LazyPage><PluginsPage /></LazyPage>} />
          <Route path="starred" element={<LazyPage><StarredPage /></LazyPage>} />
          <Route path="calls" element={<LazyPage><CallHistoryPage /></LazyPage>} />
          <Route path="discovery" element={<LazyPage><DiscoveryPage /></LazyPage>} />
          <Route path="admin" element={<LazyPage><AdminPage /></LazyPage>} />
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
