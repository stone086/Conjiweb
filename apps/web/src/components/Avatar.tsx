import { useState } from "react";
import { clsx } from "clsx";

interface AvatarProps {
  src?: string;
  name: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  presence?: "available" | "away" | "dnd" | "xa" | "unavailable";
  className?: string;
}

const SIZES = {
  xs: "w-6 h-6 text-[9px]",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-12 h-12 text-base",
  xl: "w-16 h-16 text-xl",
};

const SIZE_PX: Record<NonNullable<AvatarProps["size"]>, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
};

const PRESENCE_COLORS = {
  available:   "bg-green-400",
  away:        "bg-yellow-400",
  dnd:         "bg-red-400",
  xa:          "bg-orange-400",
  unavailable: "bg-surface-200/30",
};

const DOT_SIZES = {
  xs: "w-1.5 h-1.5",
  sm: "w-2 h-2",
  md: "w-2.5 h-2.5",
  lg: "w-3 h-3",
  xl: "w-3.5 h-3.5",
};

function getInitials(name: string): string {
  return name
    .split(/[\s@]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function colorFromName(name: string): string {
  const id = name.split("/")[0].toLowerCase();
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  const buckets = ["#0f9d68", "#7c5ce4", "#b9762b", "#79a134", "#d04e7b", "#2f7fc7"];
  return buckets[hash % buckets.length];
}

export default function Avatar({ src, name, size = "md", presence, className }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const showImg = src && !imgError;
  const initials = getInitials(name);
  const bg = colorFromName(name);
  const px = SIZE_PX[size];
  const initialFontSize = Math.round(px * 0.4);

  return (
    <div className={clsx("relative flex-shrink-0", className)}>
      <div
        className={clsx(
          SIZES[size],
          "rounded-full flex items-center justify-center font-semibold text-white overflow-hidden",
        )}
        style={showImg ? undefined : { backgroundColor: bg, fontSize: `${initialFontSize}px`, fontWeight: 600 }}
      >
        {showImg ? (
          <img
            src={src}
            alt={name}
            className="w-full h-full object-cover"
            onError={() => setImgError(true)}
          />
        ) : (
          initials || "?"
        )}
      </div>

      {presence && (
        <span className={clsx(
          "absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-surface-900",
          DOT_SIZES[size],
          PRESENCE_COLORS[presence],
        )} />
      )}
    </div>
  );
}
