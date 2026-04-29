import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useChatStore, ChatMessage } from "@/stores/chatStore";
import { useAccountStore } from "@/stores/accountStore";
import { useRosterStore } from "@/stores/rosterStore";
import { useGroupStore } from "@/stores/groupStore";
import { getClient } from "@/services/xmppAdapter";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { useMAM } from "@/hooks/useMAM";
import { FileUploadZone, UploadedFile, ImagePreview, FileCard } from "@/modules/media/FileUpload";
import Avatar from "@/components/Avatar";
import LinkPreviewCard, { extractFirstUrl } from "@/components/LinkPreviewCard";
import VoiceRecorder from "@/components/VoiceRecorder";
import VirtualMessageList from "@/modules/chat/VirtualMessageList";
import { cacheMessages, getDraft, getLocalMessages, saveDraft } from "@/services/localDb";
import { getChatToolbarActions } from "@/plugins/host";
import type { ChatToolbarAction } from "@/plugins/sdk";
import { format, isSameDay } from "date-fns";
import { formatMsgTime, formatMsgTimeFull } from "@/utils/helpers";
import { clsx } from "clsx";
import { Send, Paperclip, X, ChevronDown, CornerUpLeft, Loader, Smile, MoreVertical, Star, Pencil, Forward, Trash2, Lock, Phone, Video, UserPlus, Mic } from "lucide-react";
import { callManager } from "@/services/jingle";
import { processSlashCommand } from "@/services/slashCommands";
import EmojiPicker from "emoji-picker-react";
import { Theme } from "emoji-picker-react";
import toast from "react-hot-toast";
import { useLanguage } from "@/utils/i18n";
import { attachmentsApi } from "@/services/api";
import { encryptOmemoEnvelopeForPeer } from "@/services/e2ee";
import { tryLibsignalEncrypt } from "@/services/xmppBridge";
import { getOmemoEnabled } from "@/services/omemoSettings";

function DateDivider({ date, todayLabel, yesterdayLabel }: { date: number; todayLabel: string; yesterdayLabel: string }) {
  const label = isSameDay(date, Date.now())
    ? todayLabel
    : isSameDay(date, Date.now() - 86400000)
      ? yesterdayLabel
      : format(date, "yyyy-MM-dd");
  return (
    <div className="flex items-center gap-3 py-2 my-1">
      <div className="flex-1 h-px bg-white/5" />
      <span className="text-[10px] text-surface-200/30 px-2 py-0.5 rounded-full bg-surface-900">{label}</span>
      <div className="flex-1 h-px bg-white/5" />
    </div>
  );
}

function MessageBubble({
  msg,
  replyPreview,
  replySender,
  isOwn,
  onReply,
  onOpenImage,
  onRetry,
  onEdit,
  onForward,
  onDelete,
  onToggleStar,
  onReact,
  sentLabel,
  readLabel,
}: {
  msg: ChatMessage;
  replyPreview?: string;
  replySender?: string;
  isOwn: boolean;
  onReply: (m: ChatMessage) => void;
  onOpenImage: (src: string, alt: string) => void;
  onRetry: (m: ChatMessage) => void;
  onEdit: (m: ChatMessage) => void;
  onForward: (m: ChatMessage) => void;
  onDelete: (m: ChatMessage) => void;
  onToggleStar: (m: ChatMessage) => void;
  onReact: (m: ChatMessage, emoji: string) => void;
  sentLabel: string;
  readLabel: string;
}) {
  const { t } = useLanguage();
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [menuOpen]);
  return (
    <div
      className={clsx("flex gap-2 group", isOwn ? "flex-row-reverse" : "flex-row")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isOwn && (
        <Avatar name={msg.senderJid} size="xs" className="mt-auto mb-1" />
      )}
      <div className={clsx("flex flex-col gap-1 max-w-[70%] min-w-[8rem]", isOwn ? "items-end" : "items-start")}>
        {!isOwn && <span className="text-[10px] text-surface-200/40 px-1">{msg.senderJid.split("@")[0]}</span>}
        <div
          className={isOwn ? "msg-bubble-out" : "msg-bubble-in"}
          onContextMenu={(e) => {
            e.preventDefault();
            setMenuOpen(true);
          }}
          onTouchStart={(e) => {
            // long-press detection (500ms)
            const target = e.currentTarget;
            const timer = window.setTimeout(() => setMenuOpen(true), 500);
            const cancel = () => { window.clearTimeout(timer); };
            target.addEventListener("touchend", cancel, { once: true });
            target.addEventListener("touchmove", cancel, { once: true });
          }}
        >
          {msg.replyToId && (
            <div className="mb-2 px-2 py-1 rounded-md border-l-2 border-white/30 bg-black/15">
              <p className="text-[10px] text-surface-200/60">{replySender ?? t("chat.reply")}</p>
              <p className="text-xs text-surface-200/70 line-clamp-2 break-words">
                {replyPreview ?? t("chat.originalUnavailable")}
              </p>
            </div>
          )}
          {msg.body && <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>}
          {msg.body && (() => {
            const url = extractFirstUrl(msg.body);
            return url ? <LinkPreviewCard url={url} /> : null;
          })()}
          {msg.editedAt && <p className="text-[10px] text-surface-200/40 mt-1 cursor-default" title={`${t("chat.editedAt")} ${formatMsgTimeFull(msg.editedAt)}`}>{t("chat.edited")}</p>}
          {msg.attachments?.map((att) => (
            <div key={att.id} className="mt-2">
              {att.mimeType.startsWith("image/") ? (
                <ImagePreview src={att.downloadUrl} alt={att.fileName} onClick={() => onOpenImage(att.downloadUrl, att.fileName)} />
              ) : (
                <FileCard name={att.fileName} mimeType={att.mimeType} sizeBytes={att.sizeBytes} downloadUrl={att.downloadUrl} />
              )}
            </div>
          ))}
        </div>
        {!!msg.reactions && Object.keys(msg.reactions).length > 0 && (
          <div className="flex gap-1 flex-wrap px-1">
            {Object.entries(msg.reactions).map(([emoji, count]) => (
              <button
                key={emoji}
                onClick={() => onReact(msg, emoji)}
                className="text-[11px] px-1.5 py-0.5 rounded-full border border-white/10 bg-white/5"
              >
                {emoji} {count}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 px-1">
          {msg.starred && <span className="text-[10px] text-warn">★</span>}
          {msg.encrypted && <Lock size={10} className="text-success" />}
          {msg.decryptFailed && <span className="text-[10px] text-danger">{t("chat.decryptFailed")}</span>}
          <span className="text-[10px] text-surface-200/25" title={formatMsgTimeFull(msg.timestamp)}>
            {formatMsgTime(msg.timestamp)}
          </span>
          {isOwn && <span className="text-[10px] text-surface-200/25">{msg.status === "read" ? readLabel : sentLabel}</span>}
          {isOwn && msg.status === "failed" && (
            <button
              onClick={() => onRetry(msg)}
              className="text-[10px] text-danger hover:text-danger/80 underline"
            >
              {t("chat.retry")}
            </button>
          )}
        </div>
      </div>
      <div className={clsx("flex items-center self-center transition-opacity", hovered ? "opacity-100" : "opacity-0")}>
        <button onClick={() => onReply(msg)} className="p-1.5 rounded-lg hover:bg-white/5 text-surface-200/30 hover:text-surface-200">
          <CornerUpLeft size={13} />
        </button>
        <div className="relative" ref={menuRef}>
          <button onClick={() => setMenuOpen((v) => !v)} className="p-1.5 rounded-lg hover:bg-white/5 text-surface-200/30 hover:text-surface-200">
            <MoreVertical size={13} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-7 z-20 w-36 rounded-lg border border-white/10 bg-surface-900 shadow-xl p-1">
              <button onClick={() => { onToggleStar(msg); setMenuOpen(false); }} className="w-full text-left text-xs px-2 py-1.5 hover:bg-white/5 rounded flex items-center gap-2">
                <Star size={12} /> {msg.starred ? "Unstar" : "Star"}
              </button>
              {isOwn && (
                <button onClick={() => { onEdit(msg); setMenuOpen(false); }} className="w-full text-left text-xs px-2 py-1.5 hover:bg-white/5 rounded flex items-center gap-2">
                  <Pencil size={12} /> Edit
                </button>
              )}
              <button onClick={() => { onForward(msg); setMenuOpen(false); }} className="w-full text-left text-xs px-2 py-1.5 hover:bg-white/5 rounded flex items-center gap-2">
                <Forward size={12} /> Forward
              </button>
              <div className="px-2 py-1.5 flex items-center gap-1 border-b border-white/5">
                {["👍", "❤️", "😂", "😮", "😢", "🙏"].map((em) => (
                  <button
                    key={em}
                    onClick={() => { onReact(msg, em); setMenuOpen(false); }}
                    className="w-7 h-7 rounded hover:bg-white/10 text-base transition-transform hover:scale-110"
                    title={`React with ${em}`}
                  >
                    {em}
                  </button>
                ))}
              </div>
              {isOwn && (
                <button onClick={() => { onDelete(msg); setMenuOpen(false); }} className="w-full text-left text-xs px-2 py-1.5 hover:bg-white/5 rounded text-danger flex items-center gap-2">
                  <Trash2 size={12} /> Delete
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TypingBubble({ name }: { name: string }) {
  return (
    <div className="flex gap-2 items-end">
      <Avatar name={name} size="xs" />
      <div className="msg-bubble-in flex items-center gap-1 py-3">
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-1.5 h-1.5 rounded-full bg-surface-200/40 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}

function ReplyPreview({ msg, onCancel, title }: { msg: ChatMessage; onCancel: () => void; title: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-t border-white/5 bg-surface-900/30">
      <div className="w-0.5 h-8 bg-accent rounded-full flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-accent-soft font-medium">{title} {msg.senderJid.split("@")[0]}</p>
        <p className="text-xs text-surface-200/50 truncate">{msg.body}</p>
      </div>
      <button onClick={onCancel} className="text-surface-200/30 hover:text-surface-200 p-1">
        <X size={12} />
      </button>
    </div>
  );
}

function ForwardModal({
  message,
  candidates,
  targetId,
  onSelectTarget,
  onConfirm,
  onCancel,
}: {
  message: ChatMessage;
  candidates: { id: string; title?: string; peerJid: string; type: string }[];
  targetId: string;
  onSelectTarget: (id: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useLanguage();
  const [search, setSearch] = useState("");
  const filtered = candidates.filter((c) =>
    (c.title ?? c.peerJid).toLowerCase().includes(search.toLowerCase())
  );
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-surface-900 shadow-2xl p-4 flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-surface-50">{t("chat.forwardMessage")}</h3>
        <p className="text-xs text-surface-200/50 line-clamp-2">{message.body}</p>
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("chat.searchConversations")}
          className="input-field text-sm"
        />
        <div className="max-h-52 overflow-y-auto flex flex-col gap-1 pr-1">
          {filtered.length === 0 && (
            <p className="text-xs text-surface-200/30 text-center py-4">{t("chat.noMatchingConversations")}</p>
          )}
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelectTarget(c.id)}
              className={clsx(
                "w-full text-left text-sm px-3 py-2 rounded-lg transition-colors",
                targetId === c.id
                  ? "bg-accent/20 text-accent-soft"
                  : "hover:bg-white/5 text-surface-200/70"
              )}
            >
              {c.title ?? c.peerJid}
              <span className="text-xs text-surface-200/30 ml-1.5">
                ({c.type === "group" ? t("chat.groupConversation") : t("chat.privateConversation")})
              </span>
            </button>
          ))}
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="btn-ghost text-sm">{t("common.cancel")}</button>
          <button
            onClick={onConfirm}
            disabled={!targetId}
            className="btn-primary text-sm"
          >
            {t("chat.forward")}
          </button>
        </div>
      </div>
    </div>
  );
}

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  const { t } = useLanguage();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <img
        src={src}
        alt={alt}
        className="max-w-full max-h-full object-contain rounded-lg border border-white/10"
        onClick={(event) => event.stopPropagation()}
      />
      <button
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-black/50 border border-white/20 text-white hover:bg-black/70"
        title={t("common.close")}
      >
        <X size={16} className="mx-auto" />
      </button>
    </div>
  );
}

export default function MessageView({ conversationId }: { conversationId: string }) {
  const [searchParams] = useSearchParams();
  const { t } = useLanguage();
  const [input, setInput] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [pluginToolbarActions, setPluginToolbarActions] = useState<ChatToolbarAction[]>([]);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<ChatMessage | null>(null);
  const [forwardTargetId, setForwardTargetId] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageNodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const conversation = useChatStore((s) => s.conversations[conversationId]);
  const upsertRoom = useGroupStore((s) => s.upsertRoom);
  const peerContact = useRosterStore((s) =>
    activeAccountId && conversation?.peerJid ? s.getContact(activeAccountId, conversation.peerJid) : undefined
  );
  const upsertContact = useRosterStore((s) => s.upsertContact);
  const allConversations = useChatStore((s) => Object.values(s.conversations));
  const messages = useChatStore((s) => s.messages[conversationId] ?? []);
  const messagesRef = useRef(messages);
  const composerDraft = useChatStore((s) => s.composerDrafts[conversationId] ?? "");
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const toggleMessageStar = useChatStore((s) => s.toggleMessageStar);
  const toggleMessageReaction = useChatStore((s) => s.toggleMessageReaction);
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);
  const clearComposerDraft = useChatStore((s) => s.clearComposerDraft);
  const messageMap = new Map<string, ChatMessage>(messages.map((m) => [m.id, m]));
  const { peerIsTyping, onInputChange, onBlur } = useTypingIndicator(conversation?.peerJid ?? "");
  const { fetchHistory, loading: mamLoading, hasMore } = useMAM(conversation?.peerJid ?? "", conversationId);
  const forwardCandidates = allConversations
    .filter((c) => c.accountId === activeAccountId && c.id !== conversationId)
    .sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
  const peerDomain = (conversation?.peerJid.split("@")[1] ?? "").toLowerCase();
  const isMucPeer =
    conversation?.type === "group"
    || peerDomain.startsWith("conference.")
    || peerDomain.includes(".conference.");
  const needsContactApproval = Boolean(
    conversation?.type === "private"
      && !isMucPeer
      && peerContact?.pendingIncoming
      && !peerContact.isBlocked
  );

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      if (!conversation) return;
      if (messages.length > 0) return;

      const localMessages = await getLocalMessages(conversationId, 200);
      if (!cancelled && localMessages.length > 0) {
        localMessages.forEach((m) => addMessage(m, { countAsUnread: false }));
      }

      if (!cancelled && localMessages.length === 0) {
        await fetchHistory();
      }
    };

    bootstrap().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId, conversation, messages.length, addMessage, fetchHistory]);

  useEffect(() => {
    if (!activeAccountId || !conversation || conversation.type !== "group") return;
    const client = getClient(activeAccountId);
    if (!client?.connected) return;
    const roomJid = conversation.peerJid;
    const nickname = client.config.jid.split("@")[0] || "user";
    try {
      client.joinRoom(roomJid, nickname);
      upsertRoom({
        jid: roomJid,
        name: conversation.title || roomJid.split("@")[0],
        nickname,
        isPublic: true,
        joined: true,
      });
    } catch {
      // ignore transient join errors; reconnect flow may retry
    }
  }, [activeAccountId, conversation, upsertRoom]);

  useEffect(() => {
    let cancelled = false;
    const loadDraft = async () => {
      if (composerDraft) {
        setInput(composerDraft);
        return;
      }
      const persisted = await getDraft(conversationId);
      if (cancelled || !persisted) return;
      setComposerDraft(conversationId, persisted);
      setInput(persisted);
    };
    loadDraft().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [conversationId, composerDraft, setComposerDraft]);

  useEffect(() => {
    setInput(composerDraft);
  }, [composerDraft]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      saveDraft(conversationId, input).catch(() => {});
    }, 200);
    return () => window.clearTimeout(timer);
  }, [conversationId, input]);

  // Keep messagesRef in sync so plugin actions always read the latest messages
  // without re-triggering the plugin-load effect on every incoming message
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    const loadActions = async () => {
      if (!conversation) {
        if (!cancelled) setPluginToolbarActions([]);
        return;
      }
      const actions = await getChatToolbarActions({
        accountId: activeAccountId,
        conversationId,
        peerJid: conversation.peerJid,
        messages: messagesRef.current,
        addSystemMessage: (body: string) => {
          const systemMessage: ChatMessage = {
            id: crypto.randomUUID(),
            conversationId,
            senderJid: "system",
            body,
            bodyType: "text",
            direction: "system",
            status: "delivered",
            timestamp: Date.now(),
          };
          addMessage(systemMessage);
          cacheMessages([systemMessage]).catch(() => {});
        },
      });
      if (!cancelled) setPluginToolbarActions(actions);
    };
    loadActions().catch(() => {
      if (!cancelled) setPluginToolbarActions([]);
    });
    return () => {
      cancelled = true;
    };
  }, [activeAccountId, conversationId, conversation?.peerJid, addMessage]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    if (!isNearBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, peerIsTyping]);

  useEffect(() => {
    if (!showEmojiPicker) return;
    const onPointerDown = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (composerRef.current?.contains(target)) return;
      setShowEmojiPicker(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [showEmojiPicker]);

  useEffect(() => {
    const targetId = searchParams.get("mid");
    if (!targetId) return;
    const target = messageNodeRefs.current[targetId];
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("ring-2", "ring-accent", "rounded-xl");
    const timer = window.setTimeout(() => {
      target.classList.remove("ring-2", "ring-accent", "rounded-xl");
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [messages, searchParams]);

  const handleScroll = () => {
    const c = containerRef.current;
    if (!c) return;
    const distFromBottom = c.scrollHeight - c.scrollTop - c.clientHeight;
    isNearBottomRef.current = distFromBottom < 200;
    setShowScrollBtn(distFromBottom > 300);
    if (c.scrollTop < 80 && hasMore && !mamLoading) fetchHistory();
  };

  const sendMessage = useCallback(async () => {
    let body = input.trim();
    if (!body && !pendingFiles.length) return;
    if (!activeAccountId) return;
    if (needsContactApproval) {
      toast.error(t("chat.addContactBeforeReply"));
      return;
    }

    // Slash command interception
    if (body.startsWith("/")) {
      const result = await processSlashCommand(body, {
        conversationId,
        accountId: activeAccountId,
        insertText: (text: string) => setInput(text),
        showSystemMessage: (b: string) => {
          const sysMsg: ChatMessage = {
            id: crypto.randomUUID(),
            conversationId,
            senderJid: "system",
            body: b,
            bodyType: "text",
            direction: "system",
            status: "delivered",
            timestamp: Date.now(),
          };
          addMessage(sysMsg);
          cacheMessages([sysMsg]).catch(() => {});
        },
      });
      if (result.handled) {
        if (result.replacement === null) {
          // command consumed - clear input, don't send anything
          setInput("");
          clearComposerDraft(conversationId);
          return;
        }
        if (result.replacement) {
          body = result.replacement;
        }
      }
    }

    const client = getClient(activeAccountId);
    if (!client?.connected) {
      toast.error(t("chat.notConnected"));
      return;
    }
    let id = "";
    let sentEncrypted = false;
    try {
      let outboundBody = body;
      if (body && conversation?.type === "private" && getOmemoEnabled()) {
        const peerJid = conversation?.peerJid ?? conversationId;
        // Try libsignal-based OMEMO first (XEP-0384, interop with Conversations/Gajim).
        // Fall back to legacy custom-protocol OMEMO if peer hasn't published a bundle.
        let envelope: any = await tryLibsignalEncrypt(activeAccountId, peerJid, body);
        if (!envelope) {
          const encrypted = await encryptOmemoEnvelopeForPeer(activeAccountId, peerJid, body);
          if (!encrypted.usedPeerKey || !encrypted.envelope) {
            const sendPlain = window.confirm(t("omemo.sendPlaintextConfirm"));
            if (!sendPlain) return;
            id = client.sendMessage(
              peerJid,
              outboundBody,
              "chat",
              editingMessageId
                ? { replaceId: editingMessageId }
                : (replyTo ? { replyToId: replyTo.id, replyToJid: replyTo.senderJid } : undefined)
            );
            toast(t("omemo.sentPlaintext"));
          } else {
            envelope = encrypted.envelope;
          }
        }
        if (envelope) {
          id = client.sendOmemoMessage(
            peerJid,
            envelope,
            "chat",
            editingMessageId
              ? { replaceId: editingMessageId }
              : (replyTo ? { replyToId: replyTo.id, replyToJid: replyTo.senderJid } : undefined)
          );
          sentEncrypted = true;
        }
      } else {
        id = body ? client.sendMessage(
          conversation?.peerJid ?? conversationId,
          outboundBody,
          conversation?.type === "group" ? "groupchat" : "chat",
          editingMessageId
            ? { replaceId: editingMessageId }
            : (replyTo ? { replyToId: replyTo.id, replyToJid: replyTo.senderJid } : undefined)
        ) : crypto.randomUUID();
      }
    } catch (error: any) {
      if (body) {
        const failedMessage: ChatMessage = {
          id: crypto.randomUUID(),
          conversationId,
          senderJid: client.config.jid,
          body,
          bodyType: "text",
          direction: "out",
          status: "failed",
          timestamp: Date.now(),
          replyToId: replyTo?.id,
          attachments: pendingFiles.map((f) => ({
            id: f.id,
            fileName: f.name,
            mimeType: f.mimeType,
            downloadUrl: f.downloadUrl,
            sizeBytes: f.sizeBytes,
          })),
        };
        addMessage(failedMessage, { countAsUnread: false });
      }
      toast.error(error?.message ?? t("chat.sendFailed"));
      return;
    }
    const outgoingMessage: ChatMessage = {
      id,
      conversationId,
      senderJid: client.config.jid,
      body,
      bodyType: "text",
      direction: "out",
      status: "sent",
      timestamp: Date.now(),
      replyToId: replyTo?.id,
      encrypted: sentEncrypted,
      attachments: pendingFiles.map((f) => ({
        id: f.id,
        fileName: f.name,
        mimeType: f.mimeType,
        downloadUrl: f.downloadUrl,
        sizeBytes: f.sizeBytes,
      })),
    };
    if (editingMessageId) {
      updateMessage(conversationId, editingMessageId, {
        body,
        editedAt: Date.now(),
      });
    } else {
    addMessage(outgoingMessage);
    cacheMessages([outgoingMessage]).catch(() => {});
    }
    setInput("");
    clearComposerDraft(conversationId);
    saveDraft(conversationId, "").catch(() => {});
    setReplyTo(null);
    setEditingMessageId(null);
    setPendingFiles([]);
    setShowUpload(false);
    setShowEmojiPicker(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, pendingFiles, activeAccountId, needsContactApproval, conversationId, conversation, addMessage, updateMessage, replyTo, editingMessageId, t, clearComposerDraft]);

  const handleAcceptContact = useCallback(() => {
    if (!activeAccountId || !conversation?.peerJid) return;
    const client = getClient(activeAccountId);
    if (!client?.connected) {
      toast.error(t("chat.notConnected"));
      return;
    }
    client.approveSubscription(conversation.peerJid);
    client.addContact(conversation.peerJid, peerContact?.name);
    upsertContact({
      accountId: activeAccountId,
      jid: conversation.peerJid,
      name: peerContact?.name,
      groups: peerContact?.groups ?? [],
      subscription: "both",
      pendingIncoming: false,
      presence: peerContact?.presence ?? "unavailable",
      statusText: peerContact?.statusText,
      avatarUrl: peerContact?.avatarUrl,
      isBlocked: false,
    });
    toast.success(t("roster.accepted"));
  }, [activeAccountId, conversation?.peerJid, peerContact, t, upsertContact]);

  const handleEditMessage = useCallback((message: ChatMessage) => {
    if (message.direction !== "out") return;
    setEditingMessageId(message.id);
    setInput(message.body);
    setComposerDraft(conversationId, message.body);
    textareaRef.current?.focus();
  }, [conversationId, setComposerDraft]);

  const handleForwardMessage = useCallback((message: ChatMessage) => {
    setForwardingMessage(message);
    setForwardTargetId("");
  }, []);

  const handleConfirmForward = useCallback(() => {
    if (!forwardingMessage || !forwardTargetId || !activeAccountId) return;
    const target = allConversations.find((c) => c.id === forwardTargetId);
    if (!target) return;
    const client = getClient(activeAccountId);
    if (!client?.connected) {
      toast.error(t("chat.notConnected"));
      return;
    }
    try {
      client.sendMessage(
        target.peerJid,
        `↩ ${forwardingMessage.body}`,
        target.type === "group" ? "groupchat" : "chat"
      );
      toast.success("Forwarded");
      setForwardingMessage(null);
      setForwardTargetId("");
    } catch (error: any) {
      toast.error(error?.message ?? t("chat.sendFailed"));
    }
  }, [forwardingMessage, forwardTargetId, activeAccountId, allConversations, t]);

  const handleDeleteMessage = useCallback((message: ChatMessage) => {
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    client?.retractMessage(
      conversation?.peerJid ?? conversationId,
      message.id,
      conversation?.type === "group" ? "groupchat" : "chat"
    );
    updateMessage(conversationId, message.id, {
      body: "Message deleted",
      editedAt: Date.now(),
      deletedAt: Date.now(),
    });
  }, [activeAccountId, conversation, conversationId, updateMessage]);

  const handleToggleStar = useCallback((message: ChatMessage) => {
    toggleMessageStar(conversationId, message.id);
  }, [conversationId, toggleMessageStar]);

  const handleReact = useCallback((message: ChatMessage, emoji: string) => {
    // Update local store immediately for responsiveness
    toggleMessageReaction(conversationId, message.id, emoji);
    // Sync to XMPP peer via XEP-0444
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    if (!client?.connected || !conversation?.peerJid) return;
    // Build the full current reaction set for this user to send
    const updatedMsg = useChatStore.getState().messages[conversationId]
      ?.find((m) => m.id === message.id);
    const myEmojis = Object.entries(updatedMsg?.reactions ?? {})
      .filter(([, count]) => count > 0)
      .map(([em]) => em);
    client.sendReaction(
      conversation.peerJid,
      message.id,
      myEmojis,
      conversation.type === "group" ? "groupchat" : "chat"
    );
  }, [conversationId, toggleMessageReaction, activeAccountId, conversation]);

  const retryFailedMessage = useCallback((message: ChatMessage) => {
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    if (!client?.connected) {
      toast.error(t("chat.notConnected"));
      return;
    }
    const retry = async () => {
      try {
        const isPrivateOmemo = Boolean(
          message.encrypted
            && conversation?.type === "private"
            && getOmemoEnabled()
            && message.body
        );
        let newId = "";
        if (isPrivateOmemo) {
          const peerJid = conversation?.peerJid ?? conversationId;
          // libsignal-first OMEMO encryption with legacy fallback
          let envelope: any = await tryLibsignalEncrypt(activeAccountId, peerJid, message.body);
          if (!envelope) {
            const encrypted = await encryptOmemoEnvelopeForPeer(activeAccountId, peerJid, message.body);
            if (!encrypted.usedPeerKey || !encrypted.envelope) {
              const sendPlain = window.confirm(t("omemo.sendPlaintextConfirm"));
              if (!sendPlain) return;
              newId = client.sendMessage(peerJid, message.body, "chat");
              toast(t("omemo.sentPlaintext"));
            } else {
              envelope = encrypted.envelope;
            }
          }
          if (envelope) {
            newId = client.sendOmemoMessage(
              peerJid,
              envelope,
              "chat"
            );
          }
        } else {
          newId = client.sendMessage(
            conversation?.peerJid ?? conversationId,
            message.body,
            conversation?.type === "group" ? "groupchat" : "chat"
          );
        }
        updateMessage(conversationId, message.id, { id: newId, status: "sent", timestamp: Date.now() });
      } catch (error: any) {
        toast.error(error?.message ?? t("chat.sendFailed"));
      }
    };
    void retry();
  }, [activeAccountId, conversation, conversationId, t, updateMessage]);

  const handleComposerPaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(event.clipboardData?.items ?? []);
    const imageItems = items.filter((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (imageItems.length === 0) return;
    event.preventDefault();
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    if (!client?.connected) {
      toast.error(t("chat.notConnected"));
      return;
    }
    for (const item of imageItems) {
      const file = item.getAsFile();
      if (!file) continue;
      try {
        const result = await attachmentsApi.upload(file, undefined, activeAccountId ?? undefined);
        setPendingFiles((prev) => [
          ...prev,
          {
            id: result.id,
            name: result.file_name,
            mimeType: result.mime_type,
            sizeBytes: result.size_bytes,
            downloadUrl: result.download_url,
          },
        ]);
      } catch {
        toast.error(t("upload.error"));
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  if (!conversation) return <div className="flex items-center justify-center h-full text-surface-200/30 text-sm">{t("chat.notFound")}</div>;

  const handleStartCall = async (mediaTypes: ("audio" | "video")[]) => {
    if (!conversation?.peerJid) return;
    try {
      await callManager.startCall(conversation.peerJid, mediaTypes);
    } catch (e: any) {
      toast.error(e?.message ?? "Call failed");
    }
  };

  const useVirtualMessages = messages.length > 300;
  const highlightedMessageId = searchParams.get("mid");
  const renderMessageContent = (msg: ChatMessage) => {
    const isOwn = msg.direction === "out";
    return msg.direction === "system" ? (
      <div className="msg-bubble-system">{msg.body}</div>
    ) : (
      <MessageBubble
        msg={msg}
        replyPreview={msg.replyToId ? messageMap.get(msg.replyToId)?.body : undefined}
        replySender={msg.replyToId ? messageMap.get(msg.replyToId)?.senderJid.split("@")[0] : undefined}
        isOwn={isOwn}
        onReply={setReplyTo}
        onOpenImage={(src, alt) => setLightbox({ src, alt })}
        onRetry={retryFailedMessage}
        onEdit={handleEditMessage}
        onForward={handleForwardMessage}
        onDelete={handleDeleteMessage}
        onToggleStar={handleToggleStar}
        onReact={handleReact}
        sentLabel={t("chat.sentSent")}
        readLabel={t("chat.sentRead")}
      />
    );
  };

  return (
    <div className="flex flex-col h-full relative">
      {/* Chat header with peer info + call buttons */}
      {conversation.type === "private" && (
        <div className="flex items-center justify-end gap-1 px-4 py-2 border-b border-white/5 bg-surface-900/30">
          <button
            onClick={() => handleStartCall(["audio"])}
            className="w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center text-surface-200/60 hover:text-accent-soft transition-colors"
            title={t("chat.audioCall")}
            aria-label={t("chat.audioCall")}
          >
            <Phone size={14} />
          </button>
          <button
            onClick={() => handleStartCall(["audio", "video"])}
            className="w-8 h-8 rounded-full hover:bg-white/5 flex items-center justify-center text-surface-200/60 hover:text-accent-soft transition-colors"
            title={t("chat.videoCall")}
            aria-label={t("chat.videoCall")}
          >
            <Video size={14} />
          </button>
        </div>
      )}
      <div
        ref={containerRef}
        onScroll={useVirtualMessages ? undefined : handleScroll}
        className={clsx(
          "flex-1 min-h-0",
          useVirtualMessages ? "flex" : "overflow-y-auto px-4 py-4 flex flex-col gap-2"
        )}
      >
        {hasMore && (
          <div className={clsx("flex justify-center py-2", useVirtualMessages && "hidden")}>
            <button
              onClick={fetchHistory}
              disabled={mamLoading}
              className="text-xs text-surface-200/40 hover:text-surface-200 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-900 hover:bg-surface-800 transition-colors"
            >
              {mamLoading && <Loader size={11} className="animate-spin" />}
              {mamLoading ? t("chat.loading") : t("chat.loadOlder")}
            </button>
          </div>
        )}
        {messages.length === 0 && !mamLoading && (
          <div className="flex flex-col items-center justify-center flex-1 gap-2 text-surface-200/25">
            <p className="text-sm">{t("chat.noMessages")}</p>
          </div>
        )}
        {useVirtualMessages ? (
          <VirtualMessageList
            messages={messages}
            conversation={conversation}
            highlightId={highlightedMessageId}
            hasMore={hasMore}
            loadingOlder={mamLoading}
            onLoadOlder={fetchHistory}
            renderMessage={renderMessageContent}
            todayLabel={t("chat.today")}
            yesterdayLabel={t("chat.yesterday")}
            unreadLabel={t("chat.unread")}
            loadingLabel={t("chat.loading")}
            loadOlderLabel={t("chat.loadOlder")}
          />
        ) : messages.map((msg, i) => {
          const isOwn = msg.direction === "out";
          const prev = messages[i - 1];
          const showDate = !prev || !isSameDay(msg.timestamp, prev.timestamp);
          const unreadStartIdx = conversation.unreadCount > 0 ? Math.max(messages.length - conversation.unreadCount, 0) : -1;
          const showUnreadDivider = unreadStartIdx === i && conversation.unreadCount > 0;
          return (
            <div
              key={msg.id}
              className="animate-fade-in"
              ref={(node) => { messageNodeRefs.current[msg.id] = node; }}
              data-mid={msg.id}
            >
              {showDate && <DateDivider date={msg.timestamp} todayLabel={t("chat.today")} yesterdayLabel={t("chat.yesterday")} />}
              {showUnreadDivider && (
                <div className="flex items-center gap-3 py-2">
                  <div className="flex-1 h-px bg-accent/40" />
                  <span className="text-[10px] text-accent-soft px-2 py-0.5 rounded-full bg-accent/10">{t("chat.unread")}</span>
                  <div className="flex-1 h-px bg-accent/40" />
                </div>
              )}
              {renderMessageContent(msg)}
            </div>
          );
        })}
        {peerIsTyping && <TypingBubble name={conversation.peerJid.split("@")[0]} />}
        <div ref={messagesEndRef} />
      </div>

      {showScrollBtn && (
        <button
          onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
          className="absolute bottom-24 right-4 w-8 h-8 rounded-full bg-surface-800 border border-white/10 flex items-center justify-center text-surface-200/70 hover:text-surface-50 shadow-lg z-10"
        >
          <ChevronDown size={14} />
        </button>
      )}

      {showUpload && (
        <div className="px-4 py-3 border-t border-white/5 bg-surface-900/30">
          <FileUploadZone
            onUploaded={(f) => setPendingFiles((p) => [...p, f])}
            onCancel={() => setShowUpload(false)}
            accountId={activeAccountId ?? undefined}
          />
        </div>
      )}

      {pendingFiles.length > 0 && !showUpload && (
        <div className="px-4 py-2 border-t border-white/5 flex gap-2 flex-wrap">
          {pendingFiles.map((f) => (
            <div key={f.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-800 text-xs text-surface-200/70 border border-white/5">
              <span className="truncate max-w-[100px]">{f.name}</span>
              <button onClick={() => setPendingFiles((p) => p.filter((x) => x.id !== f.id))} className="text-surface-200/30 hover:text-danger">
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
      )}

      {replyTo && <ReplyPreview msg={replyTo} onCancel={() => setReplyTo(null)} title={t("chat.replyingTo")} />}
      {editingMessageId && (
        <div className="flex items-center gap-2 px-4 py-2 border-t border-white/5 bg-surface-900/30">
          <div className="w-0.5 h-8 bg-accent rounded-full flex-shrink-0" />
          <div className="flex-1 min-w-0 text-xs text-surface-200/70">{t("chat.editingMessage")}</div>
          <button
            onClick={() => {
              setEditingMessageId(null);
              setInput("");
              clearComposerDraft(conversationId);
            }}
            className="text-surface-200/30 hover:text-surface-200 p-1"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div ref={composerRef} className="border-t border-white/5 bg-surface-950/60 px-4 py-3 flex-shrink-0 relative">
        {pluginToolbarActions.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {pluginToolbarActions.map((action) => (
              <button
                key={action.id}
                onClick={() =>
                  action.onClick({
                    accountId: activeAccountId,
                    conversationId,
                    peerJid: conversation.peerJid,
                    messages,
                    addSystemMessage: (body: string) => {
                      const systemMessage: ChatMessage = {
                        id: crypto.randomUUID(),
                        conversationId,
                        senderJid: "system",
                        body,
                        bodyType: "text",
                        direction: "system",
                        status: "delivered",
                        timestamp: Date.now(),
                      };
                      addMessage(systemMessage);
                      cacheMessages([systemMessage]).catch(() => {});
                    },
                  })
                }
                className="px-2.5 py-1 rounded-lg text-xs border border-white/10 bg-white/5 text-surface-200/80 hover:text-surface-50 hover:bg-white/10"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <button
            onClick={() => setShowUpload(!showUpload)}
            disabled={needsContactApproval}
            className={clsx("btn-ghost p-2 flex-shrink-0", showUpload && "text-accent")}
            title={t("chat.attachFile")}
          >
            <Paperclip size={16} />
          </button>
          {needsContactApproval ? (
            <button
              type="button"
              disabled
              className="btn-ghost p-2 flex-shrink-0 opacity-60 cursor-not-allowed"
              title={t("chat.addContactBeforeReply")}
            >
              <Mic size={16} />
            </button>
          ) : (
            <VoiceRecorder
              onSend={async (file) => {
                // Upload as attachment, then send as message
                try {
                  const resp = await attachmentsApi.upload(file, undefined, activeAccountId ?? undefined);
                  // The upload returns { id, download_url, ... } - send as attachment
                  const placeholderMsg: ChatMessage = {
                    id: crypto.randomUUID(),
                    conversationId,
                    senderJid: getClient(activeAccountId ?? "")?.config.jid ?? "self",
                    body: "",
                    bodyType: "text",
                    direction: "out",
                    status: "sent",
                    timestamp: Date.now(),
                    attachments: [{
                      id: resp.id,
                      fileName: file.name,
                      mimeType: file.type,
                      sizeBytes: file.size,
                      downloadUrl: resp.download_url,
                    }],
                  };
                  addMessage(placeholderMsg);
                  cacheMessages([placeholderMsg]).catch(() => {});
                  toast.success(t("voice.sent"));
                } catch (e: any) {
                  toast.error(e?.message ?? t("voice.sendFailed"));
                }
              }}
            />
          )}
          <button
            onClick={() => setShowEmojiPicker((v) => !v)}
            className={clsx("btn-ghost p-2 flex-shrink-0", showEmojiPicker && "text-accent")}
            title="Emoji"
          >
            <Smile size={16} />
          </button>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => {
              const nextValue = e.target.value;
              setInput(nextValue);
              setComposerDraft(conversationId, nextValue);
              onInputChange();
              const next = e.target;
              next.style.height = "auto";
              next.style.height = Math.min(next.scrollHeight, 120) + "px";
            }}
            onKeyDown={handleKeyDown}
            onPaste={handleComposerPaste}
            onBlur={onBlur}
            placeholder={needsContactApproval ? t("chat.addContactBeforeReply") : `${t("chat.messagePlaceholder")} ${conversation.title ?? conversation.peerJid}...`}
            disabled={needsContactApproval}
            rows={1}
            className="flex-1 bg-surface-900 border border-white/5 rounded-xl px-4 py-2.5 text-sm text-surface-50 placeholder:text-surface-200/25 focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none min-h-[40px] max-h-[120px] disabled:opacity-60 disabled:cursor-not-allowed"
          />
          <button onClick={() => void sendMessage()} disabled={needsContactApproval || (!input.trim() && !pendingFiles.length)} className="btn-primary p-2.5 flex-shrink-0 rounded-xl" title={t("chat.send")}>
            <Send size={16} />
          </button>
        </div>
        {needsContactApproval && (
          <div className="mt-2 flex items-center justify-between gap-3 rounded-xl border border-accent/20 bg-accent/10 px-3 py-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-surface-50">{t("chat.pendingContactTitle")}</p>
              <p className="text-xs text-surface-200/60 truncate">
                {t("chat.pendingContactBody").replace("{jid}", conversation.peerJid)}
              </p>
            </div>
            <button
              type="button"
              onClick={handleAcceptContact}
              className="btn-primary flex items-center gap-1.5 px-3 py-2 text-xs flex-shrink-0"
            >
              <UserPlus size={14} />
              {t("roster.accept")}
            </button>
          </div>
        )}
        {showEmojiPicker && (
          <div className="absolute bottom-16 left-14 z-20">
            <EmojiPicker
              theme={Theme.DARK}
              lazyLoadEmojis
              onEmojiClick={(emojiData) => {
                const next = `${input}${emojiData.emoji}`;
                setInput(next);
                setComposerDraft(conversationId, next);
                textareaRef.current?.focus();
              }}
            />
          </div>
        )}
        <p className="text-[10px] text-surface-200/20 mt-1 pl-1">{t("chat.hint")}</p>
      </div>
      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
        />
      )}
      {forwardingMessage && (
        <ForwardModal
          message={forwardingMessage}
          candidates={forwardCandidates}
          targetId={forwardTargetId}
          onSelectTarget={setForwardTargetId}
          onConfirm={handleConfirmForward}
          onCancel={() => { setForwardingMessage(null); setForwardTargetId(""); }}
        />
      )}
    </div>
  );
}
