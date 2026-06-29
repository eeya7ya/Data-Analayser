"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Factory, BarChart3, AlertCircle, ScanSearch } from "lucide-react";
import PageLoader from "@/components/PageLoader";
import { ManufacturerCard } from "@/components/pricing/ManufacturerCard";
import { cn } from "@/lib/pricing/utils";
import { useAuth } from "@/lib/pricing/authContext";

interface ManufacturerWithCount {
  id: number;
  name: string;
  color: string | null;
  tag: string | null;
  createdAt: string;
  // The user this card belongs to. For admin, the dashboard shows one
  // card per (user, manufacturer) pair so the same brand can appear
  // multiple times — once per owning user.
  ownerUserId: number | null;
  ownerUserName: string | null;
  projectCount: number;
}

export default function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.role === "admin";

  const [items, setItems] = useState<ManufacturerWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/pricing/manufacturers", { cache: "no-store" });
      if (res.ok) {
        const data: ManufacturerWithCount[] = await res.json();
        setItems(data);
      } else {
        const body = await res.json().catch(() => ({}));
        setItems([]);
        setLoadError(body.error ?? `Failed to load manufacturers (${res.status}).`);
      }
    } catch {
      setItems([]);
      setLoadError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return; // middleware will redirect
    loadData();
  }, [authLoading, user, loadData]);

  const resetForm = () => {
    setNewName("");
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/pricing/manufacturers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (res.ok) {
        resetForm();
        setCreating(false);
        await loadData();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to add manufacturer. Please try again.");
      }
    } catch {
      setError("Network error. Please check your connection and database.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setCreating(false);
    resetForm();
    setError(null);
  };

  const handleDelete = async (id: number) => {
    // Optimistic update — remove immediately, refetch in background.
    setItems((prev) => prev.filter((m) => m.id !== id));
    try {
      await fetch(`/api/pricing/manufacturers/${id}`, { method: "DELETE" });
    } finally {
      loadData();
    }
  };

  // Admin-only "group by user" tabs — one tab per owning user.
  const userTabs = useMemo(() => {
    if (!isAdmin) return [] as { id: string; label: string }[];
    const seen = new Set<string>();
    const tabs: { id: string; label: string }[] = [];
    for (const m of items) {
      if (m.ownerUserId && m.ownerUserName) {
        const key = String(m.ownerUserId);
        if (!seen.has(key)) {
          seen.add(key);
          tabs.push({ id: key, label: m.ownerUserName });
        }
      }
    }
    return tabs;
  }, [isAdmin, items]);

  const visibleItems = useMemo(
    () =>
      isAdmin && activeTab !== "all"
        ? items.filter((m) => String(m.ownerUserId) === activeTab)
        : items,
    [isAdmin, activeTab, items]
  );

  // Wait for the auth context before deciding what to show — prevents
  // a flash of the empty state.
  const showSpinner = authLoading || loading;

  return (
    <div className="mx-auto max-w-screen-xl px-4 py-10 sm:px-6">
      {/* Page header */}
      <div className="mb-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-cyan-600">
            <BarChart3 className="h-3.5 w-3.5" />
            Manufacturers
          </div>
          <h1 className="text-4xl font-bold text-gray-900 tracking-tight">
            Pricing Dashboard
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            {isAdmin
              ? "Manage manufacturers and their smart pricing sheets"
              : "Your manufacturers — color and tag are yours alone"}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-shrink-0 items-center gap-2">
          <Link
            href="/pricing/deep-search"
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-gray-600 transition-all hover:border-cyan-300 hover:text-cyan-700"
          >
            <ScanSearch className="h-4 w-4" />
            Deep Search
          </Link>
          {creating ? (
            <div className="flex flex-col gap-3 items-end">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="Manufacturer name…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") handleCancel();
                  }}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-gray-800 placeholder-gray-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/20 min-w-[200px]"
                />
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCreate}
                  disabled={!newName.trim() || saving}
                  className="rounded-xl bg-cyan-500 px-5 py-2.5 text-sm font-semibold text-white transition-all hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed shadow-sm"
                >
                  {saving ? "Adding…" : "Add"}
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-800 hover:bg-gray-50 transition-all"
                >
                  Cancel
                </button>
              </div>
              {error && (
                <p className="text-xs text-rose-500 flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  {error}
                </p>
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className={cn(
                "flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold",
                "bg-cyan-500 text-white transition-all hover:bg-cyan-400",
                "shadow-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/40"
              )}
            >
              <Plus className="h-4 w-4" />
              Add Manufacturer
            </button>
          )}
        </div>
      </div>

      {/* User tabs (admin only) */}
      {isAdmin && userTabs.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          <button
            onClick={() => setActiveTab("all")}
            className={cn(
              "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
              activeTab === "all"
                ? "bg-cyan-500 text-white shadow-sm"
                : "border border-gray-200 bg-white text-gray-600 hover:border-cyan-300 hover:text-cyan-700"
            )}
          >
            All
          </button>
          {userTabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
                activeTab === tab.id
                  ? "bg-cyan-500 text-white shadow-sm"
                  : "border border-gray-200 bg-white text-gray-600 hover:border-cyan-300 hover:text-cyan-700"
            )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Load error banner */}
      {loadError && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-rose-500 mt-0.5" />
          <p className="text-sm text-rose-600">{loadError}</p>
        </div>
      )}

      {/* Content */}
      {showSpinner ? (
        <PageLoader label="Loading manufacturers…" />
      ) : visibleItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-gray-200 bg-gray-50 py-24 text-center">
          <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-2xl bg-gray-100 ring-1 ring-gray-200">
            <Factory className="h-9 w-9 text-gray-400" />
          </div>
          <h3 className="mb-2 text-xl font-semibold text-gray-700">
            No manufacturers yet
          </h3>
          <p className="mb-7 text-sm text-gray-500">
            Add your first manufacturer to get started
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-2 rounded-xl bg-cyan-500 px-6 py-3 text-sm font-semibold text-white hover:bg-cyan-400 transition-all shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Add Manufacturer
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visibleItems.map((m) => (
            // Admin can see the same manufacturer multiple times (once per
            // owning user), so the key combines manufacturer + owner.
            <div key={`${m.id}-${m.ownerUserId ?? "none"}`} className="animate-fade-in">
              <ManufacturerCard
                id={m.id}
                name={m.name}
                color={m.color}
                tag={m.tag}
                projectCount={m.projectCount}
                ownerUserId={m.ownerUserId}
                onDelete={isAdmin ? handleDelete : undefined}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
