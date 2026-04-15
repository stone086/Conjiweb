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

// Generate a deterministic pastel color from name
function colorFromName(name: string): string {
  const colors = [
    "bg-violet-700", "bg-blue-700", "bg-cyan-700",
    "bg-teal-700",   "bg-green-700", "bg-amber-700",
    "bg-rose-700",   "bg-pink-700",  "bg-indigo-700",
  ];
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff;
  return colors[Math.abs(hash) % colors.length];
}

export default function Avatar({ src, name, size = "md", presence, className }: AvatarProps) {
  const [imgError, setImgError] = useState(false);
  const showImg = src && !imgError;
  const initials = getInitials(name);
  const bg = colorFromName(name);

  return (
    <div className={clsx("relative flex-shrink-0", className)}>
      <div className={clsx(
        SIZES[size],
        "rounded-full flex items-center justify-center font-semibold text-white overflow-hidden",
        showImg ? "" : bg,
      )}>
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
