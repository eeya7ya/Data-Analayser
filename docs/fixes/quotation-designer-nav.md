# Quotation Designer navigation + post-save refresh

**Branch:** `claude/fix-quotation-designer-nav-UUrlA`
**PR:** https://github.com/eeya7ya/Data-Analayser/pull/new/claude/fix-quotation-designer-nav-UUrlA
**Commits:**
- `9c1d6e8` — fix(quotation): preserve navigation chain and refresh after save
- `961fc4c` — perf(quotation): restore short-lived caching on list endpoint

## Context

The app models a chain of `Client → Quotation → Design Stage → Catalogue`.
Three regressions were breaking that chain in everyday use:

1. **Catalogue → Designer back button lands on the quotation list** when
   the user started from a *new* (unsaved) quotation. The button routed
   to `/designer` with no query string, and the designer page gate
   redirected that straight to `/quotation`, so the in-flight client +
   items were lost.
2. **Newly created quotations were missing from the list** until the
   user clicked "+ New quotation" and edited — a 30-second HTTP cache
   on `/api/quotations` hid the write.
3. **After saving, the Designer kept rendering the pre-save version**
   until the user navigated back to the list and returned. Nothing
   re-hydrated the in-memory `existing` prop after a PATCH.

## Root causes

### Bug #1 — Catalogue back button
- `Designer.tsx` cleared the `EditingContext` on create-mode mount, so
  no context lived in localStorage for the catalogue to route through.
- `CatalogBrowser.tsx` only handled the edit-mode case:
  `router.push(editing ? '/designer?id=${editing.id}' : '/designer')`.
- The `/designer` branch hit the gate at `src/app/designer/page.tsx:94-96`
  which bounces to `/quotation`.

### Bug #2 — New quotation missing from list
- `src/app/api/quotations/route.ts` GET sent
  `Cache-Control: private, max-age=30, stale-while-revalidate=60`.
- `Designer.saveQuotation()` navigated to the list without calling
  `router.refresh()`, so the Next.js RSC cache for `/quotation` could
  also be stale.

### Bug #3 — Designer shows old data after save
- `DesignerShell.tsx` fetched the quotation once on mount and only
  re-ran when `[quotationId, reloadTick]` changed — after a successful
  PATCH neither moved, so a later re-mount re-read the pre-save snapshot.

## Changes

### `src/lib/quotationDraft.ts`
Extended `EditingContext` with an optional `folderId`. Two valid shapes:
- `id > 0` → editing a saved quotation; catalogue returns to `/designer?id=<n>`.
- `id === 0 && folderId > 0` → composing a new quotation; catalogue
  returns to `/designer?folder=<n>&new=1`.
`loadEditingContext()` validates both and drops records with `id === 0`
and no folder (nothing useful to route back to).

### `src/components/Designer.tsx`
- New optional `onSaved?: () => void` prop.
- Edit-mode hydration stamps `folder_id` into the editing context too.
- New create-mode effect mirrors the live `folderId` state into the
  context (scoped to `folderId` only so it doesn't write on every
  keystroke).
- `saveQuotation()` calls `router.refresh()` before navigating, and
  also calls `onSaved?.()` after an edit-mode PATCH so `DesignerShell`
  can silently re-fetch.

### `src/components/DesignerShell.tsx`
Passes `onSaved={() => setReloadTick(t => t + 1)}` to the Designer.
A new `hasLoadedOnceRef` guard keeps the blocking spinner on the
initial load only — subsequent post-save refreshes swap `existing`
in place so the Designer doesn't unmount mid-edit.

### `src/components/CatalogBrowser.tsx`
Back button / banner / disabled state now branch on the context shape:
edit → `/designer?id=<n>`; create → `/designer?folder=<n>&new=1`.

### `src/components/TopBar.tsx`
Mirrors the same routing so the "Designer" nav link resumes create-mode
sessions correctly.

### `src/app/api/quotations/route.ts`
GET Cache-Control tuned to `private, max-age=5, stale-while-revalidate=30`.
Freshness after save is handled by `router.refresh()` invalidating the
RSC cache, so the HTTP cache only matters for the rare client-side
fallback path — 5 s is a good compromise between snappy reloads and
post-save freshness.

### `src/components/QuotationListClient.tsx`
`safeFetchJson` uses the browser default cache (short-lived server
Cache-Control handles it).

## Files touched

- `src/lib/quotationDraft.ts`
- `src/components/Designer.tsx`
- `src/components/DesignerShell.tsx`
- `src/components/CatalogBrowser.tsx`
- `src/components/TopBar.tsx`
- `src/components/QuotationListClient.tsx`
- `src/app/api/quotations/route.ts`

## Verification

Run locally (`npm run dev`) and walk the chain end-to-end:

1. **Bug #1 — Catalogue back button**
   - From `/quotation`, click a client card → "+ New quotation".
   - In the Designer, click **"+ Add from Catalogue"**.
   - In the catalogue, add one product and click **"Back to editor"**.
   - Expect to land back on `/designer?folder=<clientId>&new=1` with
     the added product visible in the item list — **not** `/quotation`.

2. **Bug #2 — New quotation in list**
   - Create a new quotation end-to-end and click **Save**.
   - Click the nav back to `/quotation`.
   - Expect the new ref to appear in that client's card **immediately**.

3. **Bug #3 — Post-save re-render**
   - Open an existing quotation at `/designer?id=<n>`.
   - Edit a visible field (e.g. project name) and click **Save updates**.
   - Expect the preview to reflect the new value without a spinner flash.
   - Click **"+ Add from Catalogue"**, then **"Back to editor"**.
   - Expect the Designer to show the saved value (fresh API fetch via
     `DesignerShell.reloadTick`), not the pre-edit version.

Also run `npm run build` to catch type regressions on the extended
`EditingContext` shape.
