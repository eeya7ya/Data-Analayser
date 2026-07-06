/**
 * Double-confirmation guard for destructive, PERMANENT deletes.
 *
 * Deletes in this app are hard deletes — the row is removed from the database
 * and there is no Trash to recover it. So every delete action routes through
 * this helper, which forces the user to confirm twice before anything is
 * removed: a first prompt describing what will be deleted, then a final
 * "this is permanent" prompt. Returns true only if BOTH are accepted.
 *
 * @param message First-prompt text — say exactly what is about to be deleted.
 */
export function confirmDelete(message: string): boolean {
  if (typeof window === "undefined") return false;
  if (!window.confirm(message)) return false;
  return window.confirm(
    "This is PERMANENT — it cannot be undone and there is no Trash to restore from.\n\nDelete for good?",
  );
}
