import type { ComponentType } from "react";
import ProtectedPdfShowcase from "@/components/ProtectedPdfShowcase";
import SyncFolderShowcase from "@/components/SyncFolderShowcase";
import { RELEASE_NOTES } from "@/lib/releaseNotes";

/**
 * Animated visuals that stand in for a release note's text — in the one-time
 * "What's new" popup and above the note in the Updates feed. Keyed by release
 * version; a release without one simply shows its text.
 */
export interface ReleaseShowcase {
  /** Short headline shown with the visual instead of the note's title. */
  headline: string;
  Visual: ComponentType;
}

const SHOWCASES: Record<string, ReleaseShowcase> = {
  "1.81": { headline: "Protected PDF quotations", Visual: ProtectedPdfShowcase },
  "1.82": { headline: "Your sync folder, laid out like the CRM", Visual: SyncFolderShowcase },
};

/** The showcase for the release note with this title, if it has one. */
export function showcaseForTitle(title: string): ReleaseShowcase | null {
  const note = RELEASE_NOTES.find((n) => n.title === title);
  return (note && SHOWCASES[note.version]) || null;
}
