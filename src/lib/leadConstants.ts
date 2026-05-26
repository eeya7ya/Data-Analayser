/**
 * Client-safe constants for the lead lifecycle workflow.
 *
 * `leads.ts` also re-exports these but imports `postgres` transitively
 * via `db.ts`, which webpack tries to bundle into client components.
 * Splitting the constants here lets `"use client"` components reference
 * the labels / status list without dragging the server-only DB client
 * (and its `tls`, `fs`, `perf_hooks` requires) into the browser bundle.
 */

/**
 * The lead has exactly one job: intake → distribution. A presales manager
 * distributes (assigns) a new lead to a presales member; that's the whole
 * lifecycle. Once `distributed`, the lead is done — the actual quotation /
 * project work happens in the CRM client area and the handoffs queue, not
 * on the lead.
 */
export const LEAD_STATUSES = ["new", "distributed"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const LEAD_MESSAGE_KINDS = ["lead_assigned", "general"] as const;
export type LeadMessageKind = (typeof LEAD_MESSAGE_KINDS)[number];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "New",
  distributed: "Distributed",
};

export const LEAD_STATUS_WAITING_ON: Record<LeadStatus, string> = {
  new: "Presales manager (distribute)",
  distributed: "—",
};
