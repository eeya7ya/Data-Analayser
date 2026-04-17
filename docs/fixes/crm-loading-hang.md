# CRM module stuck on "Loading dashboard…" + dead navigation

**Branch:** `claude/fix-crm-save-issue-leGTl`

## Context

After enabling the CRM module in Admin → Settings, every `/crm/*` page
was stuck on a "Loading…" placeholder and sidebar navigation between
Dashboard / Contacts / Deals / Workflows never completed. Same
"frozen Next.js loading skeleton with no timeout and no way out" shape
as the earlier `quotation-designer-nav.md` fix, but this time on the
CRM surface.

## Root causes

### Bug #1 — `getAppSettings()` hung the CRM layout gate

`src/app/crm/layout.tsx` awaits `getAppSettings()` on every navigation
(`dynamic = "force-dynamic"` on the layout). The previous commit had
removed the timeout race on that function entirely to stop it serving
`DEFAULT_APP_SETTINGS` on slow Supabase responses. With no ceiling,
a hung pooler connection left the layout waiting forever — every CRM
route inherited that hang.

### Bug #2 — CRM client lists fetched with no abort budget

`Dashboard.tsx`, `ContactsList.tsx`, `CompaniesList.tsx`,
`DealsKanban.tsx`, `TasksList.tsx`, `WorkflowsList.tsx`,
`TeamsList.tsx` all ran the same pattern:

```tsx
useEffect(() => {
  fetch("/api/crm/…").then(r => r.json()).then(setData);
}, []);
```

No signal, no timeout, no retry button. If any of the ~9 serialised
queries behind the API (postgres.js `max: 1` on the pooler) stalled,
the state stayed `null` and the user saw "Loading…" indefinitely with
no diagnostic.

## Changes

### `src/lib/settings.ts`
Restored a hard 8-second read ceiling on `getAppSettings()`. On
timeout we fall back to the last cached value (or defaults if we've
never succeeded), and the background fetch is allowed to finish so the
next request gets the real value. Concurrent callers now coalesce onto
a single in-flight query via `__mtAppSettingsInFlight` so a cold lambda
handling the layout gate + analytics endpoint + `/api/crm/status` poll
doesn't open three sockets.

This is the "wait, but never forever" shape — the original 400 ms
budget lied to callers on every cold start (Bug reported in
`settings-save-default-overwrite`), and no budget at all froze /crm/*
(Bug #1 above).

### `src/lib/crm/fetchJson.ts` (new)
Small abort-budgeted JSON helper mirroring the pattern in
`DesignerShell`: 25 s timeout, proper AbortController plumbing, JSON
parse + error-response handling, and a dedicated `FetchTimeoutError`
so callers can render a retry affordance instead of an infinite
spinner.

### `src/components/crm/Dashboard.tsx`
Uses `fetchJson`. On error renders a red panel with a **Retry** button
that bumps a `reloadTick` and re-runs the effect.

### Other CRM lists
`ContactsList.tsx`, `CompaniesList.tsx`, `DealsKanban.tsx`,
`TasksList.tsx`, `WorkflowsList.tsx`, `TeamsList.tsx` all route their
`load()` / data-fetch `useEffect` through `fetchJson`. On failure the
error is surfaced in the existing red banner; the list falls back to
`[]` so the "Loading…" placeholder doesn't persist forever.

## Files touched

- `src/lib/settings.ts`
- `src/lib/crm/fetchJson.ts` (new)
- `src/components/crm/Dashboard.tsx`
- `src/components/crm/ContactsList.tsx`
- `src/components/crm/CompaniesList.tsx`
- `src/components/crm/DealsKanban.tsx`
- `src/components/crm/TasksList.tsx`
- `src/components/crm/WorkflowsList.tsx`
- `src/components/crm/TeamsList.tsx`

## Verification

1. Enable CRM in Admin → Settings → Save. Confirm the checkbox stays
   ticked after reload (earlier fix) and the CRM nav link appears.
2. Click **CRM → Dashboard**. Expect either the stat grid + charts
   within ~8 s, or a red "Failed to load dashboard." panel with a
   **Retry** button — never an indefinite "Loading dashboard…".
3. Sidebar-navigate Dashboard → Contacts → Companies → Deals →
   Tasks → Workflows. Each page either renders its list or shows
   an error banner; the layout itself is never frozen.
4. With the network throttled to simulate a slow pooler, the first
   load should still complete after at most the 25 s fetch budget,
   and **Retry** should succeed once the DB wakes up.
