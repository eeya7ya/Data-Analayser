"use client";

import { useState, useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Factory, Pencil, Check, X } from "lucide-react";
import { PricingSheet } from "@/components/pricing/PricingSheet";
import { GlobalProjectSearch } from "@/components/pricing/GlobalProjectSearch";
import { ManufacturerBackup } from "@/components/pricing/ManufacturerBackup";

interface Manufacturer {
  id: number;
  name: string;
}

/**
 * Client shell for a single pricing manufacturer's workspace —
 * editable header, global search bar, backup tools, and the embedded
 * PricingSheet. Mounted from the server page at
 * /pricing/manufacturer/[id]/page.tsx which handles auth and the host
 * TopBar.
 */
export default function ManufacturerWorkspaceClient() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = parseInt(params.id as string);

  const [manufacturer, setManufacturer] = useState<Manufacturer | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");

  const initialProjectParam = searchParams.get("project");
  const [requestedProjectId, setRequestedProjectId] = useState<number | null>(
    initialProjectParam ? parseInt(initialProjectParam, 10) : null,
  );

  const ownerParam = searchParams.get("owner");
  const ownerUserId = ownerParam ? parseInt(ownerParam, 10) : null;

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/pricing/manufacturers/${id}`);
        if (!res.ok) {
          router.push("/pricing");
          return;
        }
        const data = await res.json();
        setManufacturer(data);
        setEditName(data.name);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, router]);

  const handleSaveName = async () => {
    if (!editName.trim() || !manufacturer) return;
    const res = await fetch(`/api/pricing/manufacturers/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editName.trim() }),
    });
    if (res.ok) {
      const updated = await res.json();
      setManufacturer(updated);
    }
    setEditing(false);
  };

  if (!loading && !manufacturer) return null;

  return (
    <div className="mx-auto max-w-screen-2xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-2 text-sm">
        <Link
          href="/pricing"
          className="flex items-center gap-1 text-gray-400 transition-colors hover:text-gray-700"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Pricing dashboard
        </Link>
        <span className="text-gray-300">/</span>
        {loading ? (
          <span className="h-4 w-32 animate-pulse rounded bg-gray-200" />
        ) : (
          <span className="text-gray-700">{manufacturer!.name}</span>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-50 ring-1 ring-cyan-200">
            <Factory className="h-5 w-5 text-cyan-600" />
          </div>

          {loading ? (
            <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-200" />
          ) : editing ? (
            <div className="flex items-center gap-2">
              <input
                autoFocus
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") {
                    setEditing(false);
                    setEditName(manufacturer!.name);
                  }
                }}
                className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-lg font-bold text-gray-900 focus:border-cyan-400 focus:outline-none"
              />
              <button
                onClick={handleSaveName}
                className="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50"
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  setEditing(false);
                  setEditName(manufacturer!.name);
                }}
                className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-gray-900">{manufacturer!.name}</h1>
              <button
                onClick={() => setEditing(true)}
                className="rounded-md p-1.5 text-gray-300 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>

        {!loading && manufacturer && (
          <div className="flex flex-wrap items-center gap-3">
            <GlobalProjectSearch
              currentManufacturerId={id}
              currentOwnerUserId={ownerUserId}
              onLocalSelect={(projectId) => {
                if (typeof window !== "undefined") {
                  const sp = new URLSearchParams(window.location.search);
                  sp.set("project", String(projectId));
                  window.history.replaceState(
                    null,
                    "",
                    `${window.location.pathname}?${sp.toString()}`,
                  );
                }
                setRequestedProjectId(projectId);
              }}
            />
            <ManufacturerBackup
              manufacturerId={id}
              manufacturerName={manufacturer.name}
              ownerUserId={ownerUserId}
              onRestored={() => setReloadKey((k) => k + 1)}
            />
          </div>
        )}
      </div>

      <PricingSheet
        manufacturerId={id}
        manufacturerName={manufacturer?.name ?? ""}
        initialProjectId={requestedProjectId}
        reloadKey={reloadKey}
        ownerUserId={ownerUserId}
      />
    </div>
  );
}
