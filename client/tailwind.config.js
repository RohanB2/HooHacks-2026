/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./pages/**/*.{js,jsx}", "./components/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        "wrangler-amber": "#D4A017",
        "uva-blue": "#232D4B",
        "dark-bg": "#1a1a1a",
        "dark-card": "#2a2a2a",
        "dark-input": "#333333",
      },
      fontFamily: {
        serif: ["Georgia", "Times New Roman", "serif"],
      },
    },
  },
  plugins: [],
};
