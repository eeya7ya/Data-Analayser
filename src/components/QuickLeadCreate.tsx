"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import LeadCreateForm from "@/components/LeadCreateForm";

/**
 * Dashboard quick-create lead (V1.8). A thin collapsible wrapper around the
 * shared LeadCreateForm — the SAME form used on /leads/new and the RFQ flow —
 * so "open a new lead" looks and behaves identically everywhere. This wrapper
 * only adds the "New lead" toggle and the inline "created" confirmation; the
 * fields, client picker and file attachments all live in LeadCreateForm.
 */
export default function QuickLeadCreate() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<{ ref: string; id: number } | null>(null);

  if (!open) {
    return (
      <div className="rounded-2xl border border-dashed border-magic-border bg-white/60 p-4">
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setDone(null);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-magic-red px-4 py-2 text-sm font-semibold text-white hover:bg-magic-red/90"
        >
          <Plus className="h-4 w-4" />
          New lead
        </button>
        {done && (
          <span className="ml-3 text-sm text-emerald-700">
            Created{" "}
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => router.push(`/leads/${done.id}`)}
            >
              {done.ref || "lead"}
            </button>{" "}
            — it&apos;s in the presales queue.
          </span>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="px-1 text-sm font-bold uppercase tracking-wide text-magic-ink/70">
        New lead
      </h2>
      <LeadCreateForm
        submitLabel="Create lead"
        onCancel={() => setOpen(false)}
        onCreated={(lead) => {
          setDone({ ref: lead.ref, id: lead.id });
          setOpen(false);
        }}
      />
    </div>
  );
}
