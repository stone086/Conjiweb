/**
 * xmppBridge.ts
 * Wires XMPP adapter events into Zustand stores and the notification system.
 * Call initXmppBridge(client) after connecting each account.
 */

import { getClient, XmppClient, RosterContact as AdapterContact } from "./xmppAdapter";
import { useRosterStore } from "@/stores/rosterStore";
import { useChatStore } from "@/stores/chatStore";
import { useNotificationStore } from "@/stores/notificationStore";
import { useAccountStore } from "@/stores/accountStore";
import { useGroupStore } from "@/stores/groupStore";
import { initCrossDeviceSync } from "@/services/crossDeviceSync";
import { initSearchIndex, indexMessage, removeFromIndex } from "@/services/searchIndex";
import { callManager, JingleSession } from "@/services/jingle";
import {
  sdpToJingleXml,
  jingleXmlToSdp,
  candidateToJingleXml,
  terminateToJingleXml,
} from "@/services/jingle/sdpToJingle";
import {
  initOmemo,
  decryptEnvelope,
  encryptForDevices,
  buildOwnBundle,
  establishSession,
} from "@/services/omemo";
import { OmemoStore } from "@/services/omemo/store";
import { cacheMessages, deleteLocalConversationData } from "./localDb";
import { generateConversationId, normalizeBareJid } from "@/utils/helpers";
import {
  decryptOmemoEnvelopeFromPeer,
  decryptBodyFromPeer,
  getOrCreateLocalDeviceId,
  getOrCreateLocalOmemoBundle,
  isEncryptedPayload,
  storePeerOmemoBundle,
} from "@/services/e2ee";

const SUB_REQUEST_DEDUPE_MS = 10 * 60 * 1000;
const lastSubscriptionRequestAt = new Map<string, number>();
const avatarFetchInFlight = new Set<string>();
const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();

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

      // KILLER-07: build local full-text search index from cached messages
      void initSearchIndex(accountId).catch(() => {});

      // KILLER-04: bootstrap cross-device sync from PEP private node
      void (async () => {
        try {
          const sync = initCrossDeviceSync(accountId, client);
          const remote = await sync.pullSnapshot();
          if (!remote) return;
          const store = useChatStore.getState();
          // Apply remote starred IDs (additive)
          if (remote.starred) {
            for (const msgId of remote.starred) {
              for (const convMsgs of Object.values(store.messages)) {
                const msg = convMsgs.find((m) => m.id === msgId);
                if (msg && !msg.starred) {
                  store.toggleMessageStar(msg.conversationId, msgId);
                }
              }
            }
          }
          // Apply pinned conversations
          if (remote.pinned) {
            for (const convId of remote.pinned) {
              const conv = store.conversations[convId];
              if (conv && !conv.pinned) {
                store.upsertConversation({ ...conv, pinned: true });
              }
            }
          }
          // Apply meta-contact groupings
          if (remote.metaContacts) {
            try {
              const { useMetaContactStore } = await import("@/services/metaContacts");
              const metaStore = useMetaContactStore.getState();
              // Merge remote into local (additive)
              const remoteMetas = remote.metaContacts.metas as Record<string, any>;
              if (remoteMetas) {
                for (const [id, meta] of Object.entries(remoteMetas)) {
                  if (!metaStore.metas[id]) {
                    metaStore.metas[id] = meta;
                  }
                }
              }
            } catch {}
          }
        } catch {
          // Cross-device sync degrades gracefully if PEP unavailable
        }
      })();
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
              await storePeerOmemoBundle(accountId, normalizedJid, bundle);
            }
          }
        } catch {
          // no-op; fallback handshake remains available
        }
      };
      void syncPeerOmemo();

      // Standard flow: rely on published OMEMO device list + bundles (no private key-exchange stanzas).
    });
  });

  client.on("subscription.request", (data: any) => {
    const jid = data.jid as string;
    if (!jid) return;
    const normalizedJid = normalizeBareJid(jid);
    if (normalizedJid === ownBareJid) return;
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
    if (normalizedJid === ownBareJid) return;
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
    if (normalizedJid === ownBareJid) return;
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
    const { message, isCarbonSent, isCarbonReceived } = data;
    const from = normalizeBareJid(message.from);
    const to = normalizeBareJid(message.to ?? "");

    // XEP-0280 Carbon: this is a copy of a message we sent from another device
    // Build outgoing message and add to the peer's conversation
    if (isCarbonSent) {
      const peerJid = to;
      if (!peerJid || peerJid === ownBareJid) return;
      const convId = generateConversationId(accountId, peerJid);
      const existingConv = useChatStore.getState().conversations[convId];
      if (!existingConv) {
        const contact = useRosterStore.getState().getContact(accountId, peerJid);
        useChatStore.getState().upsertConversation({
          id: convId,
          accountId,
          type: "private",
          peerJid,
          title: contact?.name ?? peerJid.split("@")[0],
          unreadCount: 0,
          pinned: false,
        });
      }
      const carbonMsg = {
        id: message.id,
        conversationId: convId,
        senderJid: ownBareJid,
        body: message.body,
        bodyType: "text" as const,
        direction: "out" as const,
        status: "sent" as const,
        timestamp: message.timestamp,
        replyToId: message.replyTo,
      };
      // Avoid duplicates if we already added this message locally before sending
      const existing = useChatStore.getState().messages[convId]?.find((m) => m.id === message.id);
      if (!existing) {
        useChatStore.getState().addMessage(carbonMsg);
        cacheMessages([carbonMsg]).catch(() => {});
      }
      return;
    }

    // For carbon-received: treat exactly like a normal incoming message
    // (the rest of the handler below already handles it correctly)

    if (from === ownBareJid && !isCarbonReceived) return;
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

    let incomingBody = message.body;
    const incomingOmemo = message.omemo;
    const incomingEncrypted = Boolean(incomingOmemo) || (typeof incomingBody === "string" && isEncryptedPayload(incomingBody));
    let decryptFailed = false;
    if (incomingOmemo) {
      // BTBV: detect new peer device and notify user
      try {
        const senderDevId = incomingOmemo.sid;
        const trustKey = `conjiweb-omemo-trust:${accountId}:${from}:${senderDevId}`;
        if (senderDevId && !localStorage.getItem(trustKey)) {
          // First time seeing this device - flag as auto-trusted (BTBV)
          localStorage.setItem(trustKey, "trusted");
          // If peer already has other devices, this is a NEW device - warn
          const otherDevicePattern = `conjiweb-omemo-trust:${accountId}:${from}:`;
          let otherCount = 0;
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(otherDevicePattern) && k !== trustKey) otherCount++;
          }
          if (otherCount > 0) {
            const sysMsg = {
              id: crypto.randomUUID(),
              conversationId: generateConversationId(accountId, from),
              senderJid: "system",
              body: `⚠ ${from.split("@")[0]} added a new device (#${senderDevId}). Verify their fingerprint in the trust panel.`,
              bodyType: "text" as const,
              direction: "system" as const,
              status: "delivered" as const,
              timestamp: Date.now(),
            };
            useChatStore.getState().addMessage(sysMsg);
          }
        }
      } catch {}

      // Try the standard libsignal-based decryption first (for messages
      // from Conversations / Gajim / Movim using XEP-0384 v0.8+).
      let decrypted: string | null = null;
      try {
        const store = new OmemoStore(accountId);
        const localDeviceId = await store.getLocalRegistrationId();
        if (localDeviceId && incomingOmemo.namespace?.includes("axolotl")) {
          // Convert legacy envelope format to new EncryptedEnvelope
          const ourKey = incomingOmemo.keys.find((k: any) => k.rid === localDeviceId);
          if (ourKey) {
            const newEnvelope = {
              sid: incomingOmemo.sid,
              iv: base64ToArrayBuffer(incomingOmemo.iv),
              payload: base64ToArrayBuffer(incomingOmemo.payload),
              keys: incomingOmemo.keys.map((k: any) => ({
                rid: k.rid,
                isPreKey: k.prekey === true,
                body: base64ToArrayBuffer(k.value),
              })),
            };
            decrypted = await decryptEnvelope(accountId, localDeviceId, from, newEnvelope);
          }
        }
      } catch {
        // libsignal decrypt failed - fall through to legacy
      }
      // Fall back to legacy custom-protocol decryption
      if (decrypted == null) {
        decrypted = await decryptOmemoEnvelopeFromPeer(accountId, from, incomingOmemo);
      }
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

    // KILLER-07: index for offline full-text search
    indexMessage(accountId, chatMsg.conversationId, chatMsg);

    // ====================================================
    // @ai mention auto-response
    // If the message starts with @ai or contains "@ai " in a group/private chat,
    // call the backend AI assistant and post the reply as a system message.
    // ====================================================
    {
      const trimmed = (incomingBody ?? "").trim();
      const aiTrigger = /(^|\s)@ai(\s|$)/i;
      if (aiTrigger.test(trimmed)) {
        const prompt = trimmed.replace(/(^|\s)@ai(\s|$)/i, " ").trim();
        if (prompt) {
          // Collect last 10 messages of context
          const allMsgs = useChatStore.getState().messages[convId] ?? [];
          const contextMessages = allMsgs.slice(-10).map(
            (m) => `${m.senderJid.split("@")[0]}: ${m.body}`
          );
          (async () => {
            try {
              const resp = await fetch("/api/ai/assistant", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  prompt,
                  context_messages: contextMessages,
                  conversation_id: convId,
                  persona: "concise",
                }),
              });
              if (!resp.ok) return;
              const data = await resp.json();
              const aiMsg = {
                id: crypto.randomUUID(),
                conversationId: convId,
                senderJid: "ai-assistant",
                body: `🤖 ${data.reply}`,
                bodyType: "text" as const,
                direction: "system" as const,
                status: "delivered" as const,
                timestamp: Date.now(),
              };
              useChatStore.getState().addMessage(aiMsg);
              cacheMessages([aiMsg]).catch(() => {});
            } catch {
              // AI unavailable; silently skip
            }
          })();
        }
      }
    }

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

  client.on("reaction.received", (data: any) => {
    const { messageId, emojis, from } = data as {
      messageId: string;
      emojis: string[];
      from: string;
    };
    if (!messageId) return;
    const store = useChatStore.getState();
    // Find the conversation this message belongs to (scoped to this account)
    const convIds = Object.values(store.conversations)
      .filter((c) => c.accountId === accountId)
      .map((c) => c.id);
    for (const convId of convIds) {
      const list = store.messages[convId] ?? [];
      const msg = list.find((m) => m.id === messageId);
      if (msg) {
        // Replace reactions from this sender with the new set
        const existing = { ...(msg.reactions ?? {}) };
        // Peer sends their full current reaction set; we merge by emoji count
        const updated: Record<string, number> = { ...existing };
        emojis.forEach((emoji) => {
          updated[emoji] = (updated[emoji] ?? 0) + 1;
        });
        store.updateMessage(convId, messageId, { reactions: updated });
        break;
      }
    }
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

  // KILLER-04: Push local mutations to PEP cross-device sync (debounced)
  let syncDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastStarredHash = "";
  let lastPinnedHash = "";

  const triggerSync = async () => {
    if (syncDebounceTimer) clearTimeout(syncDebounceTimer);
    syncDebounceTimer = setTimeout(async () => {
      const { getCrossDeviceSync } = await import("@/services/crossDeviceSync");
      const sync = getCrossDeviceSync();
      if (!sync) return;
      const store = useChatStore.getState();
      const accountConvIds = new Set(
        Object.values(store.conversations)
          .filter((c) => c.accountId === accountId)
          .map((c) => c.id)
      );
      const starredIds: string[] = [];
      for (const [convId, msgs] of Object.entries(store.messages)) {
        if (!accountConvIds.has(convId)) continue;
        for (const m of msgs) if (m.starred) starredIds.push(m.id);
      }
      const starredHash = [...starredIds].sort().join(",");
      if (starredHash !== lastStarredHash) {
        lastStarredHash = starredHash;
        sync.pushStarred(starredIds).catch(() => {});
      }
      const pinnedIds = Object.values(store.conversations)
        .filter((c) => c.accountId === accountId && c.pinned)
        .map((c) => c.id);
      const pinnedHash = [...pinnedIds].sort().join(",");
      if (pinnedHash !== lastPinnedHash) {
        lastPinnedHash = pinnedHash;
        sync.pushPinned(pinnedIds).catch(() => {});
      }
    }, 1500);
  };

  // Jingle audio/video call handling
  client.on("jingle", async (data: any) => {
    const { from, sid, action, jingleEl } = data;
    if (!jingleEl) return;

    if (action === "session-initiate") {
      // Incoming call - parse SDP from Jingle XML
      const contentEl = jingleEl.querySelector("content");
      const senders = contentEl?.getAttribute("senders") ?? "both";
      // Determine media types from <description xmlns="urn:xmpp:jingle:apps:rtp:1" media="...">
      const descs = jingleEl.querySelectorAll('description[xmlns="urn:xmpp:jingle:apps:rtp:1"]');
      const mediaTypes: ("audio" | "video")[] = [];
      descs.forEach((d: Element) => {
        const m = d.getAttribute("media");
        if (m === "audio" || m === "video") mediaTypes.push(m);
      });
      // For incoming we need the SDP - parse jingleEl into SDP string
      // This is a simplified path: in production we'd convert Jingle XML to SDP fully
      const sdp = jingleElToSdp(jingleEl);
      await callManager.handleIncoming(sid, from, mediaTypes, sdp);
    } else if (action === "session-accept") {
      const session = callManager.getSession(sid);
      if (!session) return;
      const sdp = jingleElToSdp(jingleEl);
      await session.handleAnswer(sdp);
    } else if (action === "transport-info") {
      const session = callManager.getSession(sid);
      if (!session) return;
      // Extract candidate from <transport><candidate .../></transport>
      const cand = jingleEl.querySelector("candidate");
      if (cand) {
        const candidateLine = `candidate:${cand.getAttribute("foundation")} ${cand.getAttribute("component")} ${cand.getAttribute("protocol")} ${cand.getAttribute("priority")} ${cand.getAttribute("ip")} ${cand.getAttribute("port")} typ ${cand.getAttribute("type")}`;
        await session.addRemoteCandidate({
          candidate: candidateLine,
          sdpMid: cand.getAttribute("name") ?? "0",
        });
      }
    } else if (action === "session-terminate") {
      const session = callManager.getSession(sid);
      session?.remoteHangup();
    }
  });

  // Subscribe to outgoing Jingle stanzas from sessions
  // Subscribe to all sessions (both initiated locally and incoming) so
  // they can send Jingle stanzas back to the peer
  const subscribeSession = (session: JingleSession) => {
    session.on("stanza.outgoing", (out: any) => {
      sendJingleStanza(client, session.info.peerJid, session.info.id, out);
    });
  };
  callManager.on("incoming", subscribeSession);
  // Also auto-subscribe outgoing calls created via callManager.startCall
  const _origStartCall = callManager.startCall.bind(callManager);
  callManager.startCall = async (peerJid, mediaTypes) => {
    const session = await _origStartCall(peerJid, mediaTypes);
    subscribeSession(session);
    return session;
  };

  useChatStore.subscribe(() => { void triggerSync(); });
}

// Helper: convert incoming Jingle XML to SDP string (uses full converter)
function jingleElToSdp(jingleEl: Element): string {
  return jingleXmlToSdp(jingleEl);
}

// Helper: send an outgoing Jingle action (action, sdp/candidate/reason)
function sendJingleStanza(client: any, peerJid: string, sid: string, out: any) {
  let xml = "";
  const myJid = client.config?.jid ?? "";
  if (out.action === "session-initiate") {
    xml = sdpToJingleXml(out.sdp, "session-initiate", sid, myJid, peerJid);
  } else if (out.action === "session-accept") {
    xml = sdpToJingleXml(out.sdp, "session-accept", sid, peerJid, myJid);
  } else if (out.action === "transport-info" && out.candidate) {
    xml = candidateToJingleXml(sid, out.candidate);
  } else if (out.action === "session-terminate") {
    xml = terminateToJingleXml(sid, out.reason ?? "success");
  }
  if (xml && typeof client.sendJingle === "function") {
    client.sendJingle(peerJid, sid, xml);
  }
}


// Helper for converting OMEMO envelope between base64 and ArrayBuffer formats
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}


// =====================================================
// libsignal-based OMEMO encryption helper for outgoing messages
// =====================================================
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/**
 * Try encrypting a message using the new libsignal-based OMEMO (XEP-0384 v0.8+).
 *
 * This is what Conversations / Gajim use. If the peer has published a bundle
 * to PEP via the standard axolotl namespaces, this path produces a real
 * interoperable OMEMO message.
 *
 * Returns the legacy OmemoEnvelope shape (so xmppAdapter.sendOmemoMessage
 * can serialize it without changes), or null if libsignal can't encrypt
 * (e.g. no session, no bundle, peer doesn't support OMEMO).
 *
 * Caller should fall back to the legacy custom protocol if this returns null.
 */
export async function tryLibsignalEncrypt(
  accountId: string,
  peerJid: string,
  plaintext: string
): Promise<any | null> {
  try {
    const store = new OmemoStore(accountId);
    const ownDeviceId = await store.getLocalRegistrationId();
    if (!ownDeviceId) return null;

    const client = getClient(accountId);
    if (!client) return null;

    // 1. Discover peer's devices via PEP devicelist
    const NS_DEVICELIST = "eu.siacs.conversations.axolotl.devicelist";
    const NS_BUNDLES = "eu.siacs.conversations.axolotl.bundles";

    const deviceListEl = await (client as any).fetchPepNode(peerJid, NS_DEVICELIST);
    if (!deviceListEl) return null;

    const deviceIds: number[] = [];
    deviceListEl.querySelectorAll("device").forEach((dev: Element) => {
      const id = parseInt(dev.getAttribute("id") ?? "", 10);
      if (Number.isFinite(id)) deviceIds.push(id);
    });
    if (deviceIds.length === 0) return null;

    // 2. For each device, fetch its bundle and ensure session
    for (const deviceId of deviceIds) {
      const sessionExists = await store.loadSession(`${peerJid}.${deviceId}`);
      if (sessionExists) continue;

      const bundleEl = await (client as any).fetchPepNode(peerJid, `${NS_BUNDLES}:${deviceId}`);
      if (!bundleEl) continue;

      const identityKey = base64ToArrayBuffer(
        bundleEl.querySelector("identityKey")?.textContent?.trim() ?? ""
      );
      const signedPreKeyEl = bundleEl.querySelector("signedPreKeyPublic");
      const signedPreKeyId = parseInt(signedPreKeyEl?.getAttribute("signedPreKeyId") ?? "0", 10);
      const signedPreKey = base64ToArrayBuffer(signedPreKeyEl?.textContent?.trim() ?? "");
      const signedPreKeySignature = base64ToArrayBuffer(
        bundleEl.querySelector("signedPreKeySignature")?.textContent?.trim() ?? ""
      );
      // Pick a random one-time prekey
      const preKeyEls = bundleEl.querySelectorAll("preKeyPublic");
      let preKey: { keyId: number; publicKey: ArrayBuffer } | undefined;
      if (preKeyEls.length > 0) {
        const picked = preKeyEls[Math.floor(Math.random() * preKeyEls.length)] as Element;
        preKey = {
          keyId: parseInt(picked.getAttribute("preKeyId") ?? "0", 10),
          publicKey: base64ToArrayBuffer(picked.textContent?.trim() ?? ""),
        };
      }

      try {
        await establishSession(accountId, peerJid, {
          deviceId,
          identityKey,
          signedPreKeyId,
          signedPreKey,
          signedPreKeySignature,
          preKey,
        });
      } catch {
        // Skip this device if session establishment fails
      }
    }

    // 3. Encrypt for all devices
    const peerDevices = deviceIds.map((id) => ({ peerJid, deviceId: id }));
    const newEnvelope = await encryptForDevices(accountId, ownDeviceId, plaintext, peerDevices);

    // 4. Convert new envelope shape to legacy shape (so existing sendOmemoMessage works)
    return {
      namespace: "eu.siacs.conversations.axolotl",
      sid: newEnvelope.sid,
      iv: arrayBufferToBase64(newEnvelope.iv),
      payload: arrayBufferToBase64(newEnvelope.payload),
      keys: newEnvelope.keys.map((k) => ({
        rid: k.rid,
        value: arrayBufferToBase64(k.body),
        prekey: k.isPreKey,
      })),
    };
  } catch {
    return null;
  }
}
