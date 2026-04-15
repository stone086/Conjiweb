import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccountStore } from "@/stores/accountStore";
import { createClient } from "@/services/xmppAdapter";
import { initXmppBridge } from "@/services/xmppBridge";
import { accountsApi } from "@/services/api";
import { requestNotificationPermission } from "@/stores/notificationStore";
import toast from "react-hot-toast";
import { Wifi, Lock, User, Server, Eye, EyeOff } from "lucide-react";

export default function LoginPage() {
  const navigate = useNavigate();
  const addAccount = useAccountStore((s) => s.addAccount);

  const [form, setForm] = useState({
    jid: "",
    password: "",
    wsUrl: (import.meta.env.VITE_XMPP_WS_URL as string) ?? "ws://localhost:5280/xmpp-websocket",
  });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.jid || !form.password) return;
    setLoading(true);
    const id = crypto.randomUUID();
    const domain = form.jid.split("@")[1] ?? "localhost";
    try {
      addAccount({ id, jid: form.jid, domain, password: form.password, displayName: form.jid.split("@")[0] });
      accountsApi.create({ jid: form.jid, domain }).catch(() => {});
      const client = createClient({ jid: form.jid, password: form.password, wsUrl: form.wsUrl, accountId: id });
      initXmppBridge(client);
      await client.connect();
      await requestNotificationPermission();
      toast.success(`Connected as ${form.jid}`);
      navigate("/");
    } catch (err: any) {
      useAccountStore.getState().removeAccount(id);
      toast.error(err.message ?? "Connection failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 bg-[radial-gradient(ellipse_at_top,rgba(124,106,247,0.08),transparent_60%)]">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-accent/10 border border-accent/20 mb-4">
            <Wifi size={28} className="text-accent" />
          </div>
          <h1 className="text-3xl font-bold text-surface-50 tracking-tight">Conjiweb</h1>
          <p className="text-surface-200/50 mt-1 text-sm">Modern Web XMPP Client Platform</p>
        </div>
        <div className="glass rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-surface-50 mb-6">Connect your account</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-surface-200/70 uppercase tracking-wide">XMPP Address (JID)</label>
              <div className="relative">
                <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-200/30" />
                <input type="text" value={form.jid} onChange={(e) => setForm({ ...form, jid: e.target.value })}
                  placeholder="user@example.com" className="input-field pl-9" required autoFocus />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-surface-200/70 uppercase tracking-wide">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-200/30" />
                <input type={showPass ? "text" : "password"} value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="鈥⑩€⑩€⑩€⑩€⑩€⑩€⑩€? className="input-field pl-9 pr-10" required />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-200/30 hover:text-surface-200">
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-surface-200/70 uppercase tracking-wide">WebSocket URL</label>
              <div className="relative">
                <Server size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-200/30" />
                <input type="text" value={form.wsUrl} onChange={(e) => setForm({ ...form, wsUrl: e.target.value })}
                  placeholder="ws://xmpp.example.com:5280/xmpp-websocket" className="input-field pl-9 text-xs" />
              </div>
            </div>
            <button type="submit" disabled={loading} className="btn-primary mt-2 flex items-center justify-center gap-2">
              {loading ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Connecting...</>) : (<><Wifi size={16} />Connect</>)}
            </button>
          </form>
          <p className="text-center text-xs text-surface-200/30 mt-6">Your credentials connect directly to your XMPP server.</p>
        </div>
        <p className="text-center text-xs text-surface-200/20 mt-6">Conjiweb 路 Open Source 路 v3.0.0</p>
      </div>
    </div>
  );
}
