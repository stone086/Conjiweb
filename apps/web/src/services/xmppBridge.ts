/**
 * xmppBridge.ts
 * Wires XMPP adapter events into Zustand stores and the notification system.
 * Call initXmppBridge(client) after connecting each account.
 */

import { XmppClient, RosterContact as AdapterContact } from "./xmppAdapter";
import { useRosterStore } from "@/stores/rosterStore";
import { useChatStore } from "@/stores/chatStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useAccountStore } from "@/stores/accountStore";
import { useGroupStore } from "@/stores/groupStore";
import { cacheMessages, deleteLocalConversationData } from "./localDb";
import { generateConversationId, normalizeBareJid } from "@/utils/helpers";
import {
  buildKeyExchangePayload,
  decryptOmemoEnvelopeFromPeer,
  decryptBodyFromPeer,
  getOrCreateLocalDeviceId,
  getOrCreateLocalOmemoBundle,
  isEncryptedPayload,
  parseKeyExchangePayload,
  storePeerOmemoBundle,
  storePeerPublicKey,
} from "@/services/e2ee";
import { getOmemoEnabled } from "@/services/omemoSettings";

const SUB_REQUEST_DEDUPE_MS = 10 * 60 * 1000;
const lastSubscriptionRequestAt = new Map<string, number>();
const avatarFetchInFlight = new Set<string>();
const keyAdvertisedToPeer = new Set<string>();
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function retryDecryptConversation(accountId: string, peerJid: string) {
  const convId = generateConversationId(accountId, peerJid);
  const store = useChatStore.getState();
  const list = store.messages[convId] ?? [];
  for (const msg of list) {
    if (!msg.decryptFailed) continue;
    let decrypted: string | null = null;
    if (msg.omemoEnvelope) {
      decrypted = await decryptOmemoEnvelopeFromPeer(accountId, peerJid, msg.omemoEnvelope);
    } else if (msg.cipherPayload) {
      decrypted = await decryptBodyFromPeer(accountId, peerJid, msg.cipherPayload);
    }
    if (!decrypted) continue;
    store.updateMessage(convId, msg.id, {
      body: decrypted,
      decryptFailed: false,
    });
    const updated = store.messages[convId]?.find((m) => m.id === msg.id);
    if (updated) {
      cacheMessages([updated]).catch(() => {});
    }
  }
}

function normalizePresence(show?: string): "available" | "away" | "dnd" | "xa" | "unavailable" {
  const value = (show ?? "").toLowerCase();
  if (value === "away") return "away";
  if (value === "dnd") return "dnd";
  if (value === "xa") return "xa";
  if (value === "unavailable" || value === "offline") return "unavailable";
  return "available";
}

export function initXmppBridge(client: XmppClient) {
  const accountId = client.config.accountId;
  const ownBareJid = normalizeBareJid(client.config.jid);

  // Connection changes
  client.on("connection.changed", (data: any) => {
    useAccountStore.getState().setConnected(accountId, data.status === "connected");
    if (data.status !== "connected") {
      const store = useChatStore.getState();
      Object.values(store.conversations)
        .filter((c) => c.accountId === accountId)
        .forEach((c) => store.setTypingPeer(c.id, null, false));
    }
    if (data.status === "connected") {
      const publishLocalOmemo = async () => {
        try {
          const localDeviceId = getOrCreateLocalDeviceId(accountId);
          const localBundle = await getOrCreateLocalOmemoBundle(accountId);
          await client.publishOmemoDeviceList([localDeviceId]);
          await client.publishOmemoBundle(localBundle);
        } catch {
          // keep chat flow running even if OMEMO publish fails
        }
      };
      void publishLocalOmemo();
    }
  });

  // Roster updates -> RosterStore
  client.on("roster.updated", (data: any) => {
    const { contacts }: { contacts: AdapterContact[] } = data;
    contacts.forEach((c) => {
      if (!c.jid) return;
      const normalizedJid = normalizeBareJid(c.jid);
      if (normalizedJid === ownBareJid) return;
      const existing = useRosterStore.getState().getContact(accountId, normalizedJid);
      useRosterStore.getState().upsertContact({
        accountId,
        jid: normalizedJid,
        name: c.name ?? existing?.name,
        groups: c.groups?.length ? c.groups : (existing?.groups ?? []),
        subscription: c.subscription as any,
        pendingIncoming: c.subscription === "none" ? (existing?.pendingIncoming ?? false) : false,
        presence: existing?.presence ?? "unavailable",
        statusText: existing?.statusText,
        avatarUrl: existing?.avatarUrl,
        isBlocked: existing?.isBlocked ?? false,
      });

      const avatarKey = `${accountId}::${normalizedJid}`;
      if (!existing?.avatarUrl && !avatarFetchInFlight.has(avatarKey)) {
        avatarFetchInFlight.add(avatarKey);
        client.fetchVCardAvatar(normalizedJid).then((avatarUrl) => {
          if (avatarUrl) {
            const latest = useRosterStore.getState().getContact(accountId, normalizedJid);
            if (latest) {
              useRosterStore.getState().upsertContact({ ...latest, avatarUrl });
            }
          }
        }).finally(() => {
          avatarFetchInFlight.delete(avatarKey);
        });
      }

      const syncPeerOmemo = async () => {
        try {
          const devices = await client.fetchOmemoDeviceList(normalizedJid);
          for (const deviceId of devices) {
            const bundle = await client.fetchOmemoBundle(normalizedJid, deviceId);
            if (bundle) {
              storePeerOmemoBundle(accountId, normalizedJid, bundle);
            }
          }
        } catch {
          // no-op; fallback handshake remains available
        }
      };
      void syncPeerOmemo();

      // Proactively advertise local key to known contacts so encrypted chat can start without manual retry.
      if (getOmemoEnabled()) {
        const advertiseKey = `${accountId}::${normalizedJid}`;
        const canAdvertise = c.subscription === "both" || c.subscription === "to" || c.subscription === "from";
        if (canAdvertise && !keyAdvertisedToPeer.has(advertiseKey)) {
          keyAdvertisedToPeer.add(advertiseKey);
          buildKeyExchangePayload(accountId)
            .then((payload) => client.sendMessage(normalizedJid, payload, "chat"))
            .catch(() => {
              keyAdvertisedToPeer.delete(advertiseKey);
            });
        }
      }
    });
  });

  client.on("subscription.request", (data: any) => {
    const jid = data.jid as string;
    if (!jid) return;
    const normalizedJid = normalizeBareJid(jid);
    const dedupeKey = `${accountId}::${normalizedJid}`;
    const now = Date.now();
    const lastAt = lastSubscriptionRequestAt.get(dedupeKey) ?? 0;
    if (now - lastAt < SUB_REQUEST_DEDUPE_MS) return;
    lastSubscriptionRequestAt.set(dedupeKey, now);

    const existing = useRosterStore.getState().getContact(accountId, normalizedJid);
    const alreadySubscribed =
      existing?.subscription === "both"
      || existing?.subscription === "to"
      || existing?.subscription === "from";
    if (existing?.isBlocked || existing?.pendingIncoming || alreadySubscribed) return;
    useRosterStore.getState().markPendingIncoming(accountId, normalizedJid);
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "Subscription request",
      body: `${normalizedJid} wants to add you`,
      accountId,
    });
  });

  client.on("subscription.approved", (data: any) => {
    const normalizedJid = normalizeBareJid(data.jid as string);
    if (!normalizedJid) return;
    const existing = useRosterStore.getState().getContact(accountId, normalizedJid);
    useRosterStore.getState().upsertContact({
      accountId,
      jid: normalizedJid,
      name: existing?.name,
      groups: existing?.groups ?? [],
      subscription: "both",
      pendingIncoming: false,
      presence: existing?.presence ?? "unavailable",
      statusText: existing?.statusText,
      avatarUrl: existing?.avatarUrl,
      isBlocked: false,
    });
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "Friend request accepted",
      body: `${normalizedJid} accepted your friend request`,
      accountId,
    });
  });

  client.on("subscription.denied", (data: any) => {
    const normalizedJid = normalizeBareJid(data.jid as string);
    if (!normalizedJid) return;
    const convId = generateConversationId(accountId, normalizedJid);
    const existing = useRosterStore.getState().getContact(accountId, normalizedJid);
    if (existing) {
      useRosterStore.getState().upsertContact({
        ...existing,
        accountId,
        jid: normalizedJid,
        subscription: "none",
        pendingIncoming: false,
      });
    }
    useChatStore.getState().deleteConversation(convId);
    deleteLocalConversationData(convId).catch(() => {});
    useNotificationStore.getState().addNotification({
      type: "system",
      title: "Friend request rejected",
      body: `${normalizedJid} rejected your friend request`,
      accountId,
    });
  });

  // Presence updates -> RosterStore
  client.on("presence.updated", (data: any) => {
    const { jid, show, status } = data;
    const normalizedJid = normalizeBareJid(jid);
    if (normalizedJid === ownBareJid) return;
    const roster = useRosterStore.getState();
    if (!roster.getContact(accountId, normalizedJid)) {
      roster.upsertContact({
        accountId,
        jid: normalizedJid,
        groups: [],
        subscription: "none",
        pendingIncoming: false,
        presence: normalizePresence(show),
        statusText: status,
        isBlocked: false,
      });
      return;
    }
    roster.updatePresence(accountId, normalizedJid, normalizePresence(show), status);
  });

  // Incoming messages -> ChatStore + notifications
  client.on("message.received", async (data: any) => {
    const { message } = data;
    const from = normalizeBareJid(message.from);
    if (from === ownBareJid) return;
    const existingContact = useRosterStore.getState().getContact(accountId, from);
    if (existingContact?.isBlocked) return;

    if (!existingContact) {
      useRosterStore.getState().upsertContact({
        accountId,
        jid: from,
        groups: [],
        subscription: "none",
        pendingIncoming: true,
        presence: "unavailable",
        isBlocked: false,
      });
    }

    // Find or create conversation
    const convId = generateConversationId(accountId, from);
    const existingConv = useChatStore.getState().conversations[convId];

    if (!existingConv) {
      const contact = useRosterStore.getState().getContact(accountId, from);
      useChatStore.getState().upsertConversation({
        id: convId,
        accountId,
        type: message.type === "groupchat" ? "group" : "private",
        peerJid: from,
        title: contact?.name ?? from.split("@")[0],
        unreadCount: 0,
        pinned: false,
      });
    }

    if (typeof message.body === "string") {
      const keyPayload = parseKeyExchangePayload(message.body);
      if (keyPayload) {
        storePeerPublicKey(accountId, from, keyPayload);
        await retryDecryptConversation(accountId, from);
        if (getOmemoEnabled()) {
          const replyPayload = await buildKeyExchangePayload(accountId);
          client.sendMessage(from, replyPayload, "chat");
        }
        return;
      }
    }

    let incomingBody = message.body;
    const incomingOmemo = message.omemo;
    const incomingEncrypted = Boolean(incomingOmemo) || (typeof incomingBody === "string" && isEncryptedPayload(incomingBody));
    let decryptFailed = false;
    if (incomingOmemo) {
      const decrypted = await decryptOmemoEnvelopeFromPeer(accountId, from, incomingOmemo);
      if (decrypted == null) {
        incomingBody = "[Encrypted message - unable to decrypt]";
        decryptFailed = true;
      } else {
        incomingBody = decrypted;
      }
    } else if (incomingEncrypted) {
      const decrypted = await decryptBodyFromPeer(accountId, from, incomingBody);
      if (decrypted == null) {
        incomingBody = "[Encrypted message - unable to decrypt]";
        decryptFailed = true;
      } else {
        incomingBody = decrypted;
      }
    }

    const chatMsg = {
      id: message.id,
      conversationId: convId,
      senderJid: from,
      body: incomingBody,
      bodyType: "text" as const,
      direction: "in" as const,
      status: "delivered" as const,
      timestamp: message.timestamp,
      encrypted: incomingEncrypted,
      decryptFailed,
      cipherPayload: incomingOmemo ? undefined : (incomingEncrypted ? String(message.body) : undefined),
      omemoEnvelope: incomingOmemo ?? undefined,
      replyToId: message.replyTo,
    };

    if (message.replaceId) {
      useChatStore.getState().updateMessage(convId, message.replaceId, {
        body: message.body,
        editedAt: message.timestamp,
      });
      cacheMessages([
        {
          ...(useChatStore.getState().messages[convId]?.find((m) => m.id === message.replaceId) ?? chatMsg),
          body: message.body,
          editedAt: message.timestamp,
        },
      ]).catch(() => {});
      return;
    }

    useChatStore.getState().addMessage(chatMsg);
    client.sendReceipt(message.from, message.id, "received");
    if (useChatStore.getState().activeConversationId === convId) {
      client.sendReceipt(message.from, message.id, "displayed");
    }

    // Cache to IndexedDB
    cacheMessages([chatMsg]).catch(() => {});

    // Notification
    const contact = useRosterStore.getState().getContact(accountId, from);
    const activeConvId = useChatStore.getState().activeConversationId;
    const ownUsername = ownBareJid.split("@")[0].toLowerCase();
    const text = (message.body ?? "").toLowerCase();
    const mentionEnabled = localStorage.getItem("conjiweb-notify-mention") !== "0";
    const mentioned = text.includes(`@${ownUsername}`);
    if (activeConvId !== convId) {
      useNotificationStore.getState().addNotification({
        type: mentioned && mentionEnabled ? "mention" : "message",
        title: contact?.name ?? from.split("@")[0],
        body: message.body.slice(0, 80),
        conversationId: convId,
        accountId,
      });
    } else if (mentioned && mentionEnabled) {
      useNotificationStore.getState().addNotification({
        type: "mention",
        title: `${contact?.name ?? from.split("@")[0]} mentioned you`,
        body: message.body.slice(0, 80),
        conversationId: convId,
        accountId,
      });
    }
  });

  // MAM history messages
  client.on("mam.message", async (data: any) => {
    const { message } = data;
    const from = normalizeBareJid(message.from);
    const ownJid = normalizeBareJid(client.config.jid);
    const isOwn = from === ownJid;
    const peerJid = isOwn ? normalizeBareJid(message.to) : from;
    if (!peerJid || peerJid === ownJid) return;
    const convId = generateConversationId(accountId, peerJid);

    let body = message.body;
    const incomingOmemo = message.omemo;
    const encrypted = Boolean(incomingOmemo) || (typeof body === "string" && isEncryptedPayload(body));
    let decryptFailed = false;
    if (incomingOmemo) {
      const decrypted = await decryptOmemoEnvelopeFromPeer(accountId, peerJid, incomingOmemo);
      if (decrypted == null) {
        body = "[Encrypted message - unable to decrypt]";
        decryptFailed = true;
      } else {
        body = decrypted;
      }
    } else if (encrypted) {
      const decrypted = await decryptBodyFromPeer(accountId, peerJid, body);
      if (decrypted == null) {
        body = "[Encrypted message - unable to decrypt]";
        decryptFailed = true;
      } else {
        body = decrypted;
      }
    }

    const chatMsg = {
      id: message.id,
      conversationId: convId,
      senderJid: from,
      body,
      bodyType: "text" as const,
      direction: isOwn ? ("out" as const) : ("in" as const),
      status: "delivered" as const,
      timestamp: message.timestamp,
      encrypted,
      decryptFailed,
      cipherPayload: incomingOmemo ? undefined : (encrypted ? String(message.body) : undefined),
      omemoEnvelope: incomingOmemo ?? undefined,
      replyToId: message.replyTo,
    };

    useChatStore.getState().addMessage(chatMsg, { countAsUnread: false });
    cacheMessages([chatMsg]).catch(() => {});
  });

  // Typing indicators
  client.on("typing.started", (data: any) => {
    const from = normalizeBareJid(String(data.from ?? ""));
    if (!from || from === ownBareJid) return;
    const convId = generateConversationId(accountId, from);
    const store = useChatStore.getState();
    store.setTypingPeer(convId, from, true);
    const prev = typingTimers.get(convId);
    if (prev) clearTimeout(prev);
    typingTimers.set(
      convId,
      setTimeout(() => {
        useChatStore.getState().setTypingPeer(convId, null, false);
        typingTimers.delete(convId);
      }, 5000)
    );
  });

  client.on("typing.stopped", (data: any) => {
    const from = normalizeBareJid(String(data.from ?? ""));
    if (!from || from === ownBareJid) return;
    const convId = generateConversationId(accountId, from);
    const prev = typingTimers.get(convId);
    if (prev) {
      clearTimeout(prev);
      typingTimers.delete(convId);
    }
    useChatStore.getState().setTypingPeer(convId, null, false);
  });

  // Delivery receipts
  client.on("message.delivered", (data: any) => {
    const messageId = data.messageId as string | undefined;
    if (!messageId) return;
    const store = useChatStore.getState();
    const relevantConvIds = Object.values(store.conversations)
      .filter((c) => c.accountId === accountId)
      .map((c) => c.id);
    relevantConvIds.forEach((conversationId) => {
      const list = store.messages[conversationId] ?? [];
      if (list.some((m) => m.id === messageId && m.direction === "out")) {
        store.updateMessage(conversationId, messageId, { status: "delivered" });
      }
    });
  });

  client.on("message.read", (data: any) => {
    const messageId = data.messageId as string | undefined;
    if (!messageId) return;
    const store = useChatStore.getState();
    const relevantConvIds = Object.values(store.conversations)
      .filter((c) => c.accountId === accountId)
      .map((c) => c.id);
    relevantConvIds.forEach((conversationId) => {
      const list = store.messages[conversationId] ?? [];
      if (list.some((m) => m.id === messageId && m.direction === "out")) {
        store.updateMessage(conversationId, messageId, { status: "read" });
      }
    });
  });

  client.on("message.retracted", (data: any) => {
    const messageId = data.messageId as string | undefined;
    if (!messageId) return;
    const store = useChatStore.getState();
    const relevantConvIds = Object.values(store.conversations)
      .filter((c) => c.accountId === accountId)
      .map((c) => c.id);
    for (const conversationId of relevantConvIds) {
      const list = store.messages[conversationId] ?? [];
      if (!list.some((m) => m.id === messageId)) continue;
      store.updateMessage(conversationId, messageId, {
        body: "Message deleted",
        deletedAt: Date.now(),
        editedAt: Date.now(),
      });
      break;
    }
  });

  client.on("room.member", (data: any) => {
    const roomJid = normalizeBareJid(data.roomJid as string);
    if (!roomJid) return;
    const members = useGroupStore.getState().members[roomJid] ?? [];
    const jid = normalizeBareJid(data.jid as string);
    const nextMember = {
      jid,
      nickname: (data.nickname as string) ?? jid.split("@")[0],
      role: (data.role as any) ?? "participant",
      affiliation: (data.affiliation as any) ?? "none",
      presence: (data.presence as any) ?? "available",
    };
    const without = members.filter((m) => m.jid !== jid);
    if (nextMember.presence === "unavailable") {
      useGroupStore.getState().setMembers(roomJid, without);
      return;
    }
    useGroupStore.getState().setMembers(roomJid, [...without, nextMember]);
  });

  client.on("room.subject", (data: any) => {
    const roomJid = normalizeBareJid(data.roomJid as string);
    if (!roomJid) return;
    useGroupStore.getState().updateRoomSubject(roomJid, String(data.subject ?? ""));
  });

}
