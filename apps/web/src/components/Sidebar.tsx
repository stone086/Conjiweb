import { NavLink } from "react-router-dom";
import {
  MessageSquare, Settings, Puzzle, Shield,
  User, Plus, ChevronDown, Wifi, WifiOff,
} from "lucide-react";
import { useAccountStore } from "@/stores/accountStore";
import { clsx } from "clsx";

const navItems = [
  { to: "/", icon: MessageSquare, label: "Chats", end: true },
  { to: "/settings", icon: Settings, label: "Settings" },
  { to: "/plugins", icon: Puzzle, label: "Plugins" },
  { to: "/admin", icon: Shield, label: "Admin" },
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
  const accounts = useAccountStore((s) => s.accounts);
  const activeId = useAccountStore((s) => s.activeAccountId);
  const setActive = useAccountStore((s) => s.setActiveAccount);
  const activeAccount = accounts.find((a) => a.id === activeId);

  return (
    <aside className="w-16 flex-shrink-0 flex flex-col items-center py-4 gap-2
                      bg-surface-950 border-r border-white/5">
      {/* Logo */}
      <div className="mb-3 w-9 h-9 rounded-xl bg-accent/20 flex items-center justify-center
                      border border-accent/30 text-accent font-bold text-sm select-none">
        W3
      </div>

      {/* Account avatars */}
      <div className="flex flex-col gap-2 mb-2">
        {accounts.map((acc) => (
          <button
            key={acc.id}
            onClick={() => setActive(acc.id)}
            className={clsx(
              "relative w-9 h-9 rounded-xl transition-all duration-150",
              acc.id === activeId
                ? "ring-2 ring-accent ring-offset-2 ring-offset-surface-950"
                : "opacity-60 hover:opacity-100"
            )}
            title={acc.jid}
          >
            <div className="w-full h-full rounded-xl bg-surface-800 flex items-center justify-center
                            text-surface-200 text-xs font-semibold uppercase">
              {(acc.displayName ?? acc.jid)[0]}
            </div>
            <PresenceBadge presence={acc.presence} />
          </button>
        ))}

        {/* Add account */}
        <NavLink
          to="/settings"
          className="w-9 h-9 rounded-xl border border-dashed border-white/20
                     flex items-center justify-center text-surface-200/40
                     hover:border-accent/50 hover:text-accent transition-all duration-150"
          title="Add account"
        >
          <Plus size={14} />
        </NavLink>
      </div>

      <div className="flex-1" />

      {/* Nav icons */}
      <nav className="flex flex-col gap-1 w-full px-2">
        {navItems.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            title={label}
            className={({ isActive }) =>
              clsx(
                "w-full flex items-center justify-center py-2.5 rounded-lg transition-all duration-150",
                isActive
                  ? "bg-accent/15 text-accent-soft"
                  : "text-surface-200/50 hover:bg-white/5 hover:text-surface-200"
              )
            }
          >
            <Icon size={18} />
          </NavLink>
        ))}
      </nav>

      {/* Connection status */}
      <div className="mt-2 flex items-center justify-center" title={activeAccount?.connected ? "Connected" : "Disconnected"}>
        {activeAccount?.connected
          ? <Wifi size={14} className="text-success" />
          : <WifiOff size={14} className="text-surface-200/30" />
        }
      </div>
    </aside>
  );
}
