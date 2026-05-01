import { NavLink } from "react-router-dom";
import { useEffect, useState } from "react";
import {
  MessageSquare, Settings, Puzzle, Plus, Wifi, WifiOff, Star, Phone, Globe,
} from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { clsx } from "clsx";
import { useLanguage } from "@/utils/i18n";
import { useShallow } from "zustand/react/shallow";

const navItems = [
  { to: "/", icon: MessageSquare, key: "nav.chats", end: true },
  { to: "/starred", icon: Star, key: "nav.starred" },
  { to: "/calls", icon: Phone, key: "nav.calls" },
  { to: "/discovery", icon: Globe, key: "nav.discovery" },
  { to: "/settings", icon: Settings, key: "nav.settings" },
  { to: "/plugins", icon: Puzzle, key: "nav.plugins" },
];

function PresenceBadge({ presence }: { presence: string }) {
  return (
    <span
      className={clsx("presence-dot absolute bottom-0 right-0", {
        available: presence === "available",
        away: presence === "away",
        dnd: presence === "dnd",
        unavailable: !["available", "away", "dnd"].includes(presence),
      })}
    />
  );
}

export default function Sidebar() {
  const { t } = useLanguage();
  const { accounts, activeId } = useAccountStore(
    useShallow((s) => ({
      accounts: s.accounts,
      activeId: s.activeAccountId,
    }))
  );
  const setActive = useAccountStore((s) => s.setActiveAccount);
  const activeAccount = accounts.find((a) => a.id === activeId);
  const [browserOnline, setBrowserOnline] = useState<boolean>(typeof navigator !== "undefined" ? navigator.onLine : true);

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
    <aside className="w-14 flex-shrink-0 flex flex-col items-center py-4 gap-2 bg-surface-900 border-r border-border">
      {/* Logo */}
      <div className="mb-3 w-9 h-9 rounded-[10px] bg-primary/15 flex items-center justify-center border border-primary/30 text-primary font-bold text-sm select-none">
        W3
      </div>

      {/* Account avatars */}
      <div className="flex flex-col gap-2 mb-2">
        {accounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => setActive(acc.id)}
            className={clsx(
              "relative w-9 h-9 rounded-[10px] transition-all duration-150",
              acc.id === activeId
                ? "ring-2 ring-primary ring-offset-2 ring-offset-surface-900"
                : "opacity-60 hover:opacity-100"
            )}
            title={acc.jid}
          >
            <div className="w-full h-full rounded-[10px] bg-surface-2 flex items-center justify-center text-text-2 text-xs font-semibold uppercase">
              {(acc.displayName ?? acc.jid)[0]}
            </div>
            <PresenceBadge presence={acc.presence} />
          </button>
        ))}

        {/* Add account */}
        <NavLink
          to="/settings?add=1"
          className="w-9 h-9 rounded-[10px] border border-dashed border-border-strong flex items-center justify-center text-text-4 hover:border-primary/50 hover:text-primary transition-all duration-150"
          title={t("nav.addAccount")}
        >
          <Plus size={14} strokeWidth={1.75} />
        </NavLink>
      </div>

      <div className="flex-1" />

      {/* Nav icons */}
      <nav className="flex flex-col gap-1 w-full px-2">
        {navItems.map(({ to, icon: Icon, key, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={t(key)}
            className={({ isActive }) =>
              clsx(
                "w-full flex items-center justify-center py-2.5 rounded-sm transition-all duration-150",
                isActive
                  ? "bg-primary-tint text-primary"
                  : "text-text-4 hover:bg-surface-hover hover:text-text-2"
              )
            }
          >
            <Icon size={18} strokeWidth={1.75} />
          </NavLink>
        ))}
      </nav>

      {/* Connection status */}
      <div
        className="mt-2 flex items-center justify-center"
        title={!browserOnline ? "Browser offline" : (activeAccount?.connected ? t("nav.connected") : t("nav.disconnected"))}
      >
        {!browserOnline ? <WifiOff size={14} className="text-danger" /> : activeAccount?.connected
          ? <Wifi size={14} className="text-success" />
          : <WifiOff size={14} className="text-surface-200/30" />
        }
      </div>
    </aside>
  );
}
