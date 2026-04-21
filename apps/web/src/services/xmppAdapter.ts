/**`r`n * Full XMPP client wrapper for Conjiweb.`r`n * Wraps Strophe.js with a clean event-driven API.`r`n */

export interface XmppClientConfig {
  jid: string;
  password: string;
  wsUrl: string;
  accountId: string;
}

export type XmppEvent =
  | "connection.changed"
  | "roster.updated"
  | "presence.updated"
  | "subscription.request"
  | "subscription.approved"
  | "subscription.denied"
  | "message.received"
  | "message.sent"
  | "room.joined"
  | "room.left"
  | "mam.loaded"
  | "mam.message"
  | "omemo.error"
  | "upload.completed"
  | "typing.started"
  | "typing.stopped"
  | "message.delivered"
  | "message.read"
  | "message.retracted"
  | "room.subject"
  | "room.member"
  | "error";

export interface XmppMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  timestamp: number;
  type: "chat" | "groupchat";
  stanzaId?: string;
  replyTo?: string;
  replaceId?: string;
}

interface SendMessageOptions {
  replyToId?: string;
  replyToJid?: string;
  replaceId?: string;
}

export interface RosterContact {
  jid: string;
  name?: string;
  groups: string[];
  subscription: string;
}

type EventHandler = (data: unknown) => void;

function sanitizeXmlText(input: string): string {
  if (!input) return "";
  let output = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    const valid =
      code === 0x9
      || code === 0xa
      || code === 0xd
      || (code >= 0x20 && code <= 0xd7ff)
      || (code >= 0xe000 && code <= 0xfffd)
      || (code >= 0x10000 && code <= 0x10ffff);
    if (valid) output += ch;
  }
  return output;
}

function parseXmppDelayTimestamp(stanza: Element): number {
  const stamp = stanza
    .querySelector('delay[xmlns="urn:xmpp:delay"]')
    ?.getAttribute("stamp");
  if (!stamp) return Date.now();
  const parsed = Date.parse(stamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

export class XmppClient {
  readonly config: XmppClientConfig;
  private handlers: Map<XmppEvent, EventHandler[]> = new Map();
  private _connection: any = null;
  private _connected = false;
  private _Strophe: any = null;
  private _$msg: any = null;
  private _$iq: any = null;
  private _$pres: any = null;

  constructor(config: XmppClientConfig) {
    this.config = config;
  }

  get connected() { return this._connected; }

  on(event: XmppEvent, handler: EventHandler) {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(event, [...list, handler]);
    return () => this.off(event, handler);
  }

  off(event: XmppEvent, handler: EventHandler) {
    this.handlers.set(event, (this.handlers.get(event) ?? []).filter((h) => h !== handler));
  }

  private emit(event: XmppEvent, data: unknown) {
    (this.handlers.get(event) ?? []).forEach((h) => h(data));
  }

  async connect(): Promise<void> {
    const { Strophe, $msg, $iq, $pres } = await import("strophe.js");
    this._Strophe = Strophe;
    this._$msg = $msg;
    this._$iq = $iq;
    this._$pres = $pres;

    return new Promise((resolve, reject) => {
      const conn = new Strophe.Connection(this.config.wsUrl);
      this._connection = conn;

      conn.connect(this.config.jid, this.config.password, (status: number) => {
        switch (status) {
          case Strophe.Status.CONNECTED:
            this._connected = true;
            this.emit("connection.changed", { status: "connected", accountId: this.config.accountId });
            this._setupHandlers();
            this._sendPresence();
            this._requestRoster();
            resolve();
            break;
          case Strophe.Status.DISCONNECTED:
            this._connected = false;
            this.emit("connection.changed", { status: "disconnected", accountId: this.config.accountId });
            break;
          case Strophe.Status.AUTHFAIL:
            reject(new Error("Authentication failed. Check your JID and password."));
            break;
          case Strophe.Status.CONNFAIL:
            reject(new Error("Connection failed. Check the WebSocket URL."));
            break;
          case Strophe.Status.ERROR:
            this.emit("error", { type: "generic", accountId: this.config.accountId });
            break;
        }
      });
    });
  }

  private _setupHandlers() {
    const conn = this._connection;

    // Incoming messages
    conn.addHandler((stanza: Element) => {
      const from = stanza.getAttribute("from") ?? "";
      const type = stanza.getAttribute("type") ?? "chat";
      const body = stanza.querySelector("body")?.textContent ?? "";
      const id = stanza.getAttribute("id") ?? crypto.randomUUID();
      const subject = stanza.querySelector("subject")?.textContent ?? "";
      if (type === "groupchat" && subject) {
        this.emit("room.subject", { accountId: this.config.accountId, roomJid: from.split("/")[0], subject });
        return true;
      }

      if (stanza.querySelector("composing")) {
        this.emit("typing.started", { accountId: this.config.accountId, from });
      }
      if (stanza.querySelector("paused") || stanza.querySelector("active")) {
        this.emit("typing.stopped", { accountId: this.config.accountId, from });
      }

      const received = stanza.querySelector("received");
      if (received) {
        this.emit("message.delivered", {
          accountId: this.config.accountId,
          messageId: received.getAttribute("id"),
          from,
        });
        return true;
      }
      const displayed = stanza.querySelector("displayed");
      if (displayed) {
        this.emit("message.read", {
          accountId: this.config.accountId,
          messageId: displayed.getAttribute("id"),
          from,
        });
        return true;
      }
      const retracted = stanza.querySelector('retract[xmlns="urn:xmpp:message-retract:1"]');
      if (retracted) {
        this.emit("message.retracted", {
          accountId: this.config.accountId,
          messageId: retracted.getAttribute("id"),
          from,
        });
        return true;
      }

      if (body) {
        const replyNode = stanza.querySelector('reply[xmlns="urn:xmpp:reply:0"]');
        const replaceNode = stanza.querySelector('replace[xmlns="urn:xmpp:message-correct:0"]');
        const msg: XmppMessage = {
          id,
          from,
          to: this.config.jid,
          body,
          timestamp: Date.now(),
          type: type as "chat" | "groupchat",
          replyTo: replyNode?.getAttribute("id") ?? undefined,
          replaceId: replaceNode?.getAttribute("id") ?? undefined,
        };
        this.emit("message.received", { accountId: this.config.accountId, message: msg });
      }
      return true;
    }, null, "message");

    // Roster result
    conn.addHandler((stanza: Element) => {
      const contacts = this._parseRosterStanza(stanza);
      this.emit("roster.updated", { accountId: this.config.accountId, contacts });
      return true;
    }, "jabber:iq:roster", "iq", "result");

    // Roster push
    conn.addHandler((stanza: Element) => {
      const contacts = this._parseRosterStanza(stanza);
      this.emit("roster.updated", { accountId: this.config.accountId, contacts });
      return true;
    }, "jabber:iq:roster", "iq", "set");

    // Presence
    conn.addHandler((stanza: Element) => {
      const from = stanza.getAttribute("from") ?? "";
      const type = stanza.getAttribute("type") ?? "available";
      const fromParts = from.split("/");
      const roomJid = fromParts[0] ?? "";
      const nickname = fromParts[1] ?? "";
      const mucUser = stanza.querySelector('x[xmlns="http://jabber.org/protocol/muc#user"]');
      if (mucUser && roomJid && nickname) {
        const item = mucUser.querySelector("item");
        this.emit("room.member", {
          accountId: this.config.accountId,
          roomJid,
          nickname,
          jid: item?.getAttribute("jid") ?? `${nickname}@${roomJid}`,
          role: (item?.getAttribute("role") ?? "participant") as "moderator" | "participant" | "visitor",
          affiliation: (item?.getAttribute("affiliation") ?? "none") as "owner" | "admin" | "member" | "none",
          presence: type === "unavailable" ? "unavailable" : "available",
        });
      }
      if (type === "subscribe") {
        this.emit("subscription.request", { accountId: this.config.accountId, jid: from.split("/")[0] });
        return true;
      }
      if (type === "subscribed") {
        this.emit("subscription.approved", { accountId: this.config.accountId, jid: from.split("/")[0] });
        return true;
      }
      if (type === "unsubscribed") {
        this.emit("subscription.denied", { accountId: this.config.accountId, jid: from.split("/")[0] });
        return true;
      }
      const show = stanza.querySelector("show")?.textContent
        ?? (type === "unavailable" ? "unavailable" : "available");
      const status = stanza.querySelector("status")?.textContent ?? undefined;
      this.emit("presence.updated", { accountId: this.config.accountId, jid: from, show, status });
      return true;
    }, null, "presence");
  }

  private _parseRosterStanza(stanza: Element): RosterContact[] {
    const contacts: RosterContact[] = [];
    stanza.querySelectorAll("item").forEach((item) => {
      contacts.push({
        jid: item.getAttribute("jid") ?? "",
        name: item.getAttribute("name") ?? undefined,
        groups: Array.from(item.querySelectorAll("group")).map((g) => g.textContent ?? ""),
        subscription: item.getAttribute("subscription") ?? "none",
      });
    });
    return contacts;
  }

  private _sendPresence(show?: string, status?: string) {
    if (!this._connection) return;
    if (!show || show === "available") {
      this._connection.send(this._$pres());
    } else if (show === "unavailable") {
      this._connection.send(this._$pres({ type: "unavailable" }));
    } else {
      const pres = this._$pres().c("show").t(show);
      if (status) pres.up().c("status").t(status);
      this._connection.send(pres);
    }
  }

  private _requestRoster() {
    if (!this._connection) return;
    this._connection.send(
      this._$iq({ type: "get" }).c("query", { xmlns: "jabber:iq:roster" })
    );
  }

  sendMessage(toJid: string, body: string, type: "chat" | "groupchat" = "chat", options?: SendMessageOptions): string {
    if (!this._connection || !this._connected) throw new Error("Not connected");
    const safeBody = sanitizeXmlText(body);
    if (!safeBody.trim()) throw new Error("Message contains unsupported characters");
    const id = crypto.randomUUID();
    const stanza = this._$msg({ to: toJid, type, id })
      .c("body").t(safeBody)
      .up()
      .c("request", { xmlns: "urn:xmpp:receipts" })
      .up();
    if (options?.replyToId) {
      stanza.c("reply", {
        xmlns: "urn:xmpp:reply:0",
        id: options.replyToId,
        to: options.replyToJid ?? toJid,
      });
      stanza.up();
    }
    if (options?.replaceId) {
      stanza.c("replace", {
        xmlns: "urn:xmpp:message-correct:0",
        id: options.replaceId,
      });
    }
    this._connection.send(stanza);
    const msg: XmppMessage = {
      id,
      from: this.config.jid,
      to: toJid,
      body: safeBody,
      timestamp: Date.now(),
      type,
      replyTo: options?.replyToId,
      replaceId: options?.replaceId,
    };
    this.emit("message.sent", { accountId: this.config.accountId, message: msg });
    return id;
  }

  sendTyping(toJid: string, isTyping: boolean) {
    if (!this._connection || !this._connected) return;
    const state = isTyping ? "composing" : "paused";
    this._connection.send(
      this._$msg({ to: toJid, type: "chat" })
        .c(state, { xmlns: "http://jabber.org/protocol/chatstates" })
    );
  }

  sendReceipt(toJid: string, messageId: string, kind: "received" | "displayed" = "received") {
    if (!this._connection || !this._connected || !messageId) return;
    this._connection.send(
      this._$msg({ to: toJid, type: "chat" })
        .c(kind, { xmlns: "urn:xmpp:receipts", id: messageId })
    );
  }

  retractMessage(toJid: string, messageId: string, type: "chat" | "groupchat" = "chat") {
    if (!this._connection || !this._connected || !messageId) return;
    const stanza = this._$msg({ to: toJid, type })
      .c("apply-to", { xmlns: "urn:xmpp:fasten:0", id: messageId })
      .c("retract", { xmlns: "urn:xmpp:message-retract:1" })
      .up()
      .up();
    this._connection.send(stanza);
  }

  setPresence(show: string, status?: string) {
    this._sendPresence(show, status);
  }

  addContact(jid: string, name?: string) {
    if (!this._connection) return;
    this._connection.send(this._$pres({ to: jid, type: "subscribe" }));
    this._connection.send(
      this._$iq({ type: "set" })
        .c("query", { xmlns: "jabber:iq:roster" })
        .c("item", { jid, ...(name ? { name } : {}) })
    );
  }

  approveSubscription(jid: string) {
    if (!this._connection) return;
    this._connection.send(this._$pres({ to: jid, type: "subscribed" }));
  }

  denySubscription(jid: string) {
    if (!this._connection) return;
    this._connection.send(this._$pres({ to: jid, type: "unsubscribed" }));
  }

  blockJid(jid: string) {
    if (!this._connection) return;
    this._connection.send(
      this._$iq({ type: "set" })
        .c("block", { xmlns: "urn:xmpp:blocking" })
        .c("item", { jid })
    );
  }

  unblockJid(jid: string) {
    if (!this._connection) return;
    this._connection.send(
      this._$iq({ type: "set" })
        .c("unblock", { xmlns: "urn:xmpp:blocking" })
        .c("item", { jid })
    );
  }

  removeContact(jid: string) {
    if (!this._connection) return;
    this._connection.send(this._$pres({ to: jid, type: "unsubscribe" }));
    this._connection.send(
      this._$iq({ type: "set" })
        .c("query", { xmlns: "jabber:iq:roster" })
        .c("item", { jid, subscription: "remove" })
    );
  }

  joinRoom(roomJid: string, nickname: string, password?: string) {
    if (!this._connection) return;
    const pres = this._$pres({ to: `${roomJid}/${nickname}` })
      .c("x", { xmlns: "http://jabber.org/protocol/muc" });
    if (password) pres.c("password").t(password);
    this._connection.send(pres);
    this.emit("room.joined", { accountId: this.config.accountId, roomJid, nickname });
  }

  leaveRoom(roomJid: string, nickname: string) {
    if (!this._connection) return;
    this._connection.send(
      this._$pres({ to: `${roomJid}/${nickname}`, type: "unavailable" })
    );
    this.emit("room.left", { accountId: this.config.accountId, roomJid });
  }

  inviteToRoom(roomJid: string, inviteeJid: string, reason?: string) {
    if (!this._connection || !this._connected) throw new Error("Not connected");
    const cleanInvitee = inviteeJid.trim();
    if (!cleanInvitee) throw new Error("Invitee JID is required");
    const msg = this._$msg({ to: roomJid, type: "normal" })
      .c("x", { xmlns: "http://jabber.org/protocol/muc#user" })
      .c("invite", { to: cleanInvitee });
    if (reason?.trim()) msg.c("reason").t(sanitizeXmlText(reason.trim()));
    this._connection.send(msg);
  }

  fetchVCardAvatar(jid: string): Promise<string | null> {
    if (!this._connection) return Promise.resolve(null);
    return new Promise((resolve) => {
      const iq = this._$iq({ type: "get", to: jid }).c("vCard", { xmlns: "vcard-temp" });
      this._connection.sendIQ(
        iq.tree(),
        (result: Element) => {
          const photo = result.querySelector("vCard PHOTO");
          const b64 = photo?.querySelector("BINVAL")?.textContent?.trim();
          const mime = photo?.querySelector("TYPE")?.textContent?.trim() || "image/jpeg";
          if (!b64) {
            resolve(null);
            return;
          }
          resolve(`data:${mime};base64,${b64}`);
        },
        () => resolve(null)
      );
    });
  }

  fetchMAM(targetJid: string, options: { before?: string; limit?: number; type?: "chat" | "groupchat" } = {}) {
    if (!this._connection) return;
    const queryId = crypto.randomUUID();
    const limit = options.limit ?? 30;
    const isGroupchat = options.type === "groupchat";

    const iq = this._$iq({ type: "set", to: isGroupchat ? targetJid : undefined })
      .c("query", { xmlns: "urn:xmpp:mam:2", queryid: queryId })
      .c("x", { xmlns: "jabber:x:data", type: "submit" })
      .c("field", { var: "FORM_TYPE", type: "hidden" }).c("value").t("urn:xmpp:mam:2").up().up()
      .c("field", { var: "with" }).c("value").t(targetJid).up().up().up()
      .c("set", { xmlns: "http://jabber.org/protocol/rsm" })
      .c("max").t(String(limit));

    if (options.before) iq.up().c("before").t(options.before);

    const mamHandler = this._connection.addHandler((stanza: Element) => {
      const result = stanza.querySelector("result");
      if (!result || result.getAttribute("queryid") !== queryId) return true;
      const msg = result.querySelector("forwarded message");
      if (!msg) return true;
      const body = msg.querySelector("body")?.textContent ?? "";
      if (!body) return true;
      const forwarded = result.querySelector("forwarded") as Element | null;
      const xmppMsg: XmppMessage = {
        id: msg.getAttribute("id") ?? crypto.randomUUID(),
        from: msg.getAttribute("from") ?? "",
        to: msg.getAttribute("to") ?? "",
        body,
        timestamp: forwarded ? parseXmppDelayTimestamp(forwarded) : Date.now(),
        type: (msg.getAttribute("type") ?? "chat") as "chat" | "groupchat",
        stanzaId: result.getAttribute("id") ?? undefined,
        replyTo: msg.querySelector('reply[xmlns="urn:xmpp:reply:0"]')?.getAttribute("id") ?? undefined,
      };
      this.emit("mam.message", { accountId: this.config.accountId, message: xmppMsg, queryId });
      return true;
    }, null, "message");

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (mamHandler) {
        this._connection.deleteHandler(mamHandler);
      }
    };

    this._connection.sendIQ(iq.tree(), () => {
      cleanup();
      this.emit("mam.loaded", { accountId: this.config.accountId, targetJid, queryId });
    }, () => {
      cleanup();
      this.emit("error", { type: "mam_fetch_failed", accountId: this.config.accountId, targetJid, queryId });
    });
  }

  disconnect() {
    if (this._connection) {
      this._connection.disconnect();
      this._connected = false;
    }
  }
}

const clients: Map<string, XmppClient> = new Map();

export function getClient(accountId: string): XmppClient | undefined {
  return clients.get(accountId);
}

export function createClient(config: XmppClientConfig): XmppClient {
  clients.get(config.accountId)?.disconnect();
  const client = new XmppClient(config);
  clients.set(config.accountId, client);
  return client;
}

export function destroyClient(accountId: string) {
  clients.get(accountId)?.disconnect();
  clients.delete(accountId);
}

export function getAllClients(): XmppClient[] {
  return Array.from(clients.values());
}

