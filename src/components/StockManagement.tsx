"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera } from "lucide-react";

/**
 * StockManagement — the V1.5A stock module surface (Storage workspace).
 *
 * Two sub-tabs:
 *   • Stock     — live levels per item (total SUMMED from placements, with a
 *                 low-stock flag), per-node breakdown, per-item history, and a
 *                 Record-movement action (IN / OUT / MOVE / ADJUST).
 *   • Locations — the editable location TREE (any depth).
 *
 * Everything is event-sourced: movements POST to /api/storage/events which
 * appends to the ledger and updates the derived placement cache atomically.
 * See docs/storage-module-v1.5A.md.
 */

interface Node {
  id: number;
  parent_id: number | null;
  name: string;
  deleted_at: string | null;
  path: string;
  depth: number;
}

interface Item {
  item_id: number;
  label: string;
  vendor: string;
  model: string;
  reorder_point: number;
  total: number;
}

interface Placement {
  item_id: number;
  node_id: number;
  qty: number;
  node_name: string;
}

type SubTab = "stock" | "locations";

export default function StockManagement({
  canManage,
  canRecord,
}: {
  canManage: boolean;
  canRecord: boolean;
}) {
  const [tab, setTab] = useState<SubTab>("stock");
  const [error, setError] = useState<string | null>(null);
  const [nodes, setNodes] = useState<Node[]>([]);

  const loadNodes = useCallback(async () => {
    try {
      const res = await fetch("/api/storage/locations", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { nodes: Node[] };
      setNodes(data.nodes);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadNodes();
  }, [loadNodes]);

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 border-b border-magic-border">
        <TabButton active={tab === "stock"} onClick={() => setTab("stock")}>
          Stock
        </TabButton>
        <TabButton active={tab === "locations"} onClick={() => setTab("locations")}>
          Locations
        </TabButton>
      </div>

      {tab === "stock" && (
        <StockView
          nodes={nodes}
          canManage={canManage}
          canRecord={canRecord}
          onError={setError}
        />
      )}
      {tab === "locations" && (
        <LocationsView
          nodes={nodes}
          canManage={canManage}
          reload={loadNodes}
          onError={setError}
        />
      )}

      {error && (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Locations */

function LocationsView({
  nodes,
  canManage,
  reload,
  onError,
}: {
  nodes: Node[];
  canManage: boolean;
  reload: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);

  async function call(method: string, body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch("/api/storage/locations", {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      await reload();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addRoot() {
    const name = window.prompt("New top-level location name:");
    if (name && name.trim()) void call("POST", { name: name.trim() });
  }
  function addChild(parent: Node) {
    const name = window.prompt(`New location under "${parent.name}":`);
    if (name && name.trim())
      void call("POST", { name: name.trim(), parent_id: parent.id });
  }
  function rename(node: Node) {
    const name = window.prompt("Rename location:", node.name);
    if (name && name.trim() && name.trim() !== node.name)
      void call("PATCH", { id: node.id, name: name.trim() });
  }
  function archive(node: Node) {
    const archived = !node.deleted_at;
    if (
      archived &&
      !window.confirm(
        `Archive "${node.name}"? Its stock history stays; you can unarchive any time.`,
      )
    )
      return;
    void call("PATCH", { id: node.id, archived });
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <button
          onClick={addRoot}
          disabled={busy}
          className="rounded-lg bg-magic-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-magic-red/90 disabled:opacity-50"
        >
          + Add top-level location
        </button>
      )}

      {nodes.length === 0 ? (
        <p className="text-sm italic text-magic-ink/50">
          No locations yet.{canManage ? " Add your first one above." : ""}
        </p>
      ) : (
        <ul className="rounded-xl border border-magic-border bg-white">
          {nodes.map((n) => (
            <li
              key={n.id}
              className={`flex items-center justify-between gap-2 border-b border-magic-border/40 px-3 py-2 last:border-b-0 ${
                n.deleted_at ? "opacity-50" : ""
              }`}
            >
              <div
                className="min-w-0"
                style={{ paddingLeft: `${n.depth * 18}px` }}
              >
                <span className="text-sm font-medium text-magic-ink">
                  {n.depth > 0 && <span className="text-magic-ink/30">└ </span>}
                  {n.name}
                </span>
                {n.deleted_at && (
                  <span className="ml-2 text-xs text-amber-700">archived</span>
                )}
                <div className="truncate text-xs text-magic-ink/45">{n.path}</div>
              </div>
              {canManage && (
                <div className="flex shrink-0 items-center gap-1">
                  {!n.deleted_at && (
                    <>
                      <IconBtn label="Add child" onClick={() => addChild(n)}>
                        +
                      </IconBtn>
                      <IconBtn label="Rename" onClick={() => rename(n)}>
                        ✎
                      </IconBtn>
                    </>
                  )}
                  <IconBtn
                    label={n.deleted_at ? "Unarchive" : "Archive"}
                    onClick={() => archive(n)}
                  >
                    {n.deleted_at ? "↩" : "🗑"}
                  </IconBtn>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- Stock */

function StockView({
  nodes,
  canManage,
  canRecord,
  onError,
}: {
  nodes: Node[];
  canManage: boolean;
  canRecord: boolean;
  onError: (m: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [query, setQuery] = useState("");
  const [nodeFilter, setNodeFilter] = useState<number | "">("");
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const activeNodes = useMemo(() => nodes.filter((n) => !n.deleted_at), [nodes]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("q", query.trim());
      if (nodeFilter !== "") params.set("node_id", String(nodeFilter));
      const res = await fetch(`/api/storage/stock?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { items: Item[]; placements: Placement[] };
      setItems(data.items);
      setPlacements(data.placements);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, nodeFilter, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="search"
          placeholder="Search item (vendor / model)…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-w-0 flex-1 rounded border border-magic-border bg-white px-3 py-1.5 text-sm"
        />
        <select
          value={nodeFilter}
          onChange={(e) =>
            setNodeFilter(e.target.value === "" ? "" : Number(e.target.value))
          }
          className="rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All locations</option>
          {activeNodes.map((n) => (
            <option key={n.id} value={n.id}>
              {n.path}
            </option>
          ))}
        </select>
        {canRecord && (
          <button
            onClick={() => setShowModal(true)}
            className="rounded bg-magic-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-magic-red/90"
          >
            + Record movement
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-magic-ink/60">Loading stock…</p>
      ) : items.length === 0 ? (
        <p className="text-sm italic text-magic-ink/50">
          No stock yet. {canRecord ? 'Use "Record movement" to receive stock.' : ""}
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((it) => (
            <ItemRow
              key={it.item_id}
              item={it}
              placements={placements.filter((p) => p.item_id === it.item_id)}
              canManage={canManage}
              onChanged={load}
              onError={onError}
            />
          ))}
        </ul>
      )}

      {showModal && (
        <MovementModal
          nodes={activeNodes}
          canManage={canManage}
          onClose={() => setShowModal(false)}
          onDone={async () => {
            setShowModal(false);
            await load();
          }}
          onError={onError}
        />
      )}
    </div>
  );
}

function ItemRow({
  item,
  placements,
  canManage,
  onChanged,
  onError,
}: {
  item: Item;
  placements: Placement[];
  canManage: boolean;
  onChanged: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reorderDraft, setReorderDraft] = useState(String(item.reorder_point));
  const low = item.reorder_point > 0 && item.total <= item.reorder_point;

  useEffect(() => setReorderDraft(String(item.reorder_point)), [item.reorder_point]);

  async function saveReorder() {
    const n = Number(reorderDraft);
    if (!Number.isInteger(n) || n < 0) return;
    try {
      const res = await fetch("/api/storage/items", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: item.item_id, reorder_point: n }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      await onChanged();
    } catch (err) {
      onError((err as Error).message);
    }
  }

  return (
    <li className="rounded-xl border border-magic-border bg-white">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <button
          onClick={() => setOpen((v) => !v)}
          className="min-w-0 flex-1 text-left"
        >
          <div className="truncate text-sm font-semibold text-magic-ink">
            {item.label}
          </div>
          <div className="text-xs text-magic-ink/50">
            {placements.length} location{placements.length === 1 ? "" : "s"} · tap
            for history
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-3">
          {low && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
              Low
            </span>
          )}
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums text-magic-ink">
              {item.total}
            </div>
            <div className="text-[11px] text-magic-ink/45">on hand</div>
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-magic-border/50 px-3 py-2">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-magic-ink/70">
            <span className="font-semibold">By location:</span>
            {placements.length === 0 ? (
              <span className="italic text-magic-ink/40">none on hand</span>
            ) : (
              placements.map((p) => (
                <span
                  key={p.node_id}
                  className="rounded-full bg-magic-soft px-2 py-0.5"
                >
                  {p.node_name}: <b>{p.qty}</b>
                </span>
              ))
            )}
          </div>

          {canManage && (
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className="text-magic-ink/60">Reorder point:</span>
              <input
                type="number"
                min={0}
                value={reorderDraft}
                onChange={(e) => setReorderDraft(e.target.value)}
                className="w-20 rounded border border-magic-border px-2 py-1 text-right"
              />
              <button
                onClick={() => void saveReorder()}
                className="rounded bg-magic-ink/80 px-2 py-1 font-semibold text-white hover:bg-magic-ink"
              >
                Save
              </button>
            </div>
          )}

          <ItemHistory itemId={item.item_id} onError={onError} />
        </div>
      )}
    </li>
  );
}

interface HistoryEvent {
  id: number;
  type: string;
  qty: number;
  from_node_name: string | null;
  to_node_name: string | null;
  reason: string | null;
  recorded_at: string;
  actor_display_name: string | null;
  actor_username: string | null;
}

function ItemHistory({
  itemId,
  onError,
}: {
  itemId: number;
  onError: (m: string) => void;
}) {
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/storage/events?item_id=${itemId}`, {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { events: HistoryEvent[] };
        if (!cancelled) setEvents(data.events);
      } catch (err) {
        if (!cancelled) onError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemId, onError]);

  if (events === null)
    return <p className="text-xs text-magic-ink/50">Loading history…</p>;
  if (events.length === 0)
    return <p className="text-xs italic text-magic-ink/40">No movements yet.</p>;

  return (
    <ul className="space-y-1">
      {events.map((e) => (
        <li key={e.id} className="text-xs text-magic-ink/70">
          <span
            className={`mr-1 font-mono font-semibold ${
              e.type === "OUT"
                ? "text-red-600"
                : e.type === "IN"
                  ? "text-emerald-600"
                  : "text-magic-ink"
            }`}
          >
            {e.type}
          </span>
          <b>{e.qty}</b>
          {e.from_node_name && <> from {e.from_node_name}</>}
          {e.to_node_name && <> to {e.to_node_name}</>}
          {" · "}
          {new Date(e.recorded_at).toLocaleString()}
          {" · @"}
          {e.actor_display_name || e.actor_username || "?"}
          {e.reason && <span className="text-magic-ink/50"> · {e.reason}</span>}
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------- Movement modal */

interface PickItem {
  id: number;
  vendor: string;
  model: string;
  category: string;
  label: string;
  barcode?: string | null;
}

function MovementModal({
  nodes,
  canManage,
  onClose,
  onDone,
  onError,
}: {
  nodes: Node[];
  canManage: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
  onError: (m: string) => void;
}) {
  const [type, setType] = useState<"IN" | "OUT" | "MOVE" | "ADJUST">("IN");
  const [itemQuery, setItemQuery] = useState("");
  const [results, setResults] = useState<PickItem[]>([]);
  const [picked, setPicked] = useState<PickItem | null>(null);
  // Scan flow: a code from a USB/Bluetooth wedge scanner, manual entry, or the
  // camera. Tracks whether the current pick came from a scan (so the ledger
  // records method='scan') and the last code that matched nothing (to offer
  // mapping it onto a product).
  const [scanCode, setScanCode] = useState("");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [pickedViaScan, setPickedViaScan] = useState(false);
  const [unmatchedCode, setUnmatchedCode] = useState<string | null>(null);
  const [showCamera, setShowCamera] = useState(false);
  const [cameraSupported, setCameraSupported] = useState(false);

  useEffect(() => {
    // Show the camera button whenever the device exposes a camera API. We use
    // the native BarcodeDetector when present (Chromium/Android) and fall back
    // to a JS decoder (ZXing) elsewhere (iOS Safari, Firefox), so the camera
    // works cross-platform. The USB-wedge / manual input works everywhere.
    setCameraSupported(
      typeof navigator !== "undefined" &&
        !!navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === "function",
    );
  }, []);
  const [fromNode, setFromNode] = useState<number | "">("");
  const [toNode, setToNode] = useState<number | "">("");
  const [adjustDir, setAdjustDir] = useState<"increase" | "decrease">("increase");
  const [qty, setQty] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/storage/items?q=${encodeURIComponent(itemQuery)}`,
          { cache: "no-store" },
        );
        if (!res.ok) return;
        const data = (await res.json()) as { items: PickItem[] };
        if (!cancelled) setResults(data.items);
      } catch {
        /* soft-fail the picker search */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [itemQuery]);

  const needsFrom = type === "OUT" || type === "MOVE" || (type === "ADJUST" && adjustDir === "decrease");
  const needsTo = type === "IN" || type === "MOVE" || (type === "ADJUST" && adjustDir === "increase");

  /** Resolve a scanned/typed code to a product and pick it. */
  async function lookupCode(raw: string) {
    const code = raw.trim();
    if (!code) return;
    setScanMsg(null);
    setUnmatchedCode(null);
    try {
      const res = await fetch(
        `/api/storage/items?code=${encodeURIComponent(code)}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as { items?: PickItem[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      const found = data.items ?? [];
      if (found.length === 1) {
        setPicked(found[0]);
        setPickedViaScan(true);
        setScanCode("");
        setScanMsg(`Scanned: ${found[0].label}`);
      } else if (found.length > 1) {
        setResults(found);
        setScanMsg(`${found.length} matches for "${code}" — pick one below.`);
      } else {
        setUnmatchedCode(code);
        setScanMsg(`No item matches "${code}". Search and pick it to link the code.`);
      }
    } catch (err) {
      setScanMsg((err as Error).message);
    }
  }

  // Hardware barcode "terminal" (USB/Bluetooth wedge) types fast and ends with
  // Enter. Capture it globally so a scan still registers when the text input
  // isn't focused — ignored while the user is typing in a field, and only
  // rapid bursts (scanner speed, not human typing) are treated as a scan.
  const lookupRef = useRef(lookupCode);
  lookupRef.current = lookupCode;
  const pickedRef = useRef(picked);
  pickedRef.current = picked;
  useEffect(() => {
    let buf = "";
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      if (pickedRef.current) return; // an item is already picked
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        el?.isContentEditable
      ) {
        return; // the focused field handles its own input
      }
      const now = performance.now();
      if (now - last > 100) buf = ""; // slow gap → human typing, restart buffer
      last = now;
      if (e.key === "Enter") {
        if (buf.length >= 3) {
          const code = buf;
          buf = "";
          void lookupRef.current(code);
        }
        return;
      }
      if (e.key.length === 1) buf += e.key;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /** Map the last unmatched code onto the currently picked product (manager). */
  async function linkBarcode() {
    if (!picked || !unmatchedCode) return;
    try {
      const res = await fetch("/api/storage/items", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ item_id: picked.id, barcode: unmatchedCode }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      setScanMsg(`Linked ${unmatchedCode} → ${picked.label}.`);
      setUnmatchedCode(null);
      setPickedViaScan(true);
    } catch (err) {
      setScanMsg((err as Error).message);
    }
  }

  async function submit() {
    if (!picked) {
      onError("Pick an item first.");
      return;
    }
    const n = Number(qty);
    if (!Number.isInteger(n) || n <= 0) {
      onError("Quantity must be a whole number greater than 0.");
      return;
    }
    if (type === "ADJUST" && !reason.trim()) {
      onError("A correction (ADJUST) needs a reason.");
      return;
    }
    const body: Record<string, unknown> = {
      item_id: picked.id,
      type,
      qty: n,
      reason: reason.trim() || null,
      method: pickedViaScan ? "scan" : "manual",
    };
    if (needsFrom) body.from_node_id = fromNode === "" ? null : fromNode;
    if (needsTo) body.to_node_id = toNode === "" ? null : toNode;

    setBusy(true);
    try {
      const res = await fetch("/api/storage/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      await onDone();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-bold text-magic-ink">Record movement</h3>
          <button
            onClick={onClose}
            className="text-magic-ink/50 hover:text-magic-red"
          >
            ✕
          </button>
        </div>

        <div className="space-y-3">
          {/* Type */}
          <div className="flex flex-wrap gap-1">
            {(["IN", "OUT", "MOVE", "ADJUST"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setType(t)}
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  type === t
                    ? "border-magic-red bg-magic-red text-white"
                    : "border-magic-border text-magic-ink/70 hover:bg-magic-soft"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Item picker — scan or search */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-magic-ink/70">
              Item
            </label>
            {picked ? (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between rounded border border-magic-border px-2 py-1.5 text-sm">
                  <span className="truncate">
                    {picked.label}
                    {pickedViaScan && (
                      <span className="ml-1.5 rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                        SCANNED
                      </span>
                    )}
                  </span>
                  <button
                    onClick={() => {
                      setPicked(null);
                      setPickedViaScan(false);
                      setScanMsg(null);
                    }}
                    className="ml-2 text-xs text-magic-red"
                  >
                    change
                  </button>
                </div>
                {canManage && unmatchedCode && (
                  <button
                    onClick={() => void linkBarcode()}
                    className="w-full rounded border border-emerald-300 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    Link scanned code “{unmatchedCode}” to this item
                  </button>
                )}
              </div>
            ) : (
              <>
                {/* Scan row — USB/Bluetooth wedge, manual entry, or camera */}
                <div className="mb-1.5 flex gap-1.5">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Scan or type a barcode…"
                    value={scanCode}
                    onChange={(e) => setScanCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void lookupCode(scanCode);
                      }
                    }}
                    className="min-w-0 flex-1 rounded border border-magic-border px-2 py-1.5 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => void lookupCode(scanCode)}
                    className="shrink-0 rounded border border-magic-border px-2 py-1.5 text-xs font-semibold text-magic-ink/70 hover:bg-magic-soft"
                  >
                    Scan
                  </button>
                  {cameraSupported && (
                    <button
                      type="button"
                      onClick={() => setShowCamera(true)}
                      aria-label="Scan with camera"
                      className="shrink-0 rounded border border-magic-border px-2 py-1.5 text-magic-ink/70 hover:bg-magic-soft"
                    >
                      <Camera className="h-4 w-4" />
                    </button>
                  )}
                </div>
                {scanMsg && (
                  <p className="mb-1.5 text-xs text-magic-ink/60">{scanMsg}</p>
                )}

                <input
                  type="search"
                  placeholder="…or search vendor / model / category"
                  value={itemQuery}
                  onChange={(e) => setItemQuery(e.target.value)}
                  className="w-full rounded border border-magic-border px-2 py-1.5 text-sm"
                />
                {results.length > 0 && (
                  <ul className="mt-1 max-h-40 overflow-y-auto rounded border border-magic-border">
                    {results.map((r) => (
                      <li key={r.id}>
                        <button
                          onClick={() => {
                            setPicked(r);
                            setPickedViaScan(false);
                          }}
                          className="block w-full px-2 py-1.5 text-left text-sm hover:bg-magic-soft"
                        >
                          {r.label}
                          {r.category && (
                            <span className="text-magic-ink/40"> · {r.category}</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {showCamera && (
                  <CameraScanner
                    onDetected={(code) => {
                      setShowCamera(false);
                      setScanCode(code);
                      void lookupCode(code);
                    }}
                    onClose={() => setShowCamera(false)}
                    onError={(m) => {
                      setShowCamera(false);
                      setScanMsg(m);
                    }}
                  />
                )}
              </>
            )}
          </div>

          {/* ADJUST direction */}
          {type === "ADJUST" && (
            <div className="flex gap-1">
              {(["increase", "decrease"] as const).map((d) => (
                <button
                  key={d}
                  onClick={() => setAdjustDir(d)}
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                    adjustDir === d
                      ? "border-magic-ink bg-magic-ink text-white"
                      : "border-magic-border text-magic-ink/70 hover:bg-magic-soft"
                  }`}
                >
                  {d === "increase" ? "Increase (+)" : "Decrease (−)"}
                </button>
              ))}
            </div>
          )}

          {/* Nodes */}
          {needsFrom && (
            <NodeSelect
              label={type === "MOVE" ? "From location" : "Location"}
              nodes={nodes}
              value={fromNode}
              onChange={setFromNode}
            />
          )}
          {needsTo && (
            <NodeSelect
              label={type === "MOVE" ? "To location" : "Location"}
              nodes={nodes}
              value={toNode}
              onChange={setToNode}
            />
          )}

          {/* Qty */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-magic-ink/70">
              Quantity
            </label>
            <input
              type="number"
              min={1}
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="w-full rounded border border-magic-border px-2 py-1.5 text-sm"
            />
          </div>

          {/* Reason */}
          <div>
            <label className="mb-1 block text-xs font-semibold text-magic-ink/70">
              Reason {type === "ADJUST" ? "(required)" : "(optional)"}
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                type === "ADJUST" ? "e.g. recount: shelf had 68, system said 70" : ""
              }
              className="w-full rounded border border-magic-border px-2 py-1.5 text-sm"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-magic-border px-3 py-1.5 text-sm font-semibold hover:bg-magic-soft"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={busy}
            className="rounded-lg bg-magic-red px-4 py-1.5 text-sm font-semibold text-white hover:bg-magic-red/90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Record"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NodeSelect({
  label,
  nodes,
  value,
  onChange,
}: {
  label: string;
  nodes: Node[];
  value: number | "";
  onChange: (v: number | "") => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-semibold text-magic-ink/70">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        className="w-full rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
      >
        <option value="">— pick a location —</option>
        {nodes.map((n) => (
          <option key={n.id} value={n.id}>
            {n.path}
          </option>
        ))}
      </select>
    </div>
  );
}

/* -------------------------------------------------------------- small bits */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition-colors ${
        active
          ? "border-magic-red text-magic-red"
          : "border-transparent text-magic-ink/60 hover:text-magic-ink"
      }`}
    >
      {children}
    </button>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className="rounded border border-magic-border px-2 py-1 text-xs text-magic-ink/70 hover:bg-magic-soft"
    >
      {children}
    </button>
  );
}

// ── Camera barcode scanner (progressive enhancement) ────────────────────────
// Uses the native BarcodeDetector (Chromium / Android Chrome). Shows a small
// live-camera overlay; on the first detected code it calls onDetected and the
// parent unmounts this, which stops the stream. Only rendered when supported.

interface DetectedBarcode {
  rawValue: string;
}
interface BarcodeDetectorLike {
  detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]>;
}
interface BarcodeDetectorCtor {
  new (opts?: { formats?: string[] }): BarcodeDetectorLike;
}

function CameraScanner({
  onDetected,
  onClose,
  onError,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
  onError: (msg: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  // Hold the latest callbacks in refs so the camera effect can run exactly
  // once (empty deps) without restarting the stream on every parent render.
  const onDetectedRef = useRef(onDetected);
  const onErrorRef = useRef(onError);
  onDetectedRef.current = onDetected;
  onErrorRef.current = onError;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let stopped = false;
    let detector: BarcodeDetectorLike | null = null;
    let zxingControls: { stop: () => void } | null = null;

    async function start() {
      const video = videoRef.current;
      if (!video) return;
      try {
        const Ctor = (
          window as unknown as { BarcodeDetector?: BarcodeDetectorCtor }
        ).BarcodeDetector;
        if (Ctor) {
          // Native fast path (Chromium / Android Chrome).
          detector = new Ctor();
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
          });
          video.srcObject = stream;
          await video.play();
          timer = setInterval(async () => {
            if (stopped || !detector || !videoRef.current) return;
            try {
              const codes = await detector.detect(videoRef.current);
              if (codes.length > 0 && codes[0].rawValue) {
                onDetectedRef.current(codes[0].rawValue);
              }
            } catch {
              /* transient detect error — keep scanning */
            }
          }, 300);
        } else {
          // Browsers without BarcodeDetector (iOS Safari, Firefox) use a JS
          // decoder, loaded on demand so it stays out of the main bundle. It
          // attaches the camera stream to the <video> and stops on cleanup.
          const { BrowserMultiFormatReader } = await import("@zxing/browser");
          const reader = new BrowserMultiFormatReader();
          zxingControls = await reader.decodeFromConstraints(
            { video: { facingMode: "environment" } },
            video,
            (result) => {
              if (result && !stopped) onDetectedRef.current(result.getText());
            },
          );
        }
      } catch (err) {
        onErrorRef.current(
          err instanceof Error ? err.message : "Could not start the camera.",
        );
      }
    }
    void start();

    return () => {
      stopped = true;
      if (timer) clearInterval(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (zxingControls) zxingControls.stop();
    };
  }, []);

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-magic-border bg-black">
      <video
        ref={videoRef}
        muted
        playsInline
        className="h-44 w-full object-cover"
      />
      <div className="flex items-center justify-between bg-magic-soft px-2 py-1 text-xs">
        <span className="text-magic-ink/60">
          Point the camera at a barcode / QR
        </span>
        <button onClick={onClose} className="font-semibold text-magic-red">
          Close
        </button>
      </div>
    </div>
  );
}
