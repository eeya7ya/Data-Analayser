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
 * 1.4A — presales shared queue. A lead is pure information intake: sales
 * opens it, and it lands in a single shared presales queue. Any presales
 * person CLAIMS a lead to start working it — there is no manager hand-off /
 * distribution step. While claimed, the lead shows who is working on it.
 *
 *   new          — unclaimed, sitting in the shared presales queue.
 *   in_progress  — a presales person claimed it (assigned_to_id) and is
 *                  turning it into a company / client / project.
 *
 * The actual quotation / project work continues in the CRM client area; the
 * lead just records who owns the intake.
 */
export const LEAD_STATUSES = ["new", "in_progress"] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type LeadPriority = (typeof LEAD_PRIORITIES)[number];

export const LEAD_MESSAGE_KINDS = [
  "lead_assigned",
  "general",
  "file_uploaded",
] as const;
export type LeadMessageKind = (typeof LEAD_MESSAGE_KINDS)[number];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: "In queue",
  in_progress: "In progress",
};

export const LEAD_STATUS_WAITING_ON: Record<LeadStatus, string> = {
  new: "Any presales — claim to start",
  in_progress: "Assigned presales",
};
