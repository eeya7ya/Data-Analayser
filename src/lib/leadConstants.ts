/**
 * Client-safe constants for the lead lifecycle workflow.
 *
 * `leads.ts` also re-exports these but imports `postgres` transitively
 * via `db.ts`, which webpack tries to bundle into client components.
 * Splitting the constants here lets `"use client"` components reference
 * the labels / status list without dragging the server-only DB client
 * (and its `tls`, `fs`, `perf_hooks` requires) into the browser bundle.
 */

export const LEAD_STATUSES = [
  "new",
  "assigned",
  "in_progress",
  "quotation_sent",
  "won",
  "lost",
  "boq_in_progress",
  "sent_to_execution",
  "completed",
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const LEAD_MESSAGE_KINDS = [
  "lead_assigned",
  "quotation_sent_to_sales",
  "won",
  "lost",
  "boq_sent_to_execution",
  "general",
] as const;
export type LeadMessageKind = (typeof LEAD_MESSAGE_KINDS)[number];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  assigned: "Assigned",
  in_progress: "In progress",
  quotation_sent: "Quotation sent to sales",
  won: "Won",
  lost: "Lost",
  boq_in_progress: "BOQ in progress",
  sent_to_execution: "Sent to execution",
  completed: "Completed",
};

export const LEAD_STATUS_WAITING_ON: Record<LeadStatus, string> = {
  new: "Presales manager (triage & assign)",
  assigned: "Assigned presales user",
  in_progress: "Assigned presales user (submit quotation)",
  quotation_sent: "Sales (decide won / lost)",
  won: "Presales user (upload BOQ)",
  lost: "—",
  boq_in_progress: "Presales manager (route to execution)",
  sent_to_execution: "Project member (execute & complete)",
  completed: "—",
};
