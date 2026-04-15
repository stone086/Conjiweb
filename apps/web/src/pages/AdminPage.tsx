import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminApi } from "@/services/api";
import { Shield, Activity, Database, Server, Users, FileText, AlertCircle, CheckCircle } from "lucide-react";
import { clsx } from "clsx";
import toast from "react-hot-toast";
import { useLanguage } from "@/utils/i18n";

function StatCard({ icon: Icon, label, value, color = "text-surface-50" }: {
  icon: any; label: string; value: string | number; color?: string;
}) {
  return (
    <div className="glass rounded-xl p-4 flex items-center gap-3">
      <div className="w-9 h-9 rounded-lg bg-surface-800 flex items-center justify-center flex-shrink-0">
        <Icon size={16} className={color} />
      </div>
      <div>
        <p className="text-xs text-surface-200/50">{label}</p>
        <p className={clsx("text-lg font-bold", color)}>{value}</p>
      </div>
    </div>
  );
}

export default function AdminPage() {
  const { t } = useLanguage();
  const [authed, setAuthed] = useState(!!localStorage.getItem("admin_token"));
  const [creds, setCreds] = useState({ username: "", password: "" });

  const { data: status } = useQuery({
    queryKey: ["admin-status"],
    queryFn: adminApi.status,
    enabled: authed,
    refetchInterval: 10000,
  });

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await adminApi.login(creds.username, creds.password);
      localStorage.setItem("admin_token", res.access_token);
      setAuthed(true);
      toast.success(t("admin.loginGranted"));
    } catch {
      toast.error(t("admin.invalidCreds"));
    }
  };

  if (!authed) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="glass rounded-2xl p-8">
            <div className="flex items-center gap-2 mb-6">
              <Shield size={20} className="text-accent" />
              <h1 className="text-lg font-bold text-surface-50">{t("admin.access")}</h1>
            </div>
            <form onSubmit={login} className="flex flex-col gap-3">
              <input
                className="input-field text-sm"
                placeholder={t("admin.username")}
                value={creds.username}
                onChange={(e) => setCreds({ ...creds, username: e.target.value })}
              />
              <input
                className="input-field text-sm"
                type="password"
                placeholder={t("admin.password")}
                value={creds.password}
                onChange={(e) => setCreds({ ...creds, password: e.target.value })}
              />
              <button type="submit" className="btn-primary flex items-center justify-center gap-2">
                <Shield size={14} /> {t("admin.login")}
              </button>
            </form>
            <p className="text-xs text-surface-200/30 mt-4 text-center">{t("admin.defaultCreds")}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-surface-50 flex items-center gap-2">
              <Shield size={20} className="text-accent" /> {t("admin.dashboard")}
            </h1>
            <p className="text-sm text-surface-200/50 mt-1">{t("admin.subtitle")}</p>
          </div>
          <div className="flex items-center gap-2">
            {status?.status === "healthy"
              ? <CheckCircle size={16} className="text-success" />
              : <AlertCircle size={16} className="text-danger" />
            }
            <span className="text-sm text-surface-200/70">{status?.status ?? t("admin.checking")}</span>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatCard icon={Activity} label={t("admin.system")} value={status?.status ?? "-"} color="text-success" />
          <StatCard icon={Server} label={t("admin.version")} value={status?.version ?? "-"} />
          <StatCard icon={Users} label={t("admin.accounts")} value="-" />
          <StatCard icon={Database} label={t("admin.storage")} value="-" />
        </div>

        <section>
          <h2 className="text-sm font-semibold text-surface-200 uppercase tracking-wide mb-3">{t("admin.services")}</h2>
          <div className="flex flex-col gap-2">
            {[
              { name: "FastAPI Backend", port: "8000", desc: t("admin.restApi") },
              { name: "PostgreSQL", port: "5432", desc: t("admin.db") },
              { name: "Redis", port: "6379", desc: t("admin.cache") },
              { name: "MinIO", port: "9000", desc: t("admin.objectStore") },
              { name: "Prosody XMPP", port: "5222/5280", desc: t("admin.xmpp") },
            ].map((svc) => (
              <div key={svc.name} className="glass rounded-xl px-4 py-3 flex items-center gap-4">
                <div className="w-2 h-2 rounded-full bg-success animate-pulse-soft" />
                <div className="flex-1">
                  <span className="text-sm text-surface-50">{svc.name}</span>
                  <span className="text-xs text-surface-200/40 ml-2">{svc.desc}</span>
                </div>
                <code className="text-xs text-accent-soft font-mono">:{svc.port}</code>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-surface-200 uppercase tracking-wide mb-3">
            {t("admin.audit")}
          </h2>
          <div className="glass rounded-xl p-4 text-center text-sm text-surface-200/30">
            <FileText size={24} className="mx-auto mb-2 opacity-30" />
            {t("admin.noAudit")}
          </div>
        </section>

        <button
          onClick={() => { localStorage.removeItem("admin_token"); setAuthed(false); }}
          className="btn-ghost text-xs text-danger self-start flex items-center gap-1.5"
        >
          <Shield size={12} /> {t("admin.logout")}
        </button>
      </div>
    </div>
  );
}

