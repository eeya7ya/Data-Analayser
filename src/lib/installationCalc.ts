/**
 * Shared pricing rule for the Installation Calculator price book.
 *
 * Mirrors the CCTV costing sheet: margin is "margin on selling", so
 *   sell = cost × 100 / (100 − margin)
 * (e.g. cost 50 at 10% margin → 55.56). The sheet rounds to whole JOD;
 * we keep 2 decimals because conduit/cable presets are priced per metre
 * and would collapse to 0 or 1 JOD otherwise.
 */
export function installationSellPrice(
  unitCost: number,
  marginPercent: number,
): number {
  const cost = Number(unitCost) || 0;
  const margin = Math.min(Math.max(Number(marginPercent) || 0, 0), 95);
  return Math.round(cost * (100 / (100 - margin)) * 100) / 100;
}
