import { useState } from "react";
import { useAccountStore, XmppAccount, PresenceType } from "@/stores/accountStore";
import { createClient, destroyClient } from "@/services/xmppAdapter";
import { Trash2, Plus, Wifi, WifiOff, ChevronDown } from "lucide-react";
import toast from "react-hot-toast";
import { clsx } from "clsx";

const PRESENCES: { value: PresenceType; label: string; color: string }[] = [
  { value: "available", label: "Available", color: "bg-success" },
  { value: "away", label: "Away", color: "bg-warn" },
  { value: "dnd", label: "Do Not Disturb", color: "bg-danger" },
  { value: "unavailable", label: "Offline", color: "bg-surface-200/40" },
];

function AccountCard({ account }: { account: XmppAccount }) {
  const removeAccount = useAccountStore((s) => s.removeAccount);
  const updatePresence = useAccountStore((s) => s.updatePresence);
  const setConnected = useAccountStore((s) => s.setConnected);
  const [connecting, setConnecting] = useState(false);

  const connect = async () => {
    setConnecting(true);
    try {
      const client = createClient({
        jid: account.jid,
        password: account.password,
        wsUrl: import.meta.env.VITE_XMPP_WS_URL ?? "ws://localhost:5280/xmpp-websocket",
        accountId: account.id,
      });
      client.on("connection.changed", (d: any) => setConnected(account.id, d.status === "connected"));
      await client.connect();
      toast.success(`Connected: ${account.jid}`);
    } catch (e: any) {
      toast.error(e.message ?? "Connection failed");
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    destroyClient(account.id);
    setConnected(account.id, false);
    toast("Disconnected");
  };

  return (
    <div className="glass rounded-xl p-4 flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-surface-800 flex items-center justify-center
                        text-surface-200 font-semibold uppercase">
          {(account.displayName ?? account.jid)[0]}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-surface-50 truncate">
            {account.displayName ?? account.jid.split("@")[0]}
          </p>
          <p className="text-xs text-surface-200/50 truncate">{account.jid}</p>
        </div>
        <div className="flex items-center gap-2">
          {account.connected
            ? <span className="text-[10px] text-success font-medium flex items-center gap-1"><Wifi size={10}/> Online</span>
            : <span className="text-[10px] text-surface-200/40 flex items-center gap-1"><WifiOff size={10}/> Offline</span>
          }
        </div>
      </div>

      {/* Presence selector */}
      <div className="flex gap-2 flex-wrap">
        {PRESENCES.map((p) => (
          <button
            key={p.value}
            onClick={() => updatePresence(account.id, p.value)}
            className={clsx(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-all",
              account.presence === p.value
                ? "border-white/20 bg-white/10 text-surface-50"
                : "border-white/5 text-surface-200/40 hover:border-white/10 hover:text-surface-200"
            )}
          >
            <span className={clsx("w-2 h-2 rounded-full", p.color)} />
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        {!account.connected ? (
          <button onClick={connect} disabled={connecting} className="btn-primary text-xs py-1.5 flex items-center gap-1.5">
            {connecting
              ? <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
              : <Wifi size={12} />
            }
            Connect
          </button>
        ) : (
          <button onClick={disconnect} className="btn-ghost text-xs py-1.5 flex items-center gap-1.5 text-danger">
            <WifiOff size={12} /> Disconnect
          </button>
        )}
        <button
          onClick={() => { disconnect(); removeAccount(account.id); }}
          className="btn-ghost text-xs py-1.5 flex items-center gap-1.5 text-danger ml-auto"
        >
          <Trash2 size={12} /> Remove
        </button>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const accounts = useAccountStore((s) => s.accounts);
  const addAccount = useAccountStore((s) => s.addAccount);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ jid: "", password: "", wsUrl: "" });

  const handleAdd = () => {
    if (!form.jid || !form.password) { toast.error("JID and password required"); return; }
    addAccount({
      id: crypto.randomUUID(),
      jid: form.jid,
      domain: form.jid.split("@")[1] ?? "localhost",
      password: form.password,
      displayName: form.jid.split("@")[0],
    });
    setForm({ jid: "", password: "", wsUrl: "" });
    setShowAdd(false);
    toast.success("Account added");
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-2xl mx-auto flex flex-col gap-6">
        <div>
          <h1 className="text-xl font-bold text-surface-50">Settings</h1>
          <p className="text-sm text-surface-200/50 mt-1">Manage accounts and preferences</p>
        </div>

        {/* Accounts section */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-surface-200 uppercase tracking-wide">
              XMPP Accounts
            </h2>
            <button onClick={() => setShowAdd(!showAdd)} className="btn-ghost text-xs flex items-center gap-1">
              <Plus size={12} /> Add Account
            </button>
          </div>

          {showAdd && (
            <div className="glass rounded-xl p-4 mb-3 flex flex-col gap-3 animate-fade-in">
              <h3 className="text-sm font-medium text-surface-50">Add new account</h3>
              <input className="input-field text-sm" placeholder="user@xmpp.example.com"
                value={form.jid} onChange={(e) => setForm({ ...form, jid: e.target.value })} />
              <input className="input-field text-sm" type="password" placeholder="Password"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
              <input className="input-field text-sm" placeholder="ws://... (optional)"
                value={form.wsUrl} onChange={(e) => setForm({ ...form, wsUrl: e.target.value })} />
              <div className="flex gap-2">
                <button onClick={handleAdd} className="btn-primary text-sm">Add</button>
                <button onClick={() => setShowAdd(false)} className="btn-ghost text-sm">Cancel</button>
              </div>
            </div>
          )}

          <div className="flex flex-col gap-3">
            {accounts.length === 0 ? (
              <p className="text-sm text-surface-200/30 py-4 text-center">No accounts configured</p>
            ) : (
              accounts.map((acc) => <AccountCard key={acc.id} account={acc} />)
            )}
          </div>
        </section>

        {/* Appearance */}
        <section>
          <h2 className="text-sm font-semibold text-surface-200 uppercase tracking-wide mb-3">
            Appearance
          </h2>
          <div className="glass rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-surface-200">Theme</span>
              <select className="input-field w-auto text-sm">
                <option value="dark">Dark (Default)</option>
                <option value="light">Light</option>
                <option value="system">System</option>
              </select>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-surface-200">Message density</span>
              <select className="input-field w-auto text-sm">
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </div>
          </div>
        </section>

        {/* Notifications */}
        <section>
          <h2 className="text-sm font-semibold text-surface-200 uppercase tracking-wide mb-3">
            Notifications
          </h2>
          <div className="glass rounded-xl p-4 flex flex-col gap-3">
            {[
              { label: "Browser notifications", key: "browser" },
              { label: "Sound alerts", key: "sound" },
              { label: "Mention highlights", key: "mention" },
            ].map(({ label, key }) => (
              <label key={key} className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-surface-200">{label}</span>
                <input type="checkbox" defaultChecked className="w-4 h-4 accent-[#7c6af7]" />
              </label>
            ))}
          </div>
        </section>

        <p className="text-xs text-surface-200/20 text-center">Conjiweb 路 v3.0.0</p>
      </div>
    </div>
  );
}
