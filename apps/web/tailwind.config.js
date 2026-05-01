/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        bg: "#f7f7f8",
        surface: {
          50:  "rgb(var(--surface-50) / <alpha-value>)",
          100: "rgb(var(--surface-100) / <alpha-value>)",
          200: "rgb(var(--surface-200) / <alpha-value>)",
          800: "rgb(var(--surface-800) / <alpha-value>)",
          900: "rgb(var(--surface-900) / <alpha-value>)",
          950: "rgb(var(--surface-950) / <alpha-value>)",
          hover: "#ececf0",
          active: "#e5e5ec",
          2: "#f3f3f5",
        },
        border: {
          DEFAULT: "#e3e3e8",
          strong: "#c8c8d0",
        },
        text: {
          DEFAULT: "#15161c",
          2: "#43434d",
          3: "#6b6b76",
          4: "#9999a3",
        },
        accent: {
          DEFAULT: "rgb(var(--accent) / <alpha-value>)",
          soft:    "rgb(var(--accent-soft) / <alpha-value>)",
          dim:     "rgb(var(--accent-dim) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "#5a3dd0",
          hover: "#4a31b8",
          tint: "#f6f4fd",
          soft: "#ece8fb",
        },
        bubble: { me: "#1c1d24" },
        success: "rgb(var(--success) / <alpha-value>)",
        warn:    "rgb(var(--warn) / <alpha-value>)",
        danger:  "rgb(var(--danger) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Inter", "-apple-system", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: {
        xs: "5px",
        sm: "7px",
        md: "9px",
        lg: "12px",
        xl: "14px",
      },
      boxShadow: {
        1: "0 1px 0 rgba(0,0,0,0.04)",
        2: "0 1px 2px rgba(0,0,0,0.05), 0 2px 8px rgba(0,0,0,0.03)",
        pop: "0 4px 16px rgba(0,0,0,0.06), 0 1px 0 rgba(0,0,0,0.04)",
      },
      animation: {
        "slide-in":   "slideIn 0.2s ease-out",
        "fade-in":    "fadeIn 0.15s ease-out",
        "pulse-soft": "pulseSoft 2s infinite",
      },
      keyframes: {
        slideIn:    { from: { transform: "translateX(-8px)", opacity: 0 }, to: { transform: "translateX(0)", opacity: 1 } },
        fadeIn:     { from: { opacity: 0 }, to: { opacity: 1 } },
        pulseSoft:  { "0%,100%": { opacity: 1 }, "50%": { opacity: 0.5 } },
      },
    },
  },
  plugins: [],
};
