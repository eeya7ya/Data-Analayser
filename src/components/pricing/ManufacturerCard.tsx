"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Factory,
  FolderOpen,
  ArrowRight,
  Trash2,
  Tag,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/pricing/utils";
import { getManufacturerColor } from "@/lib/pricing/manufacturerColors";

interface Props {
  id: number;
  name: string;
  color?: string | null;
  tag?: string | null;
  projectCount: number;
  /** Owner this card represents. For admins the same manufacturer can appear
   *  multiple times (once per user), so we scope the link by owner to keep
   *  projects isolated per user. */
  ownerUserId?: number | null;
  onDelete?: (id: number) => void;
}

export function ManufacturerCard({ id, name, color, tag, projectCount, ownerUserId, onDelete }: Props) {
  const palette = getManufacturerColor(color);
  const href =
    ownerUserId != null
      ? `/pricing/manufacturer/${id}?owner=${ownerUserId}`
      : `/pricing/manufacturer/${id}`;

  // Two-stage delete confirmation (0 = idle, 1 = confirm, 2 = final confirm).
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const [busy, setBusy] = useState(false);

  const projLabel = `${projectCount} ${projectCount === 1 ? "sheet" : "sheets"}`;

  return (
    <div
      className={cn(
        "group relative rounded-2xl p-5",
        "border border-gray-200 border-l-4 bg-white",
        palette.border,
        "transition-all duration-300",
        "hover:border-cyan-200 hover:shadow-lg hover:shadow-gray-200"
      )}
    >
      {/* Delete button — always visible, muted until hover. */}
      {onDelete && stage === 0 && (
        <button
          type="button"
          aria-label={`Delete ${name}`}
          onClick={(e) => {
            e.preventDefault();
            setStage(1);
          }}
          className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-gray-300 transition-all hover:bg-rose-50 hover:text-rose-500"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}

      {/* Two-stage delete confirmation overlay */}
      {onDelete && stage > 0 && (
        <div className="absolute inset-0 z-20 flex flex-col justify-center rounded-2xl border border-rose-200 bg-white/97 p-5 backdrop-blur-sm">
          <div className="mb-2 flex items-center gap-2 text-rose-600">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm font-semibold">
              {stage === 1 ? "Delete this manufacturer?" : "Are you sure?"}
            </span>
          </div>
          <p className="mb-4 text-xs leading-relaxed text-gray-600">
            {stage === 1 ? (
              <>
                <span className="font-semibold text-gray-800">{name}</span> and
                its {projLabel} will be removed from your dashboard.
              </>
            ) : (
              <>
                This removes{" "}
                <span className="font-semibold text-gray-800">{name}</span>{" "}
                and its {projLabel}. Click confirm to proceed.
              </>
            )}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                setStage(0);
              }}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-all hover:bg-gray-50 disabled:opacity-40"
            >
              Cancel
            </button>
            {stage === 1 ? (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  setStage(2);
                }}
                className="rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-rose-600"
              >
                Delete
              </button>
            ) : (
              <button
                type="button"
                disabled={busy}
                onClick={(e) => {
                  e.preventDefault();
                  setBusy(true);
                  onDelete(id);
                }}
                className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition-all hover:bg-rose-700 disabled:opacity-60"
              >
                {busy ? "Deleting…" : "Yes, delete"}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Icon */}
      <div
        className={cn(
          "mb-4 flex h-12 w-12 items-center justify-center rounded-xl ring-1",
          palette.bg,
          palette.ring
        )}
      >
        <Factory className={cn("h-5 w-5", palette.text)} />
      </div>

      {/* Name + tag */}
      <h3 className="mb-1.5 text-base font-semibold text-gray-900">{name}</h3>
      {tag ? (
        <div
          className={cn(
            "mb-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            palette.tagBg,
            palette.tagText
          )}
        >
          <Tag className="h-2.5 w-2.5" />
          {tag}
        </div>
      ) : null}

      {/* Stats */}
      <div className="mb-5 flex items-center gap-1.5 text-xs text-gray-500">
        <FolderOpen className="h-3.5 w-3.5" />
        {projectCount} {projectCount === 1 ? "project" : "projects"}
      </div>

      {/* Open link */}
      <Link
        href={href}
        className={cn(
          "flex items-center justify-between rounded-xl px-3.5 py-2.5",
          "border border-gray-200 bg-gray-50",
          "text-sm font-medium text-gray-700",
          "transition-all hover:bg-cyan-50 hover:text-cyan-700 hover:border-cyan-200"
        )}
      >
        Open Sheet
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
