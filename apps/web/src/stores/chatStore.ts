import { create } from "zustand";

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
}

export const useChatStore = create<ChatState>((set) => ({
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
}));
