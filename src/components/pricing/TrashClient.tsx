"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  Trash2,
  RotateCcw,
  X,
  Factory,
  FolderOpen,
  ChevronLeft,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/pricing/utils";
import PageLoader from "@/components/PageLoader";

interface DeletedManufacturer {
  id: number;
  name: string;
  deletedAt: string;
}

interface DeletedProject {
  id: number;
  name: string;
  manufacturerId: number;
  manufacturerName: string;
  deletedAt: string;
}

interface TrashData {
  manufacturers: DeletedManufacturer[];
  projects: DeletedProject[];
}

export default function TrashPage() {
  const [data, setData] = useState<TrashData>({ manufacturers: [], projects: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [tab, setTab] = useState<"manufacturers" | "projects">("manufacturers");

  const loadTrash = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/pricing/trash");
      if (res.ok) setData(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrash();
  }, [loadTrash]);

  const restoreManufacturer = async (id: number) => {
    setBusy(`mfg-${id}`);
    try {
      await fetch(`/api/pricing/trash/manufacturers/${id}`, { method: "PUT" });
      await loadTrash();
    } finally {
      setBusy(null);
    }
  };

  const deleteManufacturerForever = async (id: number) => {
    if (!confirm("Permanently delete this manufacturer and ALL its projects? This cannot be undone.")) return;
    setBusy(`mfg-${id}`);
    try {
      await fetch(`/api/pricing/trash/manufacturers/${id}`, { method: "DELETE" });
      await loadTrash();
    } finally {
      setBusy(null);
    }
  };

  const restoreProject = async (id: number) => {
    setBusy(`proj-${id}`);
    try {
      await fetch(`/api/pricing/trash/projects/${id}`, { method: "PUT" });
      await loadTrash();
    } finally {
      setBusy(null);
    }
  };

  const deleteProjectForever = async (id: number) => {
    if (!confirm("Permanently delete this project? This cannot be undone.")) return;
    setBusy(`proj-${id}`);
    try {
      await fetch(`/api/pricing/trash/projects/${id}`, { method: "DELETE" });
      await loadTrash();
    } finally {
      setBusy(null);
    }
  };

  const totalItems = data.manufacturers.length + data.projects.length;

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-10 sm:px-6">
      {/* Header */}
      <div className="mb-8">
        <Link
          href="/pricing"
          className="mb-4 flex items-center gap-1 text-sm text-gray-400 hover:text-gray-700 transition-colors w-fit"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Dashboard
        </Link>
        <div className="flex items-center justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-rose-500">
              <Trash2 className="h-3.5 w-3.5" />
              Trash Bin
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Deleted Items</h1>
            <p className="mt-1 text-sm text-gray-500">
              Restore or permanently delete items.{" "}
              <span className="text-rose-500">Permanent deletion cannot be undone.</span>
            </p>
          </div>
          {totalItems > 0 && (
            <span className="rounded-full bg-rose-100 px-3 py-1 text-sm font-semibold text-rose-600">
              {totalItems} item{totalItems !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-1 rounded-xl border border-gray-200 bg-gray-50 p-1 w-fit">
        {(["manufacturers", "projects"] as const).map((t) => {
          const count = data[t].length;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors capitalize",
                tab === t
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {t === "manufacturers" ? (
                <Factory className="h-4 w-4" />
              ) : (
                <FolderOpen className="h-4 w-4" />
              )}
              {t}
              {count > 0 && (
                <span className="ml-1 rounded-full bg-rose-100 px-1.5 py-0.5 text-xs font-semibold text-rose-600">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {loading ? (
        <PageLoader label="Loading trash…" />
      ) : tab === "manufacturers" ? (
        <div className="space-y-3">
          {data.manufacturers.length === 0 ? (
            <EmptyTrash label="manufacturers" />
          ) : (
            data.manufacturers.map((m) => (
              <TrashItem
                key={m.id}
                icon={<Factory className="h-4 w-4 text-gray-400" />}
                title={m.name}
                subtitle={`Deleted ${new Date(m.deletedAt).toLocaleString()}`}
                warning="Restoring will also make all its projects visible again."
                busy={busy === `mfg-${m.id}`}
                onRestore={() => restoreManufacturer(m.id)}
                onDelete={() => deleteManufacturerForever(m.id)}
              />
            ))
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {data.projects.length === 0 ? (
            <EmptyTrash label="projects" />
          ) : (
            data.projects.map((p) => (
              <TrashItem
                key={p.id}
                icon={<FolderOpen className="h-4 w-4 text-gray-400" />}
                title={p.name}
                subtitle={`${p.manufacturerName} · Deleted ${new Date(p.deletedAt).toLocaleString()}`}
                busy={busy === `proj-${p.id}`}
                onRestore={() => restoreProject(p.id)}
                onDelete={() => deleteProjectForever(p.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

function EmptyTrash({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-gray-200 py-16 text-center">
      <Trash2 className="mb-3 h-8 w-8 text-gray-300" />
      <p className="text-sm text-gray-500">No deleted {label}</p>
    </div>
  );
}

function TrashItem({
  icon,
  title,
  subtitle,
  warning,
  busy,
  onRestore,
  onDelete,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  warning?: string;
  busy: boolean;
  onRestore: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-gray-100 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 flex-shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="font-semibold text-gray-800 truncate">{title}</p>
          <p className="text-xs text-gray-500">{subtitle}</p>
          {warning && (
            <p className="mt-1 flex items-center gap-1 text-xs text-amber-600">
              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
              {warning}
            </p>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <button
          onClick={onRestore}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          Restore
        </button>
        <button
          onClick={onDelete}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          Delete Forever
        </button>
      </div>
    </div>
  );
}
