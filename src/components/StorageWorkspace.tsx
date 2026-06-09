"use client";

import StockManagement from "@/components/StockManagement";

/**
 * StorageWorkspace — the CRM → Storage tool surface.
 *
 * V1.5A: the old "Catalogue" tab was removed — browsing the product
 * catalogue belongs to the quotation / pricing flow (/catalog), not the
 * stock module. This now hosts the V1.5A event-sourced stock module
 * directly (live levels, the location tree, and movements). See
 * docs/storage-module-v1.5A.md.
 *
 * `canManage` = storage manager / admin (edit locations, reorder points).
 * `canRecord` = any storage worker / manager / admin (record movements).
 */
export default function StorageWorkspace({
  canManage,
  canRecord,
}: {
  canManage: boolean;
  canRecord: boolean;
}) {
  return <StockManagement canManage={canManage} canRecord={canRecord} />;
}
