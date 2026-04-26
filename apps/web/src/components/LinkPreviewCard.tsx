/**
 * LinkPreviewCard.tsx - Renders an Open Graph card for a URL.
 *
 * Used inline in chat bubbles whenever a message contains a URL.
 * The preview is fetched lazily once and cached in memory + IndexedDB.
 */
import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";

interface LinkPreview {
  url: string;
  title?: string;
  description?: string;
  image?: string;
  site_name?: string;
  favicon?: string;
}

const cache = new Map<string, LinkPreview | null>();

export default function LinkPreviewCard({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreview | null | "loading">(
    cache.has(url) ? cache.get(url)! : "loading"
  );

  useEffect(() => {
    if (cache.has(url)) {
      setPreview(cache.get(url) ?? null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const resp = await fetch(`/preview?url=${encodeURIComponent(url)}`);
        if (!resp.ok) {
          if (!cancelled) {
            cache.set(url, null);
            setPreview(null);
          }
          return;
        }
        const data: LinkPreview = await resp.json();
        if (!cancelled) {
          cache.set(url, data);
          setPreview(data);
        }
      } catch {
        if (!cancelled) {
          cache.set(url, null);
          setPreview(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [url]);

  if (preview === "loading") {
    return (
      <div className="mt-2 px-3 py-2 rounded-lg border border-white/5 bg-black/20 text-xs text-surface-200/40">
        Loading preview...
      </div>
    );
  }
  if (!preview || (!preview.title && !preview.description && !preview.image)) {
    return null;
  }

  return (
    <a
      href={preview.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 flex flex-col rounded-lg border border-white/5 overflow-hidden hover:bg-white/5 transition-colors"
    >
      {preview.image && (
        <img
          src={preview.image}
          alt=""
          loading="lazy"
          className="w-full max-h-48 object-cover"
          onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
        />
      )}
      <div className="px-3 py-2 flex flex-col gap-1">
        {preview.site_name && (
          <p className="text-[10px] text-surface-200/50 uppercase tracking-wider flex items-center gap-1">
            {preview.favicon && (
              <img
                src={preview.favicon}
                alt=""
                className="w-3 h-3"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            {preview.site_name}
            <ExternalLink size={9} className="ml-auto" />
          </p>
        )}
        {preview.title && (
          <p className="text-sm font-medium text-surface-50 line-clamp-2">{preview.title}</p>
        )}
        {preview.description && (
          <p className="text-xs text-surface-200/60 line-clamp-2">{preview.description}</p>
        )}
      </div>
    </a>
  );
}

/**
 * Extracts the first http(s) URL from a string. Returns null if none.
 */
export function extractFirstUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"]+/);
  return m ? m[0] : null;
}
