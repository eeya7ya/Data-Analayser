# Storage Management Module — V1.5A Requirements & Implementation Spec

This is the V1.5A spec for the Storage module of the **MagicTech** platform
(this repo: Next.js 15 App Router + React 19 on Vercel, **Supabase Postgres**
via `postgres.js` through the Supavisor transaction pooler, JWT/PBKDF2 auth,
module-based RBAC). It supersedes the original generic requirements doc and the
**legacy flat storage model** (`storage_locations` / `storage_stock` /
`storage_requests`), which V1.5A **replaces and removes** (see
[§ Legacy model — replaced & removed](#legacy-model--replaced--removed)).

Every feature is built to **reuse the platform's existing accounts, roles,
database, audit, notifications, and PWA** rather than introduce parallel
systems. Throughout, **"Reuses"** marks an existing primitive we lean on and
**"New in V1.5A"** marks what this update adds.

Feature list:
1. Real-Time Stock Tracking — the foundation
2. Low-Stock Alerts & Reorder Points
3. Barcode / QR Scanning
4. Categories & Locations
5. Stock Movement History (Audit Log)
6. Batch & Expiry Tracking
7. Reports & Analytics
8. Multi-User Roles & Permissions
9. Import / Export & Backup
10. Offline Mode + Sync

---

## Platform primitives we build on (read this first)

These already exist in the repo. V1.5A composes them instead of reinventing.

| Concern | Existing primitive | Where |
| --- | --- | --- |
| Database | Supabase Postgres, accessed with the `postgres.js` tagged-template `sql()` helper through the Supavisor **transaction pooler** (`prepare:false`, `max:1`). | `src/lib/db.ts` |
| Schema bootstrap | Idempotent `ensureSchema()` runs `create table if not exists …` on first request. **All new V1.5A tables are added here.** | `src/lib/db.ts` |
| Auth | JWT (HttpOnly cookie, `jose`) + PBKDF2-SHA256. `getSessionUser()`, `canReadAll()`. **Reuse — no new login.** | `src/lib/auth.ts` |
| Module RBAC | `user_module_roles` grants `(user_id, module, role)`, never hard-deleted (`revoked_at`). Modules: `crm`, `projects`, `storage`, `admin`, `pricing`. Helpers: `hasModule`, `hasModuleRole`, `requireModuleRole`, `isModuleManager`. | `src/lib/modules.ts` |
| Visibility scope | Owner / team-manager / project-assignment scoping returning ID lists for `where x = any($1)`. V1.5A extends this with **location-subtree** scoping. | `src/lib/scope.ts` |
| Audit feed | `activity_log` (`owner_id, actor_id, entity_type, entity_id, verb, meta_json, created_at`). | `src/lib/db.ts`, `modules.ts` |
| Notifications | `notifications` table **+ Web Push** (VAPID, `web-push`, service-worker `push` handler). | `src/lib/push.ts`, `public/sw.js`, `NotificationsBell.tsx` |
| "Live" UX today | **Polling** via `setInterval` (e.g. `NotificationsBell` every 60 s). No WebSockets. `@supabase/supabase-js` is a dependency but Realtime is currently unused. | `NotificationsBell.tsx`, README |
| PWA | Installable PWA: `src/app/manifest.ts` + `public/sw.js` (push + offline navigation fallback; **deliberately does not cache data today**). | `src/app/manifest.ts`, `public/sw.js` |
| Items catalogue | `products` (`vendor, system, category, sub_category, model, description, currency, price_si, specifications, picture_url`) and `catalogue_items` (multi-tier pricing). Stock items reference `products(id)`. | `src/lib/db.ts`, `CatalogBrowser.tsx` |
| Files / object storage | Supabase **Storage** private bucket via signed URLs. | `src/lib/storage.ts` |
| Import / Export | `exceljs`, `xlsx`, `jspdf`; `ExcelImportModal`; folder export/import routes. | `package.json`, `ExcelImportModal.tsx` |
| Backup / restore | Admin backup + restore endpoints (table-driven dump → ZIP, including Storage blobs). | `src/app/api/admin/backup/*` |
| Charts | `recharts`. | `PricingCharts.tsx` |
| Soft-delete / append-only conventions | `deleted_at` on mutable rows; "nothing is ever deleted" already used by `storage_requests`. | throughout |

**Naming convention (adapted to this platform).** The original doc proposed
`Stock <Role>` roles and `stock.*` permissions to avoid clashes. On this
platform that namespace **already exists as the `storage` module** in
`user_module_roles`. So V1.5A keeps `module = 'storage'`, expresses roles as
`storage` roles, and uses `stock.*` strings only as the **permission keys**
mapped from those roles (see Feature 8). We do **not** introduce a second RBAC
system.

---

## Feature 1 — Real-Time Stock Tracking (Foundation)

### Goal
One **live quantity** per item that is always accurate, updates the instant a
change happens, and reaches every connected user without manual refresh.
Everything else depends on this.

### Core rule: one source of truth = an append-only event ledger
The database holds the truth. The client **never** computes the final number.
Crucially for this platform's integrity rules (Feature 7), the live quantity is
**derived by summing events**, not stored as a mutable counter — the legacy
`storage_stock.on_hand` aggregate is exactly the "separately-stored total that
can drift" we are eliminating.

**New in V1.5A — `stock_events` (the ledger, append-only):**

```
stock_events
  id            bigserial primary key
  event_uid     uuid not null unique        -- client-generated; dedupes offline re-sync (Feature 10)
  item_id       integer not null references products(id)
  type          text not null check (type in ('IN','OUT','MOVE','ADJUST'))
  qty           numeric not null            -- signed application happens per node; exact decimal, never float
  from_node_id  integer references stock_location_nodes(id)   -- OUT / MOVE source
  to_node_id    integer references stock_location_nodes(id)   -- IN  / MOVE destination
  batch_id      integer references stock_batches(id)          -- nullable (Feature 6)
  actor_id      integer references users(id)
  method        text not null check (method in ('scan','manual','import','sync'))
  reason        text                         -- required for ADJUST (Feature 5)
  link_type     text, link_id integer        -- optional tie to quotations/deals/projects
  occurred_at   timestamptz not null default now()  -- real-world time (offline = original time)
  recorded_at   timestamptz not null default now()  -- server insert time (= sync time when offline)
```

Rows are **never updated or deleted** (that is Feature 5). A correction is a new
`ADJUST` row.

### Derived live quantities — `stock_placements` (read model)
Per the integrity rule, item/placement totals are **summed from events**. For
query performance we keep a **materialized placement cache** updated inside the
same transaction as each event insert, plus a runnable reconcile check
(Feature 7) proving `cache == Σ events`:

```
stock_placements                 -- (item, node[, batch]) -> on-hand, derived from events
  item_id  integer not null references products(id)
  node_id  integer not null references stock_location_nodes(id)
  batch_id integer references stock_batches(id)
  qty      numeric not null default 0 check (qty >= 0)
  updated_at timestamptz not null default now()
  primary key (item_id, node_id, batch_id)
```

- **Item total** = `Σ qty` over placements (= `Σ` signed events). Live per
  placement **and** live total.

### The three (+one) moments
`IN` (received), `MOVE` (relocate), `OUT` (sold/shipped/used), plus `ADJUST`
(correction — Feature 5). All four are just `stock_events` rows.

### How a change is triggered
- **By scanning (primary)** — Feature 3 identifies the item (and optionally the
  node), user confirms qty + direction.
- **Manually (required)** — search/select item (reuse `search.ts` /
  `CatalogBrowser`), type qty, pick direction, confirm.

Both feed **one** server route handler (`POST /api/storage/events`) → one ledger
insert in a transaction → placement cache updated → low-stock check (Feature 2)
→ live broadcast. Identical result regardless of trigger.

### "Real-time" delivery — honest current state + the V1.5A plan
- **Today:** the app has no WebSockets; "live" surfaces poll (`setInterval`).
- **New in V1.5A:** subscribe the Storage screens to **Supabase Realtime**
  (Postgres change stream on `stock_placements` / `stock_events`) directly from
  the browser via `@supabase/supabase-js` (already a dependency). Vercel
  serverless cannot hold sockets, so the browser talks to Supabase Realtime
  directly; the Next.js route handler stays the write path. **Fallback:** the
  existing 60 s poll, so the feature degrades gracefully.

### Concurrency
Because changes are additive events, concurrent actions both apply (no
last-writer-wins). The DB transaction + `check (qty >= 0)` on the placement
cache is the safety net; a would-be-negative event is rejected (or queued for
review when offline — Feature 10).

### Integration with the existing platform
- Reuse `users` + JWT session; `actor_id` is the session user.
- Link an `OUT` to an existing **quotation / deal / project** via
  `link_type`/`link_id` (`quotations`, `deals`, `projects` already exist).
- Reuse the existing Supabase DB and auth — no parallel store.

### Flow
```
Trigger (Scan OR Manual)
   -> item + qty + direction (+ node, + batch)
   -> POST /api/storage/events  (one transaction)
   -> insert stock_events (append-only)  ->  update stock_placements cache
   -> Feature 2 low-stock check           ->  notifications / Web Push if tripped
   -> Supabase Realtime pushes the new number to every subscribed client
   -> the event IS the history (Feature 5)
```

---

## Feature 2 — Low-Stock Alerts & Reorder Points

### Goal
Warn before an item runs out, using the live total from Feature 1.

### New in V1.5A — per-item settings table
We keep storage settings **off** the shared catalogue (`products`) so storage
config never collides with quotation/pricing data:

```
stock_item_settings
  item_id        integer primary key references products(id)
  reorder_point  numeric not null default 0
  batch_tracked  boolean not null default false   -- Feature 6 toggle
  unit           text    not null default 'each'  -- Feature 7 unit
  qty_precision  smallint not null default 0      -- 0 = integer; >0 = fixed decimal
  barcode        text                              -- Feature 3 (or stock_barcodes)
  updated_at     timestamptz not null default now()
```

### What it must do
- Set a **reorder point** per item (fixed/typed — smart thresholds come later).
- After any **downward** event (`OUT`, `MOVE`-out, downward `ADJUST`), compare
  the **new total** against the reorder point.
- When `total <= reorder_point`, raise an alert.

### Alert delivery — reuse existing infra
- **Reuses** the `notifications` table + **Web Push** (`src/lib/push.ts`,
  `public/sw.js`). Low-stock and (Feature 6) "expiring soon" become two new
  `notifications.kind` values, surfaced by `NotificationsBell` and pushed to
  installed devices. Target = users holding a storage manager role.

### Multi-node basis
Reorder check is on the **item total** by default (sum across placements);
per-node thresholds are optional later.

```
Downward event -> placement cache updated -> recompute item total
   -> total <= reorder_point ?  -> insert notifications row + Web Push to managers
```

---

## Feature 3 — Barcode / QR Scanning

### Goal
Answer "which item?" (and "which node?") instantly. All three input methods end
at the same "identified" state and feed the same IN/OUT/MOVE/ADJUST flow.

### Input methods
1. **Mobile camera** — request camera in the mobile browser and read codes with
   the native `BarcodeDetector` API where available, falling back to a JS
   library (e.g. `@zxing/browser`). **HTTPS is already guaranteed** (Vercel)
   and the app is an installable PWA, so camera access works.
2. **Scanner device (USB / Bluetooth / RF)** — keyboard-wedge: it types the
   code into a focused input and presses Enter. A small focus-capture handler is
   all that's needed (mirrors the existing manual-entry inputs).
3. **Manual entry (required fallback)** — reuse the existing product search
   (`src/lib/search.ts`, `CatalogBrowser`) to pick by name/model/vendor.

### New in V1.5A — barcode linking
- Store the item barcode on `stock_item_settings.barcode`, or, to allow
  multiple codes and **node labels**, a dedicated map:

```
stock_barcodes
  code      text primary key
  kind      text not null check (kind in ('item','node'))
  item_id   integer references products(id)
  node_id   integer references stock_location_nodes(id)
  created_at timestamptz not null default now()
```

- Item already labelled → scan once at setup, save the code.
- Item with no barcode → generate a code, print/attach a label.
- **1D barcode** (holds the item/node id) is the default; **QR** optional for
  more data / any-angle scans (and can encode a batch number — Feature 6).

### Ties to locations (Feature 4)
Scan the **item**, then the **node label** → placement identified without typing
the path. Works with camera, scanner, and manual.

---

## Feature 4 — Categories & Locations

The organization layer: **what type** (category) and **where** (location).

### Part A — Categories (what type)
- **Reuses** the catalogue's existing `products.category` / `sub_category`
  (e.g. `HIKVISION / IP Camera`). Category is about meaning, independent of
  position. Used for filtering, bulk actions, and per-category value
  (Feature 7).
- Renaming a category updates all items that point at it (catalogue-level edit).

### Part B — Locations: a flexible TREE (replaces the legacy flat list)
The legacy `storage_locations` was a **flat** `name + address` list — not
acceptable for 27+ sites of varying depth. **New in V1.5A** a self-referencing
tree, the standalone reusable component the platform boundary calls for:

```
stock_location_nodes
  id         serial primary key
  parent_id  integer references stock_location_nodes(id)   -- null = top node
  name       text not null
  barcode    text                                          -- optional node label (Feature 3)
  created_at timestamptz not null default now()
  deleted_at timestamptz                                   -- archive, never hard-delete
```

A node stores only its **name** and **parent**. The full address
(`Hashmet › Street 22 › Complex 4 › 3rd Floor › Room 3 › Shelf 22`) is **walked
from parents at read time** via a recursive CTE — never stored as a string.

**Why a tree:** any depth anywhere; address built automatically; and flexible
editing — **rename** a node (every item under it follows), **move a branch**
(all children move automatically by repointing one `parent_id`), **add a level
or a 28th/29th location** with no schema change. Items point at a **node id**,
never a typed path, so structural edits never break the items inside.

### Part C — Multi-node stock (required)
The same item can sit in many nodes at once — that is exactly `stock_placements`
(Feature 1), keyed `(item_id, node_id[, batch_id])`. **Item total = Σ placement
qty.** The three events with multi-node:
- **IN** → add to a node's placement (create row if new).
- **OUT** → subtract from a node's placement.
- **MOVE** → one action: subtract from `from_node_id`, add to `to_node_id`.

```
MOVE 20: Room 3 -> Shelf 22   (one stock_events row, type='MOVE')
   placement (item, Room 3):   200 -> 180
   placement (item, Shelf 22):  50 -> 70
   ledger: "moved 20 from Room 3 to Shelf 22"
```

Low-stock alerts check the **total** by default (per-node optional).

### Decisions locked in
1. Locations = flexible **tree** (`parent_id`), any depth, fully editable.
2. Multi-node = **yes** (`stock_placements`); total = sum.
3. Alert basis = **total** by default.

### Open item to decide later
MOVE to a not-yet-existing node: **auto-create** the node vs **must exist
first**. Affects the MOVE flow.

---

## Feature 5 — Stock Movement History (Audit Log)

### What it is
The permanent, append-only diary of every stock change — **this is the
`stock_events` ledger from Feature 1**, not a second table. Feature 1 gives the
current number; the ledger explains how it got there.

### Each entry captures
item (`item_id`), signed quantity (`qty` + `type`), type
(`IN/OUT/MOVE/ADJUST`), where (`from_node_id` → `to_node_id`), who (`actor_id`),
when (`occurred_at`), how (`method` = scan/manual/import/sync), why/link
(`reason`, `link_type`/`link_id`). All columns already defined in Feature 1.

### Core rule: append-only
`stock_events` rows are **never edited or deleted**. A mistake is fixed by a
*correcting* `ADJUST` row; the original truth stays. This is what makes it an
audit log, not a list.

```
10:02  IN   +100  Shelf 22  by @ali   (scan)
10:05  ADJUST -90  Shelf 22  by @ali   (reason: "typo, should have been 10")
```

### ADJUST
The fourth type: a manual correction after a physical recount, flagged as a
correction and **requiring a `reason`** (enforced in the route handler). Keeps
real-world counting errors honest and traceable.

### Connections
- **Feature 1** — every event both updates the placement cache and *is* the
  history (same insert).
- **Platform `activity_log`** — in addition to `stock_events`, write a compact
  `activity_log` row (`entity_type='stock'`, `verb=type`) so stock activity
  shows in the platform-wide feed alongside CRM/projects. The ledger is the
  detailed source of truth; `activity_log` is the cross-module headline.
- **Reconciliation** — Feature 7's check: live qty must equal the signed sum of
  events.

### Decision (later)
Retention: keep **forever** first; add **archiving** (never deleting) later if
volume demands — consistent with Supabase PITR on the Pro plan.

---

## Feature 6 — Batch & Expiry Tracking

### What it is
A **batch/lot** is a slice of an item sharing an origin, with its own lot
number, expiry, received date, and optionally supplier/production date/cost.

**New in V1.5A:**
```
stock_batches
  id            serial primary key
  item_id       integer not null references products(id)
  lot_no        text not null
  expiry_date   date
  received_date date
  supplier      text
  cost          numeric        -- exact decimal money (Feature 7), never float
  created_at    timestamptz not null default now()
```

Placements and events already carry an optional `batch_id`, so stock becomes
`item + node + batch -> qty` only when needed.

### Per-item toggle (required)
`stock_item_settings.batch_tracked`. Items with no expiry (tools, hardware) stay
simple `item + node -> qty` (`batch_id = null`). Only perishable/regulated items
turn it on.

### Core rule: FEFO (First Expired, First Out)
On `OUT`, draw from the soonest-expiring batch first. **Default mode =
suggest-with-warning** (worker may override); enforce-mode is configurable.

### Alerts
New `notifications.kind = 'stock_expiring'` (rides the same Feature 2
notification + Web Push path): "expiring within X days."

### Connections
IN records the batch; OUT picks a batch (FEFO); placements track per node **and**
batch; every `stock_events` row records `batch_id`; barcodes/QR can encode the
lot.

---

## Feature 7 — Reports & Analytics

### What it is
A **read-only** insight layer that adds no new data — it reads placements,
events, batches, and the location tree and turns them into decisions. Reports =
what's true now / what happened; Analytics = what it means over time.

### Core reports
1. **Current stock value** — `qty × cost`, totaled per item / category / node.
2. **Low-stock** — items with `total <= reorder_point` (Feature 2).
3. **Expiry** — batches expiring within X days (Feature 6).
4. **Movement** — all `stock_events` over a date range (Feature 5).
5. **Stock-by-location** — placements summed per node or branch (Feature 4).

### Location roll-ups
Recursive CTE over `stock_location_nodes` to sum a whole branch or drill to one
shelf — same data at different zoom (`Hashmet` total … down to `Shelf 22`).

### Calculation accuracy & integrity (required — non-negotiable)
- **Single source of truth** — every total is **summed at read time** from
  placements/events. Never display a separately-stored total. (This is the whole
  reason the legacy `storage_stock.on_hand` aggregate is being removed.)
- **Money uses exact decimals** — Postgres **`numeric`** for all currency
  (`cost`, values). Never `float`/binary FP. (`0.1 + 0.2 ≠ 0.3` class of bug is
  thereby impossible.)
- **Quantities** — integer for countable items; controlled fixed decimal for
  weight/volume via `stock_item_settings.qty_precision`. Defined per item; never
  mixed.
- **One rounding rule** — round half-up to the configured decimals, applied only
  at display/total time, consistently across every report.
- **Roll-up = sum of children, always** — a parent node's value equals the exact
  sum of descendants; verified bottom-up.
- **Audit reconciliation** — a runnable check proving, per item/node, that the
  placement cache equals the **signed sum of `stock_events`**
  (`IN − OUT ± MOVE ± ADJUST`). Surfaces drift immediately.
- **Consistent units** — convert to a common `unit` before summing; never add
  mixed units.
- **Read-only** — reports never mutate stock; safe for view-only users.

### Live vs snapshot
- **Live** — recomputed on open (daily ops). **Reuses** `recharts` for charts.
- **Snapshot** — frozen at a point in time for the books:

```
stock_snapshots
  id          serial primary key
  taken_at    timestamptz not null default now()
  taken_by    integer references users(id)
  scope_json  jsonb        -- node/category filters captured
  totals_json jsonb        -- frozen numbers; immutable thereafter
```

### Export
**Reuses** `exceljs` / `xlsx` (CSV/Excel) and `jspdf` (printable PDF). Feeds
finance (stock value) and purchasing (expiry). Gated by `stock.export`
(Feature 8). Leads into Feature 9.

---

## Feature 8 — Multi-User Roles & Permissions

### What it is
The authorization layer. It **reuses the platform login** and only adds
authorization on top — through the existing `user_module_roles` system, not a
new one.

### Roles (within the existing `storage` module)
**New in V1.5A** — expand `ROLES_PER_MODULE.storage` (today only
`['worker','manager']`) to:

| Role (`module='storage'`) | Intent |
| --- | --- |
| `viewer` | See stock and reports; change nothing. |
| `operator` | Record `IN` / `OUT` / `MOVE` (daily floor work). |
| `supervisor` | Operator + `ADJUST` + approvals. |
| `manager` | Everything: settings, reorder points, role assignment. |
| `auditor` | Read-only access to the full ledger and reports. |

Assigned with the existing grant flow; `requireModuleRole(user, 'storage', …)`
enforces them. (`worker` maps to `operator` during migration.)

### Permissions (`stock.*` keys mapped from roles)
Each maps to an action from earlier features. These are **permission strings**
checked in route handlers, resolved from the user's `storage` role(s):

`stock.in`, `stock.out`, `stock.move`, `stock.adjust` (sensitive — supervisor+),
`stock.item.manage`, `stock.category.manage`, `stock.location.manage`,
`stock.reorder.manage`, `stock.report.view`, `stock.export`,
`stock.roles.manage` (admin only).

### Least privilege
Minimum needed per job; sensitive actions (`stock.adjust`, any archive/delete)
require a higher role by default.

### Location-scoped permissions (required — for 27+ sites)
**New in V1.5A** — extend `src/lib/scope.ts` with a **location-subtree** scope:
a grant can be pinned to a `stock_location_nodes` node and **cascades to all
descendants** (recursive CTE), e.g. "operator on **Hashmet**" can act on every
node under Hashmet but not another building. A regional grant covers several
branches; head office (admin) sees all. New table:

```
stock_role_scopes
  id        serial primary key
  user_id   integer not null references users(id)
  role      text not null            -- one of the storage roles above
  node_id   integer references stock_location_nodes(id)  -- null = global within module
  created_at timestamptz not null default now()
  revoked_at timestamptz             -- never hard-deleted (matches user_module_roles)
```

### Tie-in with the audit log
Permissions decide who **can**; `stock_events` records who **did**. Restricting
`stock.adjust` to supervisors means an unexplained change can only come from a
trusted, identified person — and the ledger proves who.

### Safety rule
Always keep at least one **admin** (platform-wide rule already in place); the
last admin cannot strip their own admin rights.

### Decisions locked in
1. Roles live in the existing `storage` module; `stock.*` are permission keys.
2. Location-scoped permissions = **yes**, cascading to children.
3. Sensitive actions require a higher role by default.

---

## Feature 9 — Import / Export & Backup

### Import (bulk in)
- Load **items, categories, location nodes, and opening stock** from CSV/Excel
  (**reuses** `exceljs`/`xlsx` and the `ExcelImportModal` pattern).
- **Validate before committing** — check the whole file (valid numbers, existing
  categories/nodes, no duplicate codes), show errors, apply only if it passes.
  Never half-import.
- Opening stock imports as `IN` `stock_events` with `method='import'`, so the
  ledger stays the single source of truth and the import is auditable.
- Obeys Feature 7 accuracy rules (exact `numeric`, correct units).

### Export (bulk out)
- Stock lists, reports, and the ledger to **CSV/Excel** (`exceljs`/`xlsx`) and
  **PDF** (`jspdf`) for printable reports. Feeds finance/purchasing. Gated by
  `stock.export`.

### Backup
- **Reuses** the platform's admin backup/restore (`/api/admin/backup` →
  table-driven ZIP incl. Storage blobs). The new V1.5A tables
  (`stock_events`, `stock_placements`, `stock_location_nodes`, `stock_batches`,
  `stock_item_settings`, `stock_barcodes`, `stock_role_scopes`,
  `stock_snapshots`) are picked up by the dump, so stock data is covered.
- Supabase **PITR** (Pro plan) provides point-in-time recovery on top.
- **Restore** is sensitive: admin-only and written to `activity_log`.

### Decisions (later)
1. Backup frequency / retention.
2. Import conflict handling: skip vs update vs reject duplicates.

---

## Feature 10 — Offline Mode + Sync

### What it is
Keep working when a device can't reach the server, then reconcile on reconnect.
It temporarily relaxes "one source of truth" and restores it on sync. Hardest
feature → last.

### Builds on the existing PWA
- **Reuses** `public/sw.js` + `src/app/manifest.ts` (already installable, push
  enabled). **Note:** today the service worker **deliberately does not cache
  data** (auth-gated, data-heavy). V1.5A adds, *scoped to the Storage screens
  only*:
  - **IndexedDB** for a last-known stock snapshot (read offline) and an
    **outbox queue** of pending events.
  - A cache strategy for the Storage routes/assets so the screens load offline.

### Core idea: queue now, sync later
```
Offline:   queued OUT 3 Shelf22 10:01 · IN 50 Room3 10:04 · MOVE 10 Room3->Shelf22 10:07
Reconnect: POST the queued stock_events in order -> DB applies -> live totals update -> outbox cleared
```
This works **because the model is event-based** (Feature 1): "OUT 3" replays
later; an absolute "set qty = N" would not.

### Stack note
Offline lives in the **browser (PWA)**; Vercel/Node is the **sync target**, not
the offline mechanism. On reconnect the server receives queued events, applies
them once each in order, and (Feature 1) Supabase Realtime pushes the new
numbers out.

### Required: sync confirmation & review
Sync is **not** silent:
1. Notify the user there are pending offline changes.
2. Show a **review screen** listing every queued event (item, qty, type, node,
   time).
3. The user **explicitly confirms** before anything is sent.
4. After send, show the result (synced / flagged conflicts).

### Conflicts
- Additive events don't need a "winner" — concurrent changes apply in sequence.
- The one non-auto-resolvable case: a queued event would push a placement
  **negative** (`check (qty >= 0)` would fail). These are **flagged for human
  review** during/after sync — never silently guessed.

### Sync guarantees
- **Order preserved** by `occurred_at`.
- **No double-apply** — `stock_events.event_uid` (UUID, unique) makes a retried
  sync idempotent (the classic offline double-count bug is structurally
  prevented).
- **Honest audit** — synced events store both `occurred_at` (original) and
  `recorded_at` (sync time).

### Scope options (pick per need)
1. **Read-only offline** — view last-known stock; no edits. Simplest.
2. **Full offline** — queue `IN/OUT/MOVE` + sync. Powerful, complex.
3. **Online-only + batch-mode wireless scanners** — scanner stores scans and
   uploads when docked; web app stays simple. Often most practical for warehouse
   dead zones.

---

## Module boundaries (lives inside the larger platform)
- The **location tree** (`stock_location_nodes`) is a standalone, reusable
  component — not buried inside stock logic.
- Stock **placements/events reference node IDs**, never typed text paths.
- **Categories** (meaning, on `products`) and **locations** (position, the tree)
  stay separate concepts.
- Reuse the platform's accounts, roles, authentication, database, audit feed,
  notifications, and PWA.

---

## Legacy model — replaced & removed

V1.5A's event-sourced, tree-based, multi-node, batch-aware model is
**incompatible** with the original flat storage model, which is therefore
**retired**:

| Legacy object | Why it's removed | V1.5A replacement |
| --- | --- | --- |
| `storage_locations` (flat `name + address`) | No hierarchy; can't express 27+ nested sites. | `stock_location_nodes` (tree). |
| `storage_stock` (`product_id, location_id → on_hand/reserved`) | A **mutable stored aggregate** — the exact "total that can drift from its parts" Feature 7 forbids. | `stock_events` (truth) + `stock_placements` (derived cache). |
| `storage_requests` (project → pending/approved/denied/fulfilled) | A workflow queue, not a movement ledger; no audit of actual stock change. | Recast as `OUT`/reservation `stock_events` linked to a project, plus role-gated approval. |

**Code/surfaces touched by the legacy model** (must be migrated or removed in
lockstep): the `/storage` page + `StoragePanel` (Locations/Stock/Requests tabs),
`/api/storage/{locations,requests,stock}`, `RequestStockButton` (used on project
pages via `ProjectHeaderActions`), and the home-dashboard KPIs in
`src/app/page.tsx` + `StorageDashboardClient` that read the legacy tables. The
new module lives where the **"Stock Management" placeholder** already waits in
`StorageWorkspace` (`/crm/storage`).

> **`quotation_stock_checks` (BOQ availability checks) — decision needed.** This
> table + `StockChecksTab` + `QuotationStockCheckPanel` + `/api/stock-checks`
> are a *quotation* feature (presales asks "can the warehouse fulfil this BoM?"),
> not part of the flat stock model. It can either **stay as-is** (a CRM/quotation
> feature) or be **re-implemented on V1.5A placements** (live availability from
> `stock_placements`). It is **not** auto-removed by this spec.

### Suggested migration (non-destructive first, then drop)
1. **Add** all V1.5A tables to `ensureSchema()` (additive; nothing breaks).
2. **Backfill**: one `stock_location_nodes` per legacy `storage_locations` row
   (flat → top-level nodes, refine later); one `IN` `stock_events`
   (`method='import'`, `reason='legacy opening balance'`) per
   `storage_stock.on_hand`, which builds `stock_placements`.
3. **Repoint** UI to the new workspace; convert `RequestStockButton` to file a
   project-linked `OUT`/reservation event.
4. **Verify** with the Feature 7 reconciliation check.
5. **Drop** `storage_stock`, `storage_locations`, `storage_requests`, their
   `/api/storage/*` routes and `StoragePanel`, and update
   `src/app/page.tsx` / `StorageDashboardClient` KPIs to read V1.5A tables.

---

## Status
- [ ] Feature 1 — Real-Time Stock Tracking (`stock_events` + `stock_placements` + Realtime)
- [ ] Feature 2 — Low-Stock Alerts & Reorder Points (`stock_item_settings` + notifications/Web Push)
- [ ] Feature 3 — Barcode / QR Scanning (`stock_barcodes` + BarcodeDetector/zxing)
- [ ] Feature 4 — Categories & Locations (`stock_location_nodes` tree + multi-node placements)
- [ ] Feature 5 — Stock Movement History (the append-only `stock_events` ledger + `activity_log`)
- [ ] Feature 6 — Batch & Expiry Tracking (`stock_batches`, per-item toggle, FEFO)
- [ ] Feature 7 — Reports & Analytics (derived totals, `numeric` money, recursive roll-ups, snapshots)
- [ ] Feature 8 — Roles & Permissions (expand `storage` roles + `stock_role_scopes` subtree scoping)
- [ ] Feature 9 — Import / Export & Backup (exceljs/xlsx/jspdf + existing admin backup)
- [ ] Feature 10 — Offline Mode + Sync (PWA IndexedDB outbox + idempotent `event_uid`)
- [ ] Legacy removal — drop `storage_locations` / `storage_stock` / `storage_requests` after migration

**V1.5A spec — mapped to the MagicTech platform.**
