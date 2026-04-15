import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        magic: {
          // Brand primary (kept identical so existing print styles / PDFs
          // render the exact same red). Everything else moved to a warmer,
          // more modern palette with a secondary accent & deeper ink.
          red: "#E2231A",
          ink: "#111827",
          soft: "#F5F6FB",
          border: "#E4E7F1",
          header: "#EEF1FA",
          highlight: "#FFF200",
          accent: "#6366F1", // indigo — secondary accent for gradients
          accent2: "#06B6D4", // cyan — tertiary accent
          surface: "#FFFFFFcc", // translucent surface used for glass cards
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "mt-canvas":
          "radial-gradient(1200px 600px at 10% -10%, rgba(226,35,26,0.10), transparent 60%), radial-gradient(900px 500px at 100% 10%, rgba(99,102,241,0.10), transparent 60%), radial-gradient(800px 500px at 50% 110%, rgba(6,182,212,0.08), transparent 60%), linear-gradient(180deg, #F8FAFF 0%, #F3F5FB 100%)",
        "mt-glow":
          "linear-gradient(135deg, rgba(226,35,26,0.9) 0%, rgba(255,77,68,0.9) 50%, rgba(99,102,241,0.9) 100%)",
      },
      boxShadow: {
        "mt-soft":
          "0 1px 2px rgba(17,24,39,0.04), 0 8px 24px -12px rgba(17,24,39,0.12)",
        "mt-lift":
          "0 4px 12px rgba(17,24,39,0.06), 0 24px 60px -20px rgba(99,102,241,0.25)",
      },
      keyframes: {
        "mt-float": {
          "0%,100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-6px)" },
        },
        "mt-pulse-soft": {
          "0%,100%": { opacity: "0.7" },
          "50%": { opacity: "1" },
        },
      },
      animation: {
        "mt-float": "mt-float 6s ease-in-out infinite",
        "mt-pulse-soft": "mt-pulse-soft 3s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
