import axios from "axios";
import { useAccountStore } from "@/stores/accountStore";
export const ADMIN_SESSION_EXPIRED_EVENT = "conjiweb:admin-session-expired";
const USER_TOKEN_KEY_PREFIX = "conjiweb-user-token:";

export function getUserToken(accountId?: string | null): string | null {
  if (!accountId) return null;
  return sessionStorage.getItem(`${USER_TOKEN_KEY_PREFIX}${accountId}`);
}

export function setUserToken(accountId: string, token: string) {
  sessionStorage.setItem(`${USER_TOKEN_KEY_PREFIX}${accountId}`, token);
}

export function clearUserToken(accountId: string) {
  sessionStorage.removeItem(`${USER_TOKEN_KEY_PREFIX}${accountId}`);
}

function normalizeApiUrl(raw?: string): string {
  const fallback = "/api";
  if (!raw) return fallback;
  const value = raw.trim().replace(/\/+$/, "");
  if (!value) return fallback;

  // Absolute URL: ensure path ends with /api
  if (/^https?:\/\//i.test(value)) {
    try {
      const u = new URL(value);
      const path = (u.pathname || "/").replace(/\/+$/, "");
      if (path === "" || path === "/") {
        u.pathname = "/api";
      } else if (!path.endsWith("/api")) {
        u.pathname = `${path}/api`;
      }
      return u.toString().replace(/\/+$/, "");
    } catch {
      return fallback;
    }
  }

  // Relative path: ensure /api suffix
  if (value.startsWith("/")) {
    if (value === "/api" || value.endsWith("/api")) return value;
    return `${value}/api`.replace(/\/{2,}/g, "/");
  }

  return fallback;
}

const API_URL = normalizeApiUrl(import.meta.env.VITE_API_URL as string | undefined);

export const api = axios.create({
  baseURL: API_URL,
});

api.interceptors.request.use((config) => {
  const store = useAccountStore.getState();

  let accountId =
    (typeof config.headers?.["X-Conjiweb-Account-Id"] === "string"
      ? config.headers["X-Conjiweb-Account-Id"]
      : undefined) ??
    store.activeAccountId;

  // 🔥 兜底：没有 activeAccountId 时用第一个账号
  if (!accountId && store.accounts?.length > 0) {
    accountId = store.accounts[0].id;
  }

  console.debug("[API] using accountId:", accountId);

  const token =
    getUserToken(accountId) ?? sessionStorage.getItem("admin_token");

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
    console.debug("[API] token attached ✔");
  } else {
    console.warn("[API] NO TOKEN ❌", accountId);
  }

  if (config.headers && "X-Conjiweb-Account-Id" in config.headers) {
    delete config.headers["X-Conjiweb-Account-Id"];
  }

  // Keep JSON default for normal requests, but never force it for FormData uploads.
  const isFormData =
    typeof FormData !== "undefined" && config.data instanceof FormData;
  if (!isFormData) {
    const hasExplicitContentType =
      Boolean(config.headers?.["Content-Type"]) || Boolean((config.headers as any)?.["content-type"]);
    if (!hasExplicitContentType) {
      (config.headers as any)["Content-Type"] = "application/json";
    }
  } else {
    // Let browser/axios set multipart boundary automatically.
    if (config.headers && "Content-Type" in config.headers) {
      delete (config.headers as any)["Content-Type"];
    }
    if (config.headers && "content-type" in (config.headers as any)) {
      delete (config.headers as any)["content-type"];
    }
  }

  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 && sessionStorage.getItem("admin_token")) {
      sessionStorage.removeItem("admin_token");
      window.dispatchEvent(new Event(ADMIN_SESSION_EXPIRED_EVENT));
    }
    return Promise.reject(error);
  }
);

// Accounts
export const accountsApi = {
  list: () => api.get("/accounts/").then((r) => r.data),
  create: (data: { jid: string; domain: string; display_name?: string }) =>
    api.post("/accounts/", data).then((r) => r.data),
  delete: (id: string) => api.delete(`/accounts/${id}`).then((r) => r.data),
  getPreferences: (accountId: string) =>
    api.get(`/accounts/${accountId}/preferences`).then((r) => r.data),
  updatePreferences: (
    accountId: string,
    data: {
      auto_login?: boolean;
      default_presence?: string;
      theme_override?: string | null;
      notifications_enabled?: boolean;
      config_json?: Record<string, any>;
    }
  ) => api.put(`/accounts/${accountId}/preferences`, data).then((r) => r.data),
};

// Messages
export const messagesApi = {
  search: (q: string, accountId: string) =>
    api.get("/messages/search", { params: { q, account_id: accountId } }).then((r) => r.data),
  getConversation: (id: string, limit = 50) =>
    api.get(`/messages/conversation/${id}`, { params: { limit } }).then((r) => r.data),
  index: (data: object) => api.post("/messages/", data).then((r) => r.data),
  clearHistory: (accountId: string) =>
    api.delete("/messages/history", {
      params: { account_id: accountId },
      headers: { "X-Conjiweb-Account-Id": accountId },
    }).then((r) => r.data),
};

// Attachments
export const attachmentsApi = {
  upload: (file: File, messageId?: string, accountId?: string) => {
    const form = new FormData();
    form.append("file", file, file.name);
    if (messageId) form.append("message_id", messageId);

    // CRITICAL: do NOT set Content-Type manually for FormData uploads.
    // The browser must set it automatically as
    //   "multipart/form-data; boundary=----WebKitFormBoundary..."
    // Setting it manually omits the boundary, the server fails to parse the
    // body (returning 400 or in some configs 401 from the auth middleware
    // running before body parse), and the upload appears to fail.
    //
    // The axios request interceptor will still add Authorization: Bearer <token>
    // because we are not setting that header here.
    const headers: Record<string, string> = {};
    if (accountId) headers["X-Conjiweb-Account-Id"] = accountId;

    return api.post("/attachments/upload", form, { headers }).then((r) => r.data);
  },
};

// Plugins
export const pluginsApi = {
  list: () =>
    api.get("/plugins/").then((r) => {
      const data = r.data;
      if (Array.isArray(data)) return data;
      if (Array.isArray(data?.items)) return data.items;
      if (Array.isArray(data?.data)) return data.data;
      return [];
    }),
  enable: (id: string) => api.post(`/plugins/${id}/enable`).then((r) => r.data),
  disable: (id: string) => api.post(`/plugins/${id}/disable`).then((r) => r.data),
};

// AI
export const aiApi = {
  summarize: (messages: string[], conversationId?: string) =>
    api.post("/ai/summarize", { messages, conversation_id: conversationId }).then((r) => r.data),
  smartReply: (message: string) =>
    api.post("/ai/smart-reply", null, { params: { message } }).then((r) => r.data),
  translate: (text: string, targetLang = "en") =>
    api.post("/ai/translate", null, { params: { text, target_lang: targetLang } }).then((r) => r.data),
};

// Admin
export const adminApi = {
  status: () => api.get("/admin/status").then((r) => r.data),
  serviceHealth: () => api.get("/admin/service-health").then((r) => r.data),
  auditLogs: (limit = 20, offset = 0) =>
    api.get("/admin/audit-logs", { params: { limit, offset } }).then((r) => r.data),
  login: (username: string, password: string) =>
    api.post("/auth/admin/login", { username, password }).then((r) => r.data),
};

// Auth
export const authApi = {
  config: () =>
    api.get("/auth/config").then((r) => r.data as {
      xmpp_domain: string;
      public_domain: string;
      registration_enabled: boolean;
    }),
  register: (data: { jid: string; password: string }) =>
    api.post("/auth/register", data).then((r) => r.data),
  getUserToken: (jid: string, password: string) =>
    api.post("/auth/user-token", { jid, password }).then((r) => r.data),
};
