/**
 * Single source of truth for the user-facing app version string. Shown in the
 * fixed footer bar (AppFooter) and the Product-updates badge so anyone can read
 * which build they're on at a glance.
 *
 * The version is DERIVED from the top of the release-notes changelog
 * (src/lib/releaseNotes.ts): every change adds a note there and bumps the
 * version by 0.01, so the label and the changelog can never drift apart. Don't
 * hard-code a version here — edit releaseNotes.ts.
 */
export { APP_VERSION, APP_VERSION_LABEL } from "@/lib/releaseNotes";
