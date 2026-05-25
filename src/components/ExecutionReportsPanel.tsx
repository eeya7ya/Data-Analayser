"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Execution reports for a project. Assigned technicians / engineers post
 * progress updates, blockers, and completion notes; the project manager
 * and owner read them. The post form only appears when the API says the
 * viewer may post (assigned member / owner / admin).
 */

interface ReportRow {
  id: number;
  kind: "update" | "blocker" | "done";
  progress: number | null;
  body: string;
  created_at: string;
  author_username: string | null;
  author_name: string | null;
}

const KIND_STYLE: Record<string, string> = {
  update: "border-indigo-300 bg-indigo-50 text-indigo-700",
  blocker: "border-amber-300 bg-amber-50 text-amber-800",
  done: "border-emerald-300 bg-emerald-50 text-emerald-700",
};
const KIND_LABEL: Record<string, string> = {
  update: "Progress",
  blocker: "Blocker",
  done: "Completion",
};

export default function ExecutionReportsPanel({
  projectId,
}: {
  projectId: number;
}) {
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [canPost, setCanPost] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<"update" | "blocker" | "done">("update");
  const [progress, setProgress] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/execution-reports?project_id=${projectId}`,
        { cache: "no-store" },
      );
      const data = (await res.json()) as {
        reports?: ReportRow[];
        can_post?: boolean;
      };
      setReports(data.reports ?? []);
      setCanPost(!!data.can_post);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/execution-reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project_id: projectId,
          kind,
          progress: progress === "" ? null : Number(progress),
          body: body.trim(),
        }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setBody("");
      setProgress("");
      setKind("update");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-magic-border bg-white p-5">
      <h2 className="text-lg font-semibold text-magic-ink mb-1">
        Execution reports
      </h2>
      <p className="text-xs text-magic-ink/60 mb-3">
        Progress updates and feedback from the assigned technicians /
        engineers.
      </p>

      {canPost && (
        <div className="mb-4 rounded-lg border border-dashed border-magic-border bg-magic-soft/30 p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-2">
            <select
              value={kind}
              onChange={(e) =>
                setKind(e.target.value as "update" | "blocker" | "done")
              }
              className="rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
            >
              <option value="update">Progress update</option>
              <option value="blocker">Blocker / issue</option>
              <option value="done">Completion note</option>
            </select>
            <input
              type="number"
              min={0}
              max={100}
              value={progress}
              onChange={(e) => setProgress(e.target.value)}
              placeholder="Progress % (optional)"
              className="rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
            />
          </div>
          <textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What's the status? Any blockers, photos to follow, parts needed, estimated finish…"
            className="w-full rounded border border-magic-border bg-white px-2 py-1.5 text-sm"
          />
          <div className="flex justify-end">
            <button
              onClick={() => void submit()}
              disabled={busy || !body.trim()}
              className="rounded-md bg-magic-red px-3 py-1.5 text-xs font-semibold text-white hover:bg-magic-red/90 disabled:opacity-50"
            >
              {busy ? "Posting…" : "Post report"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="mb-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-magic-ink/50">Loading reports…</p>
      ) : reports.length === 0 ? (
        <p className="text-sm text-magic-ink/50 italic">
          No execution reports yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {reports.map((r) => (
            <li
              key={r.id}
              className="rounded-lg border border-magic-border/60 p-3"
            >
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${KIND_STYLE[r.kind]}`}
                >
                  {KIND_LABEL[r.kind] ?? r.kind}
                </span>
                {r.progress !== null && (
                  <span className="text-[11px] font-semibold text-magic-ink/70">
                    {r.progress}%
                  </span>
                )}
                <span className="ml-auto text-[11px] text-magic-ink/40">
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-sm text-magic-ink/80">
                {r.body}
              </p>
              <p className="mt-1 text-[11px] text-magic-ink/40">
                by {r.author_name || r.author_username || "—"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
