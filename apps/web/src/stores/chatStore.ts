import { create } from "zustand";
import { persist } from "zustand/middleware";

export type MessageDirection = "in" | "out" | "system";
export type ConversationType = "private" | "group" | "system";

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderJid: string;
  body: string;
  bodyType: "text" | "html" | "markdown";
  direction: MessageDirection;
  status: "pending" | "sent" | "delivered" | "read" | "failed";
  timestamp: number;
  replyToId?: string;
  attachments?: MessageAttachment[];
}

export interface MessageAttachment {
  id: string;
  fileName: string;
  mimeType: string;
  downloadUrl: string;
  sizeBytes: number;
}

export interface Conversation {
  id: string;
  accountId: string;
  type: ConversationType;
  peerJid: string;
  title: string;
  avatarUrl?: string;
  lastMessage?: string;
  lastMessageAt?: number;
  unreadCount: number;
  pinned: boolean;
}

interface ChatState {
  conversations: Record<string, Conversation>;
  messages: Record<string, ChatMessage[]>; // keyed by conversationId
  activeConversationId: string | null;

  setActiveConversation: (id: string | null) => void;
  upsertConversation: (conv: Conversation) => void;
  addMessage: (msg: ChatMessage) => void;
  markRead: (conversationId: string) => void;
  clearMessages: (conversationId: string) => void;
  clearAllHistory: () => void;
  pruneHistoryOlderThan: (cutoffTs: number) => void;
}

export const useChatStore = create<ChatState>()(
  persist(
    (set) => ({
      conversations: {},
      messages: {},
      activeConversationId: null,

      setActiveConversation: (id) =>
        set((s) => {
          if (id) {
            // Auto mark read
            const conv = s.conversations[id];
            if (conv) {
              return {
                activeConversationId: id,
                conversations: {
                  ...s.conversations,
                  [id]: { ...conv, unreadCount: 0 },
                },
              };
            }
          }
          return { activeConversationId: id };
        }),

      upsertConversation: (conv) =>
        set((s) => ({
          conversations: { ...s.conversations, [conv.id]: conv },
        })),

      addMessage: (msg) =>
        set((s) => {
          const existing = s.messages[msg.conversationId] ?? [];
          if (existing.some((m) => m.id === msg.id)) {
            return s;
          }
          const conv = s.conversations[msg.conversationId];
          return {
            messages: {
              ...s.messages,
              [msg.conversationId]: [...existing, msg],
            },
            conversations: conv
              ? {
                  ...s.conversations,
                  [msg.conversationId]: {
                    ...conv,
                    lastMessage: msg.body,
                    lastMessageAt: msg.timestamp,
                    unreadCount:
                      s.activeConversationId === msg.conversationId
                        ? 0
                        : (conv.unreadCount ?? 0) + (msg.direction === "in" ? 1 : 0),
                  },
                }
              : s.conversations,
          };
        }),

      markRead: (conversationId) =>
        set((s) => {
          const conv = s.conversations[conversationId];
          if (!conv) return s;
          return {
            conversations: {
              ...s.conversations,
              [conversationId]: { ...conv, unreadCount: 0 },
            },
          };
        }),

      clearMessages: (conversationId) =>
        set((s) => ({
          messages: { ...s.messages, [conversationId]: [] },
        })),

      clearAllHistory: () =>
        set((s) => {
          const nextConversations: Record<string, Conversation> = {};
          Object.entries(s.conversations).forEach(([id, conv]) => {
            nextConversations[id] = {
              ...conv,
              lastMessage: undefined,
              lastMessageAt: undefined,
              unreadCount: 0,
            };
          });
          return {
            messages: {},
            conversations: nextConversations,
          };
        }),

      pruneHistoryOlderThan: (cutoffTs) =>
        set((s) => {
          const nextMessages: Record<string, ChatMessage[]> = {};
          Object.entries(s.messages).forEach(([convId, list]) => {
            const kept = list.filter((m) => m.timestamp >= cutoffTs);
            if (kept.length > 0) nextMessages[convId] = kept;
          });

          const nextConversations: Record<string, Conversation> = {};
          Object.entries(s.conversations).forEach(([id, conv]) => {
            const convMsgs = nextMessages[id] ?? [];
            const last = convMsgs.length > 0 ? convMsgs[convMsgs.length - 1] : null;
            nextConversations[id] = {
              ...conv,
              lastMessage: last?.body,
              lastMessageAt: last?.timestamp,
              unreadCount: last ? conv.unreadCount : 0,
            };
          });

          return {
            messages: nextMessages,
            conversations: nextConversations,
          };
        }),
    }),
    {
      name: "conjiweb-chat",
      partialize: (s) => ({
        conversations: s.conversations,
        messages: s.messages,
        activeConversationId: s.activeConversationId,
      }),
    }
  )
);
