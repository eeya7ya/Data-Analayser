import { getAppSettings } from "@/lib/settings";

/**
 * Throws "CRM_DISABLED" when the runtime kill-switch on AppSettings is off.
 * API handlers convert that to a 404 so the existence of /api/crm/* surfaces
 * is invisible to non-admins until an admin enables the module.
 */
export async function requireCrmEnabled(): Promise<void> {
  const settings = await getAppSettings();
  if (!settings.crmModuleEnabled) {
    throw new Error("CRM_DISABLED");
  }
}

/** Maps an Error message to an HTTP status code consistent across the CRM. */
export function statusForError(msg: string): number {
  if (msg === "UNAUTHENTICATED") return 401;
  if (msg === "FORBIDDEN") return 403;
  if (msg === "CRM_DISABLED") return 404;
  if (msg === "NOT_FOUND") return 404;
  if (msg === "BAD_REQUEST") return 400;
  return 500;
}
