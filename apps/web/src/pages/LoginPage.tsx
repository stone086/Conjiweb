import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { setAccountPassword, useAccountStore } from "@/stores/accountStore";
import { createClient } from "@/services/xmppAdapter";
import { initXmppBridge } from "@/services/xmppBridge";
import { accountsApi, authApi, setUserToken } from "@/services/api";
import { apiSocket } from "@/services/apiSocket";
import { requestNotificationPermission } from "@/stores/notificationStore";
import toast from "react-hot-toast";
import { Wifi, Lock, User, Eye, EyeOff, UserPlus } from "lucide-react";
import { useLanguage } from "@/utils/i18n";

export default function LoginPage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const addAccount = useAccountStore((s) => s.addAccount);
  const wsUrl = (import.meta.env.VITE_XMPP_WS_URL as string) ?? "ws://localhost:5280/xmpp-websocket";

  const [form, setForm] = useState({
    jid: "",
    password: "",
  });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);

  const connectWithCurrentForm = async (jidOverride?: string) => {
    const jid = jidOverride ?? form.jid;
    const id = crypto.randomUUID();
    const domain = jid.split("@")[1] ?? "localhost";
    addAccount({ id, jid, domain, password: form.password, displayName: jid.split("@")[0] });
    setAccountPassword(id, form.password);
    accountsApi.create({ jid, domain }).catch(() => {});
    const client = createClient({ jid, password: form.password, wsUrl, accountId: id });
    initXmppBridge(client);
    try {
      await client.connect();
      const tokenRes = await authApi.getUserToken(jid, form.password).catch(() => null);
      if (tokenRes?.access_token) {
        setUserToken(id, tokenRes.access_token);
        apiSocket.connect(id);
      } else {
        // Non-fatal: XMPP is connected, but backend token endpoint may be unavailable.
        toast("Connected, but backend token service is unavailable right now.");
      }
      await requestNotificationPermission();
      toast.success(`${t("login.connectedAs")}: ${jid}`);
      navigate("/");
    } catch (err: any) {
      useAccountStore.getState().removeAccount(id);
      throw err;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.jid || !form.password) return;
    setLoading(true);
    try {
      await connectWithCurrentForm();
    } catch (err: any) {
      toast.error(err.message ?? t("login.connectionFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!form.jid || !form.password) {
      toast.error(t("toast.jidRequired"));
      return;
    }
    setRegistering(true);
    try {
      const reg = await authApi.register({ jid: form.jid, password: form.password });
      const effectiveJid = reg?.jid ?? form.jid;
      setForm((prev) => ({ ...prev, jid: effectiveJid }));
      toast.success(t("login.registerSuccess"));
      await connectWithCurrentForm(effectiveJid);
    } catch (err: any) {
      const message = err?.response?.data?.detail ?? err?.message ?? t("login.registerFailed");
      toast.error(message);
    } finally {
      setRegistering(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-950 bg-[radial-gradient(ellipse_at_top,rgba(124,106,247,0.08),transparent_60%)]">
      <div className="w-full max-w-md px-4">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-32 h-32 rounded-3xl bg-accent/10 border border-accent/20 mb-4 overflow-hidden">
            <img src="/app-logo.png" alt="Conjiweb" className="w-full h-full object-cover" />
          </div>
        </div>
        <div className="glass rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-surface-50 mb-6">{t("login.connectAccount")}</h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-surface-200/70 uppercase tracking-wide">{t("login.jid")}</label>
              <div className="relative">
                <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-200/30" />
                <input type="text" value={form.jid} onChange={(e) => setForm({ ...form, jid: e.target.value })}
                  placeholder="user@example.com" className="input-field pl-9" required autoFocus />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-surface-200/70 uppercase tracking-wide">{t("login.password")}</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-200/30" />
                <input type={showPass ? "text" : "password"} value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="********" className="input-field pl-9 pr-10" required />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-200/30 hover:text-surface-200">
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-3">
              <button type="submit" disabled={loading || registering} className="btn-primary flex items-center justify-center gap-2">
                {loading ? (<><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />{t("login.connecting")}</>) : (<><Wifi size={16} />{t("login.connect")}</>)}
              </button>
              <button
                type="button"
                disabled={loading || registering}
                onClick={handleRegister}
                className="h-12 rounded-xl border border-surface-100/20 bg-surface-900/40 text-surface-50 font-semibold flex items-center justify-center gap-2 hover:bg-surface-900/60 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <UserPlus size={16} />
                {registering ? t("login.registering") : t("login.register")}
              </button>
            </div>
          </form>
        </div>
        <p className="text-center text-xs text-surface-200/20 mt-6">Conjiweb · Open Source · v{__APP_VERSION__}</p>
      </div>
    </div>
  );
}
