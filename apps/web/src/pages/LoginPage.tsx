import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { normalizeAccountJid, setAccountPassword, useAccountStore } from "@/stores/accountStore";
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
  const currentHost = window.location.hostname.trim().toLowerCase();
  const configuredWsUrl = (import.meta.env.VITE_XMPP_WS_URL as string | undefined) ?? "";
  const wsUrl = (() => {
    const sameOrigin = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/xmpp-websocket`;
    if (!configuredWsUrl) return sameOrigin;
    try {
      return new URL(configuredWsUrl).host === window.location.host ? configuredWsUrl : sameOrigin;
    } catch {
      return sameOrigin;
    }
  })();
  const envXmppDomain = ((import.meta.env.VITE_XMPP_DOMAIN as string | undefined) ?? "").trim().toLowerCase();

  const [form, setForm] = useState({
    jid: "",
    password: "",
  });
  const [inviteDomain] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return (params.get("invite_domain") ?? "").trim().toLowerCase();
  });
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [xmppDomain, setXmppDomain] = useState(envXmppDomain);
  const [publicDomain, setPublicDomain] = useState(currentHost);

  const expandJid = (value: string) => {
    const trimmed = value.trim();
    const defaultDomain = xmppDomain || inviteDomain;
    if (defaultDomain && trimmed && !trimmed.includes("@")) return `${trimmed}@${defaultDomain}`;
    if (!xmppDomain || !trimmed.includes("@")) return trimmed;

    const [username, ...domainParts] = trimmed.split("@");
    const domain = domainParts.join("@").toLowerCase();
    const aliases = new Set([inviteDomain, publicDomain, currentHost].filter(Boolean));
    if (username && aliases.has(domain) && domain !== xmppDomain) {
      return `${username}@${xmppDomain}`;
    }
    return trimmed;
  };

  const withTimeout = <T,>(promise: Promise<T>, ms: number, message: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    });
  };

  const connectWithCurrentForm = async (jidOverride?: string) => {
    const jid = normalizeAccountJid(jidOverride ?? expandJid(form.jid));
    const domain = jid.split("@")[1] ?? "localhost";
    const existing = useAccountStore.getState().accounts.find((a) => normalizeAccountJid(a.jid) === jid);
    const id = existing?.id ?? crypto.randomUUID();
    const createdAccount = !existing;
    addAccount({ id, jid, domain, password: form.password, displayName: jid.split("@")[0] });
    setAccountPassword(id, form.password);
    accountsApi.create({ jid, domain }).catch(() => {});
    const client = createClient({ jid, password: form.password, wsUrl, accountId: id });
    initXmppBridge(client);
    try {
      await withTimeout(client.connect(), 20000, t("login.connectionFailed"));
      const tokenRes = await authApi.getUserToken(jid, form.password);
      if (tokenRes?.access_token) {
        setUserToken(id, tokenRes.access_token);
      }
      await requestNotificationPermission();
      toast.success(`${t("login.connectedAs")}: ${jid}`);
      apiSocket.connect(id);
      navigate("/");
    } catch (err: any) {
      client.disconnect();
      if (createdAccount) {
        useAccountStore.getState().removeAccount(id);
      } else {
        useAccountStore.getState().setConnected(id, false);
      }
      throw err;
    }
  };

  const [ssoProviders, setSsoProviders] = useState<{ oidc: boolean; ldap: boolean; oidc_label: string; ldap_label: string } | null>(null);
  const [ldapMode, setLdapMode] = useState(false);
  const [ldapUser, setLdapUser] = useState("");
  const [ldapPass, setLdapPass] = useState("");

  // Discover available SSO providers on mount
  useEffect(() => {
    authApi.config()
      .then((config) => {
        if (config?.xmpp_domain) setXmppDomain(String(config.xmpp_domain).trim().toLowerCase());
        if (config?.public_domain) setPublicDomain(String(config.public_domain).trim().toLowerCase());
      })
      .catch(() => {});
    fetch("/sso/providers")
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data && (data.oidc || data.ldap)) setSsoProviders(data);
      })
      .catch(() => {});
  }, []);

  // Handle SSO redirect-back-with-token
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.startsWith("#sso-token=")) {
      const params = new URLSearchParams(hash.slice(1));
      const token = params.get("sso-token");
      const rawJid = params.get("jid");
      if (token && rawJid) {
        const jid = normalizeAccountJid(rawJid);
        const existing = useAccountStore.getState().accounts.find((a) => normalizeAccountJid(a.jid) === jid);
        // Build the account from SSO token, store it, and connect
        const id = existing?.id ?? crypto.randomUUID();
        useAccountStore.getState().addAccount({
          id, jid,
          domain: jid.split("@")[1] ?? "",
          displayName: jid.split("@")[0],
        });
        setUserToken(id, token);
        toast.success("SSO login successful");
        // Clear hash and redirect
        window.history.replaceState(null, "", "/");
        navigate("/");
      }
    }
  }, [navigate]);

  const handleLdapLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ldapUser || !ldapPass) return;
    setLoading(true);
    try {
      const r = await fetch("/sso/ldap/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: ldapUser, password: ldapPass }),
      });
      if (!r.ok) throw new Error((await r.json()).detail ?? "LDAP login failed");
      const data = await r.json();
      const jid = normalizeAccountJid(data.jid);
      const existing = useAccountStore.getState().accounts.find((a) => normalizeAccountJid(a.jid) === jid);
      const id = existing?.id ?? crypto.randomUUID();
      useAccountStore.getState().addAccount({
        id, jid,
        domain: jid.split("@")[1] ?? "",
        displayName: ldapUser,
      });
      setUserToken(id, data.access_token);
      toast.success("LDAP login successful");
      navigate("/");
    } catch (err: any) {
      toast.error(err?.message ?? "LDAP login failed");
    } finally {
      setLoading(false);
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
      const requestedJid = expandJid(form.jid);
      const reg = await authApi.register({ jid: requestedJid, password: form.password });
      const effectiveJid = reg?.jid ?? requestedJid;
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
          {inviteDomain && (
            <div className="mb-4 rounded-xl border border-accent/20 bg-accent/10 px-3 py-2 text-xs text-surface-100">
              {t("login.inviteHint").replace("{domain}", inviteDomain)}
            </div>
          )}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-surface-200/70 uppercase tracking-wide">{t("login.jid")}</label>
              <div className="relative">
                <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-200/30" />
                <input type="text" value={form.jid} onChange={(e) => setForm({ ...form, jid: e.target.value })}
                  placeholder={inviteDomain ? t("login.jidInvitePlaceholder").replace("{domain}", inviteDomain) : "user@example.com"} className="input-field pl-9" required autoFocus />
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
          {ssoProviders && (
            <div className="mt-4 pt-4 border-t border-white/5">
              <p className="text-xs text-surface-200/40 text-center mb-3">{t("login.ssoDivider")}</p>
              <div className="flex flex-col gap-2">
                {ssoProviders.oidc && (
                  <a
                    href="/sso/oidc/login"
                    className="btn-secondary text-sm text-center py-2 hover:bg-white/10"
                  >
                    {ssoProviders.oidc_label}
                  </a>
                )}
                {ssoProviders.ldap && (
                  <button
                    type="button"
                    onClick={() => setLdapMode(!ldapMode)}
                    className="btn-secondary text-sm py-2 hover:bg-white/10"
                  >
                    {ssoProviders.ldap_label}
                  </button>
                )}
              </div>
              {ssoProviders.ldap && ldapMode && (
                <form onSubmit={handleLdapLogin} className="flex flex-col gap-2 mt-3">
                  <input
                    type="text"
                    placeholder={t("login.username")}
                    value={ldapUser}
                    onChange={(e) => setLdapUser(e.target.value)}
                    className="input-field text-sm"
                    autoFocus
                  />
                  <input
                    type="password"
                    placeholder={t("login.password")}
                    value={ldapPass}
                    onChange={(e) => setLdapPass(e.target.value)}
                    className="input-field text-sm"
                  />
                  <button type="submit" disabled={loading} className="btn-primary text-sm py-2">
                    {t("login.ldapSignIn")}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
        <p className="text-center text-xs text-surface-200/20 mt-6">Conjiweb · Open Source · v{__APP_VERSION__}</p>
      </div>
    </div>
  );
}
