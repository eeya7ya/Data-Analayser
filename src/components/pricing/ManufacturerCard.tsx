"use client";

import Link from "next/link";
import { Factory, FolderOpen, ArrowRight, Trash2, Tag } from "lucide-react";
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
      {/* Delete button (admin only) */}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            if (confirm(`Delete "${name}" and all its data?`)) {
              onDelete(id);
            }
          }}
          className="absolute right-3 top-3 rounded-lg p-1.5 text-gray-300 opacity-0 transition-all group-hover:opacity-100 hover:bg-rose-50 hover:text-rose-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
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
