import { useState, useEffect, useCallback, useRef } from "react";
import { getClient } from "@/services/xmppAdapter";
import { useAccountStore } from "@/stores/accountStore";

/**
 * Hook for sending and receiving typing indicators.
 * Automatically sends "composing" when user types,
 * "paused" after they stop for 3 seconds.
 */
export function useTypingIndicator(peerJid: string) {
  const [peerIsTyping, setPeerIsTyping] = useState(false);
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const peerTypingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  useEffect(() => {
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    if (!client) return;

    const unsub1 = client.on("typing.started", (data: any) => {
      if (data.from?.split("/")[0] === peerJid) {
        setPeerIsTyping(true);
        if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current);
        peerTypingTimer.current = setTimeout(() => setPeerIsTyping(false), 10000);
      }
    });

    const unsub2 = client.on("typing.stopped", (data: any) => {
      if (data.from?.split("/")[0] === peerJid) {
        setPeerIsTyping(false);
        if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current);
      }
    });

    return () => {
      unsub1();
      unsub2();
      if (peerTypingTimer.current) clearTimeout(peerTypingTimer.current);
    };
  }, [activeAccountId, peerJid]);

  const onInputChange = useCallback(() => {
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    if (!client?.connected) return;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      client.sendTyping(peerJid, true);
    }

    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => {
      isTypingRef.current = false;
      client.sendTyping(peerJid, false);
    }, 3000);
  }, [activeAccountId, peerJid]);

  const onBlur = useCallback(() => {
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    if (!client?.connected || !isTypingRef.current) return;
    isTypingRef.current = false;
    client.sendTyping(peerJid, false);
    if (typingTimer.current) clearTimeout(typingTimer.current);
  }, [activeAccountId, peerJid]);

  return { peerIsTyping, onInputChange, onBlur };
}
