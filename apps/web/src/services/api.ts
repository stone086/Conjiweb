import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem("admin_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Accounts
export const accountsApi = {
  list: () => api.get("/accounts/").then((r) => r.data),
  create: (data: { jid: string; domain: string; display_name?: string }) =>
    api.post("/accounts/", data).then((r) => r.data),
  delete: (id: string) => api.delete(`/accounts/${id}`).then((r) => r.data),
};

// Messages
export const messagesApi = {
  search: (q: string) => api.get("/messages/search", { params: { q } }).then((r) => r.data),
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
  list: () => api.get("/plugins/").then((r) => r.data),
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
  login: (username: string, password: string) =>
    api.post("/auth/admin/login", { username, password }).then((r) => r.data),
};
