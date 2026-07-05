import type { CSSProperties } from "react";

/**
 * Sign-in backdrop — a premium, animated "aurora" canvas.
 *
 * The backdrop is composed from small, independent layers — a deep base
 * gradient, a few slowly drifting colour orbs, a fine mesh, a readability
 * vignette and a top sheen — instead of a wall of inline divs on the page.
 * Each layer is a tiny presentational component you can reuse, reorder,
 * drop, or retune via props, so changing the look is a one-line edit.
 *
 * It stays a pure-CSS **server** component (ships zero JavaScript): the
 * orb animation is driven by keyframes rendered inline once, and it backs
 * off automatically for `prefers-reduced-motion` users.
 */

/** Brand hues shared by the orbs (red primary, indigo + cyan accents). */
const BRAND_RED = "226, 35, 26";
const BRAND_INDIGO = "99, 102, 241";
const BRAND_CYAN = "6, 182, 212";

/** Full-bleed, non-interactive layer wrapper shared by every piece. */
function Layer({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-0 ${className}`}
      style={style}
    />
  );
}

/** Deep, near-black brand gradient that fills the canvas. */
export function BaseGradient() {
  return (
    <Layer
      style={{
        background:
          "radial-gradient(140% 120% at 50% -20%, #16203a 0%, #0b1020 48%, #06080f 100%)",
      }}
    />
  );
}

/**
 * A soft, blurred colour orb that drifts. Position/size/colour are props so
 * you can scatter a few for depth; `delay` desyncs their motion.
 */
function Orb({
  color,
  className = "",
  style,
  animation,
}: {
  color: string;
  className?: string;
  style?: CSSProperties;
  animation?: string;
}) {
  return (
    <div
      aria-hidden
      className={`login-orb pointer-events-none absolute rounded-full ${className}`}
      style={{
        background: `radial-gradient(circle at 30% 30%, rgba(${color}, 0.55), rgba(${color}, 0) 70%)`,
        filter: "blur(60px)",
        animation,
        ...style,
      }}
    />
  );
}

/** Faint masked mesh for a subtle "engineered" texture. */
export function MeshOverlay({ cell = 46 }: { cell?: number }) {
  return (
    <Layer
      className="opacity-[0.05]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
        backgroundSize: `${cell}px ${cell}px`,
        maskImage:
          "radial-gradient(ellipse 80% 60% at 50% 40%, black 0%, transparent 75%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 80% 60% at 50% 40%, black 0%, transparent 75%)",
      }}
    />
  );
}

/** Top-to-bottom tint so foreground type stays readable over the orbs. */
export function Vignette() {
  return (
    <Layer
      style={{
        background:
          "radial-gradient(120% 90% at 50% 0%, transparent 40%, rgba(6,8,15,0.55) 100%)",
      }}
    />
  );
}

/** A thin light sheen along the very top edge — reads as premium glass. */
export function TopSheen() {
  return (
    <Layer className="h-40 bg-gradient-to-b from-white/[0.06] to-transparent [inset:0_0_auto_0]" />
  );
}

/**
 * Compose the default sign-in background. Swap or add <Orb/> layers to
 * retune the look; nothing on the page has to change.
 */
export default function LoginBackground() {
  return (
    <>
      {/* Keyframes rendered inline so the drift is live on first paint (no
          client JS) and disabled for reduced-motion users. */}
      <style>{`
        @keyframes login-orb-a {
          0%,100% { transform: translate3d(0,0,0) scale(1); }
          50%     { transform: translate3d(6%, 5%, 0) scale(1.12); }
        }
        @keyframes login-orb-b {
          0%,100% { transform: translate3d(0,0,0) scale(1.05); }
          50%     { transform: translate3d(-7%, -4%, 0) scale(0.92); }
        }
        @keyframes login-orb-c {
          0%,100% { transform: translate3d(0,0,0) scale(1); }
          50%     { transform: translate3d(4%, -6%, 0) scale(1.1); }
        }
        @media (prefers-reduced-motion: reduce) {
          .login-orb { animation: none !important; }
        }
      `}</style>

      <BaseGradient />

      {/* Drifting brand orbs — the star of the show. */}
      <Orb
        color={BRAND_RED}
        className="h-[36rem] w-[36rem]"
        style={{ top: "-8rem", left: "-6rem" }}
        animation="login-orb-a 22s ease-in-out infinite"
      />
      <Orb
        color={BRAND_INDIGO}
        className="h-[34rem] w-[34rem]"
        style={{ bottom: "-10rem", right: "-4rem" }}
        animation="login-orb-b 26s ease-in-out infinite"
      />
      <Orb
        color={BRAND_CYAN}
        className="h-[26rem] w-[26rem] opacity-80"
        style={{ top: "38%", left: "42%" }}
        animation="login-orb-c 30s ease-in-out infinite"
      />

      <MeshOverlay />
      <Vignette />
      <TopSheen />
    </>
  );
}
