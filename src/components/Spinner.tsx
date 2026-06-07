/**
 * Inline brand loader — a breathing 3×3 grid of dots that scales with
 * `size`. Used inside buttons, panels, and tab bodies.
 *
 * No "use client", no runtime style injection: the `mt-loader-grid`
 * keyframes live in globals.css so the animation runs on first paint
 * (server-rendered too) instead of waiting for React to hydrate and run
 * a useEffect — that delay was the "loader renders late" problem.
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
