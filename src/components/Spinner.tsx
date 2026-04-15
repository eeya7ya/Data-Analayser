/**
 * Small circular spinner used inside loading.tsx skeletons and anywhere
 * a short async operation is in flight. The skeleton-pulse shimmer alone
 * can read as "the page is idle" on slow networks; a real spinning ring
 * makes it obvious that work is actively happening.
 *
 * Pure CSS (Tailwind's `animate-spin`) so there's no JS cost and it keeps
 * moving even when the main thread is busy hydrating the real page.
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
  return (
    <span
      role="status"
      aria-live="polite"
      className={`inline-flex items-center gap-2 text-magic-ink/60 ${className}`}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="animate-spin"
        aria-hidden="true"
      >
        <circle
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeOpacity="0.2"
          strokeWidth="3"
        />
        <path
          d="M22 12a10 10 0 0 1-10 10"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {label && <span className="text-xs font-medium">{label}</span>}
    </span>
  );
}
