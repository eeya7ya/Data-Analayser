/**
 * Hero-screen loader — the breathing 3×3 grid of dots at full size with a
 * message below. Used by every `loading.tsx` route skeleton and full-card
 * loading states.
 *
 * No "use client", no runtime style injection: the `mt-loader-grid`
 * keyframes live in globals.css, so the dots animate on the very first
 * paint — including inside server-rendered route loaders, before any
 * client JS runs. That removes the "loader shows up / starts late" delay.
 *
 *   <PageLoader />                              — defaults.
 *   <PageLoader label="Building your deal…" />  — custom message.
 *   <PageLoader fullScreen />                   — pads to the viewport.
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
  const wrapperClass = fullScreen
    ? `flex min-h-[60vh] w-full flex-col items-center justify-center gap-7 ${className}`
    : `flex w-full flex-col items-center justify-center gap-6 py-10 ${className}`;

  return (
    <div role="status" aria-live="polite" className={wrapperClass}>
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
      <p className="m-0 text-center text-[1.05rem] font-semibold tracking-wide text-[#9E1B45]">
        {label}
      </p>
    </div>
  );
}
