import { useEffect, useMemo, useState } from "react";

export type Language = "en-US" | "zh-CN";

const LANGUAGE_KEY = "conjiweb-language";
const LANGUAGE_EVENT = "conjiweb:language-change";

const messages: Record<Language, Record<string, string>> = {
  "en-US": {
    "nav.chats": "Chats",
    "nav.settings": "Settings",
    "nav.plugins": "Plugins",
    "nav.admin": "Admin",
    "nav.addAccount": "Add account",
    "nav.connected": "Connected",
    "nav.disconnected": "Disconnected",

    "settings.title": "Settings",
    "settings.subtitle": "Manage accounts and preferences",
    "settings.accounts": "XMPP Accounts",
    "settings.addAccount": "Add Account",
    "settings.addNewAccount": "Add new account",
    "settings.password": "Password",
    "settings.wsOptional": "ws://... (optional)",
    "settings.add": "Add",
    "settings.cancel": "Cancel",
    "settings.noAccounts": "No accounts configured",
    "settings.appearance": "Appearance",
    "settings.theme": "Theme",
    "settings.languagePack": "Language Pack",
    "settings.messageDensity": "Message density",
    "settings.themeDark": "Dark (Default)",
    "settings.themeLight": "Light",
    "settings.themeSystem": "System",
    "settings.languageEn": "English",
    "settings.languageZh": "简体中文",
    "settings.densityComfortable": "Comfortable",
    "settings.densityCompact": "Compact",
    "settings.notifications": "Notifications",
    "settings.notifyBrowser": "Browser notifications",
    "settings.notifySound": "Sound alerts",
    "settings.notifyMention": "Mention highlights",

    "account.online": "Online",
    "account.offline": "Offline",
    "account.connect": "Connect",
    "account.disconnect": "Disconnect",
    "account.remove": "Remove",
    "presence.available": "Available",
    "presence.away": "Away",
    "presence.dnd": "Do Not Disturb",
    "presence.offline": "Offline",

    "toast.accountAdded": "Account added",
    "toast.jidRequired": "JID and password required",
    "toast.connected": "Connected",
    "toast.connectionFailed": "Connection failed",
    "toast.disconnected": "Disconnected",
  },
  "zh-CN": {
    "nav.chats": "聊天",
    "nav.settings": "设置",
    "nav.plugins": "插件",
    "nav.admin": "管理",
    "nav.addAccount": "添加账号",
    "nav.connected": "已连接",
    "nav.disconnected": "未连接",

    "settings.title": "设置",
    "settings.subtitle": "管理账号和偏好配置",
    "settings.accounts": "XMPP 账号",
    "settings.addAccount": "添加账号",
    "settings.addNewAccount": "添加新账号",
    "settings.password": "密码",
    "settings.wsOptional": "ws://...（可选）",
    "settings.add": "添加",
    "settings.cancel": "取消",
    "settings.noAccounts": "暂无账号",
    "settings.appearance": "外观",
    "settings.theme": "主题",
    "settings.languagePack": "语言包",
    "settings.messageDensity": "消息密度",
    "settings.themeDark": "深色（默认）",
    "settings.themeLight": "浅色",
    "settings.themeSystem": "跟随系统",
    "settings.languageEn": "English",
    "settings.languageZh": "简体中文",
    "settings.densityComfortable": "舒适",
    "settings.densityCompact": "紧凑",
    "settings.notifications": "通知",
    "settings.notifyBrowser": "浏览器通知",
    "settings.notifySound": "声音提醒",
    "settings.notifyMention": "提及高亮",

    "account.online": "在线",
    "account.offline": "离线",
    "account.connect": "连接",
    "account.disconnect": "断开连接",
    "account.remove": "移除",
    "presence.available": "在线",
    "presence.away": "离开",
    "presence.dnd": "勿扰",
    "presence.offline": "离线",

    "toast.accountAdded": "账号已添加",
    "toast.jidRequired": "请填写 JID 和密码",
    "toast.connected": "连接成功",
    "toast.connectionFailed": "连接失败",
    "toast.disconnected": "已断开连接",
  },
};

export function getStoredLanguage(): Language {
  const saved = localStorage.getItem(LANGUAGE_KEY);
  return saved === "zh-CN" ? "zh-CN" : "en-US";
}

export function setLanguage(lang: Language) {
  localStorage.setItem(LANGUAGE_KEY, lang);
  window.dispatchEvent(new CustomEvent(LANGUAGE_EVENT, { detail: lang }));
}

export function useLanguage() {
  const [lang, setLangState] = useState<Language>(getStoredLanguage());

  useEffect(() => {
    const onLang = (event: Event) => {
      const next = (event as CustomEvent<Language>).detail;
      if (next === "en-US" || next === "zh-CN") setLangState(next);
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === LANGUAGE_KEY) setLangState(getStoredLanguage());
    };
    window.addEventListener(LANGUAGE_EVENT, onLang);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(LANGUAGE_EVENT, onLang);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const t = useMemo(() => {
    const table = messages[lang] ?? messages["en-US"];
    return (key: string) => table[key] ?? key;
  }, [lang]);

  return { lang, t, setLanguage };
}

