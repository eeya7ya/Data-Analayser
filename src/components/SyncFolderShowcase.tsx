"use client";

import { useId, type ReactNode } from "react";
import { FileText, FolderSync, RefreshCw } from "@/lib/icons";

/** App rows (left) and laptop folders (right) share the same tree shape. */
const APP_ROWS = [
  { cy: 36, x: 10, bar: 56 },
  { cy: 60, x: 20, bar: 46 },
  { cy: 84, x: 30, bar: 50 },
  { cy: 108, x: 40, bar: 34 },
];
const FOLDERS = [
  { cy: 22, x: 8, bar: 46 },
  { cy: 38, x: 18, bar: 38 },
  { cy: 54, x: 28, bar: 42 },
  { cy: 70, x: 38, bar: 28 },
];

/**
 * Animated concept art for the v1.82 release (the sync folder mirrors the
 * CRM). One looping 12 s story in three beats, synced with the cards below:
 *
 *   1. Same folders — the app's Company › Person › Project › BOQs rows light up
 *      one by one and the same folders appear on the laptop.
 *   2. Excel + PDF — an Excel, a locked Excel and a stamped PDF pop into the
 *      project.
 *   3. Drop to upload — a file drops into the laptop's BOQs folder, travels
 *      back and lands in the app with a tick.
 *
 * Pure SVG + CSS keyframes (the `.ws-*` rules in globals.css), like the v1.81
 * showcase; a still frame is shown when the user prefers reduced motion.
 */
export default function SyncFolderShowcase() {
  // Unique per instance: the popup and the Updates feed can both be mounted.
  const id = useId().replace(/:/g, "");
  const shadow = `${id}-shadow`;
  const dots = `${id}-dots`;

  return (
    <div className="ws-anim">
      <div className="overflow-hidden rounded-xl border border-magic-border bg-gradient-to-br from-amber-50/70 via-white to-rose-50">
        <svg
          viewBox="0 0 360 200"
          className="block h-auto w-full"
          role="img"
          aria-label="The app's company, person and project folders appear on a laptop; Excel and PDF files arrive, and a file dropped on the laptop uploads back to the app"
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
          <circle cx="40" cy="30" r="70" fill="#E2231A" opacity="0.05" />
          <circle cx="330" cy="180" r="84" fill="#F59E0B" opacity="0.07" />

          {/* The app: the CRM tree */}
          <g transform="translate(14 34)">
            <rect width="136" height="132" rx="12" fill="#fff" stroke="#E4E7F1" filter={`url(#${shadow})`} />
            <path d="M12 0H124A12 12 0 0 1 136 12V20H0V12A12 12 0 0 1 12 0Z" fill="#F5F6FB" />
            <path d="M0 20.5H136" stroke="#E4E7F1" />
            <circle cx="11" cy="10" r="2.4" fill="#FCA5A5" />
            <circle cx="19" cy="10" r="2.4" fill="#FDE68A" />
            <circle cx="27" cy="10" r="2.4" fill="#A7F3D0" />
            <image href="/logo.png" x="92" y="5.8" width="34" height="8.4" />
            <TreeLines rows={APP_ROWS} half={7} stroke="#E5E7EB" />
            {APP_ROWS.map((r, i) => (
              <g key={i}>
                <rect
                  className={`ws-h${i + 1}`}
                  x="6"
                  y={r.cy - 10}
                  width="124"
                  height="20"
                  rx="6"
                  fill="#FEF2F2"
                  stroke="#FECACA"
                />
                {i === 3 && (
                  <rect
                    className="ws-h4b"
                    x="6"
                    y={r.cy - 10}
                    width="124"
                    height="20"
                    rx="6"
                    fill="#ECFDF5"
                    stroke="#A7F3D0"
                  />
                )}
                <AppIcon kind={i} x={r.x} cy={r.cy} />
                <rect x={r.x + 20} y={r.cy - 3} width={r.bar} height="6" rx="3" fill="#E5E7EB" />
                <rect x={r.x + 26 + r.bar} y={r.cy - 3} width="12" height="6" rx="3" fill="#F3F4F6" />
              </g>
            ))}
            {/* The uploaded file, landed in the app */}
            <g transform={`translate(116 ${APP_ROWS[3].cy})`}>
              <g className="ws-new">
                <path d="M-5 -7H2L5 -4V7H-5Z" fill="#fff" stroke="#10B981" strokeWidth="1.2" strokeLinejoin="round" />
                <circle cx="4" cy="5" r="4" fill="#10B981" />
                <path d="M2.2 5l1.3 1.3 2.2-2.4" fill="none" stroke="#fff" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
              </g>
            </g>
          </g>

          {/* Sync hub + the data travelling each way */}
          <g transform="translate(152 84)">
            {[1, 2, 3, 4].map((n) => (
              <rect key={n} className={`ws-p${n}`} x="-3" y="-3" width="6" height="6" rx="1.6" fill="#E2231A" />
            ))}
          </g>
          <g transform="translate(152 116)">
            <rect className="ws-up" x="-3" y="-3" width="6" height="6" rx="1.6" fill="#10B981" />
          </g>
          <g transform="translate(177 100)">
            <circle r="13" fill="#fff" stroke="#E4E7F1" filter={`url(#${shadow})`} />
            <g className="ws-spin">
              <path d="M-6 -1.5A6.2 6.2 0 0 1 4.8 -4" fill="none" stroke="#E2231A" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M2.4 -6.6L5.2 -3.9L1.7 -2.6" fill="none" stroke="#E2231A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M6 1.5A6.2 6.2 0 0 1 -4.8 4" fill="none" stroke="#E2231A" strokeWidth="1.8" strokeLinecap="round" />
              <path d="M-2.4 6.6L-5.2 3.9L-1.7 2.6" fill="none" stroke="#E2231A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </g>
          </g>

          {/* The laptop: the sync folder */}
          <g transform="translate(204 30)">
            <rect width="144" height="108" rx="9" fill="#1F2937" filter={`url(#${shadow})`} />
            <circle cx="72" cy="2.7" r="1" fill="#4B5563" />
            <path d="M-10 110H154L148 118H-4Z" fill="#D1D5DB" />
            <rect x="58" y="110" width="28" height="3" rx="1.5" fill="#9CA3AF" />
            <g transform="translate(5 5)">
              <rect width="134" height="98" rx="5" fill="#fff" />
              <path d="M5 0H129A5 5 0 0 1 134 5V11H0V5A5 5 0 0 1 5 0Z" fill="#F5F6FB" />
              <circle cx="7" cy="5.5" r="1.7" fill="#FCA5A5" />
              <circle cx="12.5" cy="5.5" r="1.7" fill="#FDE68A" />
              <circle cx="18" cy="5.5" r="1.7" fill="#A7F3D0" />
              <rect x="56" y="3.5" width="22" height="4" rx="2" fill="#E5E7EB" />
              {FOLDERS.map((f, i) => (
                <g key={i} className={`ws-f${i + 1}`}>
                  {i > 0 && (
                    <path
                      d={`M${FOLDERS[i - 1].x + 6} ${FOLDERS[i - 1].cy + 5}V${f.cy}H${f.x - 1}`}
                      fill="none"
                      stroke="#E5E7EB"
                      strokeWidth="1.2"
                    />
                  )}
                  <g className={i === 3 ? "ws-bounce" : undefined}>
                    <Folder x={f.x} cy={f.cy} color={i === 2 ? "#F59E0B" : i === 3 ? "#34D399" : "#FBBF24"} />
                  </g>
                  <rect x={f.x + 16} y={f.cy - 2.5} width={f.bar} height="5" rx="2.5" fill="#E5E7EB" />
                </g>
              ))}
              {/* What lands in the project: Excel, locked Excel, PDF */}
              <g transform="translate(52 80)">
                <g className="ws-c1">
                  <Sheet fill="#ECFDF5" stroke="#10B981" />
                </g>
              </g>
              <g transform="translate(72 80)">
                <g className="ws-c2">
                  <Sheet fill="#ECFDF5" stroke="#10B981" />
                  <MiniLock x={11} y={1} />
                </g>
              </g>
              <g transform="translate(92 80)">
                <g className="ws-c3">
                  <path d="M0 0H9L13 4V16H0Z" fill="#FEF2F2" stroke="#E2231A" strokeWidth="1" strokeLinejoin="round" />
                  <rect x="0" y="10" width="13" height="6" fill="#E2231A" />
                  <text x="6.5" y="14.6" textAnchor="middle" fontSize="4.6" fontWeight="800" fill="#fff">
                    PDF
                  </text>
                  <g className="ws-stamp">
                    <rect x="1.5" y="5" width="10" height="2" rx="1" fill="#E2231A" opacity="0.35" transform="rotate(-30 6.5 6)" />
                  </g>
                  <MiniLock x={11} y={1} />
                </g>
              </g>
              {/* A file dropped into the BOQs folder */}
              <g transform={`translate(${FOLDERS[3].x + 6} ${FOLDERS[3].cy - 3})`}>
                <g className="ws-drop">
                  <path d="M-5 -7H2L5 -4V7H-5Z" fill="#fff" stroke="#111827" strokeWidth="1.1" strokeLinejoin="round" />
                  <path d="M-3 -1H3M-3 2H3" stroke="#10B981" strokeWidth="1.1" strokeLinecap="round" />
                </g>
              </g>
            </g>
          </g>
        </svg>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Concept
          className="ws-card-1"
          tone="bg-magic-red/10 text-magic-red"
          bar="bg-magic-red"
          icon={<FolderSync className="h-4 w-4" />}
          title="Same folders"
          caption="Like the CRM"
        />
        <Concept
          className="ws-card-2"
          tone="bg-amber-50 text-amber-600"
          bar="bg-amber-500"
          icon={<FileText className="h-4 w-4" />}
          title="Excel + PDF"
          caption="Read-only copies"
        />
        <Concept
          className="ws-card-3"
          tone="bg-emerald-50 text-emerald-600"
          bar="bg-emerald-500"
          icon={<RefreshCw className="h-4 w-4" />}
          title="Drop to upload"
          caption="Both ways"
        />
      </div>
    </div>
  );
}

/** Elbow connectors of a tree whose rows are `rows`. */
function TreeLines({
  rows,
  half,
  stroke,
}: {
  rows: Array<{ cy: number; x: number }>;
  half: number;
  stroke: string;
}) {
  return (
    <g fill="none" stroke={stroke} strokeWidth="1.2">
      {rows.slice(1).map((r, i) => (
        <path key={i} d={`M${rows[i].x + half} ${rows[i].cy + half}V${r.cy}H${r.x - 1}`} />
      ))}
    </g>
  );
}

/** Company, person, project and BOQs tiles of the app tree. */
function AppIcon({ kind, x, cy }: { kind: number; x: number; cy: number }) {
  const tiles = ["#EEF2FF", "#FEF2F2", "#FFF7ED", "#ECFDF5"];
  return (
    <g transform={`translate(${x} ${cy - 7})`}>
      <rect width="14" height="14" rx="4" fill={tiles[kind]} />
      {kind === 0 && (
        <g fill="#6366F1">
          <rect x="3.5" y="3" width="7" height="8.5" rx="1" />
          <rect x="5" y="4.6" width="1.4" height="1.4" fill="#fff" />
          <rect x="7.6" y="4.6" width="1.4" height="1.4" fill="#fff" />
          <rect x="5" y="7.2" width="1.4" height="1.4" fill="#fff" />
          <rect x="7.6" y="7.2" width="1.4" height="1.4" fill="#fff" />
        </g>
      )}
      {kind === 1 && (
        <g fill="#E2231A">
          <circle cx="7" cy="5.2" r="2.3" />
          <path d="M2.8 11.5a4.2 4.2 0 0 1 8.4 0Z" />
        </g>
      )}
      {kind === 2 && <path d="M3 4.2h3l1.2 1.3H11v5.3H3Z" fill="#F59E0B" />}
      {kind === 3 && (
        <g fill="none" stroke="#10B981" strokeWidth="1.1">
          <rect x="3.2" y="3.4" width="7.6" height="7.2" rx="1" />
          <path d="M3.2 6h7.6M3.2 8.4h7.6M6 3.4v7.2" />
        </g>
      )}
    </g>
  );
}

function Folder({ x, cy, color }: { x: number; cy: number; color: string }) {
  return (
    <g transform={`translate(${x} ${cy - 5})`}>
      <path d="M0 1.2A1.2 1.2 0 0 1 1.2 0H4.6L6 1.6H10.8A1.2 1.2 0 0 1 12 2.8V8.8A1.2 1.2 0 0 1 10.8 10H1.2A1.2 1.2 0 0 1 0 8.8Z" fill={color} />
      <path d="M0 3.4H12" stroke="#fff" strokeOpacity="0.5" strokeWidth="0.8" />
    </g>
  );
}

/** A small spreadsheet file. */
function Sheet({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <g>
      <path d="M0 0H9L13 4V16H0Z" fill={fill} stroke={stroke} strokeWidth="1" strokeLinejoin="round" />
      <path d="M2.5 7.5h8M2.5 10.5h8M2.5 13.5h8M6.5 6v9" stroke={stroke} strokeWidth="0.8" />
    </g>
  );
}

function MiniLock({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r="3.6" fill="#111827" />
      <path d="M-1.3 -0.4V-1.3a1.3 1.3 0 0 1 2.6 0V-0.4" fill="none" stroke="#fff" strokeWidth="0.8" />
      <rect x="-1.8" y="-0.5" width="3.6" height="2.6" rx="0.6" fill="#fff" />
    </g>
  );
}

/** One of the three captions under the animation; lit while its beat plays. */
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
      className={`ws-card ${className} relative overflow-hidden rounded-xl border border-magic-border bg-white px-2.5 pb-2.5 pt-2`}
    >
      {/* Stacked: three cards share the popup's width. */}
      <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg ${tone}`}>
        {icon}
      </span>
      <div className="mt-1.5 text-[13px] font-semibold leading-tight text-magic-ink">{title}</div>
      <div className="mt-0.5 text-[11px] leading-tight text-magic-ink/55">{caption}</div>
      <span className={`ws-bar absolute inset-x-0 bottom-0 h-0.5 origin-left ${bar}`} />
    </div>
  );
}
