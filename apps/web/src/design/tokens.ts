// conjiweb-tokens.ts
// TypeScript mirror of the Slate Pro design tokens.
// Use these in styled-components / inline styles / Tailwind theme extension.
// Keep in sync with conjiweb-tokens.css — that is the source of truth.

export const colors = {
  // Surfaces
  bg:             "#f7f7f8",
  surface:        "#ffffff",
  surface2:       "#f3f3f5",
  surfaceHover:   "#ececf0",
  surfaceActive:  "#e5e5ec",

  // Borders
  border:         "#e3e3e8",
  borderStrong:   "#c8c8d0",

  // Text
  text:           "#15161c",
  text2:          "#43434d",
  text3:          "#6b6b76",
  text4:          "#9999a3",

  // Accent
  primary:        "#5a3dd0",
  primaryHover:   "#4a31b8",
  primaryTint:    "#f6f4fd",
  primarySoft:    "#ece8fb",

  // Semantic
  success:        "#0f9d68",
  danger:         "#d44c3a",
  dangerSoft:     "#fdecea",
  warning:        "#c97e2b",

  // Avatar palette (consistent-color buckets per XEP-0392)
  avatar: {
    emerald: "#0f9d68",
    violet:  "#7c5ce4",
    amber:   "#b9762b",
    lime:    "#79a134",
    rose:    "#d04e7b",
    sky:     "#2f7fc7",
  },

  // Bubble specifics
  bubbleMeBg:        "#1c1d24",
  bubbleMeFg:        "#ffffff",
  bubbleThemBg:      "#ffffff",
  bubbleThemFg:      "#15161c",
  bubbleThemBorder:  "#e3e3e8",
} as const;

export const radii = {
  xs:   5,
  sm:   7,
  md:   9,
  lg:   12,
  xl:   14,
  pill: 9999,
} as const;

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
} as const;

export const shadows = {
  s1:    "0 1px 0 rgba(0, 0, 0, 0.04)",
  s2:    "0 1px 2px rgba(0, 0, 0, 0.05), 0 2px 8px rgba(0, 0, 0, 0.03)",
  pop:   "0 4px 16px rgba(0, 0, 0, 0.06), 0 1px 0 rgba(0, 0, 0, 0.04)",
  ring:  "0 0 0 3px #f6f4fd",
} as const;

export const typography = {
  fontSans: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
  fontMono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',

  fs: {
    xs:   "10.5px",
    sm:   "11.5px",
    md:   "12.5px",
    base: "13.5px",
    lg:   "14px",
  },

  fw: {
    regular:  450,   // Slate Pro body weight
    medium:   500,
    semibold: 600,
    bold:     700,
  },

  letter: {
    tight: "-0.01em",
    snug:  "-0.005em",
  },
} as const;

export const tokens = { colors, radii, space, shadows, typography } as const;
export default tokens;
