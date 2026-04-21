import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useChatStore, ChatMessage } from "@/stores/chatStore";
import { useAccountStore } from "@/stores/accountStore";
import { getClient } from "@/services/xmppAdapter";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { useMAM } from "@/hooks/useMAM";
import { FileUploadZone, UploadedFile, ImagePreview, FileCard } from "@/modules/media/FileUpload";
import { cacheMessages, getDraft, getLocalMessages, saveDraft } from "@/services/localDb";
import { getChatToolbarActions } from "@/plugins/host";
import type { ChatToolbarAction } from "@/plugins/sdk";
import { format, isSameDay } from "date-fns";
import { clsx } from "clsx";
import { Send, Paperclip, X, ChevronDown, CornerUpLeft, Loader, Smile } from "lucide-react";
import EmojiPicker from "emoji-picker-react";
import { Theme } from "emoji-picker-react";
import toast from "react-hot-toast";
import { useLanguage } from "@/utils/i18n";
import { attachmentsApi } from "@/services/api";

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
  sentLabel: string;
  readLabel: string;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      className={clsx("flex gap-2 group", isOwn ? "flex-row-reverse" : "flex-row")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {!isOwn && (
        <div className="w-7 h-7 rounded-full bg-surface-800 flex items-center justify-center text-[11px] font-medium uppercase flex-shrink-0 mt-auto mb-1 text-surface-200">
          {msg.senderJid[0]}
        </div>
      )}
      <div className={clsx("flex flex-col gap-1 max-w-[70%] min-w-[8rem]", isOwn ? "items-end" : "items-start")}>
        {!isOwn && <span className="text-[10px] text-surface-200/40 px-1">{msg.senderJid.split("@")[0]}</span>}
        <div className={isOwn ? "msg-bubble-out" : "msg-bubble-in"}>
          {msg.replyToId && (
            <div className="mb-2 px-2 py-1 rounded-md border-l-2 border-white/30 bg-black/15">
              <p className="text-[10px] text-surface-200/60">{replySender ?? "Reply"}</p>
              <p className="text-xs text-surface-200/70 line-clamp-2 break-words">
                {replyPreview ?? "Original message not available"}
              </p>
            </div>
          )}
          {msg.body && <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>}
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
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-surface-200/25" title={format(msg.timestamp, "yyyy-MM-dd HH:mm:ss")}>
            {format(msg.timestamp, "HH:mm")}
          </span>
          {isOwn && <span className="text-[10px] text-surface-200/25">{msg.status === "read" ? readLabel : sentLabel}</span>}
          {isOwn && msg.status === "failed" && (
            <button
              onClick={() => onRetry(msg)}
              className="text-[10px] text-danger hover:text-danger/80 underline"
            >
              Retry
            </button>
          )}
        </div>
      </div>
      <div className={clsx("flex items-center self-center transition-opacity", hovered ? "opacity-100" : "opacity-0")}>
        <button onClick={() => onReply(msg)} className="p-1.5 rounded-lg hover:bg-white/5 text-surface-200/30 hover:text-surface-200">
          <CornerUpLeft size={13} />
        </button>
      </div>
    </div>
  );
}

function TypingBubble({ name }: { name: string }) {
  return (
    <div className="flex gap-2 items-end">
      <div className="w-7 h-7 rounded-full bg-surface-800 flex items-center justify-center text-[11px] font-medium uppercase text-surface-200">{name[0]}</div>
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

function ImageLightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
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
        title="Close"
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
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageNodeRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const conversation = useChatStore((s) => s.conversations[conversationId]);
  const messages = useChatStore((s) => s.messages[conversationId] ?? []);
  const composerDraft = useChatStore((s) => s.composerDrafts[conversationId] ?? "");
  const addMessage = useChatStore((s) => s.addMessage);
  const updateMessage = useChatStore((s) => s.updateMessage);
  const setComposerDraft = useChatStore((s) => s.setComposerDraft);
  const clearComposerDraft = useChatStore((s) => s.clearComposerDraft);
  const messageMap = new Map<string, ChatMessage>(messages.map((m) => [m.id, m]));
  const { peerIsTyping, onInputChange, onBlur } = useTypingIndicator(conversation?.peerJid ?? "");
  const { fetchHistory, loading: mamLoading, hasMore } = useMAM(conversation?.peerJid ?? "", conversationId);

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
      });
      if (!cancelled) setPluginToolbarActions(actions);
    };
    loadActions().catch(() => {
      if (!cancelled) setPluginToolbarActions([]);
    });
    return () => {
      cancelled = true;
    };
  }, [activeAccountId, conversationId, conversation, messages, addMessage]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    if (c.scrollHeight - c.scrollTop - c.clientHeight < 200) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
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
    setShowScrollBtn(c.scrollHeight - c.scrollTop - c.clientHeight > 300);
    if (c.scrollTop < 80 && hasMore && !mamLoading) fetchHistory();
  };

  const sendMessage = useCallback(() => {
    const body = input.trim();
    if (!body && !pendingFiles.length) return;
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    if (!client?.connected) {
      toast.error(t("chat.notConnected"));
      return;
    }
    let id: string;
    try {
      id = body
        ? client.sendMessage(
            conversation?.peerJid ?? conversationId,
            body,
            conversation?.type === "group" ? "groupchat" : "chat",
            replyTo
              ? { replyToId: replyTo.id, replyToJid: replyTo.senderJid }
              : undefined
          )
        : crypto.randomUUID();
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
      attachments: pendingFiles.map((f) => ({
        id: f.id,
        fileName: f.name,
        mimeType: f.mimeType,
        downloadUrl: f.downloadUrl,
        sizeBytes: f.sizeBytes,
      })),
    };
    addMessage(outgoingMessage);
    cacheMessages([outgoingMessage]).catch(() => {});
    setInput("");
    clearComposerDraft(conversationId);
    saveDraft(conversationId, "").catch(() => {});
    setReplyTo(null);
    setPendingFiles([]);
    setShowUpload(false);
    setShowEmojiPicker(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, pendingFiles, activeAccountId, conversationId, conversation, addMessage, replyTo, t, clearComposerDraft]);

  const retryFailedMessage = useCallback((message: ChatMessage) => {
    if (!activeAccountId) return;
    const client = getClient(activeAccountId);
    if (!client?.connected) {
      toast.error(t("chat.notConnected"));
      return;
    }
    try {
      const newId = client.sendMessage(
        conversation?.peerJid ?? conversationId,
        message.body,
        conversation?.type === "group" ? "groupchat" : "chat"
      );
      updateMessage(conversationId, message.id, { id: newId, status: "sent", timestamp: Date.now() });
    } catch (error: any) {
      toast.error(error?.message ?? t("chat.sendFailed"));
    }
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
      sendMessage();
    }
  };

  if (!conversation) return <div className="flex items-center justify-center h-full text-surface-200/30 text-sm">{t("chat.notFound")}</div>;

  return (
    <div className="flex flex-col h-full relative">
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2">
        {hasMore && (
          <div className="flex justify-center py-2">
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
        {messages.map((msg, i) => {
          const isOwn = msg.direction === "out";
          const prev = messages[i - 1];
          const showDate = !prev || !isSameDay(msg.timestamp, prev.timestamp);
          return (
            <div
              key={msg.id}
              className="animate-fade-in"
              ref={(node) => { messageNodeRefs.current[msg.id] = node; }}
              data-mid={msg.id}
            >
              {showDate && <DateDivider date={msg.timestamp} todayLabel={t("chat.today")} yesterdayLabel={t("chat.yesterday")} />}
              {msg.direction === "system" ? (
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
                  sentLabel={t("chat.sentSent")}
                  readLabel={t("chat.sentRead")}
                />
              )}
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
            className={clsx("btn-ghost p-2 flex-shrink-0", showUpload && "text-accent")}
            title={t("chat.attachFile")}
          >
            <Paperclip size={16} />
          </button>
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
            placeholder={`${t("chat.messagePlaceholder")} ${conversation.title ?? conversation.peerJid}...`}
            rows={1}
            className="flex-1 bg-surface-900 border border-white/5 rounded-xl px-4 py-2.5 text-sm text-surface-50 placeholder:text-surface-200/25 focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none min-h-[40px] max-h-[120px]"
          />
          <button onClick={sendMessage} disabled={!input.trim() && !pendingFiles.length} className="btn-primary p-2.5 flex-shrink-0 rounded-xl" title={t("chat.send")}>
            <Send size={16} />
          </button>
        </div>
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
    </div>
  );
}
