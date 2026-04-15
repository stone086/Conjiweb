import { useState, useRef, useEffect, useCallback } from "react";
import { useChatStore, ChatMessage } from "@/stores/chatStore";
import { useAccountStore } from "@/stores/accountStore";
import { getClient } from "@/services/xmppAdapter";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { useMAM } from "@/hooks/useMAM";
import { FileUploadZone, UploadedFile, ImagePreview, FileCard } from "@/modules/media/FileUpload";
import { format, isSameDay } from "date-fns";
import { clsx } from "clsx";
import { Send, Paperclip, X, ChevronDown, CornerUpLeft, Loader } from "lucide-react";
import toast from "react-hot-toast";

function DateDivider({ date }: { date: number }) {
  const label = isSameDay(date, Date.now()) ? "Today"
    : isSameDay(date, Date.now() - 86400000) ? "Yesterday"
    : format(date, "MMMM d, yyyy");
  return (
    <div className="flex items-center gap-3 py-2 my-1">
      <div className="flex-1 h-px bg-white/5" />
      <span className="text-[10px] text-surface-200/30 px-2 py-0.5 rounded-full bg-surface-900">{label}</span>
      <div className="flex-1 h-px bg-white/5" />
    </div>
  );
}

function MessageBubble({ msg, isOwn, onReply }: { msg: ChatMessage; isOwn: boolean; onReply: (m: ChatMessage) => void }) {
  const [hovered, setHovered] = useState(false);
  return (
    <div className={clsx("flex gap-2 group", isOwn ? "flex-row-reverse" : "flex-row")}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      {!isOwn && (
        <div className="w-7 h-7 rounded-full bg-surface-800 flex items-center justify-center text-[11px] font-medium uppercase flex-shrink-0 mt-auto mb-1 text-surface-200">
          {msg.senderJid[0]}
        </div>
      )}
      <div className={clsx("flex flex-col gap-1 max-w-[70%]", isOwn ? "items-end" : "items-start")}>
        {!isOwn && <span className="text-[10px] text-surface-200/40 px-1">{msg.senderJid.split("@")[0]}</span>}
        <div className={isOwn ? "msg-bubble-out" : "msg-bubble-in"}>
          {msg.body && <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>}
          {msg.attachments?.map((att) => (
            <div key={att.id} className="mt-2">
              {att.mimeType.startsWith("image/")
                ? <ImagePreview src={att.downloadUrl} alt={att.fileName} />
                : <FileCard name={att.fileName} mimeType={att.mimeType} sizeBytes={att.sizeBytes} downloadUrl={att.downloadUrl} />}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2 px-1">
          <span className="text-[10px] text-surface-200/25">{format(msg.timestamp, "HH:mm")}</span>
          {isOwn && <span className="text-[10px] text-surface-200/25">{msg.status === "read" ? "✓✓" : "✓"}</span>}
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
        {[0,1,2].map((i) => <span key={i} className="w-1.5 h-1.5 rounded-full bg-surface-200/40 animate-bounce" style={{animationDelay:`${i*0.15}s`}} />)}
      </div>
    </div>
  );
}

function ReplyPreview({ msg, onCancel }: { msg: ChatMessage; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-t border-white/5 bg-surface-900/30">
      <div className="w-0.5 h-8 bg-accent rounded-full flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-[10px] text-accent-soft font-medium">Replying to {msg.senderJid.split("@")[0]}</p>
        <p className="text-xs text-surface-200/50 truncate">{msg.body}</p>
      </div>
      <button onClick={onCancel} className="text-surface-200/30 hover:text-surface-200 p-1"><X size={12} /></button>
    </div>
  );
}

export default function MessageView({ conversationId }: { conversationId: string }) {
  const [input, setInput] = useState("");
  const [showUpload, setShowUpload] = useState(false);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [pendingFiles, setPendingFiles] = useState<UploadedFile[]>([]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const conversation = useChatStore((s) => s.conversations[conversationId]);
  const messages = useChatStore((s) => s.messages[conversationId] ?? []);
  const addMessage = useChatStore((s) => s.addMessage);
  const { peerIsTyping, onInputChange, onBlur } = useTypingIndicator(conversation?.peerJid ?? "");
  const { fetchHistory, loading: mamLoading, hasMore } = useMAM(conversation?.peerJid ?? "", conversationId);

  useEffect(() => { if (conversation && messages.length === 0) fetchHistory(); }, [conversationId]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    if (c.scrollHeight - c.scrollTop - c.clientHeight < 200) messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, peerIsTyping]);

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
    if (!client?.connected) { toast.error("Not connected"); return; }
    const id = body ? client.sendMessage(conversation?.peerJid ?? conversationId, body, conversation?.type === "group" ? "groupchat" : "chat") : crypto.randomUUID();
    addMessage({
      id, conversationId, senderJid: client.config.jid, body,
      bodyType: "text", direction: "out", status: "sent", timestamp: Date.now(),
      replyToId: replyTo?.id,
      attachments: pendingFiles.map((f) => ({ id: f.id, fileName: f.name, mimeType: f.mimeType, downloadUrl: f.downloadUrl, sizeBytes: f.sizeBytes })),
    });
    setInput(""); setReplyTo(null); setPendingFiles([]); setShowUpload(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  }, [input, pendingFiles, activeAccountId, conversationId, conversation, addMessage, replyTo]);

  const handleKeyDown = (e: React.KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };

  if (!conversation) return <div className="flex items-center justify-center h-full text-surface-200/30 text-sm">Conversation not found</div>;

  return (
    <div className="flex flex-col h-full relative">
      <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-4 py-4 flex flex-col gap-2">
        {hasMore && (
          <div className="flex justify-center py-2">
            <button onClick={fetchHistory} disabled={mamLoading}
              className="text-xs text-surface-200/40 hover:text-surface-200 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-900 hover:bg-surface-800 transition-colors">
              {mamLoading && <Loader size={11} className="animate-spin" />}
              {mamLoading ? "Loading..." : "Load older messages"}
            </button>
          </div>
        )}
        {messages.length === 0 && !mamLoading && (
          <div className="flex flex-col items-center justify-center flex-1 gap-2 text-surface-200/25">
            <p className="text-sm">No messages yet. Say hello!</p>
          </div>
        )}
        {messages.map((msg, i) => {
          const isOwn = msg.direction === "out";
          const prev = messages[i - 1];
          const showDate = !prev || !isSameDay(msg.timestamp, prev.timestamp);
          return (
            <div key={msg.id} className="animate-fade-in">
              {showDate && <DateDivider date={msg.timestamp} />}
              {msg.direction === "system"
                ? <div className="msg-bubble-system">{msg.body}</div>
                : <MessageBubble msg={msg} isOwn={isOwn} onReply={setReplyTo} />}
            </div>
          );
        })}
        {peerIsTyping && <TypingBubble name={conversation.peerJid.split("@")[0]} />}
        <div ref={messagesEndRef} />
      </div>

      {showScrollBtn && (
        <button onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })}
          className="absolute bottom-24 right-4 w-8 h-8 rounded-full bg-surface-800 border border-white/10 flex items-center justify-center text-surface-200/70 hover:text-surface-50 shadow-lg z-10">
          <ChevronDown size={14} />
        </button>
      )}

      {showUpload && (
        <div className="px-4 py-3 border-t border-white/5 bg-surface-900/30">
          <FileUploadZone onUploaded={(f) => setPendingFiles((p) => [...p, f])} onCancel={() => setShowUpload(false)} />
        </div>
      )}

      {pendingFiles.length > 0 && !showUpload && (
        <div className="px-4 py-2 border-t border-white/5 flex gap-2 flex-wrap">
          {pendingFiles.map((f) => (
            <div key={f.id} className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-surface-800 text-xs text-surface-200/70 border border-white/5">
              <span className="truncate max-w-[100px]">{f.name}</span>
              <button onClick={() => setPendingFiles((p) => p.filter((x) => x.id !== f.id))} className="text-surface-200/30 hover:text-danger"><X size={10} /></button>
            </div>
          ))}
        </div>
      )}

      {replyTo && <ReplyPreview msg={replyTo} onCancel={() => setReplyTo(null)} />}

      <div className="border-t border-white/5 bg-surface-950/60 px-4 py-3 flex-shrink-0">
        <div className="flex items-end gap-2">
          <button onClick={() => setShowUpload(!showUpload)} className={clsx("btn-ghost p-2 flex-shrink-0", showUpload && "text-accent")} title="Attach file">
            <Paperclip size={16} />
          </button>
          <textarea ref={textareaRef} value={input}
            onChange={(e) => { setInput(e.target.value); onInputChange(); const t = e.target; t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; }}
            onKeyDown={handleKeyDown} onBlur={onBlur}
            placeholder={`Message ${conversation.title ?? conversation.peerJid}…`}
            rows={1} className="flex-1 bg-surface-900 border border-white/5 rounded-xl px-4 py-2.5 text-sm text-surface-50 placeholder:text-surface-200/25 focus:outline-none focus:ring-1 focus:ring-accent/40 resize-none min-h-[40px] max-h-[120px]" />
          <button onClick={sendMessage} disabled={!input.trim() && !pendingFiles.length} className="btn-primary p-2.5 flex-shrink-0 rounded-xl" title="Send">
            <Send size={16} />
          </button>
        </div>
        <p className="text-[10px] text-surface-200/20 mt-1 pl-1">Enter to send · Shift+Enter new line</p>
      </div>
    </div>
  );
}
