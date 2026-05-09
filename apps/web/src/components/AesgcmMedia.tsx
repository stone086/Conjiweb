/**
 * AesgcmMedia.tsx — Render an aesgcm:// URL as inline audio/image/file.
 *
 * On mount: fetches the encrypted blob, decrypts via WebCrypto, exposes a blob: URL.
 * On unmount: revokes the blob URL.
 * On error: shows a fallback "encrypted attachment" link.
 */
import { useEffect, useState } from "react";
import { Loader2, AlertCircle, Download } from "lucide-react";
import { fetchAndDecryptAesgcm, revokeAesgcmBlobUrl } from "@/services/aesgcmMedia";
import { useAccountStore } from "@/stores/accountStore";
import { safeHref } from "@/utils/urlSafety";
import { useLanguage } from "@/utils/i18n";

interface AesgcmMediaProps {
  /** The full aesgcm:// URL including the #hex fragment */
  url: string;
  /** Best-guess filename (used to pick image/audio/video/file rendering) */
  fileName: string;
  /** Optional plain HTTPS URL of the same resource — shown as a fallback link */
  plainHref?: string;
}

type Status =
  | { kind: "loading" }
  | { kind: "ready"; blobUrl: string }
  | { kind: "error"; message: string };

function pickKind(name: string): "image" | "audio" | "video" | "file" {
  const lower = name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|heic|heif|bmp)$/.test(lower)) return "image";
  if (/\.(m4a|mp3|ogg|oga|opus|wav|webm)$/.test(lower)) return "audio";
  if (/\.(mp4|mov|webm|mkv)$/.test(lower)) return "video";
  return "file";
}

export default function AesgcmMedia({ url, fileName, plainHref }: AesgcmMediaProps) {
  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const activeAccountId = useAccountStore((s) => s.activeAccountId);
  const { t } = useLanguage();

  useEffect(() => {
    let cancelled = false;
    const ctrl = new AbortController();

    fetchAndDecryptAesgcm(url, { signal: ctrl.signal, accountId: activeAccountId })
      .then((blobUrl) => {
        if (!cancelled) setStatus({ kind: "ready", blobUrl });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        setStatus({ kind: "error", message });
      });

    return () => {
      cancelled = true;
      ctrl.abort();
      // Note: don't revoke the cached URL here — other messages may share it.
      // The cache lives until logout / page unload, or explicit cleanup.
    };
  }, [url]);

  const kind = pickKind(fileName);

  if (status.kind === "loading") {
    return (
      <div className="flex items-center gap-2 text-xs text-surface-200/70 py-2">
        <Loader2 size={14} className="animate-spin" />
        <span>{t("media.decrypting", { fileName })}</span>
      </div>
    );
  }

  if (status.kind === "error") {
    return (
      <div className="flex flex-col gap-1 py-1">
        <div className="flex items-center gap-2 text-xs text-warn">
          <AlertCircle size={14} />
          <span>{t("media.decryptFailed", { message: status.message })}</span>
        </div>
        {plainHref && safeHref(plainHref) && (
          <a
            href={safeHref(plainHref)!}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[11px] text-accent-soft underline break-all"
          >
            <Download size={10} className="inline -mt-0.5 mr-1" />
            {t("media.rawFile", { fileName })}
          </a>
        )}
      </div>
    );
  }

  // Ready — render media inline
  if (kind === "image") {
    return (
      <a href={status.blobUrl} target="_blank" rel="noopener noreferrer" className="block max-w-xs">
        <img
          src={status.blobUrl}
          alt={fileName}
          className="rounded-lg max-w-full max-h-64 object-contain"
          loading="lazy"
        />
      </a>
    );
  }

  if (kind === "audio") {
    return (
      <audio
        src={status.blobUrl}
        controls
        preload="metadata"
        className="max-w-full"
      >
        {t("media.audioUnsupported")}
      </audio>
    );
  }

  if (kind === "video") {
    return (
      <video
        src={status.blobUrl}
        controls
        preload="metadata"
        className="rounded-lg max-w-full max-h-64"
      >
        {t("media.videoUnsupported")}
      </video>
    );
  }

  // Generic file — download link
  return (
    <a
      href={status.blobUrl}
      download={fileName}
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-surface-800 text-sm text-accent-soft hover:bg-surface-800/80 transition-colors"
    >
      <Download size={14} />
      {fileName}
    </a>
  );
}
