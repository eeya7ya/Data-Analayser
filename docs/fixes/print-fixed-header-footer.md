# Print: fixed header + footer that content can't cross (V1.4C)

## What users asked for

> Print needs to be more advanced. Cover pages are good. Every printed page
> (from **all** the Print buttons in the app) should have:
> - a **fixed header** at the top, with correct page layout/margins,
> - the body,
> - a **fixed footer** at the bottom, with correct page layout/margins,
>
> and **once a sheet gets long enough to start crossing the footer's reserved
> area, it should split to the next page** instead of running under the footer.

## How printing is wired (so a CSS change covers every button)

Every Print / Print Draft / Print BOQ button — in **both** the Designer
(`Designer.tsx`) and the read-only viewer (`QuotationViewer.tsx`) — funnels
through `runQuotationPrint()` (`src/lib/printQuotation.ts`), which flips the
preview into read-only mode and calls `window.print()`. They all render the
**same** DOM (`QuotationPreview.tsx`) and obey the **same** `@media print`
rules in `src/app/globals.css`. So the page-frame lives in one place and a fix
there applies to all print buttons at once.

## The page-frame technique (and why we keep it)

Each content page is one `<section class="quotation-sheet">` wrapping a single
`<table class="sheet-layout">`:

- `<thead>` → brand strip = **fixed header**
- `<tbody>` → info grid + items / totals = **body**
- `<tfoot>` → address bar = **fixed footer**

`thead { display: table-header-group }` and `tfoot { display:
table-footer-group }` are the **only browser-native** way to get all three of:

1. repeat the header/footer on **every** physical page,
2. **reserve** their vertical space so body content can never paint over them
   (the engine breaks the table to the next page before the body reaches the
   reserved `<tfoot>` band — exactly the "split before crossing the footer"
   behaviour requested), and
3. keep the full-bleed **cover / about-us** sheets header/footer-free (those
   are separate `.full-bleed` sheets with no table).

A `position: fixed` header/footer gives (1) but **not** (2) — content flows
under it — and it would **leak onto the cover pages** (you can't hide a fixed
element on just the first two pages). A spec-correct `position: running()` /
`@top-center` only works in paid print engines (Prince/WeasyPrint), not in the
browser's "Save as PDF". So the table running-group technique is the right one
for a browser-printed document that also has full-bleed cover art.

References that informed this: the table `thead`/`tfoot` running-group pattern
is the consensus browser-reliable approach
(geeksforgeeks.org/css/how-to-print-header-and-footer-on-every-printed-page-of-a-document-in-css,
aaronsaray.com/2025/a-deep-dive-into-print-css-headers-and-footers); `paged.js`
is only needed for dynamic running content like "Page X of Y", which this
document does not have.

## The bug that caused content to cross the footer

The previous CSS forced `height: 100%` on the single body `<tr>` **and** the
body `<td>`. Because `100%` resolves against a table that is *itself*
overflowing onto the next page, it over-constrained the row; Chrome then
mis-placed the repeated `<tfoot>` on continuation pages and let body content
render **into / under** the footer band — the reported "crossing".

## The fix

In `@media print` (`globals.css`):

- **Removed** `height: 100%` from `.sheet-layout > tbody > tr` and the
  `.sheet-body-cell`. Keeping `height: 100%` on the **table only** still
  distributes spare space to the body row on short pages (footer stays at the
  bottom) **without** over-constraining a row that needs to fragment, so long
  sheets now break to the next page cleanly with no crossing.
- Header/footer cells get `break-inside: avoid` so the bands are never split
  across a page boundary.
- `print-color-adjust: exact` on the whole sheet so the header band, footer
  band, system/section banners and totals highlight actually print (Chrome
  otherwise drops element backgrounds).
- System banners ("Sound System") and section dividers ("Outdoor Cameras") get
  `break-after: avoid` so a banner is never stranded at the bottom of a page
  with its rows pushed to the next.
- Page geometry is unchanged: `@page { size: A4; margin: 14mm 12mm 18mm 12mm }`
  for content pages and a zero-margin named `@page full-bleed` for the cover /
  about-us artwork.

Cover and about-us pages are untouched (they were already good).
