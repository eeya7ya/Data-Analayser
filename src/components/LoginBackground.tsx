import type { CSSProperties } from "react";

/**
 * Modular sign-in background.
 *
 * The login backdrop is composed from small, independent layers — a base
 * gradient, a readability vignette, one or more accent glows, and an optional
 * grid — instead of a wall of inline divs living on the page. Each layer is a
 * tiny presentational component you can reuse, reorder, drop, or retune via
 * props, so changing the look is a one-line edit rather than untangling stacked
 * backgrounds. Pure CSS in a server component, so it ships no JavaScript.
 */

/** Full-bleed, non-interactive layer wrapper shared by every background piece. */
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

/** Deep brand gradient that fills the canvas. */
export function BaseGradient() {
  return (
    <Layer
      style={{
        background:
          "radial-gradient(120% 120% at 50% 0%, #141a2b 0%, #0b0f1a 55%, #070a12 100%)",
      }}
    />
  );
}

/** Top-to-bottom tint so foreground type stays readable over any layer. */
export function Vignette() {
  return (
    <Layer className="bg-gradient-to-b from-[#0b0f1a]/65 via-[#0b0f1a]/40 to-[#0b0f1a]/85" />
  );
}

/** A soft coloured glow. Reuse with a different colour/position for depth. */
export function AccentGlow({
  color = "rgba(226,35,26,0.10)",
  position = "30% 50%",
  size = "60% 60%",
}: {
  color?: string;
  position?: string;
  size?: string;
}) {
  return (
    <Layer
      style={{
        background: `radial-gradient(${size} at ${position}, ${color}, transparent 70%)`,
      }}
    />
  );
}

/** Faint masked grid for a subtle "engineered" texture. */
export function GridOverlay({ cell = 44 }: { cell?: number }) {
  return (
    <Layer
      className="opacity-[0.05]"
      style={{
        backgroundImage:
          "linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)",
        backgroundSize: `${cell}px ${cell}px`,
        maskImage:
          "radial-gradient(ellipse at center, black 35%, transparent 80%)",
        WebkitMaskImage:
          "radial-gradient(ellipse at center, black 35%, transparent 80%)",
      }}
    />
  );
}

/**
 * Compose the default sign-in background. Toggle the grid or swap the glows
 * without touching the page — add more <AccentGlow/> layers for extra depth.
 */
export default function LoginBackground({ grid = true }: { grid?: boolean }) {
  return (
    <>
      <BaseGradient />
      <Vignette />
      <AccentGlow color="rgba(226,35,26,0.10)" position="28% 42%" />
      <AccentGlow
        color="rgba(99,102,241,0.10)"
        position="78% 60%"
        size="55% 55%"
      />
      {grid && <GridOverlay />}
    </>
  );
}
