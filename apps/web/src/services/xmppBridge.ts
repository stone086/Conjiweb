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
import { cacheMessages } from "./localDb";

export function initXmppBridge(client: XmppClient) {
  const accountId = client.config.accountId;

  // Connection changes
  client.on("connection.changed", (data: any) => {
    useAccountStore.getState().setConnected(accountId, data.status === "connected");
  });

  // Roster updates → RosterStore
  client.on("roster.updated", (data: any) => {
    const { contacts }: { contacts: AdapterContact[] } = data;
    contacts.forEach((c) => {
      if (!c.jid) return;
      useRosterStore.getState().upsertContact({
        jid: c.jid,
        name: c.name,
        groups: c.groups,
        subscription: c.subscription as any,
        presence: "unavailable",
        isBlocked: false,
      });
    });
  });

  // Presence updates → RosterStore
  client.on("presence.updated", (data: any) => {
    const { jid, show, status } = data;
    useRosterStore.getState().updatePresence(jid, show, status);
  });

  // Incoming messages → ChatStore + notifications
  client.on("message.received", (data: any) => {
    const { message } = data;
    const from = message.from.split("/")[0];

    // Find or create conversation
    const convId = `${accountId}:${from}`;
    const existingConv = useChatStore.getState().conversations[convId];

    if (!existingConv) {
      const contact = useRosterStore.getState().contacts[from];
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

    const chatMsg = {
      id: message.id,
      conversationId: convId,
      senderJid: message.from,
      body: message.body,
      bodyType: "text" as const,
      direction: "in" as const,
      status: "delivered" as const,
      timestamp: message.timestamp,
    };

    useChatStore.getState().addMessage(chatMsg);

    // Cache to IndexedDB
    cacheMessages([chatMsg]).catch(() => {});

    // Notification
    const contact = useRosterStore.getState().contacts[from];
    const activeConvId = useChatStore.getState().activeConversationId;
    if (activeConvId !== convId) {
      useNotificationStore.getState().addNotification({
        type: "message",
        title: contact?.name ?? from.split("@")[0],
        body: message.body.slice(0, 80),
        conversationId: convId,
        accountId,
      });
    }
  });

  // MAM history messages
  client.on("mam.message", (data: any) => {
    const { message } = data;
    const from = message.from.split("/")[0];
    const isOwn = from === client.config.jid.split("/")[0];
    const peerJid = isOwn ? message.to.split("/")[0] : from;
    const convId = `${accountId}:${peerJid}`;

    const chatMsg = {
      id: message.id,
      conversationId: convId,
      senderJid: message.from,
      body: message.body,
      bodyType: "text" as const,
      direction: isOwn ? ("out" as const) : ("in" as const),
      status: "delivered" as const,
      timestamp: message.timestamp,
    };

    useChatStore.getState().addMessage(chatMsg);
    cacheMessages([chatMsg]).catch(() => {});
  });

  // Typing indicators
  client.on("typing.started", (data: any) => {
    // Could update a typing indicator store here
    console.log(`[xmppBridge] ${data.from} is typing`);
  });

  client.on("typing.stopped", (data: any) => {
    console.log(`[xmppBridge] ${data.from} stopped typing`);
  });

  // Delivery receipts
  client.on("message.delivered", (data: any) => {
    // Update message status in store
    console.log(`[xmppBridge] Message delivered: ${data.messageId}`);
  });

  console.log(`[xmppBridge] Bridge initialized for account: ${accountId}`);
}
