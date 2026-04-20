import axios from "axios";
export const ADMIN_SESSION_EXPIRED_EVENT = "conjiweb:admin-session-expired";

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
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("admin_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401 && localStorage.getItem("admin_token")) {
      localStorage.removeItem("admin_token");
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
};

// Attachments
export const attachmentsApi = {
  upload: (file: File, messageId?: string) => {
    const form = new FormData();
    form.append("file", file);
    if (messageId) form.append("message_id", messageId);
    return api.post("/attachments/upload", form, {
      headers: { "Content-Type": "multipart/form-data" },
    }).then((r) => r.data);
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
  register: (data: { jid: string; password: string }) =>
    api.post("/auth/register", data).then((r) => r.data),
};
