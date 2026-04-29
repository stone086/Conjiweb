import { useEffect, useMemo, useRef, useState } from "react";
import { Search, Bell, Moon, Sun, PanelRight, Lock, Unlock } from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import NotificationPanel from "@/modules/notification/NotificationPanel";
import GlobalSearch from "@/modules/search/GlobalSearch";
import { applyTheme, getStoredTheme } from "@/utils/theme";
import { useLanguage } from "@/utils/i18n";
import { getOmemoEnabled, onOmemoEnabledChange, setOmemoEnabled } from "@/services/omemoSettings";
import { useReconnectStore } from "@/stores/reconnectStore";
import toast from "react-hot-toast";

interface TopBarProps {
  onToggleRight?: () => void;
  showRightToggle?: boolean;
}
export default function TopBar({ onToggleRight, showRightToggle }: TopBarProps) {
  const { t } = useLanguage();
  const [theme, setTheme] = useState(getStoredTheme());
  const [showNotifs, setShowNotifs] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [omemoEnabled, setOmemoEnabledState] = useState(getOmemoEnabled());
  const dark = useMemo(() => {
    if (theme === "system") return !window.matchMedia("(prefers-color-scheme: light)").matches;
    return theme === "dark";
  }, [theme]);
  const account = useAccountStore((s) => s.accounts.find((a) => a.id === s.activeAccountId));
  const reconnectingCount = useReconnectStore((s) => s.reconnectingAccountIds.length);
  const totalUnread = useNotificationStore((s) => s.totalUnread);
  const notifWrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => onOmemoEnabledChange(setOmemoEnabledState), []);

  useKeyboardShortcuts({
    "ctrl+k": () => setShowSearch(true),
    "meta+k": () => setShowSearch(true),
    "escape": () => {
      setShowSearch(false);
      setShowNotifs(false);
    },
  });

  useEffect(() => {
    if (!showNotifs) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (notifWrapRef.current?.contains(target)) return;
      setShowNotifs(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("touchstart", handlePointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("touchstart", handlePointerDown);
    };
  }, [showNotifs]);

  return (
    <>
      <header className="h-12 flex items-center gap-3 px-4 border-b border-white/5 bg-surface-950/80 backdrop-blur-sm flex-shrink-0 relative z-20">
        <button
          onClick={() => setShowSearch(true)}
          className="flex items-center gap-2 flex-1 max-w-xs px-3 py-1.5 rounded-lg bg-surface-900 border border-white/5 text-surface-200/30 hover:border-white/10 transition-colors cursor-text"
        >
          <Search size={13} />
          <span className="text-xs flex-1 text-left">{t("topbar.searchPlaceholder")}</span>
          <kbd className="hidden sm:inline text-[9px] px-1.5 py-0.5 rounded bg-surface-800 text-surface-200/30 border border-white/5">
            {t("topbar.searchShortcut")}
          </kbd>
        </button>
        <div className="flex-1" />
        <button
          onClick={() => {
            const next = !omemoEnabled;
            setOmemoEnabled(next);
            if (next) {
              toast(t("omemo.enabledNotice"), { duration: 5000 });
            }
          }}
          className="btn-ghost p-2"
          title={omemoEnabled ? t("omemo.enabled") : t("omemo.disabled")}
        >
          {omemoEnabled ? <Lock size={16} /> : <Unlock size={16} />}
        </button>
        {showRightToggle && (
          <button onClick={onToggleRight} className="btn-ghost p-2" title={t("topbar.toggleInfo")}>
            <PanelRight size={16} />
          </button>
        )}
        <button
          onClick={() => {
            const next = dark ? "light" : "dark";
            setTheme(next);
            applyTheme(next);
          }}
          className="btn-ghost p-2"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <div ref={notifWrapRef} className="relative">
          <button onClick={() => setShowNotifs(!showNotifs)} className="btn-ghost p-2 relative">
            <Bell size={16} />
            {totalUnread > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-[14px] rounded-full bg-accent text-[9px] font-bold flex items-center justify-center text-white px-0.5">
                {totalUnread > 9 ? "9+" : totalUnread}
              </span>
            )}
          </button>
          {showNotifs && <NotificationPanel onClose={() => setShowNotifs(false)} />}
        </div>
        {account && (
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-surface-900 border border-white/5 select-none">
            <div className="w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-accent-soft text-xs uppercase font-medium">
              {(account.displayName ?? account.jid)[0]}
            </div>
            <span className="text-surface-200 text-xs max-w-[100px] truncate">
              {account.displayName ?? account.jid.split("@")[0]}
            </span>
            {reconnectingCount > 0 && (
              <span className="text-[10px] text-warn">{`Reconnecting ${reconnectingCount}`}</span>
            )}
          </div>
        )}
      </header>
      {showSearch && <GlobalSearch onClose={() => setShowSearch(false)} />}
    </>
  );
}

