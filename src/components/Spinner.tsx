"use client";

import { useEffect } from "react";

/**
 * Brand loader — a breathing 3×3 grid of dots. Same visual is used
 * everywhere in the app: inline inside buttons, in card / tab panels,
 * and on the full-page route loaders (via PageLoader). The grid scales
 * with `size` so a tiny 12-px button indicator and an 84-px hero loader
 * are visibly the same component.
 *
 *   <Spinner />                          — bare 16-px indicator.
 *   <Spinner size={48} />                — medium panel loader.
 *   <Spinner size={84} label="Loading…"/>— big with text on the right.
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
      @keyframes mt-loader-grid {
        0%, 100% { transform: scale(0.6); opacity: 0.4; }
        50%      { transform: scale(1);   opacity: 1;   }
      }
    `;
    document.head.appendChild(el);
  }, []);

  // The reference grid is 16-px dots with 9-px gap. We scale both
  // proportionally so the same component reads cleanly at 12 px and at
  // 200 px without changing layout.
  const dot = Math.max(3, Math.round(size / 3.2));
  const gap = Math.max(2, Math.round(size / 5.5));
  const radius = Math.max(1, Math.round(dot / 3));

  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 text-magic-ink/70 ${className}`}
    >
      <span
        aria-hidden="true"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(3, ${dot}px)`,
          gap: `${gap}px`,
          flexShrink: 0,
        }}
      >
        {Array.from({ length: 9 }).map((_, i) => {
          const row = Math.floor(i / 3);
          const col = i % 3;
          return (
            <span
              key={i}
              style={{
                width: dot,
                height: dot,
                borderRadius: radius,
                background: "#EF476F",
                animation: "mt-loader-grid 1.3s ease-in-out infinite",
                animationDelay: `${(row + col) * 0.1}s`,
              }}
            />
          );
        })}
      </span>
      {label && (
        <span className="text-xs font-medium text-magic-ink/70">{label}</span>
      )}
    </span>
  );
}
