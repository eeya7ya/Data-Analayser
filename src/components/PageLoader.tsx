"use client";

import { useEffect } from "react";

/**
 * Hero-screen brand loader. Designed for `loading.tsx` skeletons and
 * full-card / full-tab empty states where the user is waiting for the
 * page to come up.
 *
 * The visual is a soft morphing red blob, optionally wrapped in a halo
 * ring, with the message stacked below — same animation system as
 * <Spinner /> but big and centered.
 *
 *   <PageLoader />                              — defaults (84-px blob).
 *   <PageLoader label="Building your deal…" />  — custom message.
 *   <PageLoader fullScreen />                   — pads the loader to the
 *                                                 viewport for a top-of-
 *                                                 the-tree route loader.
 */
export default function PageLoader({
  size = 84,
  label = "Hang tight, almost there…",
  fullScreen = false,
  className = "",
}: {
  size?: number;
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
      @keyframes mt-loader-morph {
        0%, 100% { border-radius: 42% 58% 63% 37% / 41% 44% 56% 59%; }
        50%      { border-radius: 67% 33% 38% 62% / 60% 63% 37% 40%; }
      }
      @keyframes mt-loader-spin { to { transform: rotate(360deg); } }
      @keyframes mt-loader-pulse {
        0%, 100% { opacity: 0.85; transform: scale(1); }
        50%      { opacity: 1;    transform: scale(1.04); }
      }
      @keyframes mt-loader-halo {
        0%, 100% { opacity: 0.45; transform: scale(1); }
        50%      { opacity: 0.20; transform: scale(1.18); }
      }
    `;
    document.head.appendChild(el);
  }, []);

  const haloSize = Math.round(size * 1.35);
  const wrapperClass = fullScreen
    ? `flex min-h-[60vh] w-full flex-col items-center justify-center gap-7 ${className}`
    : `flex w-full flex-col items-center justify-center gap-6 py-10 ${className}`;

  const blobStyle: React.CSSProperties = {
    width: size,
    height: size,
    background:
      "linear-gradient(135deg, #FF6B6B 0%, #E2231A 55%, #9E1B45 100%)",
    boxShadow: "0 18px 40px rgba(226, 35, 26, 0.35)",
    animation:
      "mt-loader-morph 4s ease-in-out infinite, mt-loader-spin 9s linear infinite, mt-loader-pulse 3s ease-in-out infinite",
  };
  const haloStyle: React.CSSProperties = {
    width: haloSize,
    height: haloSize,
    border: "2px solid rgba(226, 35, 26, 0.35)",
    borderRadius: "9999px",
    animation: "mt-loader-halo 3.4s ease-in-out infinite",
  };

  return (
    <div role="status" aria-live="polite" className={wrapperClass}>
      <div className="relative flex items-center justify-center">
        <span aria-hidden="true" className="absolute" style={haloStyle} />
        <span aria-hidden="true" style={blobStyle} />
      </div>
      <p className="m-0 text-center text-sm font-semibold tracking-wide text-magic-ink/75">
        {label}
      </p>
    </div>
  );
}
