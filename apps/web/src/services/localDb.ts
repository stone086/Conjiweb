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

interface CachedMessage extends ChatMessage {
  cacheKey: string;
}

class WGajimDB extends Dexie {
  messages!: Table<CachedMessage>;
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
    this.version(2).stores({
      messages: "cacheKey, [conversationId+id], conversationId, timestamp, id",
      conversations: "id, accountId, peerJid, lastMessageAt",
      drafts: "conversationId",
      contacts: "[jid+accountId], accountId",
    });
  }
}

export const db = new WGajimDB();

// Helper functions
export async function cacheMessages(messages: ChatMessage[]) {
  const rows: CachedMessage[] = messages.map((m) => ({
    ...m,
    cacheKey: `${m.conversationId}:${m.id}`,
  }));
  await db.messages.bulkPut(rows);
}

export async function getLocalMessages(conversationId: string, limit = 50) {
  const rows = await db.messages
    .where("conversationId")
    .equals(conversationId)
    .reverse()
    .limit(limit)
    .toArray();
  return rows
    .map(({ cacheKey: _cacheKey, ...msg }) => msg)
    .sort((a, b) => a.timestamp - b.timestamp);
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

export async function clearLocalMessageHistory() {
  await db.messages.clear();
}

export async function pruneLocalMessagesBefore(cutoffTs: number) {
  await db.messages.where("timestamp").below(cutoffTs).delete();
}

export async function deleteLocalConversationData(conversationId: string) {
  await db.messages.where("conversationId").equals(conversationId).delete();
  await db.drafts.delete(conversationId);
  await db.conversations.delete(conversationId);
}
