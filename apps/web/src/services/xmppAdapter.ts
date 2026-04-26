/**
 * Full XMPP client wrapper for Conjiweb.
 * Wraps Strophe.js with a clean event-driven API.
 */

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
  | "reaction.received"
  | "room.subject"
  | "room.member"
  | "jingle"
  | "sm.failed"
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
  omemo?: OmemoEnvelope;
}

interface SendMessageOptions {
  replyToId?: string;
  replyToJid?: string;
  replaceId?: string;
}

export interface OmemoEnvelopeKey {
  rid: number;
  value: string;
  prekey?: boolean;
  n?: number;
  ek?: string;
  pkid?: number;
}

export interface OmemoEnvelope {
  namespace: string;
  sid: number;
  iv: string;
  keys: OmemoEnvelopeKey[];
  payload: string;
}

export interface OmemoBundle {
  deviceId: number;
  signedPreKeyId: number;
  signedPreKeyPublic: string;
  signedPreKeySignature: string;
  identityKey: string;
  preKeys: Array<{ preKeyId: number; value: string }>;
}

export interface RosterContact {
  jid: string;
  name?: string;
  groups: string[];
  subscription: string;
}

type EventHandler = (data: unknown) => void;

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

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

const OMEMO_NAMESPACE_LEGACY = "eu.siacs.conversations.axolotl";
const OMEMO_NAMESPACE_MODERN = "urn:xmpp:omemo:2";
const OMEMO_NAMESPACES = [OMEMO_NAMESPACE_MODERN, OMEMO_NAMESPACE_LEGACY] as const;
const PUBSUB_NS = "http://jabber.org/protocol/pubsub";
function omemoDeviceListNode(namespace: string): string {
  return namespace === OMEMO_NAMESPACE_MODERN
    ? `${namespace}:devices`
    : `${namespace}.devicelist`;
}

function bundleNodeFor(namespace: string, deviceId: number): string {
  return namespace === OMEMO_NAMESPACE_MODERN
    ? `${namespace}:bundles:${deviceId}`
    : `${namespace}.bundles:${deviceId}`;
}

function parseOmemoEnvelope(stanza: Element): OmemoEnvelope | null {
  const encrypted = OMEMO_NAMESPACES
    .map((namespace) => stanza.querySelector(`encrypted[xmlns="${namespace}"]`))
    .find((node): node is Element => Boolean(node));
  if (!encrypted) return null;
  const namespace = encrypted.getAttribute("xmlns") ?? OMEMO_NAMESPACE_LEGACY;
  const header = encrypted.querySelector("header");
  const payload = encrypted.querySelector("payload")?.textContent?.trim();
  const iv = header?.querySelector("iv")?.textContent?.trim();
  const sidRaw = header?.getAttribute("sid");
  if (!header || !payload || !iv || !sidRaw) return null;
  const sid = Number.parseInt(sidRaw, 10);
  if (!Number.isFinite(sid)) return null;
  const keys: OmemoEnvelopeKey[] = Array.from(header.querySelectorAll("key"))
    .map((node) => {
      const rid = Number.parseInt(node.getAttribute("rid") ?? "", 10);
      const value = node.textContent?.trim() ?? "";
      if (!Number.isFinite(rid) || !value) return null;
      const nRaw = node.getAttribute("n");
      const n = nRaw == null ? undefined : Number.parseInt(nRaw, 10);
      const pkidRaw = node.getAttribute("pkid");
      const pkid = pkidRaw == null ? undefined : Number.parseInt(pkidRaw, 10);
      return {
        rid,
        value,
        prekey: node.getAttribute("prekey") === "true",
        n: Number.isFinite(n as number) ? n : undefined,
        ek: node.getAttribute("ek") ?? undefined,
        pkid: Number.isFinite(pkid as number) ? pkid : undefined,
      } as OmemoEnvelopeKey;
    })
    .filter((x): x is OmemoEnvelopeKey => Boolean(x));
  if (keys.length === 0) return null;
  return {
    namespace,
    sid,
    iv,
    keys,
    payload,
  };
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
            this._setupDiscoHandler();      // XEP-0030 service discovery
            this._setupSmHandlers();        // XEP-0198 stream management handlers
            this._enableStreamManagement(); // XEP-0198 enable
            this._enableCarbons();          // XEP-0280 multi-device sync
            this._setupCsiHandling();       // XEP-0352 active/inactive
            this._sendPresence();           // includes XEP-0115 caps
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
      // XEP-0280 Message Carbons unwrapping:
      // <message><sent|received><forwarded><message>...real message...
      // Only trust carbons from our own bare JID.
      const ownBareJid = this.config.jid.split("/")[0].toLowerCase();
      const stanzaFromBare = (stanza.getAttribute("from") ?? "").split("/")[0].toLowerCase();

      let realStanza: Element = stanza;
      let isCarbonSent = false;
      let isCarbonReceived = false;

      const carbonSent = stanza.querySelector('sent[xmlns="urn:xmpp:carbons:2"]');
      const carbonRecv = stanza.querySelector('received[xmlns="urn:xmpp:carbons:2"]');
      if ((carbonSent || carbonRecv) && stanzaFromBare === ownBareJid) {
        const wrapper = carbonSent ?? carbonRecv;
        const forwarded = wrapper?.querySelector('forwarded[xmlns="urn:xmpp:forward:0"]');
        const inner = forwarded?.querySelector("message");
        if (inner) {
          realStanza = inner;
          isCarbonSent = !!carbonSent;
          isCarbonReceived = !!carbonRecv;
        }
      }

      const from = realStanza.getAttribute("from") ?? "";
      const type = realStanza.getAttribute("type") ?? "chat";
      const body = realStanza.querySelector("body")?.textContent ?? "";
      const omemo = parseOmemoEnvelope(stanza);
      const id = realStanza.getAttribute("id") ?? crypto.randomUUID();
      const subject = realStanza.querySelector("subject")?.textContent ?? "";
      if (type === "groupchat" && subject) {
        this.emit("room.subject", { accountId: this.config.accountId, roomJid: from.split("/")[0], subject });
        return true;
      }

      if (realStanza.querySelector("composing")) {
        this.emit("typing.started", { accountId: this.config.accountId, from });
      }
      if (realStanza.querySelector("paused") || realStanza.querySelector("active")) {
        this.emit("typing.stopped", { accountId: this.config.accountId, from });
      }

      const received = realStanza.querySelector("received");
      if (received) {
        this.emit("message.delivered", {
          accountId: this.config.accountId,
          messageId: received.getAttribute("id"),
          from,
        });
        return true;
      }
      const displayed = realStanza.querySelector("displayed");
      if (displayed) {
        this.emit("message.read", {
          accountId: this.config.accountId,
          messageId: displayed.getAttribute("id"),
          from,
        });
        return true;
      }
      // XEP-0444 Message Reactions
      const reactionsEl = realStanza.querySelector('reactions[xmlns="urn:xmpp:reactions:0"]');
      if (reactionsEl) {
        const msgId = reactionsEl.getAttribute("id");
        const emojis = Array.from(reactionsEl.querySelectorAll("reaction"))
          .map((r) => r.textContent?.trim() ?? "")
          .filter(Boolean);
        if (msgId) {
          this.emit("reaction.received", {
            accountId: this.config.accountId,
            from,
            messageId: msgId,
            emojis,
          });
        }
        return true;
      }

      const retracted = realStanza.querySelector('retract[xmlns="urn:xmpp:message-retract:1"]');
      if (retracted) {
        this.emit("message.retracted", {
          accountId: this.config.accountId,
          messageId: retracted.getAttribute("id"),
          from,
        });
        return true;
      }

      if (body || omemo) {
        const replyNode = realStanza.querySelector('reply[xmlns="urn:xmpp:reply:0"]');
        const replaceNode = realStanza.querySelector('replace[xmlns="urn:xmpp:message-correct:0"]');
        const msg: XmppMessage = {
          id,
          from,
          to: realStanza.getAttribute("to") ?? this.config.jid,
          body: body || "[OMEMO message]",
          timestamp: Date.now(),
          type: type as "chat" | "groupchat",
          replyTo: replyNode?.getAttribute("id") ?? undefined,
          replaceId: replaceNode?.getAttribute("id") ?? undefined,
          omemo: omemo ?? undefined,
        };
        this.emit("message.received", {
          accountId: this.config.accountId,
          message: msg,
          isCarbonSent,
          isCarbonReceived,
        });
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

    // Jingle (XEP-0166) IQ handler - audio/video calls
    conn.addHandler((stanza: Element) => {
      const jingle = stanza.querySelector('jingle[xmlns="urn:xmpp:jingle:1"]');
      if (!jingle) return true;

      const fromJid = stanza.getAttribute("from") ?? "";
      const sid = jingle.getAttribute("sid") ?? "";
      const action = jingle.getAttribute("action") ?? "";
      const iqId = stanza.getAttribute("id") ?? "";

      // Acknowledge the IQ immediately
      const ack = this._$iq({ type: "result", to: fromJid, id: iqId });
      conn.send(ack);

      // Emit to bridge for routing to callManager
      this.emit("jingle", {
        accountId: this.config.accountId,
        from: fromJid,
        sid,
        action,
        jingleEl: jingle,
      });
      return true;
    }, "urn:xmpp:jingle:1", "iq", "set");

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

  private _capsHash: string | null = null;

  private async _ensureCapsHash() {
    if (this._capsHash) return this._capsHash;
    try {
      this._capsHash = await this._computeCapsHash();
    } catch {
      this._capsHash = null;
    }
    return this._capsHash;
  }

  private async _sendPresence(show?: string, status?: string) {
    if (!this._connection) return;
    const hash = await this._ensureCapsHash();
    let pres: any;
    if (!show || show === "available") {
      pres = this._$pres();
    } else if (show === "unavailable") {
      pres = this._$pres({ type: "unavailable" });
    } else {
      pres = this._$pres().c("show").t(show).up();
      if (status) pres.c("status").t(status).up();
    }
    // XEP-0115 Entity Capabilities
    if (hash && (!show || show !== "unavailable")) {
      pres.c("c", {
        xmlns: "http://jabber.org/protocol/caps",
        hash: "sha-1",
        node: "https://conjiweb.dev/caps",
        ver: hash,
      }).up();
    }
    this._connection.send(pres);
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

  sendOmemoMessage(
    toJid: string,
    envelope: OmemoEnvelope,
    type: "chat" | "groupchat" = "chat",
    options?: SendMessageOptions
  ): string {
    if (!this._connection || !this._connected) throw new Error("Not connected");
    const id = crypto.randomUUID();
    const stanza = this._$msg({ to: toJid, type, id })
      .c("body").t("This message is OMEMO encrypted")
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
      stanza.up();
    }

    const encrypted = stanza.c("encrypted", { xmlns: envelope.namespace })
      .c("header", { sid: String(envelope.sid) });
    envelope.keys.forEach((key) => {
      encrypted.c("key", {
        rid: String(key.rid),
        ...(key.prekey ? { prekey: "true" } : {}),
        ...(typeof key.n === "number" ? { n: String(key.n) } : {}),
        ...(typeof key.pkid === "number" ? { pkid: String(key.pkid) } : {}),
        ...(key.ek ? { ek: key.ek } : {}),
      }).t(key.value).up();
    });
    encrypted.c("iv").t(envelope.iv).up().up().c("payload").t(envelope.payload).up().up();

    this._connection.send(stanza);
    const msg: XmppMessage = {
      id,
      from: this.config.jid,
      to: toJid,
      body: "This message is OMEMO encrypted",
      timestamp: Date.now(),
      type,
      replyTo: options?.replyToId,
      replaceId: options?.replaceId,
      omemo: envelope,
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

  publishOmemoDeviceList(deviceIds: number[]) {
    if (!this._connection) return Promise.resolve();
    const uniqueIds = Array.from(new Set(deviceIds.filter((id) => Number.isFinite(id) && id > 0)));
    const publishToNamespace = (namespace: string) =>
      new Promise<void>((resolve, reject) => {
        const iq = this._$iq({ type: "set" })
          .c("pubsub", { xmlns: PUBSUB_NS })
          .c("publish", { node: omemoDeviceListNode(namespace) })
          .c("item", { id: "current" })
          .c("list", { xmlns: namespace });
        uniqueIds.forEach((id) => {
          iq.c("device", { id: String(id) }).up();
        });
        this._connection.sendIQ(iq.tree(), () => resolve(), () => reject(new Error("OMEMO devicelist publish failed")));
      });
    return Promise.allSettled(OMEMO_NAMESPACES.map((ns) => publishToNamespace(ns))).then((results) => {
      if (results.every((r) => r.status === "rejected")) {
        throw new Error("OMEMO devicelist publish failed");
      }
    });
  }

  fetchOmemoDeviceList(jid: string): Promise<number[]> {
    if (!this._connection) return Promise.resolve([]);
    const fetchFromNamespace = (namespace: string) =>
      new Promise<number[]>((resolve) => {
        const iq = this._$iq({ type: "get", to: jid })
          .c("pubsub", { xmlns: PUBSUB_NS })
          .c("items", { node: omemoDeviceListNode(namespace) });
        this._connection.sendIQ(
          iq.tree(),
          (result: Element) => {
            const list = result.querySelector(`list[xmlns="${namespace}"]`);
            if (!list) {
              resolve([]);
              return;
            }
            const ids = Array.from(list.querySelectorAll("device"))
              .map((node) => Number.parseInt(node.getAttribute("id") ?? "", 10))
              .filter((id) => Number.isFinite(id) && id > 0);
            resolve(Array.from(new Set(ids)));
          },
          () => resolve([])
        );
      });
    return Promise.all(OMEMO_NAMESPACES.map((ns) => fetchFromNamespace(ns))).then((groups) =>
      Array.from(new Set(groups.flat()))
    );
  }

  publishOmemoBundle(bundle: OmemoBundle) {
    if (!this._connection) return Promise.resolve();
    const publishToNamespace = (namespace: string) =>
      new Promise<void>((resolve, reject) => {
        const iq = this._$iq({ type: "set" })
          .c("pubsub", { xmlns: PUBSUB_NS })
          .c("publish", { node: bundleNodeFor(namespace, bundle.deviceId) })
          .c("item", { id: "current" })
          .c("bundle", { xmlns: namespace })
          .c("signedPreKeyPublic", { signedPreKeyId: String(bundle.signedPreKeyId) }).t(bundle.signedPreKeyPublic).up()
          .c("signedPreKeySignature").t(bundle.signedPreKeySignature).up()
          .c("identityKey").t(bundle.identityKey).up()
          .c("prekeys");
        bundle.preKeys.forEach((key) => {
          iq.c("preKeyPublic", { preKeyId: String(key.preKeyId) }).t(key.value).up();
        });
        this._connection.sendIQ(iq.tree(), () => resolve(), () => reject(new Error("OMEMO bundle publish failed")));
      });
    return Promise.allSettled(OMEMO_NAMESPACES.map((ns) => publishToNamespace(ns))).then((results) => {
      if (results.every((r) => r.status === "rejected")) {
        throw new Error("OMEMO bundle publish failed");
      }
    });
  }

  fetchOmemoBundle(jid: string, deviceId: number): Promise<OmemoBundle | null> {
    if (!this._connection) return Promise.resolve(null);
    const fetchFromNamespace = (namespace: string) =>
      new Promise<OmemoBundle | null>((resolve) => {
        const iq = this._$iq({ type: "get", to: jid })
          .c("pubsub", { xmlns: PUBSUB_NS })
          .c("items", { node: bundleNodeFor(namespace, deviceId) });
        this._connection.sendIQ(
          iq.tree(),
          (result: Element) => {
            const bundleNode = result.querySelector(`bundle[xmlns="${namespace}"]`);
            if (!bundleNode) {
              resolve(null);
              return;
            }
            const spk = bundleNode.querySelector("signedPreKeyPublic");
            const sig = bundleNode.querySelector("signedPreKeySignature");
            const ik = bundleNode.querySelector("identityKey");
            if (!spk?.textContent || !sig?.textContent || !ik?.textContent) {
              resolve(null);
              return;
            }
            const preKeys = Array.from(bundleNode.querySelectorAll("prekeys preKeyPublic"))
              .map((node) => {
                const preKeyId = Number.parseInt(node.getAttribute("preKeyId") ?? "", 10);
                const value = node.textContent?.trim() ?? "";
                if (!Number.isFinite(preKeyId) || !value) return null;
                return { preKeyId, value };
              })
              .filter((v): v is { preKeyId: number; value: string } => Boolean(v));
            resolve({
              deviceId,
              signedPreKeyId: Number.parseInt(spk.getAttribute("signedPreKeyId") ?? "1", 10) || 1,
              signedPreKeyPublic: spk.textContent.trim(),
              signedPreKeySignature: sig.textContent.trim(),
              identityKey: ik.textContent.trim(),
              preKeys,
            });
          },
          () => resolve(null)
        );
      });
    return Promise.all(OMEMO_NAMESPACES.map((ns) => fetchFromNamespace(ns))).then((bundles) =>
      bundles.find((bundle): bundle is OmemoBundle => Boolean(bundle)) ?? null
    );
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
      const omemo = parseOmemoEnvelope(msg);
      if (!body && !omemo) return true;
      const forwarded = result.querySelector("forwarded") as Element | null;
      const xmppMsg: XmppMessage = {
        id: msg.getAttribute("id") ?? crypto.randomUUID(),
        from: msg.getAttribute("from") ?? "",
        to: msg.getAttribute("to") ?? "",
        body: body || "[OMEMO message]",
        timestamp: forwarded ? parseXmppDelayTimestamp(forwarded) : Date.now(),
        type: (msg.getAttribute("type") ?? "chat") as "chat" | "groupchat",
        stanzaId: result.getAttribute("id") ?? undefined,
        replyTo: msg.querySelector('reply[xmlns="urn:xmpp:reply:0"]')?.getAttribute("id") ?? undefined,
        omemo: omemo ?? undefined,
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

  sendReaction(toJid: string, messageId: string, emojis: string[], type: "chat" | "groupchat" = "chat") {
    if (!this._connection || !this._connected) return;
    const msg = this._$msg({ to: toJid, type })
      .c("reactions", { xmlns: "urn:xmpp:reactions:0", id: messageId });
    emojis.forEach((emoji) => msg.c("reaction").t(emoji).up());
    this._connection.send(msg);
  }

  /**
   * Send a Jingle stanza (XEP-0166). The Jingle XML is built by the bridge
   * layer using sdpToJingleXml/candidateToJingleXml/terminateToJingleXml.
   *
   * Wraps the Jingle element in an IQ set and sends it.
   */
  sendJingle(peerJid: string, _sid: string, jingleXml: string): void {
    if (!this._connection || !this._connected) return;
    // Parse the jingleXml string into an Element via DOMParser
    const doc = new DOMParser().parseFromString(jingleXml, "text/xml");
    const jingleEl = doc.documentElement;
    if (!jingleEl || jingleEl.localName !== "jingle") return;

    const iq = this._$iq({ type: "set", to: peerJid });
    // Append the jingle element to the IQ via cnode()
    iq.cnode(jingleEl as any);
    this._connection.send(iq);
  }

  // ============================================================
  // XEP-0198 Stream Management
  // ============================================================
  /**
   * Stream Management state for resilience against network drops.
   *
   * - We tell the server "enable" with resume=true so the server keeps
   *   our session alive briefly after disconnect.
   * - We track every outgoing stanza in _smOutgoingQueue.
   * - When the server sends <a h="N"/>, we drop ack'd stanzas from queue.
   * - When we reconnect, we send <resume previd="..." h="..."/> to recover
   *   without re-authenticating, and the server replays missed inbound stanzas.
   *
   * Strophe.js does NOT include SM by default; we implement it directly.
   */
  private _smEnabled = false;
  private _smResumeId: string | null = null;
  private _smOutgoingCount = 0;        // h: count of stanzas WE sent
  private _smIncomingCount = 0;        // h: count of stanzas WE received
  private _smOutgoingQueue: Element[] = [];
  private _smRequestTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Get current stream-management state. Persisted across reconnects
   * via accountStore so resume can succeed.
   */
  getSmState(): { resumeId: string | null; h: number } {
    return { resumeId: this._smResumeId, h: this._smIncomingCount };
  }

  private _enableStreamManagement() {
    if (!this._connection || this._smEnabled) return;
    // Send <enable xmlns="urn:xmpp:sm:3" resume="true"/>
    const enable = this._buildElement("enable", {
      xmlns: "urn:xmpp:sm:3",
      resume: "true",
    });
    if (enable) this._connection.send(enable);
  }

  private _setupSmHandlers() {
    if (!this._connection) return;
    // Handle <enabled> response from server
    this._connection.addHandler((stanza: Element) => {
      this._smEnabled = true;
      this._smResumeId = stanza.getAttribute("id");
      this._smOutgoingCount = 0;
      this._smIncomingCount = 0;
      this._smOutgoingQueue = [];
      this._startSmRequestTimer();
      return true;
    }, "urn:xmpp:sm:3", "enabled");

    // Handle <a h="N"/> from server (acknowledgement of our sent stanzas)
    this._connection.addHandler((stanza: Element) => {
      const hStr = stanza.getAttribute("h");
      if (hStr) {
        const ack = parseInt(hStr, 10);
        if (Number.isFinite(ack)) this._handleSmAck(ack);
      }
      return true;
    }, "urn:xmpp:sm:3", "a");

    // Handle <r/> from server: respond with our incoming count
    this._connection.addHandler((_stanza: Element) => {
      const reply = this._buildElement("a", {
        xmlns: "urn:xmpp:sm:3",
        h: String(this._smIncomingCount),
      });
      if (reply) this._connection.send(reply);
      return true;
    }, "urn:xmpp:sm:3", "r");

    // Handle <resumed> from server (resume succeeded)
    this._connection.addHandler((stanza: Element) => {
      const hStr = stanza.getAttribute("h");
      if (hStr) {
        const ack = parseInt(hStr, 10);
        if (Number.isFinite(ack)) this._handleSmAck(ack);
      }
      // Replay any unacked stanzas
      const toReplay = [...this._smOutgoingQueue];
      this._smOutgoingQueue = [];
      this._smOutgoingCount -= toReplay.length;
      if (this._smOutgoingCount < 0) this._smOutgoingCount = 0;
      for (const s of toReplay) {
        this._connection.send(s);
        this._smOutgoingCount++;
        this._smOutgoingQueue.push(s);
      }
      return true;
    }, "urn:xmpp:sm:3", "resumed");

    // Handle <failed/> from server (resume failed - need fresh auth)
    this._connection.addHandler((_stanza: Element) => {
      this._smEnabled = false;
      this._smResumeId = null;
      this._smOutgoingQueue = [];
      this.emit("sm.failed", { accountId: this.config.accountId });
      return true;
    }, "urn:xmpp:sm:3", "failed");

    // Track incoming stanzas: increment counter for any non-SM stanza
    this._connection.addHandler((stanza: Element) => {
      const ns = stanza.getAttribute("xmlns") ?? stanza.namespaceURI ?? "";
      if (ns !== "urn:xmpp:sm:3") {
        this._smIncomingCount++;
      }
      return true;  // don't consume; let other handlers process
    }, null, null);
  }

  private _handleSmAck(ackedCount: number) {
    // Server has acked stanzas up to this h count
    // Drop already-acked entries from queue
    const dropCount = ackedCount - (this._smOutgoingCount - this._smOutgoingQueue.length);
    if (dropCount > 0) {
      this._smOutgoingQueue.splice(0, dropCount);
    }
  }

  private _startSmRequestTimer() {
    if (this._smRequestTimer) return;
    // Periodically request ack to keep queue from growing unbounded
    this._smRequestTimer = setInterval(() => {
      if (this._connection && this._connected && this._smEnabled
          && this._smOutgoingQueue.length > 0) {
        const r = this._buildElement("r", { xmlns: "urn:xmpp:sm:3" });
        if (r) this._connection.send(r);
      }
    }, 30000);
  }

  private _stopSmRequestTimer() {
    if (this._smRequestTimer) {
      clearInterval(this._smRequestTimer);
      this._smRequestTimer = null;
    }
  }

  /**
   * Wraps an outgoing stanza send, recording it for SM tracking.
   * Called automatically from sendMessage if SM is enabled.
   */
  private _trackOutgoing(stanza: Element) {
    if (!this._smEnabled) return;
    this._smOutgoingCount++;
    this._smOutgoingQueue.push(stanza);
    // Cap queue at 100 entries to prevent memory growth
    if (this._smOutgoingQueue.length > 100) {
      this._smOutgoingQueue.shift();
    }
  }

  // ============================================================
  // XEP-0084 PEP User Avatar
  // ============================================================
  /**
   * Publish own avatar via PEP. Accepts PNG/JPEG data URL or raw bytes.
   * Computes SHA-1 hash and publishes to:
   *   urn:xmpp:avatar:data (the bytes, keyed by hash)
   *   urn:xmpp:avatar:metadata (info: hash, MIME, size, dims)
   */
  async publishPepAvatar(imageBytes: Uint8Array, mimeType: string = "image/png", width?: number, height?: number) {
    if (!this._connection || !this._connected) return;
    // SHA-1 hash
    const imageBuffer = imageBytes.buffer.slice(
      imageBytes.byteOffset,
      imageBytes.byteOffset + imageBytes.byteLength
    ) as ArrayBuffer;
    const hashBuf = await crypto.subtle.digest("SHA-1", imageBuffer);
    const hashBytes = new Uint8Array(hashBuf);
    const hashHex = Array.from(hashBytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    // base64 encode
    let bin = "";
    for (let i = 0; i < imageBytes.byteLength; i++) bin += String.fromCharCode(imageBytes[i]);
    const dataB64 = btoa(bin);

    // Publish data
    const dataIq = this._$iq({ type: "set" })
      .c("pubsub", { xmlns: "http://jabber.org/protocol/pubsub" })
      .c("publish", { node: "urn:xmpp:avatar:data" })
      .c("item", { id: hashHex })
      .c("data", { xmlns: "urn:xmpp:avatar:data" }).t(dataB64);
    await new Promise<void>((resolve) => {
      this._connection.sendIQ(dataIq.tree(), () => resolve(), () => resolve());
    });

    // Publish metadata
    const metaAttrs: Record<string, string> = {
      bytes: String(imageBytes.byteLength),
      id: hashHex,
      type: mimeType,
    };
    if (width) metaAttrs.width = String(width);
    if (height) metaAttrs.height = String(height);
    const metaIq = this._$iq({ type: "set" })
      .c("pubsub", { xmlns: "http://jabber.org/protocol/pubsub" })
      .c("publish", { node: "urn:xmpp:avatar:metadata" })
      .c("item", { id: hashHex })
      .c("metadata", { xmlns: "urn:xmpp:avatar:metadata" })
      .c("info", metaAttrs);
    await new Promise<void>((resolve) => {
      this._connection.sendIQ(metaIq.tree(), () => resolve(), () => resolve());
    });
  }

  // ============================================================
  // Generic PEP node publish / fetch (XEP-0163)
  // Used by OMEMO (devicelist, bundles) and other PEP-based features.
  // ============================================================
  async publishPepNode(node: string, item: any, itemId: string = "current"): Promise<void> {
    if (!this._connection || !this._connected) throw new Error("Not connected");
    const iq = this._$iq({ type: "set" })
      .c("pubsub", { xmlns: "http://jabber.org/protocol/pubsub" })
      .c("publish", { node })
      .c("item", { id: itemId });
    // Build the inner item XML based on item.type
    if (item.type === "devicelist") {
      const list = iq.c("list", { xmlns: "eu.siacs.conversations.axolotl" });
      for (const id of item.deviceIds as number[]) {
        list.c("device", { id: String(id) }).up();
      }
    } else if (item.type === "bundle") {
      const b = item.bundle;
      const bn = iq.c("bundle", { xmlns: "eu.siacs.conversations.axolotl" });
      bn.c("signedPreKeyPublic", { signedPreKeyId: String(b.signedPreKeyId) })
        .t(arrayBufferToBase64(b.signedPreKey)).up();
      bn.c("signedPreKeySignature").t(arrayBufferToBase64(b.signedPreKeySignature)).up();
      bn.c("identityKey").t(arrayBufferToBase64(b.identityKey)).up();
      const pks = bn.c("prekeys");
      for (const pk of b.preKeys) {
        pks.c("preKeyPublic", { preKeyId: String(pk.keyId) })
          .t(arrayBufferToBase64(pk.publicKey)).up();
      }
    } else if (item.type === "raw" && item.xml) {
      iq.cnode(item.xml);
    }
    await new Promise<void>((resolve, reject) => {
      this._connection.sendIQ(iq.tree(), () => resolve(), (err: any) => reject(err));
    });
  }

  async fetchPepNode(jid: string, node: string): Promise<Element | null> {
    if (!this._connection || !this._connected) return null;
    return new Promise((resolve) => {
      const iq = this._$iq({ type: "get", to: jid })
        .c("pubsub", { xmlns: "http://jabber.org/protocol/pubsub" })
        .c("items", { node });
      this._connection.sendIQ(iq.tree(), (result: Element) => {
        resolve(result);
      }, () => resolve(null));
    });
  }

  /**
   * Fetch a peer's PEP avatar. Returns data URL or null if not published.
   */
  async fetchPepAvatar(peerJid: string): Promise<string | null> {
    if (!this._connection || !this._connected) return null;
    return new Promise((resolve) => {
      // First fetch metadata to get hash
      const metaIq = this._$iq({ type: "get", to: peerJid })
        .c("pubsub", { xmlns: "http://jabber.org/protocol/pubsub" })
        .c("items", { node: "urn:xmpp:avatar:metadata" });
      this._connection.sendIQ(metaIq.tree(), (metaResult: Element) => {
        const info = metaResult.querySelector("metadata info");
        const hash = info?.getAttribute("id");
        const mime = info?.getAttribute("type") ?? "image/png";
        if (!hash) { resolve(null); return; }

        // Then fetch data by hash
        const dataIq = this._$iq({ type: "get", to: peerJid })
          .c("pubsub", { xmlns: "http://jabber.org/protocol/pubsub" })
          .c("items", { node: "urn:xmpp:avatar:data" })
          .c("item", { id: hash });
        this._connection.sendIQ(dataIq.tree(), (dataResult: Element) => {
          const dataB64 = dataResult.querySelector("data")?.textContent?.trim();
          if (!dataB64) { resolve(null); return; }
          resolve(`data:${mime};base64,${dataB64}`);
        }, () => resolve(null));
      }, () => resolve(null));
    });
  }

  // ============================================================
  // XEP-0280 Message Carbons
  // ============================================================
  private _enableCarbons() {
    if (!this._connection) return;
    const iq = this._$iq({ type: "set", id: "carbons-enable" })
      .c("enable", { xmlns: "urn:xmpp:carbons:2" });
    this._connection.sendIQ(iq.tree(), () => {
      // success - server confirmed carbons enabled
    }, () => {
      // failed - server may not support carbons; non-fatal
    });
  }

  // ============================================================
  // XEP-0352 Client State Indication
  // ============================================================
  private _csiActive = true;
  private _csiVisibilityHandler: (() => void) | null = null;

  private _setupCsiHandling() {
    if (typeof document === "undefined") return;
    this._csiVisibilityHandler = () => {
      if (document.hidden) this.setInactive();
      else this.setActive();
    };
    document.addEventListener("visibilitychange", this._csiVisibilityHandler);
  }

  setActive() {
    if (!this._connection || !this._connected || this._csiActive) return;
    this._csiActive = true;
    const stanza = this._buildElement("active", { xmlns: "urn:xmpp:csi:0" });
    if (stanza) this._connection.send(stanza);
  }

  setInactive() {
    if (!this._connection || !this._connected || !this._csiActive) return;
    this._csiActive = false;
    const stanza = this._buildElement("inactive", { xmlns: "urn:xmpp:csi:0" });
    if (stanza) this._connection.send(stanza);
  }

  private _buildElement(name: string, attrs: Record<string, string>): Element | null {
    if (!this._Strophe) return null;
    return this._Strophe.xmlElement(name, attrs as any);
  }

  // ============================================================
  // XEP-0030 Service Discovery + XEP-0115 Entity Capabilities
  // ============================================================
  private static readonly SUPPORTED_FEATURES = [
    "http://jabber.org/protocol/disco#info",
    "http://jabber.org/protocol/disco#items",
    "urn:xmpp:carbons:2",
    "urn:xmpp:csi:0",
    "urn:xmpp:mam:2",
    "urn:xmpp:ping",
    "urn:xmpp:receipts",
    "urn:xmpp:chat-markers:0",
    "urn:xmpp:reactions:0",
    "urn:xmpp:reply:0",
    "urn:xmpp:message-correct:0",
    "urn:xmpp:message-retract:1",
    "urn:xmpp:fasten:0",
    "urn:xmpp:avatar:metadata+notify",
    "urn:xmpp:avatar:data",
    "urn:xmpp:blocking",
    "http://jabber.org/protocol/muc",
    "http://jabber.org/protocol/chatstates",
    "vcard-temp",
    "jabber:x:conference",
  ];

  /**
   * Compute the XEP-0115 caps verification string.
   * Format: SHA-1 of "client/type/lang/name<feature1<feature2<...<"
   */
  private async _computeCapsHash(): Promise<string> {
    const features = [...XmppClient.SUPPORTED_FEATURES].sort();
    const idString = "client/web//Conjiweb<" + features.join("<") + "<";
    const buf = new TextEncoder().encode(idString);
    const hash = await crypto.subtle.digest("SHA-1", buf);
    // base64 encode
    const bytes = new Uint8Array(hash);
    let bin = "";
    for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
  }

  /**
   * Setup handler for incoming disco#info queries about our capabilities.
   */
  private _setupDiscoHandler() {
    if (!this._connection) return;
    this._connection.addHandler((iq: Element) => {
      const fromIq = iq.getAttribute("from") ?? "";
      const idIq = iq.getAttribute("id") ?? "";
      const reply = this._$iq({ type: "result", to: fromIq, id: idIq })
        .c("query", { xmlns: "http://jabber.org/protocol/disco#info" })
        .c("identity", { category: "client", type: "web", name: "Conjiweb" }).up();
      for (const feature of XmppClient.SUPPORTED_FEATURES) {
        reply.c("feature", { var: feature }).up();
      }
      this._connection.send(reply);
      return true;
    }, "http://jabber.org/protocol/disco#info", "iq", "get");
  }

  disconnect() {
    // Clean up CSI visibility listener
    if (this._csiVisibilityHandler && typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._csiVisibilityHandler);
      this._csiVisibilityHandler = null;
    }
    // Stop SM request timer (keep queue intact for resume on reconnect)
    this._stopSmRequestTimer();
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
