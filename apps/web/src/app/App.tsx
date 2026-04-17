import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect } from "react";
import { useAccountStore } from "@/stores/accountStore";
import { useChatStore } from "@/stores/chatStore";
import { useXmppReconnect } from "@/hooks/useXmppReconnect";
import { usePWA } from "@/hooks/usePWA";
import MainLayout from "@/layouts/MainLayout";
import LoginPage from "@/pages/LoginPage";
import ChatPage from "@/pages/ChatPage";
import SettingsPage from "@/pages/SettingsPage";
import AdminPage from "@/pages/AdminPage";
import PluginsPage from "@/pages/PluginsPage";

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

  useEffect(() => {
    mergeDuplicatePrivateConversations();
  }, [mergeDuplicatePrivateConversations]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<AuthGuard><MainLayout /></AuthGuard>}>
        <Route index element={<ChatPage />} />
        <Route path="chat/:conversationId?" element={<ChatPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="plugins" element={<PluginsPage />} />
        <Route path="admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return <AppInner />;
}
