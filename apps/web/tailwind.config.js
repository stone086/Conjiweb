/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Deep space palette
        surface: {
          50:  "#f0f0f8",
          100: "#e0e0f0",
          200: "#c0c0e0",
          800: "#1a1a2e",
          900: "#0f0f1a",
          950: "#07070e",
        },
        accent: {
          DEFAULT: "#7c6af7",
          soft:    "#a89cf8",
          dim:     "#4a3fba",
        },
        success: "#22c55e",
        warn:    "#f59e0b",
        danger:  "#ef4444",
      },
      fontFamily: {
        sans: ["'DM Sans'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
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
