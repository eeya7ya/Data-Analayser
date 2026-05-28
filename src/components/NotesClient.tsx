"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  NotebookPen,
  Plus,
  Trash2,
  Download,
  Check,
  Loader2,
} from "lucide-react";

/**
 * My Notes — a per-user notebook. A sidebar lists the user's notes; the
 * editor pane autosaves the selected note (debounced) and can export it to
 * a branded PDF (MagicTech logo + "My Notes" header) generated client-side
 * with jsPDF. All data is private to the signed-in user.
 */

interface Note {
  id: number;
  title: string;
  body: string;
  created_at: string;
  updated_at: string;
}

type SaveState = "idle" | "saving" | "saved";

export default function NotesClient({ authorName }: { authorName: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [loading, setLoading] = useState(true);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = notes.find((n) => n.id === selectedId) ?? null;

  const loadNotes = useCallback(async (selectFirst = false) => {
    try {
      const res = await fetch("/api/notes", { cache: "no-store" });
      const data = (await res.json()) as { notes?: Note[] };
      const list = data.notes ?? [];
      setNotes(list);
      if (selectFirst && list.length > 0) {
        setSelectedId(list[0].id);
        setTitle(list[0].title);
        setBody(list[0].body);
      }
    } catch {
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadNotes(true);
  }, [loadNotes]);

  function selectNote(n: Note) {
    // Flush any pending save for the note we're leaving.
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setSelectedId(n.id);
    setTitle(n.title);
    setBody(n.body);
    setSaveState("idle");
  }

  async function createNote() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled note", body: "" }),
    });
    const data = (await res.json()) as { note?: Note };
    if (data.note) {
      setNotes((prev) => [data.note!, ...prev]);
      setSelectedId(data.note.id);
      setTitle(data.note.title);
      setBody(data.note.body);
      setSaveState("idle");
    }
  }

  // Debounced autosave whenever the editor fields change for a real note.
  const scheduleSave = useCallback(
    (id: number, nextTitle: string, nextBody: string) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      setSaveState("saving");
      saveTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(`/api/notes/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: nextTitle, body: nextBody }),
          });
          const data = (await res.json()) as { note?: Note };
          if (data.note) {
            setNotes((prev) =>
              prev
                .map((n) => (n.id === id ? data.note! : n))
                .sort(
                  (a, b) =>
                    new Date(b.updated_at).getTime() -
                    new Date(a.updated_at).getTime(),
                ),
            );
          }
          setSaveState("saved");
          setTimeout(() => setSaveState("idle"), 1500);
        } catch {
          setSaveState("idle");
        }
      }, 900);
    },
    [],
  );

  function onTitleChange(v: string) {
    setTitle(v);
    if (selectedId) scheduleSave(selectedId, v, body);
  }
  function onBodyChange(v: string) {
    setBody(v);
    if (selectedId) scheduleSave(selectedId, title, v);
  }

  async function deleteNote(id: number) {
    if (!confirm("Delete this note? This can't be undone from here.")) return;
    await fetch(`/api/notes/${id}`, { method: "DELETE" });
    setNotes((prev) => {
      const next = prev.filter((n) => n.id !== id);
      if (selectedId === id) {
        if (next.length > 0) {
          setSelectedId(next[0].id);
          setTitle(next[0].title);
          setBody(next[0].body);
        } else {
          setSelectedId(null);
          setTitle("");
          setBody("");
        }
      }
      return next;
    });
  }

  async function downloadPdf() {
    if (!selected) return;
    await exportNoteToPdf(
      { title: title || "Untitled note", body, updated_at: selected.updated_at },
      authorName,
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-4 flex items-center gap-3">
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-magic-red/10 text-magic-red">
          <NotebookPen className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-magic-ink">
            My Notes
          </h1>
          <p className="text-sm text-magic-ink/55">
            Your private notebook. Autosaves as you type · export to PDF.
          </p>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-4 lg:grid-cols-[18rem_1fr]">
        {/* Sidebar */}
        <aside className="flex flex-col rounded-2xl border border-magic-border bg-white/80 shadow-mt-soft">
          <div className="flex items-center justify-between border-b border-magic-border/60 px-3 py-2.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-magic-ink/50">
              {notes.length} note{notes.length === 1 ? "" : "s"}
            </span>
            <button
              onClick={() => void createNote()}
              className="inline-flex items-center gap-1 rounded-lg bg-magic-red px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-magic-red/90"
            >
              <Plus className="h-3.5 w-3.5" />
              New
            </button>
          </div>
          <div className="max-h-[60vh] flex-1 overflow-y-auto p-2 lg:max-h-none">
            {loading ? (
              <p className="px-2 py-6 text-center text-xs text-magic-ink/40">
                Loading…
              </p>
            ) : notes.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-magic-ink/40">
                No notes yet. Hit “New” to start one.
              </p>
            ) : (
              <ul className="space-y-1">
                {notes.map((n) => {
                  const active = n.id === selectedId;
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => selectNote(n)}
                        className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${
                          active
                            ? "bg-magic-red/8 ring-1 ring-magic-red/30"
                            : "hover:bg-magic-soft"
                        }`}
                      >
                        <p
                          className={`truncate text-sm font-semibold ${
                            active ? "text-magic-red" : "text-magic-ink"
                          }`}
                        >
                          {n.title || "Untitled note"}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-magic-ink/45">
                          {n.body.trim()
                            ? n.body.replace(/\s+/g, " ").slice(0, 48)
                            : "Empty"}
                        </p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Editor */}
        <section className="flex flex-1 flex-col rounded-2xl border border-magic-border bg-white/80 shadow-mt-soft">
          {selected ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-magic-border/60 px-4 py-3">
                <div className="flex items-center gap-2 text-xs text-magic-ink/45">
                  {saveState === "saving" ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
                    </>
                  ) : saveState === "saved" ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-emerald-500" /> Saved
                    </>
                  ) : (
                    <>
                      Edited{" "}
                      {new Date(selected.updated_at).toLocaleDateString()}
                    </>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void downloadPdf()}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-magic-border bg-white px-3 py-1.5 text-sm font-semibold text-magic-ink/80 shadow-sm hover:bg-magic-soft"
                  >
                    <Download className="h-4 w-4" />
                    PDF
                  </button>
                  <button
                    onClick={() => void deleteNote(selected.id)}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-magic-border bg-white px-3 py-1.5 text-sm font-semibold text-magic-red shadow-sm hover:bg-magic-red/5"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                </div>
              </div>
              <div className="flex flex-1 flex-col px-4 py-3">
                <input
                  value={title}
                  onChange={(e) => onTitleChange(e.target.value)}
                  placeholder="Note title"
                  className="w-full border-0 bg-transparent text-xl font-bold text-magic-ink placeholder:text-magic-ink/30 focus:outline-none focus:ring-0"
                />
                <textarea
                  value={body}
                  onChange={(e) => onBodyChange(e.target.value)}
                  placeholder="Start writing…"
                  className="mt-2 min-h-[40vh] w-full flex-1 resize-none border-0 bg-transparent text-sm leading-relaxed text-magic-ink/85 placeholder:text-magic-ink/30 focus:outline-none focus:ring-0"
                />
              </div>
            </>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
              <NotebookPen className="h-10 w-10 text-magic-ink/20" />
              <p className="mt-3 text-sm font-semibold text-magic-ink/60">
                No note selected
              </p>
              <p className="mt-1 text-xs text-magic-ink/40">
                Pick a note on the left, or create a new one.
              </p>
              <button
                onClick={() => void createNote()}
                className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-magic-red/90"
              >
                <Plus className="h-4 w-4" />
                New note
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Fetch /logo.png as a data URL for embedding in the PDF. */
async function loadLogo(): Promise<{
  dataUrl: string;
  width: number;
  height: number;
} | null> {
  try {
    const res = await fetch("/logo.png");
    if (!res.ok) return null;
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const dims = await new Promise<{ width: number; height: number }>(
      (resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.width, height: img.height });
        img.onerror = () => resolve({ width: 1, height: 1 });
        img.src = dataUrl;
      },
    );
    return { dataUrl, ...dims };
  } catch {
    return null;
  }
}

/**
 * Render a single note to a clean A4 PDF: MagicTech logo top-left, "My
 * Notes" header, then the note title, date, author and wrapped body with
 * automatic page breaks.
 */
async function exportNoteToPdf(
  note: { title: string; body: string; updated_at: string },
  authorName: string,
) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 18;
  const contentW = pageW - margin * 2;

  // ── Branded header ──────────────────────────────────────────────
  const logo = await loadLogo();
  let headerBottom = margin;
  if (logo) {
    const logoW = 42;
    const logoH = (logo.height / logo.width) * logoW;
    doc.addImage(logo.dataUrl, "PNG", margin, margin, logoW, logoH);
    headerBottom = margin + logoH;
  }
  doc.setTextColor(226, 35, 26); // magic red
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("My Notes", pageW - margin, margin + 8, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120, 120, 120);
  doc.text(
    `${authorName} · ${new Date(note.updated_at).toLocaleDateString()}`,
    pageW - margin,
    margin + 14,
    { align: "right" },
  );

  let y = Math.max(headerBottom, margin + 18) + 8;
  // Divider
  doc.setDrawColor(226, 35, 26);
  doc.setLineWidth(0.6);
  doc.line(margin, y, pageW - margin, y);
  y += 10;

  // ── Title ───────────────────────────────────────────────────────
  doc.setTextColor(20, 20, 20);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  const titleLines = doc.splitTextToSize(note.title || "Untitled note", contentW);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 7 + 4;

  // ── Body ────────────────────────────────────────────────────────
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(40, 40, 40);
  const lineH = 6;
  const bodyLines = doc.splitTextToSize(note.body || "", contentW) as string[];
  for (const line of bodyLines) {
    if (y > pageH - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineH;
  }

  const safe = (note.title || "note")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 50) || "note";
  doc.save(`MyNotes-${safe}.pdf`);
}
