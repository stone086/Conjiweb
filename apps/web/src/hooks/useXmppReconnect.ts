import { useEffect, useRef } from "react";
import { useAccountStore } from "@/stores/accountStore";
import { createClient, getClient } from "@/services/xmppAdapter";
import { initXmppBridge } from "@/services/xmppBridge";

const RECONNECT_DELAYS = [3000, 5000, 10000, 30000]; // ms

/**
 * Watches all accounts and auto-reconnects disconnected ones.
 * Mount this once at the app root level.
 */
export function useXmppReconnect() {
  const accounts = useAccountStore((s) => s.accounts);
  const setConnected = useAccountStore((s) => s.setConnected);
  const attemptsRef = useRef<Record<string, number>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    accounts.forEach((account) => {
      if (!account.is_enabled) return;

      const client = getClient(account.id);
      if (client?.connected) return;

      // Already scheduled
      if (timersRef.current[account.id]) return;

      const attempt = attemptsRef.current[account.id] ?? 0;
      const delay = RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];

      timersRef.current[account.id] = setTimeout(async () => {
        delete timersRef.current[account.id];

        try {
          const wsUrl = import.meta.env.VITE_XMPP_WS_URL ?? "ws://localhost:5280/xmpp-websocket";
          const newClient = createClient({
            jid: account.jid,
            password: account.password,
            wsUrl,
            accountId: account.id,
          });
          initXmppBridge(newClient);
          await newClient.connect();
          attemptsRef.current[account.id] = 0;
          setConnected(account.id, true);
        } catch {
          attemptsRef.current[account.id] = attempt + 1;
          setConnected(account.id, false);
        }
      }, delay);
    });

    return () => {
      Object.values(timersRef.current).forEach(clearTimeout);
    };
  }, [accounts, setConnected]);
}
