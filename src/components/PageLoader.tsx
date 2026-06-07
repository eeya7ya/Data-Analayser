"use client";

import { useEffect } from "react";

/**
 * Hero-screen loader. Renders the same breathing 3×3 grid of dots as
 * <Spinner /> but at full hero size with the message stacked below.
 * Used by every `loading.tsx` route skeleton and any full-card /
 * full-tab "still fetching" state.
 *
 *   <PageLoader />                              — defaults (16-px dots).
 *   <PageLoader label="Building your deal…" />  — custom message.
 *   <PageLoader fullScreen />                   — pads the loader to the
 *                                                 viewport for a top-of-
 *                                                 the-tree route loader.
 */
export default function PageLoader({
  label = "Hang tight, almost there…",
  fullScreen = false,
  className = "",
}: {
  label?: string;
  fullScreen?: boolean;
  className?: string;
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

  const wrapperClass = fullScreen
    ? `flex min-h-[60vh] w-full flex-col items-center justify-center gap-7 ${className}`
    : `flex w-full flex-col items-center justify-center gap-6 py-10 ${className}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={wrapperClass}
      style={{
        fontFamily: "'Quicksand', ui-rounded, 'Segoe UI', sans-serif",
        background: "transparent",
      }}
    >
      <div
        aria-hidden="true"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 16px)",
          gap: 9,
        }}
      >
        {Array.from({ length: 9 }).map((_, i) => {
          const row = Math.floor(i / 3);
          const col = i % 3;
          return (
            <span
              key={i}
              style={{
                width: 16,
                height: 16,
                borderRadius: 5,
                background: "#EF476F",
                animation: "mt-loader-grid 1.3s ease-in-out infinite",
                animationDelay: `${(row + col) * 0.1}s`,
              }}
            />
          );
        })}
      </div>
      <p
        style={{
          margin: 0,
          fontSize: "1.18rem",
          fontWeight: 600,
          color: "#9E1B45",
          textAlign: "center",
        }}
      >
        {label}
      </p>
    </div>
  );
}
