"use client";

import { useEffect } from "react";

/**
 * Inline brand loader — drops into existing call sites in place of the
 * original spin-ring SVG. The visual is a small soft-morphing red blob
 * paired with an optional label on the right, so layouts that placed
 * the spinner next to a heading or skeleton bar still flow horizontally.
 *
 * For full-screen / hero loading states use <PageLoader /> instead.
 *
 *   <Spinner />                          — bare 16-px indicator.
 *   <Spinner size={20} label="Loading…"/>— with text on the right.
 */
export default function Spinner({
  size = 16,
  className = "",
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById("mt-loader-styles")) return;
    const el = document.createElement("style");
    el.id = "mt-loader-styles";
    el.textContent = `
      @keyframes mt-loader-morph {
        0%, 100% { border-radius: 42% 58% 63% 37% / 41% 44% 56% 59%; }
        50%      { border-radius: 67% 33% 38% 62% / 60% 63% 37% 40%; }
      }
      @keyframes mt-loader-spin { to { transform: rotate(360deg); } }
      @keyframes mt-loader-pulse {
        0%, 100% { opacity: 0.85; transform: scale(1); }
        50%      { opacity: 1;    transform: scale(1.04); }
      }
    `;
    document.head.appendChild(el);
  }, []);

  const glow = Math.max(2, Math.round(size * 0.18));
  const blobStyle: React.CSSProperties = {
    width: size,
    height: size,
    background:
      "linear-gradient(135deg, #FF4E4E 0%, #E2231A 55%, #9E1B45 100%)",
    boxShadow: `0 ${glow}px ${glow * 2}px rgba(226, 35, 26, 0.30)`,
    animation:
      "mt-loader-morph 4s ease-in-out infinite, mt-loader-spin 9s linear infinite, mt-loader-pulse 3s ease-in-out infinite",
    flexShrink: 0,
  };

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 text-magic-ink/70 ${className}`}
    >
      <span aria-hidden="true" style={blobStyle} />
      {label && (
        <span className="text-xs font-medium text-magic-ink/70">{label}</span>
      )}
    </span>
  );
}
