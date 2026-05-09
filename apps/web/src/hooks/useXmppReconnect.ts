import { useEffect } from "react";
import { getAccountPassword, useAccountStore } from "@/stores/accountStore";
import { createClient, getClient, destroyClient } from "@/services/xmppAdapter";
import { initXmppBridge } from "@/services/xmppBridge";
import { useReconnectStore } from "@/stores/reconnectStore";
import { authApi, setUserToken, setUserRefreshToken } from "@/services/api";
import {
  superviseConnection,
  unsuperviseConnection,
  getSupervisorState,
} from "@/services/connectionSupervisor";

/**
 * Watches all accounts and supervises auto-reconnect.
 * Mount once at the app root level.
 *
 * Strategy:
 *   - For every enabled account, attach a connectionSupervisor.
 *   - Supervisor uses exponential backoff with jitter (1s..60s, ±25%, max 50 attempts).
 *   - On `online` / `visibilitychange` events the supervisor accelerates retries
 *     so the user is back online within seconds of network/tab recovery.
 *   - Account list changes (add/remove account) attach/detach supervisors.
 */
export function useXmppReconnect() {
  const accounts = useAccountStore((s) => s.accounts);
  const setConnected = useAccountStore((s) => s.setConnected);
  const setReconnecting = useReconnectStore((s) => s.setReconnecting);

  useEffect(() => {
    const supervisedIds = new Set<string>();

    const deriveWsUrl = (): string => {
      // Same-origin construction matches LoginPage.tsx logic so we don't
      // accidentally reconnect to ws://localhost:5280 from a wss://prod page.
      const sameOrigin = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/xmpp-websocket`;
      const configured = (import.meta.env.VITE_XMPP_WS_URL as string | undefined) ?? "";
      if (configured) {
        try {
          const u = new URL(configured);
          if (u.host === window.location.host) return configured;
        } catch {}
      }
      return sameOrigin;
    };

    const attemptConnect = async (accountId: string): Promise<void> => {
      const account = accounts.find((a) => a.id === accountId);
      if (!account) throw new Error("Account vanished from store");
      const password = getAccountPassword(accountId);
      if (!password) {
        // No runtime password — can't reconnect silently. The user must log in.
        setConnected(accountId, false);
        setReconnecting(accountId, false);
        throw new Error("No runtime password — manual login required");
      }

      // Tear down any zombie client to avoid two parallel sockets
      const existing = getClient(accountId);
      if (existing) {
        try {
          existing.disconnect();
        } catch {}
        destroyClient(accountId);
      }

      const newClient = createClient({
        jid: account.jid,
        password,
        wsUrl: deriveWsUrl(),
        accountId,
        // Stability tunings — see XmppClientConfig
        keepaliveIntervalMs: 45_000,
        keepaliveTimeoutMs: 20_000,
        smRequestIntervalMs: 30_000,
      });
      initXmppBridge(newClient);
      // Re-attach supervisor on the new client instance (createClient discards prior listeners)
      attachSupervisor(accountId);

      setReconnecting(accountId, true);
      try {
        await newClient.connect();
        setConnected(accountId, true);
        setReconnecting(accountId, false);
        // Refresh user-token after reconnect so file uploads keep working
        try {
          const tokenRes = await authApi.getUserToken(account.jid, password).catch(() => null);
          if (tokenRes?.access_token) {
            setUserToken(accountId, tokenRes.access_token);
            if ((tokenRes as any).refresh_token) {
              setUserRefreshToken(accountId, (tokenRes as any).refresh_token);
            }
          }
        } catch {
          // Non-fatal — upload will retry token next time
        }
      } catch (err) {
        setConnected(accountId, false);
        // setReconnecting stays true while supervisor keeps trying
        throw err;
      }
    };

    const attachSupervisor = (accountId: string) => {
      const client = getClient(accountId);
      if (!client) return;
      superviseConnection(client, {
        initialBackoffMs: 1000,
        maxBackoffMs: 60_000,
        multiplier: 2,
        jitterFraction: 0.25,
        maxAttempts: 50,
        reconnect: () => attemptConnect(accountId),
      });
      supervisedIds.add(accountId);
    };

    // Phase 1: attach supervisor to every existing client
    accounts.forEach((account) => {
      if (!account.is_enabled) return;
      const client = getClient(account.id);
      if (client) {
        attachSupervisor(account.id);
      }
      // If no client exists, supervisor will be attached when one is first
      // created (LoginPage / SettingsPage handle initial creation).
    });

    // Phase 2: poll supervisor state every 5s -> drive setReconnecting
    // (purely cosmetic so the UI shows "Reconnecting..." correctly)
    const stateTimer = setInterval(() => {
      accounts.forEach((account) => {
        const s = getSupervisorState(account.id);
        if (!s) return;
        if (s.inProgress || (s.active && s.attempts > 0 && !s.intentionalDisconnect)) {
          setReconnecting(account.id, true);
        }
      });
    }, 5000);

    return () => {
      clearInterval(stateTimer);
      supervisedIds.forEach((id) => unsuperviseConnection(id));
    };
  }, [accounts, setConnected, setReconnecting]);
}
