/**
 * jingle/index.ts - High-level Jingle integration with XMPP.
 *
 * The CallManager owns all active sessions per account. It listens for
 * incoming Jingle IQ stanzas via xmppAdapter events and dispatches them
 * to the right session.
 *
 * To make a call:
 *   const session = await callManager.startCall(accountId, peerJid, ["audio", "video"]);
 *   session.on("state.changed", state => updateUI(state));
 *   session.on("stream.remote", stream => attachToVideo(stream));
 *
 * To accept an incoming call:
 *   callManager.on("incoming", session => {
 *     showRingUI(session);
 *     onAcceptClick(() => session.acceptCall());
 *     onDeclineClick(() => session.hangup("decline"));
 *   });
 *
 * coturn / TURN configuration:
 *   The xmppAdapter fetches XEP-0215 external services from the server
 *   (mod_external_services on Prosody) and passes them as iceServers.
 */

import { JingleSession } from "./session";
import { CallMediaType, IceServer } from "./types";

export type { CallSession, CallState, CallMediaType, IceServer } from "./types";
export { JingleSession } from "./session";

type Listener = (session: JingleSession) => void;

class CallManager {
  private sessions = new Map<string, JingleSession>();   // sessionId -> session
  private listeners = new Map<string, Listener[]>();
  private iceServers: IceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },             // public STUN fallback
  ];

  /**
   * Set ICE servers (typically called once after XMPP connect, with
   * STUN/TURN servers fetched from XEP-0215).
   */
  setIceServers(servers: IceServer[]) {
    this.iceServers = servers;
  }

  on(event: "incoming" | "started" | "ended", fn: Listener): () => void {
    const arr = this.listeners.get(event) ?? [];
    arr.push(fn);
    this.listeners.set(event, arr);
    // Return an unsubscribe function for ergonomic cleanup in React effects
    return () => this.off(event, fn);
  }

  off(event: "incoming" | "started" | "ended", fn: Listener) {
    const arr = this.listeners.get(event);
    if (!arr) return;
    this.listeners.set(event, arr.filter(l => l !== fn));
  }

  private emit(event: string, session: JingleSession) {
    (this.listeners.get(event) ?? []).forEach(fn => fn(session));
  }

  getSession(sessionId: string): JingleSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): JingleSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Initiate a call to peerJid.
   */
  async startCall(
    peerJid: string,
    mediaTypes: CallMediaType[]
  ): Promise<JingleSession> {
    const sessionId = crypto.randomUUID();
    const session = new JingleSession(sessionId, peerJid, "outgoing", mediaTypes, this.iceServers);
    this.sessions.set(sessionId, session);
    session.on("ended", () => {
      this.sessions.delete(sessionId);
      this.emit("ended", session);
    });
    this.emit("started", session);
    await session.initiate();
    return session;
  }

  /**
   * Called by the bridge when a session-initiate Jingle stanza arrives.
   */
  async handleIncoming(
    sessionId: string,
    fromJid: string,
    mediaTypes: CallMediaType[],
    sdp: string
  ): Promise<JingleSession> {
    const session = new JingleSession(sessionId, fromJid, "incoming", mediaTypes, this.iceServers);
    this.sessions.set(sessionId, session);
    session.on("ended", () => {
      this.sessions.delete(sessionId);
      this.emit("ended", session);
    });
    await session.acceptIncomingOffer(sdp);
    this.emit("incoming", session);
    return session;
  }
}

export const callManager = new CallManager();
