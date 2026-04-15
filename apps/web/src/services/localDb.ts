import Dexie, { Table } from "dexie";
import type { ChatMessage, Conversation } from "@/stores/chatStore";

interface Draft {
  conversationId: string;
  body: string;
  updatedAt: number;
}

interface CachedContact {
  jid: string;
  accountId: string;
  name?: string;
  avatarUrl?: string;
  presence?: string;
  updatedAt: number;
}

class WGajimDB extends Dexie {
  messages!: Table<ChatMessage>;
  conversations!: Table<Conversation>;
  drafts!: Table<Draft>;
  contacts!: Table<CachedContact>;

  constructor() {
    super("conjiweb");
    this.version(1).stores({
      messages: "id, conversationId, timestamp",
      conversations: "id, accountId, peerJid, lastMessageAt",
      drafts: "conversationId",
      contacts: "[jid+accountId], accountId",
    });
  }
}

export const db = new WGajimDB();

// Helper functions
export async function cacheMessages(messages: ChatMessage[]) {
  await db.messages.bulkPut(messages);
}

export async function getLocalMessages(conversationId: string, limit = 50) {
  return db.messages
    .where("conversationId")
    .equals(conversationId)
    .reverse()
    .limit(limit)
    .toArray();
}

export async function saveDraft(conversationId: string, body: string) {
  if (body.trim()) {
    await db.drafts.put({ conversationId, body, updatedAt: Date.now() });
  } else {
    await db.drafts.delete(conversationId);
  }
}

export async function getDraft(conversationId: string): Promise<string> {
  const d = await db.drafts.get(conversationId);
  return d?.body ?? "";
}

export async function cacheConversations(convs: Conversation[]) {
  await db.conversations.bulkPut(convs);
}

export async function getLocalConversations(accountId: string) {
  return db.conversations
    .where("accountId")
    .equals(accountId)
    .reverse()
    .sortBy("lastMessageAt");
}
