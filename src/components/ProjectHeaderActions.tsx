"use client";

import { usePathname } from "next/navigation";
import RequestQuotationButton from "@/components/RequestQuotationButton";

/**
 * Project-level action buttons (Request for Quotation) for the project
 * drill-down header. These are PROJECT actions, so they belong on the
 * project's own pages (the quotations list, POs, BOQs) — NOT inside a single
 * quotation's viewer. When the active route is a specific quotation
 * (`.../quotations/<id>`) this renders nothing, keeping the quotation view
 * focused on the document. RFQ itself is additionally sales-only (see
 * RequestQuotationButton).
 *
 * The legacy "Request stock" button was removed in V1.5A along with the flat
 * inventory model; project-linked stock movements move to the new
 * event-sourced stock module (docs/storage-module-v1.5A.md).
 */
export default function ProjectHeaderActions({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const pathname = usePathname() ?? "";
  // .../quotations/<digits> (optionally with a trailing segment) is the
  // quotation viewer — hide project actions there.
  const onQuotationViewer = /\/quotations\/\d+(?:\/|$)/.test(pathname);
  if (onQuotationViewer) return null;

  return (
    <div className="no-print flex flex-col items-end gap-2 shrink-0">
      <RequestQuotationButton projectId={projectId} projectName={projectName} />
    </div>
  );
}
