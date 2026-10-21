"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { Eye, Lock } from "@/lib/icons";

/** Widths of the "text lines" drawn on the illustrated page. */
const LINES = [92, 80, 88, 70, 84, 60];

/**
 * Animated concept art for the v1.81 release (read-only, encrypted PDFs).
 * One looping 10 s story in two beats, synced with the two cards below it:
 *
 *   1. Encrypted — the page text scrambles, a padlock drops and snaps shut,
 *      a password pill types itself in.
 *   2. Read-only — "view" and "print" light up green; a pencil tries to edit
 *      the page and is refused.
 *
 * Pure SVG + CSS keyframes (the `.wn-*` rules in globals.css), so it costs no
 * dependency; a still frame is shown when the user prefers reduced motion.
 */
export default function ProtectedPdfShowcase() {
  // Unique per instance: the popup and the Updates feed can both be mounted.
  const id = useId().replace(/:/g, "");
  const shadow = `${id}-shadow`;
  const dots = `${id}-dots`;

  return (
    <div className="wn-anim">
      <div className="overflow-hidden rounded-xl border border-magic-border bg-gradient-to-br from-rose-50 via-white to-indigo-50/70">
        <svg
          viewBox="0 0 360 200"
          className="block h-auto w-full"
          role="img"
          aria-label="A PDF is locked with a padlock, then opened as view and print only — editing is blocked"
        >
          <defs>
            <filter id={shadow} x="-30%" y="-30%" width="160%" height="170%">
              <feDropShadow dx="0" dy="8" stdDeviation="8" floodColor="#111827" floodOpacity="0.12" />
            </filter>
            <pattern id={dots} width="14" height="14" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1" fill="#E4E7F1" />
            </pattern>
          </defs>

          {/* Backdrop */}
          <rect width="360" height="200" fill={`url(#${dots})`} />
          <circle cx="58" cy="36" r="70" fill="#E2231A" opacity="0.05" />
          <circle cx="314" cy="176" r="84" fill="#6366F1" opacity="0.06" />

          {/* The PDF page */}
          <g className="wn-doc">
            <g transform="translate(122 25)" filter={`url(#${shadow})`}>
              <path
                d="M10 0H98L116 18V140a10 10 0 0 1-10 10H10A10 10 0 0 1 0 140V10A10 10 0 0 1 10 0Z"
                fill="#fff"
                stroke="#E4E7F1"
              />
              <path d="M98 0V12a6 6 0 0 0 6 6H116Z" fill="#EEF1FA" />
              <image href="/logo.png" x="12" y="13" width="50" height="12.3" />
              <rect x="12" y="31" width="22" height="3" rx="1.5" fill="#E2231A" />
              <g className="wn-lines">
                {LINES.map((w, i) => (
                  <rect key={i} x="12" y={44 + i * 10} width={w} height="5" rx="2.5" fill="#E5E7EB" />
                ))}
              </g>
              {/* The same lines, scrambled into cipher blocks */}
              <g className="wn-cipher">
                {LINES.flatMap((w, i) =>
                  Array.from({ length: Math.floor(w / 7) }, (_, j) => (
                    <rect
                      key={`${i}-${j}`}
                      className="wn-bit"
                      style={{ animationDelay: `${((i * 13 + j * 7) % 9) * 0.13}s` }}
                      x={12 + j * 7}
                      y={44 + i * 10}
                      width="5"
                      height="5"
                      rx="1.2"
                      fill={(i * 7 + j * 3) % 5 === 0 ? "#FCA5A5" : "#D1D5DB"}
                    />
                  )),
                )}
              </g>
              {/* The logo stamp the real export burns into every page */}
              <image
                href="/logo.png"
                x="26"
                y="66"
                width="64"
                height="16"
                opacity="0.14"
                transform="rotate(-30 58 74)"
              />
              <g transform="translate(12 120)">
                <rect width="30" height="16" rx="4" fill="#E2231A" />
                <text x="15" y="11.3" textAnchor="middle" fontSize="8.5" fontWeight="800" fill="#fff" letterSpacing="0.5">
                  PDF
                </text>
              </g>
              <rect x="70" y="124" width="34" height="4" rx="2" fill="#E5E7EB" />
              <rect x="82" y="132" width="22" height="4" rx="2" fill="#E5E7EB" />
              {/* Flashes red when the edit is refused */}
              <path
                className="wn-doc-deny"
                d="M10 0H98L116 18V140a10 10 0 0 1-10 10H10A10 10 0 0 1 0 140V10A10 10 0 0 1 10 0Z"
                fill="none"
                stroke="#E2231A"
                strokeWidth="2"
              />
            </g>
          </g>

          {/* Beat 1 — encrypted: padlock + password */}
          <g transform="translate(180 98)">
            <g className="wn-lock">
              <circle className="wn-pulse" r="36" fill="none" stroke="#E2231A" strokeWidth="2" />
              <circle r="29" fill="#fff" fillOpacity="0.96" filter={`url(#${shadow})`} />
              <path
                className="wn-shackle"
                d="M-9 -3V-11a9 9 0 0 1 18 0V-3"
                fill="none"
                stroke="#111827"
                strokeWidth="4.5"
                strokeLinecap="round"
              />
              <rect x="-14" y="-4" width="28" height="22" rx="6" fill="#E2231A" />
              <circle cy="5" r="3" fill="#fff" />
              <rect x="-1.2" y="6" width="2.4" height="6" rx="1.2" fill="#fff" />
            </g>
          </g>
          <g transform="translate(80 98)">
            <g className="wn-keypill">
              <rect x="-31" y="-10" width="62" height="20" rx="10" fill="#111827" />
              <circle cx="-19" r="3.2" fill="none" stroke="#FCD34D" strokeWidth="1.7" />
              <path d="M-15.8 0H-9M-11 0V3" stroke="#FCD34D" strokeWidth="1.7" strokeLinecap="round" />
              {[0, 1, 2, 3].map((n) => (
                <circle
                  key={n}
                  className="wn-dot"
                  style={{ "--i": n } as CSSProperties}
                  cx={-3 + n * 7}
                  r="2.3"
                  fill="#fff"
                />
              ))}
            </g>
          </g>

          {/* Beat 2 — read-only: view ✓  print ✓  edit ✗ */}
          <g transform="translate(266 56)">
            <g className="wn-badge">
              <circle r="15" fill="#ECFDF5" stroke="#10B981" strokeWidth="1.5" />
              <path d="M-8.5 0Q0 -8 8.5 0Q0 8 -8.5 0Z" fill="#fff" stroke="#059669" strokeWidth="1.6" />
              <circle className="wn-pupil" r="2.8" fill="#059669" />
              <Check />
            </g>
          </g>
          <g transform="translate(266 98)">
            <g className="wn-badge wn-badge-2">
              <circle r="15" fill="#ECFDF5" stroke="#10B981" strokeWidth="1.5" />
              <rect x="-5" y="-9" width="10" height="5" rx="1" fill="#fff" stroke="#059669" strokeWidth="1.3" />
              <rect x="-8.5" y="-4.5" width="17" height="8" rx="2" fill="#059669" />
              <rect x="-5" y="0.5" width="10" height="7.5" rx="1" fill="#fff" stroke="#059669" strokeWidth="1.3" />
              <Check />
            </g>
          </g>
          <g transform="translate(206 82)">
            <g className="wn-pencil">
              <g transform="rotate(-35)">
                <polygon points="0,0 9,-4.5 9,4.5" fill="#FDE68A" />
                <polygon points="0,0 3,-1.5 3,1.5" fill="#374151" />
                <rect x="9" y="-4.5" width="26" height="9" fill="#F59E0B" />
                <rect x="9" y="-1" width="26" height="2" fill="#D97706" opacity="0.5" />
                <rect x="35" y="-4.5" width="4" height="9" fill="#9CA3AF" />
                <rect x="39" y="-4.5" width="6" height="9" rx="2" fill="#FB7185" />
              </g>
            </g>
          </g>
          <g transform="translate(192 64)">
            <g className="wn-deny">
              <circle r="11" fill="#fff" stroke="#E2231A" strokeWidth="2" />
              <circle r="6.2" fill="none" stroke="#E2231A" strokeWidth="2" />
              <path d="M-4.4 4.4L4.4 -4.4" stroke="#E2231A" strokeWidth="2.2" strokeLinecap="round" />
            </g>
          </g>
        </svg>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Concept
          className="wn-card-enc"
          tone="bg-magic-red/10 text-magic-red"
          bar="bg-magic-red"
          icon={<Lock className="h-4 w-4" />}
          title="Encrypted"
          caption="Password optional"
        />
        <Concept
          className="wn-card-ro"
          tone="bg-emerald-50 text-emerald-600"
          bar="bg-emerald-500"
          icon={<Eye className="h-4 w-4" />}
          title="Read-only"
          caption="View & print only"
        />
      </div>
    </div>
  );
}

/** Small green tick in a badge's corner. */
function Check() {
  return (
    <g transform="translate(11 -10)">
      <circle r="5.5" fill="#10B981" />
      <path d="M-2.4 0l1.6 1.6 3-3.2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

/** One of the two captions under the animation; lit while its beat plays. */
function Concept({
  className,
  tone,
  bar,
  icon,
  title,
  caption,
}: {
  className: string;
  tone: string;
  bar: string;
  icon: ReactNode;
  title: string;
  caption: string;
}) {
  return (
    <div
      className={`wn-card ${className} relative overflow-hidden rounded-xl border border-magic-border bg-white px-3 py-2.5`}
    >
      <div className="flex items-center gap-2.5">
        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight text-magic-ink">{title}</div>
          <div className="truncate text-[11px] text-magic-ink/55">{caption}</div>
        </div>
      </div>
      <span className={`wn-bar absolute inset-x-0 bottom-0 h-0.5 origin-left ${bar}`} />
    </div>
  );
}
