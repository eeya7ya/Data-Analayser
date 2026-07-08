"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Save, Plus, Trash2, Download, FileSpreadsheet, Printer, FolderMinus, GitBranch, FileSignature, ClipboardPaste, BadgeCheck } from "lucide-react";
import PageLoader from "@/components/PageLoader";
import { ProjectSelector } from "./ProjectSelector";
import { ConstantsPanel } from "./ConstantsPanel";
import { ProductTable } from "./ProductTable";
import { PricingCharts } from "./PricingCharts";
import { ConvertToQuotationDialog } from "./ConvertToQuotationDialog";
import { type Constants, DEFAULT_CONSTANTS } from "@/lib/pricing/calculations";
import { confirmDelete } from "@/lib/confirmDelete";
import { exportToCsv, exportToPrint } from "@/lib/pricing/export";

interface Project {
  id: number;
  name: string;
  date?: string | null;
  responsiblePerson?: string | null;
  parentProjectId?: number | null;
  revisionNumber?: number | null;
}

interface ProductRow {
  id: number;
  position: number;
  itemModel: string;
  priceUsd: number;
  quantity: number;
  shippingOverride?: number | null;
  customsOverride?: number | null;
  shippingRateOverride?: number | null;
  customsRateOverride?: number | null;
  profitRateOverride?: number | null;
  /** V1.8 — internal per-line description; never prints, carries to quotation. */
  description?: string | null;
}

interface Props {
  manufacturerId: number;
  manufacturerName: string;
  /** If set, the sheet tries to auto-select this project id after load
   *  (overrides the default first-project auto-select). Changing this
   *  value at runtime also switches selection. */
  initialProjectId?: number | null;
  /** Increment this number from the parent to force a refresh of the
   *  project list (e.g. after a backup restore). */
  reloadKey?: number;
  /** Admin-only: scopes the projects view to a specific owning user so the
   *  same manufacturer viewed from two different user cards shows two
   *  separate project lists. */
  ownerUserId?: number | null;
}

export function PricingSheet({
  manufacturerId,
  manufacturerName,
  initialProjectId,
  reloadKey = 0,
  ownerUserId,
}: Props) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [constants, setConstants] = useState<Constants>(DEFAULT_CONSTANTS);
  const [targetCurrency, setTargetCurrency] = useState("JOD");
  const [sourceCurrency, setSourceCurrency] = useState("USD");
  const [rows, setRows] = useState<ProductRow[]>([]);
  // Transient feedback for the bulk-paste affordances (count pasted, or a
  // hint to use Ctrl/Cmd+V when the browser blocks clipboard reads).
  const [pasteHint, setPasteHint] = useState("");
  // Start in a loading state so we don't flash the "No project selected"
  // empty state on first paint while the projects list is still in-flight.
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingRevision, setSavingRevision] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [converting, setConverting] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);

  // Editable project meta
  const [projectName, setProjectName] = useState("");
  const [projectDate, setProjectDate] = useState("");
  const [responsiblePerson, setResponsiblePerson] = useState("");
  // Executive-manager confirmation state for the selected sheet.
  const [execStatus, setExecStatus] = useState<string>("none");
  const [submittingExec, setSubmittingExec] = useState(false);
  // Only presales managers may submit a pricing sheet to the executive
  // (admin is deliberately not part of this workflow gate).
  const [canSubmitExec, setCanSubmitExec] = useState(false);
  useEffect(() => {
    let alive = true;
    void fetch("/api/auth/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { module_roles?: Array<{ module: string; role: string }> }) => {
        if (!alive) return;
        setCanSubmitExec(
          !!d.module_roles?.some(
            (r) => r.module === "crm" && r.role === "presales_manager",
          ),
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Track whether we've done the initial project auto-select
  const initialSelectDone = useRef(false);

  // Keep the latest initialProjectId in a ref so loadProjects can read it
  // without being added to its dependency list — otherwise we'd re-fetch
  // the whole project list (and re-render everything) on every search
  // result click, which was freezing the page.
  const initialProjectIdRef = useRef<number | null | undefined>(initialProjectId);
  useEffect(() => {
    initialProjectIdRef.current = initialProjectId;
  }, [initialProjectId]);

  // Load projects list — only re-runs when manufacturerId changes or
  // when the parent bumps reloadKey (e.g. after a restore).
  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const params = new URLSearchParams({ manufacturerId: String(manufacturerId) });
      if (ownerUserId != null) params.set("ownerUserId", String(ownerUserId));
      const res = await fetch(`/api/pricing/projects?${params.toString()}`);
      if (res.ok) {
        const data: Project[] = await res.json();
        setProjects(data);
        // Auto-select on initial load. If the parent gave us an
        // initialProjectId we honour it; otherwise pick the first.
        if (!initialSelectDone.current && data.length > 0) {
          initialSelectDone.current = true;
          const wantId = initialProjectIdRef.current;
          const preferred =
            wantId != null && data.some((p) => p.id === wantId)
              ? wantId
              : data[0].id;
          setSelectedProjectId(preferred);
        }
      }
    } finally {
      setProjectsLoading(false);
    }
  }, [manufacturerId, ownerUserId]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects, reloadKey]);

  // If the parent supplies a new initialProjectId at runtime (e.g. user
  // picked a result from global search), switch to it without losing
  // unsaved edits to the current project.
  useEffect(() => {
    if (initialProjectId == null) return;
    if (initialProjectId === selectedProjectId) return;
    // Only honour it when the project is in our loaded list.
    if (projects.some((p) => p.id === initialProjectId)) {
      setSelectedProjectId(initialProjectId);
    }
  }, [initialProjectId, projects, selectedProjectId]);

  // Load project data when selection changes
  useEffect(() => {
    if (!selectedProjectId) return;

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/pricing/projects/${selectedProjectId}`);
        if (cancelled) return;
        if (!res.ok) {
          // Never leave the *previous* project's rows/constants on screen when
          // a switch fails — that's what made a failed load look like "the same
          // selected items" under a different project. Clear to a blank sheet.
          setRows([]);
          setConstants(DEFAULT_CONSTANTS);
          setProjectName("");
          setProjectDate("");
          setResponsiblePerson("");
          setExecStatus("none");
          return;
        }
        const data = await res.json();

        if (cancelled) return;

        if (data.project) {
          setProjectName(data.project.name ?? "");
          setProjectDate(data.project.date ?? "");
          setResponsiblePerson(data.project.responsiblePerson ?? "");
          setExecStatus((data.project.exec_status as string) ?? "none");
        }

        if (data.constants) {
          // Coerce defensively: a poisoned row (a numeric column that ended
          // up storing the SQL special value NaN) must not propagate NaN
          // into the constants — which would cascade NaN through every
          // calculated cell and total. Fall back to the sensible defaults.
          const numOr = (v: unknown, fallback: number) => {
            const n = parseFloat(String(v));
            return Number.isFinite(n) ? n : fallback;
          };
          setConstants({
            currencyRate: numOr(data.constants.currencyRate, DEFAULT_CONSTANTS.currencyRate),
            shippingRate: numOr(data.constants.shippingRate, DEFAULT_CONSTANTS.shippingRate),
            customsRate: numOr(data.constants.customsRate, DEFAULT_CONSTANTS.customsRate),
            profitMargin: numOr(data.constants.profitMargin, DEFAULT_CONSTANTS.profitMargin),
            taxRate: numOr(data.constants.taxRate, DEFAULT_CONSTANTS.taxRate),
          });
          setTargetCurrency(data.constants.targetCurrency ?? "JOD");
          setSourceCurrency(data.constants.sourceCurrency ?? "USD");
        }

        if (data.productLines) {
          setRows(
            data.productLines.map((l: any) => {
              const price = parseFloat(l.priceUsd);
              return {
                id: l.id,
                position: l.position,
                itemModel: l.itemModel,
                priceUsd: Number.isFinite(price) ? price : 0,
                quantity: l.quantity,
                shippingOverride: l.shippingOverride != null ? parseFloat(l.shippingOverride) : null,
                customsOverride: l.customsOverride != null ? parseFloat(l.customsOverride) : null,
                shippingRateOverride: l.shippingRateOverride != null ? parseFloat(l.shippingRateOverride) : null,
                customsRateOverride: l.customsRateOverride != null ? parseFloat(l.customsRateOverride) : null,
                profitRateOverride: l.profitRateOverride != null ? parseFloat(l.profitRateOverride) : null,
                description: l.description ?? null,
              };
            })
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setSavedAt(null);
        }
      }
    };

    load();
    return () => { cancelled = true; };
  }, [selectedProjectId]);

  // Manual save
  const handleSave = useCallback(async () => {
    if (!selectedProjectId || saving) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/pricing/projects/${selectedProjectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName,
          date: projectDate || null,
          responsiblePerson: responsiblePerson || null,
          constants: { ...constants, targetCurrency, sourceCurrency },
          productLines: rows,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.productLines) {
          setRows((prev) =>
            prev.map((r, i) =>
              data.productLines[i] ? { ...r, id: data.productLines[i].id, position: data.productLines[i].position } : r
            )
          );
        }
        setProjects((prev) =>
          prev.map((p) =>
            p.id === selectedProjectId
              ? { ...p, name: projectName, date: projectDate || null, responsiblePerson: responsiblePerson || null }
              : p
          )
        );
        setSavedAt(new Date());
      }
    } finally {
      setSaving(false);
    }
  }, [selectedProjectId, saving, projectName, projectDate, responsiblePerson, constants, targetCurrency, rows]);

  // Save the current in-memory edits as a brand new revision linked
  // back to the source project. The server clones the project row,
  // constants and product lines, but we hand it the live snapshot so
  // unsaved tweaks aren't lost.
  const handleSaveAsRevision = useCallback(async () => {
    if (!selectedProjectId || savingRevision) return;
    setSavingRevision(true);
    try {
      const res = await fetch(`/api/pricing/projects/${selectedProjectId}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: projectName || undefined,
          date: projectDate || null,
          responsiblePerson: responsiblePerson || null,
          constants: { ...constants, targetCurrency, sourceCurrency },
          productLines: rows,
        }),
      });
      if (res.ok) {
        const created = await res.json();
        await loadProjects();
        setSelectedProjectId(created.id);
        setSavedAt(new Date());
      } else {
        const data = await res.json().catch(() => null);
        alert(data?.error ?? "Failed to save revision");
      }
    } finally {
      setSavingRevision(false);
    }
  }, [
    selectedProjectId,
    savingRevision,
    projectName,
    projectDate,
    responsiblePerson,
    constants,
    targetCurrency,
    sourceCurrency,
    rows,
    loadProjects,
  ]);

  // Submit this pricing sheet to the executive manager for confirmation.
  const handleSubmitExec = useCallback(async () => {
    if (!selectedProjectId) return;
    setSubmittingExec(true);
    try {
      const res = await fetch("/api/executive/confirmations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "pricing",
          id: selectedProjectId,
          action: "submit",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit");
      setExecStatus("pending");
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setSubmittingExec(false);
    }
  }, [selectedProjectId]);

  // Convert this pricing project into a fresh active quotation in the
  // host's quotation system, then hand the user off to the Designer.
  // We save any unsaved edits first so the quotation matches what the
  // user is currently seeing on screen.
  const handleConvertToQuotation = useCallback(
    async (
      folderId: number | null,
      projectId: number | null,
      kind: "company" | "individual",
      companyId: number | null,
    ) => {
      if (!selectedProjectId || converting) return;
      setConverting(true);
      try {
        // ALWAYS persist the on-screen sheet before converting, and verify it
        // succeeded. The server-side convert reads product lines straight from
        // the DB, so if the DB is out of sync with what the user sees it wrongly
        // reports "Project has no priced product lines yet". The old code
        // skipped this save whenever a stale `savedAt` checkpoint existed (and
        // ignored the save's result), which is exactly how a sheet full of
        // priced lines could fail to convert.
        const saveRes = await fetch(
          `/api/pricing/projects/${selectedProjectId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: projectName,
              date: projectDate || null,
              responsiblePerson: responsiblePerson || null,
              constants: { ...constants, targetCurrency, sourceCurrency },
              productLines: rows,
            }),
          },
        );
        if (!saveRes.ok) {
          const e = (await saveRes.json().catch(() => ({}))) as {
            error?: string;
          };
          alert(e?.error ?? "Couldn't save the pricing sheet before converting.");
          return;
        }
        setSavedAt(new Date());
        const res = await fetch(
          `/api/pricing/projects/${selectedProjectId}/convert-to-quotation`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              includeOptionalIntro: true,
              folderId,
              projectId,
            }),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          alert(err?.error ?? "Failed to convert to quotation");
          return;
        }
        const data = (await res.json()) as {
          quotationId: number;
          redirectTo: string;
        };
        // Land the user on the CRM drill-down for the company/client/project
        // the quotation was filed under — that view carries the breadcrumb
        // (Dashboard → CRM → Companies → …) so the new company and quotation
        // are easy to find. Fall back to the bare viewer when we don't have
        // enough context to build the drill-down URL.
        let target = data.redirectTo;
        if (folderId != null && projectId != null && data.quotationId) {
          if (kind === "company" && companyId != null) {
            target = `/crm/company/${companyId}/clients/${folderId}/${projectId}/quotations/${data.quotationId}`;
          } else if (kind === "individual") {
            target = `/crm/individual/${folderId}/${projectId}/quotations/${data.quotationId}`;
          }
        }
        window.location.href = target;
      } finally {
        setConverting(false);
      }
    },
    [
      selectedProjectId,
      converting,
      savedAt,
      rows,
      projectName,
      projectDate,
      responsiblePerson,
      constants,
      targetCurrency,
      sourceCurrency,
    ],
  );

  const handleCreateProject = useCallback(async (name: string) => {
    const res = await fetch("/api/pricing/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, manufacturerId, ownerUserId }),
    });
    if (res.ok) {
      const project = await res.json();
      // Render the new project immediately — insert it into the list and
      // select it now, then reconcile ordering/fields from the server in the
      // background. Previously we awaited a full refetch before anything
      // showed, so a new project appeared to "not render immediately".
      setProjects((prev) =>
        prev.some((p) => p.id === project.id) ? prev : [...prev, project],
      );
      setSelectedProjectId(project.id);
      loadProjects();
    }
  }, [manufacturerId, ownerUserId, loadProjects]);

  const handleAddRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      {
        id: Date.now(),
        position: prev.length + 1,
        itemModel: "",
        priceUsd: 0,
        quantity: 1,
      },
    ]);
  }, []);

  // Bulk paste: turn a clipboard block (one item per line, optionally
  // tab-separated Item Model / USD Price / Qty columns straight out of
  // Excel or Sheets) into product rows and append them. This is the only
  // way to populate a brand-new sheet by paste, since the ProductTable —
  // and its per-column paste buttons — only render once a row exists.
  const pasteRowsFromText = useCallback((text: string) => {
    if (!text || !text.trim()) return;
    setRows((prev) => {
      const lines = text.replace(/\r\n?/g, "\n").split("\n");
      while (lines.length > 1 && lines[lines.length - 1].trim() === "") lines.pop();
      const idSeed = Date.now();
      const added = lines.reduce<ProductRow[]>((acc, line) => {
        const cells = line.split("\t");
        const itemModel = (cells[0] ?? "").trim();
        const priceRaw = (cells[1] ?? "").replace(/[^0-9.]/g, "");
        const qtyRaw = (cells[2] ?? "").replace(/[^0-9]/g, "");
        // Skip blank lines so a trailing newline doesn't add an empty row.
        if (itemModel === "" && priceRaw === "" && qtyRaw === "") return acc;
        acc.push({
          id: idSeed + acc.length,
          position: prev.length + acc.length + 1,
          itemModel,
          priceUsd: parseFloat(priceRaw) || 0,
          quantity: parseInt(qtyRaw, 10) || 1,
        });
        return acc;
      }, []);
      if (added.length === 0) return prev;
      setPasteHint(
        `Pasted ${added.length} row${added.length === 1 ? "" : "s"}`,
      );
      return [...prev, ...added].map((r, i) => ({ ...r, position: i + 1 }));
    });
  }, []);

  const pasteRowsFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      pasteRowsFromText(text);
    } catch {
      setPasteHint(
        "Couldn't read the clipboard — click the sheet and press Ctrl/Cmd+V instead.",
      );
    }
  }, [pasteRowsFromText]);

  // Clear the paste feedback after a few seconds so it doesn't linger.
  useEffect(() => {
    if (!pasteHint) return;
    const t = setTimeout(() => setPasteHint(""), 5000);
    return () => clearTimeout(t);
  }, [pasteHint]);

  const handleClearRows = useCallback(() => {
    setRows((prev) => {
      if (prev.length === 0) return prev;
      if (confirm("Clear all product rows?")) return [];
      return prev;
    });
  }, []);

  const handleDeleteProject = useCallback(async () => {
    if (!selectedProjectId) return;
    const project = projects.find((p) => p.id === selectedProjectId);
    if (!confirmDelete(`Permanently delete "${project?.name ?? "this project"}" and all its lines?`)) return;
    const res = await fetch(`/api/pricing/projects/${selectedProjectId}`, { method: "DELETE" });
    if (res.ok) {
      setSelectedProjectId(null);
      initialSelectDone.current = false;
      await loadProjects();
    }
  }, [selectedProjectId, projects, loadProjects]);

  const handleCurrencyChange = useCallback((code: string, rate: number) => {
    setTargetCurrency(code);
    setConstants((prev) => ({ ...prev, currencyRate: rate }));
  }, []);

  const handleSourceCurrencyChange = useCallback((code: string) => {
    setSourceCurrency(code);
  }, []);

  const selectedProject = projects.find((p) => p.id === selectedProjectId);

  const handleExportCsv = useCallback(() => {
    if (!selectedProject || rows.length === 0) return;
    exportToCsv(rows, constants, projectName || selectedProject.name, manufacturerName, targetCurrency, responsiblePerson);
    setShowExportMenu(false);
  }, [selectedProject, rows, constants, projectName, manufacturerName, targetCurrency, responsiblePerson]);

  const handleExportPrint = useCallback(() => {
    if (!selectedProject || rows.length === 0) return;
    exportToPrint(rows, constants, projectName || selectedProject.name, manufacturerName, targetCurrency, responsiblePerson);
    setShowExportMenu(false);
  }, [selectedProject, rows, constants, projectName, manufacturerName, targetCurrency, responsiblePerson]);

  return (
    <div className="space-y-5">
      {/* Header row */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ProjectSelector
            projects={projects}
            selectedId={selectedProjectId}
            onSelect={setSelectedProjectId}
            onCreateNew={handleCreateProject}
          />

          {/* Editable project name + date */}
          {selectedProjectId && !loading && (
            <>
              <input
                type="text"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                placeholder="Project name…"
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              />
              <input
                type="text"
                value={responsiblePerson}
                onChange={(e) => setResponsiblePerson(e.target.value)}
                placeholder="Responsible person…"
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 placeholder-gray-400 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              />
              <input
                type="date"
                value={projectDate}
                onChange={(e) => setProjectDate(e.target.value)}
                className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/20"
              />
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Save status */}
          {!saving && savedAt && (
            <span className="text-xs text-gray-400">
              Saved {savedAt.toLocaleTimeString()}
            </span>
          )}

          {/* Manual Save button */}
          {selectedProjectId && !loading && (
            <>
              <button
                onClick={handleDeleteProject}
                title="Move project to trash"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
              >
                <FolderMinus className="h-3.5 w-3.5" />
                Delete
              </button>
              <button
                onClick={handleSaveAsRevision}
                disabled={saving || savingRevision}
                title="Save current edits as a new revision linked to this project"
                className="flex items-center gap-1.5 rounded-lg border border-cyan-200 bg-white px-3 py-1.5 text-xs font-medium text-cyan-700 transition-colors hover:border-cyan-300 hover:bg-cyan-50 disabled:opacity-60"
              >
                <GitBranch className="h-3.5 w-3.5" />
                {savingRevision ? "Saving…" : "Save as Revision"}
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-cyan-400 disabled:opacity-60"
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? "Saving…" : "Save"}
              </button>
              {canSubmitExec && (
                <button
                  onClick={handleSubmitExec}
                  disabled={submittingExec || execStatus === "pending"}
                  title="Submit this pricing sheet to the executive manager for confirmation"
                  className="flex items-center gap-1.5 rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-xs font-medium text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-50 disabled:opacity-60"
                >
                  <BadgeCheck className="h-3.5 w-3.5" />
                  {submittingExec
                    ? "Submitting…"
                    : execStatus === "pending"
                      ? "Awaiting confirmation"
                      : execStatus === "confirmed"
                        ? "Confirmed ✓"
                        : execStatus === "rejected"
                          ? "Rejected — re-submit"
                          : "Submit for confirmation"}
                </button>
              )}
              <button
                onClick={() => setShowConvertDialog(true)}
                disabled={converting || rows.length === 0}
                title="Create a draft quotation in the Designer pre-filled from these prices"
                className="flex items-center gap-1.5 rounded-lg bg-magic-red px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-magic-red/90 disabled:opacity-60"
              >
                <FileSignature className="h-3.5 w-3.5" />
                {converting ? "Converting…" : "Convert to Quotation"}
              </button>
            </>
          )}

          {/* Export button */}
          {selectedProjectId && rows.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowExportMenu((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:border-cyan-300 hover:bg-cyan-50 hover:text-cyan-700"
              >
                <Download className="h-3.5 w-3.5" />
                Export
              </button>
              {showExportMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowExportMenu(false)}
                  />
                  <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-gray-200 bg-white py-1 shadow-lg">
                    <button
                      onClick={handleExportPrint}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      <Printer className="h-3.5 w-3.5 text-gray-400" />
                      Print / Save as PDF
                    </button>
                    <button
                      onClick={handleExportCsv}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-gray-400" />
                      Export as CSV
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {projectsLoading || loading ? (
        <PageLoader label="Loading pricing sheet…" />
      ) : !selectedProjectId ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-gray-300">
          <div className="text-center">
            <p className="text-sm text-gray-500">No project selected</p>
            <p className="mt-1 text-xs text-gray-400">
              Use the dropdown above to select or create a project
            </p>
          </div>
        </div>
      ) : (
        <>
          {/* Constants */}
          <ConstantsPanel
            constants={constants}
            onChange={setConstants}
            saving={saving}
            sourceCurrency={sourceCurrency}
            targetCurrency={targetCurrency}
            onSourceCurrencyChange={handleSourceCurrencyChange}
            onCurrencyChange={handleCurrencyChange}
          />

          {/* Product table */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-widest text-gray-500">
                Product Lines
              </h3>
              <div className="flex items-center gap-2">
                {rows.length > 0 && (
                  <button
                    onClick={handleClearRows}
                    className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 className="h-3 w-3" />
                    Clear
                  </button>
                )}
                <button
                  onClick={pasteRowsFromClipboard}
                  title="Paste rows from clipboard — one item per line, optionally tab-separated Item Model / USD Price / Qty"
                  className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-600"
                >
                  <ClipboardPaste className="h-3 w-3" />
                  Paste
                </button>
                <button
                  onClick={handleAddRow}
                  className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-cyan-400"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Row
                </button>
              </div>
            </div>
            {pasteHint && (
              <p className="mb-2 text-xs text-cyan-600">{pasteHint}</p>
            )}
            {rows.length === 0 ? (
              <div
                tabIndex={0}
                onPaste={(e) => {
                  e.preventDefault();
                  pasteRowsFromText(e.clipboardData.getData("text"));
                }}
                className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-200 outline-none transition-colors focus:border-cyan-300 focus:bg-cyan-50/30"
              >
                <div className="text-center">
                  <p className="text-sm text-gray-400">No products yet</p>
                  <p className="mt-1 text-xs text-gray-400">
                    Click here and press Ctrl/Cmd+V to paste a list —
                    columns: Item Model, USD Price, Qty
                  </p>
                  <div className="mt-3 flex items-center justify-center gap-2">
                    <button
                      onClick={pasteRowsFromClipboard}
                      className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-500 transition-colors hover:border-cyan-200 hover:bg-cyan-50 hover:text-cyan-600"
                    >
                      <ClipboardPaste className="h-3.5 w-3.5" />
                      Paste from clipboard
                    </button>
                    <button
                      onClick={handleAddRow}
                      className="flex items-center gap-1.5 rounded-lg bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-cyan-400"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Row
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <ProductTable
                rows={rows}
                constants={constants}
                onChange={setRows}
                targetCurrency={targetCurrency}
              />
            )}
          </div>

          {/* Charts */}
          <PricingCharts rows={rows} constants={constants} />
        </>
      )}

      <ConvertToQuotationDialog
        open={showConvertDialog}
        converting={converting}
        onClose={() => setShowConvertDialog(false)}
        onConfirm={({ folderId, projectId, kind, companyId }) => {
          void handleConvertToQuotation(folderId, projectId, kind, companyId);
        }}
      />
    </div>
  );
}
