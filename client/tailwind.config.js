/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./pages/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        parchment: "#f5e6c8",
        "parchment-dim": "#b8a88a",
        leather: "#8b4513",
        "leather-light": "#a0522d",
        brass: "#c9a84c",
        "brass-dim": "#a08530",
        desert: "#1a1008",
        "desert-light": "#2d1b08",
        "desert-border": "#3d2b18",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "monospace"],
        display: ["var(--font-rye)", "cursive"],
      },
    },
  },
  plugins: [],
};
