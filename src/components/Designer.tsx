"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SessionUser } from "@/lib/auth";
import QuotationPreview, {
  QuotationItem,
  QuotationExtraColumn,
} from "./QuotationPreview";
import type { AppSettings } from "@/lib/settings";
import {
  DEFAULT_TERMS,
  loadDraft,
  saveDraft,
  clearDraft,
  saveEditingContext,
  loadEditingContext,
  loadEditDraft,
  saveEditDraft,
  clearEditDraft,
  termsMatchBuiltInDefault,
  PRICING_FACTORS,
  PRICING_LABELS,
  type PricingCategory,
} from "@/lib/quotationDraft";
import { computeQuotationTotals } from "@/lib/quotationTotals";

export interface ExistingQuotation {
  id: number;
  ref: string;
  project_name: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  sales_engineer: string | null;
  prepared_by: string | null;
  site_name: string;
  tax_percent: number;
  folder_id: number | null;
  items_json: QuotationItem[];
  config_json: {
    showPictures?: boolean;
    terms?: string[];
    salesPhone?: string;
    extraColumns?: QuotationExtraColumn[];
    scopeIntro?: string;
    designEng?: string;
    pricingCategory?: PricingCategory;
    manualFactor?: number;
    includeTax?: boolean;
    taxInclusive?: boolean;
    // Legacy marker. Quotations saved before the "Excl. Tax" button was
    // changed from a display overlay to a real unit_price transform stored
    // raw (tax-inclusive) prices even when taxInclusive=true. The hydration
    // path below divides those rows on first open and then sets this flag
    // on save so the migration only runs once per quotation.
    taxPricesNormalized?: boolean;
  };
}

interface ClientFolder {
  id: number;
  name: string;
  client_email?: string | null;
  client_phone?: string | null;
  client_company?: string | null;
}

export default function Designer({
  user,
  existing,
  initialFolderId,
  appSettings,
}: {
  user: SessionUser;
  existing?: ExistingQuotation;
  /**
   * Folder id passed in via `?folder=<id>` when the user clicked
   * "+ New quotation" from inside a client card on /quotation. We use
   * it to pre-select the folder in create mode so the client fields
   * are already locked in when the Designer first renders.
   */
  initialFolderId?: number | null;
  /**
   * Global presets loaded on the server — seeds the default Terms list for
   * new quotations and supplies the admin-editable printable footer.
   */
  appSettings: AppSettings;
}) {
  const adminDefaultTerms =
    appSettings.defaultTerms && appSettings.defaultTerms.length > 0
      ? appSettings.defaultTerms
      : DEFAULT_TERMS;
  const router = useRouter();
  const editMode = !!existing;
  const [projectName, setProjectName] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const [salesEng, setSalesEng] = useState("ENG. Yahya Khaled");
  const [salesPhone, setSalesPhone] = useState("+962 795172566");
  const [preparedBy, setPreparedBy] = useState(user.username);
  const [refCode, setRefCode] = useState("");
  const [siteName, setSiteName] = useState("");
  const [taxPercent, setTaxPercent] = useState(16);
  const [items, setItems] = useState<QuotationItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");
  const [showPictures, setShowPictures] = useState(false);
  const [terms, setTerms] = useState<string[]>([...adminDefaultTerms]);
  const [extraColumns, setExtraColumns] = useState<QuotationExtraColumn[]>([]);
  const [scopeIntro, setScopeIntro] = useState("");
  const [designEng, setDesignEngState] = useState("");
  const [pricingCategory, setPricingCategoryState] = useState<PricingCategory>("si");
  // User-defined multiplier applied to SI base prices when pricing
  // category == "manual". Stored as a string so the <input> can hold
  // partial values like "1." while the user is still typing without the
  // backing number collapsing to NaN.
  const [manualFactor, setManualFactor] = useState<number>(1);
  const [manualFactorText, setManualFactorText] = useState<string>("1");
  const [includeTax, setIncludeTax] = useState(true);
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [folders, setFolders] = useState<ClientFolder[]>([]);
  const [folderId, setFolderId] = useState<number | null>(null);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderEmail, setNewFolderEmail] = useState("");
  const [newFolderPhone, setNewFolderPhone] = useState("");
  const [newFolderCompany, setNewFolderCompany] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);
  // When true, the embedded QuotationPreview is rendered in non-editable
  // mode for the duration of a browser print dialog, so the printed output
  // matches the /quotation viewer exactly (no editable chrome, no extra
  // "Add row / Add column" toolbars). The toggle flips back off as soon as
  // the print dialog closes via `onafterprint`.
  const [printMode, setPrintMode] = useState(false);
  const hydratedRef = useRef(false);

  // Presales Engineer for this session — always anchored to the logged-in
  // user so an admin signed in after a sales engineer on the same browser
  // never inherits the previous person's name. Edit mode still lets saved
  // quotations keep whatever `config_json.designEng` the author stamped.
  const defaultDesignEng = user.display_name || user.username;

  /**
   * A folder acts as the CRM record for the client: when one is selected
   * the Designer treats the folder's email/phone/name as the source of
   * truth for the quotation header and locks those inputs so the only
   * thing the user types for a new quotation is the project name.
   */
  const selectedFolder =
    folderId != null ? folders.find((f) => f.id === folderId) || null : null;
  const clientLocked = !!selectedFolder;

  /**
   * Gate the design UI (pricing toolbar + quotation table) behind a client
   * selection when creating a brand-new quotation. The workflow is now
   *   Step 1 — land on /designer → "Start a new quotation" hero with the
   *            client picker as the only interactive thing on the page.
   *   Step 2 — once a folder is picked, reveal the pricing toolbar and the
   *            quotation preview so the user can actually design.
   * Edit mode always shows everything because legacy rows may have a null
   * folder_id and we don't want to hide the table from them.
   */
  const showDesignUI = editMode || folderId != null;

  function setDesignEng(value: string) {
    // Session-local only: changes stay in the draft / saved config but do
    // not leak to a browser-wide localStorage pref. A previous global
    // "last Presales Engineer" key leaked between users on shared browsers
    // so an admin would see a sales engineer's name under their own login.
    setDesignEngState(value);
  }

  // ── Pricing category switching ────────────────────────────────────────────
  // When the user picks a new preset category (SI / DPP / End-user) we
  // recompute every row's unit_price from its stored price_si baseline.
  // Manual pricing now also recomputes — using a user-defined multiplier
  // (`manualFactor`) that the user types next to the button — so the rule
  // is: unit_price = price_si × factor for every category, with the factor
  // being the preset value for SI/DPP/End-user and the user-entered
  // number for manual.
  function setPricingCategory(next: PricingCategory) {
    setPricingCategoryState(next);

    const factor =
      next === "manual"
        ? Number.isFinite(manualFactor) && manualFactor > 0
          ? manualFactor
          : 1
        : PRICING_FACTORS[next];

    setItems((cur) =>
      cur.map((it) => {
        // Use stored SI price if available, otherwise treat current
        // unit_price as the SI baseline (backwards-compat with old items).
        const base = it.price_si ?? it.unit_price;
        return {
          ...it,
          price_si: base,
          unit_price: Number((base * factor).toFixed(2)),
        };
      }),
    );
  }

  // Applies the manual multiplier to every row's SI base price. Called
  // from the manual-factor input whenever the user commits a new value
  // (onBlur or Enter). We keep this separate from `setPricingCategory`
  // so the factor can be re-applied without the user having to toggle
  // the category button a second time.
  function applyManualFactor(nextFactor: number) {
    if (!Number.isFinite(nextFactor) || nextFactor <= 0) return;
    setManualFactor(nextFactor);
    setManualFactorText(String(nextFactor));
    if (pricingCategory !== "manual") return;
    setItems((cur) =>
      cur.map((it) => {
        const base = it.price_si ?? it.unit_price;
        return {
          ...it,
          price_si: base,
          unit_price: Number((base * nextFactor).toFixed(2)),
        };
      }),
    );
  }

  // Pressing the Excl./Incl. Tax button MUTATES every row's unit_price
  // (and price_si baseline) so the stored value matches what the user
  // sees and what gets saved. The taxInclusive flag is kept as metadata
  // recording the user's last action so the button label survives a
  // reload. Running the transform across every item (optional rows
  // included) keeps unit prices consistent — the optional flag only
  // hides the row total, the unit price itself is still displayed for
  // reference and must track the toggle.
  function toggleTaxInclusive() {
    const rate = (Number(taxPercent) || 0) / 100;
    if (rate <= 0) {
      setTaxInclusive((v) => !v);
      return;
    }
    const factor = 1 + rate;
    const goingExclusive = !taxInclusive;
    const op = goingExclusive
      ? (n: number) => Number((n / factor).toFixed(2))
      : (n: number) => Number((n * factor).toFixed(2));
    setItems((cur) =>
      cur.map((it) => ({
        ...it,
        unit_price: op(Number(it.unit_price) || 0),
        price_si: it.price_si != null ? op(Number(it.price_si)) : it.price_si,
      })),
    );
    setTaxInclusive((v) => !v);
  }

  // ── Hydrate state on mount ────────────────────────────────────────────────
  useEffect(() => {
    if (existing) {
      saveEditingContext({
        id: existing.id,
        ref: existing.ref,
        projectName: existing.project_name || "",
      });

      const baseItems = (Array.isArray(existing.items_json)
        ? existing.items_json
        : []
      ).map((it) => ({
        ...it,
        system: it.system || it.brand || "General",
        price_si: it.price_si ?? it.unit_price,
      }));

      const draft = loadDraft();
      const stagedItems =
        Array.isArray(draft.items) && draft.items.length > 0
          ? draft.items.map((it) => ({
              ...it,
              system: it.system || it.brand || "General",
              price_si: it.price_si ?? it.unit_price,
            }))
          : [];
      // Per-quotation edit draft: unsaved edits made in a previous
      // session (e.g. modified terms) are kept in localStorage under a
      // per-id key so refreshing /designer?id=X doesn't blow them away.
      // Only used when no catalog stagedItems are pending — staging
      // takes priority because the user just pushed products in from
      // the catalog and expects to see them.
      const editDraft =
        stagedItems.length === 0 ? loadEditDraft(existing.id) : null;
      const combinedBase =
        editDraft && Array.isArray(editDraft.items) && editDraft.items.length > 0
          ? editDraft.items.map((it) => ({
              ...it,
              system: it.system || it.brand || "General",
              price_si: it.price_si ?? it.unit_price,
            }))
          : [...baseItems, ...stagedItems];
      const combined = combinedBase.map((it, i) => ({
        ...it,
        no: i + 1,
      }));
      setItems(combined);
      if (stagedItems.length > 0) clearDraft();

      setProjectName(editDraft?.projectName ?? (existing.project_name || ""));
      setClientName(existing.client_name || "");
      setClientEmail(existing.client_email || "");
      setClientPhone(existing.client_phone || "");
      setSalesEng(existing.sales_engineer || "ENG. Yahya Khaled");
      setSalesPhone(existing.config_json?.salesPhone || "+962 795172566");
      setPreparedBy(existing.prepared_by || user.username);
      setRefCode(existing.ref);
      setSiteName(editDraft?.siteName ?? (existing.site_name || ""));
      setTaxPercent(
        Number(editDraft?.taxPercent ?? existing.tax_percent ?? 16),
      );
      setShowPictures(
        editDraft ? Boolean(editDraft.showPictures) : Boolean(existing.config_json?.showPictures),
      );
      {
        // Saved quotations created before the admin Settings tab existed
        // have `config_json.terms` stamped with the old built-in defaults.
        // Those should yield to the current admin-edited presets so the
        // user's edits in /admin → Settings actually propagate; a genuine
        // customisation (anything that differs from the built-in list)
        // still wins. The per-id edit draft (if any) takes priority over
        // both — that's the "unsaved in-flight edits survive refresh"
        // path the terms-not-saving complaint hinges on.
        const savedTerms = Array.isArray(existing.config_json?.terms)
          ? existing.config_json!.terms!
          : [];
        const draftedTerms =
          editDraft && Array.isArray(editDraft.terms) ? editDraft.terms : null;
        if (draftedTerms && draftedTerms.length > 0) {
          setTerms(draftedTerms);
        } else {
          const useAdminDefaults =
            savedTerms.length === 0 || termsMatchBuiltInDefault(savedTerms);
          setTerms(useAdminDefaults ? [...adminDefaultTerms] : savedTerms);
        }
      }
      setExtraColumns(
        editDraft?.extraColumns ??
          (Array.isArray(existing.config_json?.extraColumns)
            ? existing.config_json!.extraColumns!
            : []),
      );
      setScopeIntro(editDraft?.scopeIntro ?? (existing.config_json?.scopeIntro || ""));
      // Presales Engineer: prefer whatever the quotation was saved with so
      // reopening an old record is lossless; otherwise anchor to the
      // logged-in user's display name. The previous fallback chain also
      // consulted a browser-wide localStorage pref, which leaked names
      // between users on shared machines — that step is intentionally gone.
      setDesignEngState(
        editDraft?.designEng ||
          existing.config_json?.designEng ||
          defaultDesignEng,
      );
      setPricingCategoryState(
        editDraft?.pricingCategory || existing.config_json?.pricingCategory || "si",
      );
      {
        const restoredManual =
          editDraft && typeof editDraft.manualFactor === "number" && Number.isFinite(editDraft.manualFactor) && editDraft.manualFactor > 0
            ? editDraft.manualFactor
            : typeof existing.config_json?.manualFactor === "number" &&
                Number.isFinite(existing.config_json.manualFactor) &&
                existing.config_json.manualFactor > 0
              ? existing.config_json.manualFactor
              : 1;
        setManualFactor(restoredManual);
        setManualFactorText(String(restoredManual));
      }
      setIncludeTax(
        editDraft ? editDraft.includeTax !== false : existing.config_json?.includeTax !== false,
      );
      setTaxInclusive(
        editDraft ? Boolean(editDraft.taxInclusive) : Boolean(existing.config_json?.taxInclusive),
      );

      // Legacy migration: quotations saved before the Excl./Incl. Tax
      // button was changed from a display overlay to a real unit_price
      // transform stored RAW (tax-inclusive) prices even when the flag
      // was on. Detect via the absence of `taxPricesNormalized` and
      // divide every unit_price/price_si by (1+rate) once, so totals and
      // displayed values match after the divisor was removed from the
      // preview. The next save persists the flag and skips this branch.
      const legacyCfg = existing.config_json || {};
      if (legacyCfg.taxInclusive && !legacyCfg.taxPricesNormalized) {
        const legacyRate = (Number(existing.tax_percent ?? 16) || 0) / 100;
        if (legacyRate > 0) {
          const legacyFactor = 1 + legacyRate;
          setItems((cur) =>
            cur.map((it) => ({
              ...it,
              unit_price: Number(
                ((Number(it.unit_price) || 0) / legacyFactor).toFixed(2),
              ),
              price_si:
                it.price_si != null
                  ? Number(
                      ((Number(it.price_si) || 0) / legacyFactor).toFixed(2),
                    )
                  : it.price_si,
            })),
          );
        }
      }

      hydratedRef.current = true;
      return;
    }

    saveEditingContext(null);

    const d = loadDraft();
    setItems(d.items.map((it) => ({ ...it, price_si: it.price_si ?? it.unit_price })));
    setProjectName(d.projectName);
    setClientName(d.clientName);
    setClientEmail(d.clientEmail);
    setClientPhone(d.clientPhone);
    setSalesEng(d.salesEng);
    setSalesPhone(d.salesPhone);
    setPreparedBy(d.preparedBy || user.username);
    setRefCode(d.refCode);
    setSiteName(d.siteName);
    setTaxPercent(d.taxPercent);
    setShowPictures(d.showPictures);
    setTerms(d.terms.length > 0 ? d.terms : [...adminDefaultTerms]);
    setExtraColumns(d.extraColumns || []);
    setScopeIntro(d.scopeIntro || "");
    // Presales Engineer for a brand-new quotation is ALWAYS the logged-in
    // user. We deliberately ignore anything `loadDraft()` returned for
    // `designEng` so switching accounts on a shared browser doesn't
    // resurface the previous user's name; the helper already scrubs that
    // field, this line is defence in depth.
    setDesignEngState(defaultDesignEng);
    setPricingCategoryState(d.pricingCategory || "si");
    setIncludeTax(d.includeTax !== false);
    setTaxInclusive(Boolean(d.taxInclusive));
    const restoredManual =
      typeof d.manualFactor === "number" && Number.isFinite(d.manualFactor) && d.manualFactor > 0
        ? d.manualFactor
        : 1;
    setManualFactor(restoredManual);
    setManualFactorText(String(restoredManual));
    // Restore the previously picked client folder so a full-page refresh
    // no longer drops the user back into the "pick a client" hero. The
    // actual select dropdown is still wired up normally, so changing
    // clients from this point onward works like before.
    if (typeof d.folderId === "number" && Number.isFinite(d.folderId)) {
      setFolderId(d.folderId);
    }
    hydratedRef.current = true;
  }, [existing, user.username, user.display_name]);

  // ── Fetch client folders ──────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/folders")
      .then((r) => r.json())
      .then((d) => setFolders(d.folders || []))
      .catch(() => {});
  }, []);

  // Set folder_id from existing quotation after folders are loaded
  useEffect(() => {
    if (existing?.folder_id && folders.length > 0) {
      setFolderId(existing.folder_id);
    }
  }, [existing, folders]);

  // Create mode: pre-select the folder passed in via `?folder=<id>` on the
  // URL (the "+ New quotation" button on each client card). We only do
  // this once, and only when there's no current selection, so the user
  // can still switch to a different client afterwards.
  const initialFolderAppliedRef = useRef(false);
  useEffect(() => {
    if (editMode) return;
    if (initialFolderAppliedRef.current) return;
    if (!initialFolderId) return;
    if (folders.length === 0) return;
    if (folders.some((f) => f.id === initialFolderId)) {
      setFolderId(initialFolderId);
      initialFolderAppliedRef.current = true;
    }
  }, [editMode, initialFolderId, folders]);

  // When the user picks a client folder, snap the client header fields to
  // the folder's CRM data. This is the mechanism that implements
  // "select a folder, only type the project name" — the inputs become
  // read-only via `clientLocked` and their values are sourced from here.
  useEffect(() => {
    if (!selectedFolder) return;
    setClientName(selectedFolder.name || "");
    setClientEmail(selectedFolder.client_email || "");
    setClientPhone(selectedFolder.client_phone || "");
  }, [selectedFolder]);

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setCreatingFolder(true);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          client_email: newFolderEmail.trim() || null,
          client_phone: newFolderPhone.trim() || null,
          client_company: newFolderCompany.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      setFolders((prev) =>
        [...prev, data.folder].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setFolderId(data.folder.id);
      setNewFolderName("");
      setNewFolderEmail("");
      setNewFolderPhone("");
      setNewFolderCompany("");
      setShowNewFolder(false);
    } catch (err) {
      alert((err as Error).message || "Failed to create client folder");
    } finally {
      setCreatingFolder(false);
    }
  }

  // ── Persist draft whenever it changes (new-mode only) ─────────────────────
  useEffect(() => {
    if (!hydratedRef.current || editMode) return;
    saveDraft({
      items,
      projectName,
      clientName,
      clientEmail,
      clientPhone,
      salesEng,
      salesPhone,
      preparedBy,
      refCode,
      siteName,
      taxPercent,
      showPictures,
      terms,
      extraColumns,
      scopeIntro,
      designEng,
      pricingCategory,
      manualFactor,
      includeTax,
      taxInclusive,
      folderId,
    });
  }, [
    editMode,
    items,
    projectName,
    clientName,
    clientEmail,
    clientPhone,
    salesEng,
    salesPhone,
    preparedBy,
    refCode,
    siteName,
    taxPercent,
    showPictures,
    terms,
    extraColumns,
    scopeIntro,
    designEng,
    pricingCategory,
    manualFactor,
    includeTax,
    taxInclusive,
    folderId,
  ]);

  // ── Persist edit-mode draft per quotation id ──────────────────────────────
  // Edit mode used to skip localStorage entirely, which meant any in-flight
  // changes (notably term edits) were thrown away on refresh. We now
  // mirror the relevant state into a per-id slot so refreshing
  // /designer?id=X reinstates the user's unsaved work. The slot is
  // cleared from saveQuotation() once the server confirms the PATCH.
  useEffect(() => {
    if (!hydratedRef.current || !editMode || !existing) return;
    saveEditDraft(existing.id, {
      items,
      terms,
      extraColumns,
      scopeIntro,
      designEng,
      pricingCategory,
      manualFactor,
      includeTax,
      taxInclusive,
      projectName,
      siteName,
      showPictures,
      taxPercent,
    });
  }, [
    editMode,
    existing,
    items,
    terms,
    extraColumns,
    scopeIntro,
    designEng,
    pricingCategory,
    manualFactor,
    includeTax,
    taxInclusive,
    projectName,
    siteName,
    showPictures,
    taxPercent,
  ]);

  // ── Restore last-used saved quotation on fresh /designer load ─────────────
  // If the user landed on /designer with no ?id= query string but there's
  // an editing context in localStorage (meaning they were last working on
  // a saved quotation), bounce them over to /designer?id=X so the refresh
  // keeps them in their current project instead of dropping them into an
  // empty new-quotation hero. The "+ New quotation" button next to the
  // client picker is the explicit opt-out.
  const autoRedirectCheckedRef = useRef(false);
  useEffect(() => {
    if (autoRedirectCheckedRef.current) return;
    autoRedirectCheckedRef.current = true;
    if (editMode) return;
    if (typeof window === "undefined") return;
    // Honour the ?new=1 opt-out so the "+ New quotation" button can
    // land on a clean /designer without getting bounced back.
    const sp = new URLSearchParams(window.location.search);
    if (sp.has("new")) return;
    const ctx = loadEditingContext();
    if (ctx && Number.isFinite(ctx.id)) {
      router.replace(`/designer?id=${ctx.id}`);
    }
  }, [editMode, router]);

  async function saveQuotation() {
    // In create mode, a client folder is required — it's how the quotation
    // inherits client_name/email/phone. In edit mode we preserve whatever
    // folder state the existing row had (may be null for legacy rows).
    if (!editMode && !folderId) {
      alert("Please select or create a client before saving the quotation.");
      return;
    }
    setSaving(true);
    setSaveStatus("");
    try {
      const totals = computeQuotationTotals(items, includeTax ? taxPercent : 0, includeTax && taxInclusive);
      const payload = {
        ref: refCode || undefined,
        project_name: projectName || "Untitled Quotation",
        client_name: clientName,
        client_email: clientEmail,
        client_phone: clientPhone,
        sales_engineer: salesEng,
        prepared_by: preparedBy || user.username,
        site_name: siteName,
        tax_percent: taxPercent,
        folder_id: folderId,
        items,
        totals,
        config: {
          showPictures,
          terms,
          salesPhone,
          extraColumns,
          scopeIntro,
          designEng,
          pricingCategory,
          manualFactor,
          includeTax,
          taxInclusive,
          // Stamped on every save so the legacy migration in the
          // hydration effect only runs once per quotation.
          taxPricesNormalized: true,
        },
      };
      const res = editMode
        ? await fetch(`/api/quotations?id=${existing!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/quotations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "save failed");
      if (editMode) {
        // The in-flight edit draft has now been flushed to the DB, so
        // the per-id localStorage slot can go. If the user keeps editing
        // after this, fresh changes will repopulate it via the save
        // effect above.
        if (existing) clearEditDraft(existing.id);
        const now = new Date().toLocaleTimeString("en-GB");
        setSaveStatus(`Saved at ${now}`);
        return;
      }
      clearDraft();
      saveEditingContext(null);
      router.push(`/quotation?id=${data.quotation.id}`);
    } catch (err) {
      setSaveStatus(`Error: ${(err as Error).message}`);
      alert((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function clearAll() {
    if (!confirm("Clear the current quotation draft?")) return;
    setItems([]);
    setProjectName("");
    setClientName("");
    setClientEmail("");
    setClientPhone("");
    setSiteName("");
    setShowPictures(false);
    setTerms([...adminDefaultTerms]);
    setPricingCategoryState("si");
    if (!editMode) clearDraft();
  }

  /**
   * User-initiated "start a brand-new quotation" — the explicit opt-out
   * from the "restore last-used project on refresh" behaviour. We drop
   * any in-flight draft, clear the editing context (so the auto-redirect
   * effect doesn't bounce us back), then navigate to /designer?new=1 so
   * a fresh reload lands on the empty hero. The query flag lives only
   * long enough for the redirect effect to see it once — subsequent
   * edits populate a brand-new draft from zero.
   */
  function startNewQuotation() {
    if (
      items.length > 0 &&
      !confirm(
        "Start a new quotation? Any unsaved changes in the current draft will be discarded.",
      )
    ) {
      return;
    }
    clearDraft();
    saveEditingContext(null);
    if (editMode && existing) clearEditDraft(existing.id);
    router.push("/designer?new=1");
  }

  // Prints the current in-memory quotation preview straight from the
  // Designer without first saving. We flip `printMode` on so the embedded
  // <QuotationPreview> re-renders in its non-editable form — same code
  // path as the /quotation viewer — and only then open the browser print
  // dialog. Without this, the printed output picked up the editable
  // chrome (manual-column toolbars, add-row buttons, inline form inputs)
  // and the empty-state "Add manual item" sheet, giving the user the
  // extra "unrequired slide" and mis-styled layout they reported.
  function printQuotation() {
    if (typeof window === "undefined") return;
    setPrintMode(true);
  }

  // Once `printMode` is committed the DOM now mirrors the read-only
  // viewer, so opening the browser print dialog produces an identical
  // printed document. We wait one frame for React to flush, call
  // `window.print()` (which blocks until the user confirms/cancels),
  // then drop back into editable mode on the next tick. Using
  // `onafterprint` as a safety net covers the Safari path where
  // `window.print()` returns before the dialog closes.
  useEffect(() => {
    if (!printMode) return;
    let cancelled = false;
    const restore = () => {
      if (cancelled) return;
      setPrintMode(false);
    };
    window.addEventListener("afterprint", restore);
    const frame = window.requestAnimationFrame(() => {
      try {
        window.print();
      } finally {
        // Some browsers (Chrome) return synchronously from window.print();
        // flip back immediately so the editable UI comes back.
        restore();
      }
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", restore);
    };
  }, [printMode]);

  return (
    <div className="space-y-4">
      {/* ── Step 1 hero ──────────────────────────────────────────────────────
          Only rendered in create mode before a client is picked. Gives the
          user a single clear instruction ("pick a client to start") instead
          of dropping them into an empty preview with no obvious next action.
          Disappears as soon as a folder is selected so it doesn't get in the
          way of subsequent edits. */}
      {!showDesignUI && (
        <div className="no-print rounded-2xl border-2 border-dashed border-magic-red/40 bg-gradient-to-b from-magic-red/5 to-transparent p-6 text-center">
          <button
            type="button"
            onClick={() => setShowNewFolder(true)}
            title="Create a new client and start a quotation"
            className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-magic-red text-white shadow-sm transition-transform hover:scale-105 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-magic-red focus:ring-offset-2"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 4v16m8-8H4"
              />
            </svg>
            <span className="sr-only">Create new client</span>
          </button>
          <h2 className="text-xl font-bold text-magic-ink">
            Start a new quotation
          </h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-magic-ink/70">
            Click the <span className="font-semibold text-magic-red">+</span>{" "}
            above to create a new client, or pick an existing one from the
            dropdown below. The quotation will be filed under their folder
            and the header fields (name, email, phone) will be filled in for
            you. Once a client is selected, the pricing toolbar and
            quotation table will appear.
          </p>
        </div>
      )}

      {/* ── Settings toolbar ──────────────────────────────────────────────── */}
      {showDesignUI && (
      <div className="no-print rounded-2xl border border-magic-border bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Pricing category */}
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-semibold uppercase text-magic-ink/60 mb-1">
              Pricing category
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.keys(PRICING_LABELS) as PricingCategory[]).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setPricingCategory(cat)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                    pricingCategory === cat
                      ? "bg-magic-red text-white"
                      : "border border-magic-border text-magic-ink/70 hover:bg-magic-soft"
                  }`}
                >
                  {PRICING_LABELS[cat]}
                  {cat !== "manual" && (
                    <span className="ml-1 text-[10px] opacity-70">
                      ×{PRICING_FACTORS[cat as Exclude<PricingCategory, "manual">]}
                    </span>
                  )}
                </button>
              ))}
            </div>
            {pricingCategory !== "manual" && (
              <p className="mt-1 text-[10px] text-magic-ink/50">
                All prices = SI base × {PRICING_FACTORS[pricingCategory as Exclude<PricingCategory, "manual">]}
              </p>
            )}
            {pricingCategory === "manual" && (
              <div className="mt-1 flex items-center gap-2">
                <label className="text-[10px] font-semibold uppercase text-magic-ink/60">
                  Factor
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={manualFactorText}
                  onChange={(e) => setManualFactorText(e.target.value)}
                  onBlur={() => {
                    const n = Number(manualFactorText);
                    if (Number.isFinite(n) && n > 0) {
                      applyManualFactor(n);
                    } else {
                      // Revert the input text if the user typed nonsense
                      // — the committed factor stays at whatever was last
                      // successfully applied.
                      setManualFactorText(String(manualFactor));
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      (e.target as HTMLInputElement).blur();
                    }
                  }}
                  className="w-20 rounded-md border border-magic-border px-2 py-1 text-sm"
                  title="Multiplier applied to each row's SI base price (e.g. 1.5 = +50%, 0.98 = −2%)"
                />
                <span className="text-[10px] text-magic-ink/50">
                  Unit price = SI base × {Number.isFinite(manualFactor) && manualFactor > 0 ? manualFactor : 1}
                </span>
              </div>
            )}
          </div>

          {/* Quick settings */}
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-[10px] font-semibold uppercase text-magic-ink/60">
                Tax %
              </label>
              <div className="flex items-center gap-1.5 mt-1">
                <input
                  type="number"
                  value={taxPercent}
                  onChange={(e) => setTaxPercent(Number(e.target.value))}
                  disabled={!includeTax}
                  className={`w-20 rounded-md border border-magic-border px-2 py-1 text-sm ${
                    !includeTax ? "opacity-40" : ""
                  }`}
                />
                <button
                  onClick={() => setIncludeTax(!includeTax)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    includeTax
                      ? "bg-green-600 text-white hover:bg-green-700"
                      : "bg-gray-300 text-magic-ink/70 hover:bg-gray-400"
                  }`}
                  title={includeTax ? "Click to exclude tax" : "Click to include tax"}
                >
                  {includeTax ? "Tax ON" : "Tax OFF"}
                </button>
                <button
                  onClick={toggleTaxInclusive}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                    taxInclusive
                      ? "bg-orange-500 text-white hover:bg-orange-600"
                      : "bg-gray-300 text-magic-ink/70 hover:bg-gray-400"
                  }`}
                  title={taxInclusive ? "Prices shown are tax-excluded" : "Click to exclude tax from prices"}
                >
                  {taxInclusive ? "Excl. Tax" : "Incl. Tax"}
                </button>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-magic-ink/80 pb-1">
              <input
                type="checkbox"
                checked={showPictures}
                onChange={(e) => setShowPictures(e.target.checked)}
              />
              Pictures
            </label>
          </div>
        </div>
      </div>
      )}

      {/* ── Client folder (CRM) ─────────────────────────────────────────────
          A client folder IS the client record. Selecting one populates the
          email / phone / name on the printable quotation and locks those
          fields so the user only needs to fill in the project name. */}
      <div className="no-print rounded-2xl border border-magic-border bg-white p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-[10px] font-semibold uppercase text-magic-ink/60 mb-1">
              Client {editMode ? "" : <span className="text-magic-red">*</span>}
            </label>
            {!showNewFolder ? (
              <div className="flex items-center gap-2">
                <select
                  value={folderId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "__new__") {
                      setShowNewFolder(true);
                    } else {
                      setFolderId(v ? Number(v) : null);
                    }
                  }}
                  className="rounded-md border border-magic-border px-3 py-1.5 text-sm min-w-[240px]"
                >
                  <option value="">
                    {editMode ? "No client (unfiled)" : "— Select a client —"}
                  </option>
                  {folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                      {f.client_company ? ` · ${f.client_company}` : ""}
                    </option>
                  ))}
                  <option value="__new__">+ New client…</option>
                </select>
                {/* Explicit opt-out of "restore last-used project on refresh".
                    Clicking this discards the in-flight draft and lands on a
                    fresh /designer?new=1 page — the designer no longer
                    auto-redirects when the `new` flag is present. */}
                <button
                  type="button"
                  onClick={startNewQuotation}
                  title="Start a brand-new quotation (discards any unsaved draft)"
                  className="rounded-md border border-magic-border px-3 py-1.5 text-xs font-semibold text-magic-ink/80 hover:bg-magic-soft"
                >
                  + New quotation
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-start gap-2">
                <input
                  autoFocus
                  className="rounded-md border border-magic-border px-3 py-1.5 text-sm min-w-[180px]"
                  placeholder="Client name *"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); createFolder(); }
                    if (e.key === "Escape") {
                      setShowNewFolder(false);
                      setNewFolderName("");
                      setNewFolderEmail("");
                      setNewFolderPhone("");
                      setNewFolderCompany("");
                    }
                  }}
                />
                <input
                  className="rounded-md border border-magic-border px-3 py-1.5 text-sm min-w-[180px]"
                  placeholder="Email"
                  value={newFolderEmail}
                  onChange={(e) => setNewFolderEmail(e.target.value)}
                />
                <input
                  className="rounded-md border border-magic-border px-3 py-1.5 text-sm min-w-[150px]"
                  placeholder="Phone"
                  value={newFolderPhone}
                  onChange={(e) => setNewFolderPhone(e.target.value)}
                />
                <input
                  className="rounded-md border border-magic-border px-3 py-1.5 text-sm min-w-[170px]"
                  placeholder="Company"
                  value={newFolderCompany}
                  onChange={(e) => setNewFolderCompany(e.target.value)}
                />
                <button
                  onClick={createFolder}
                  disabled={!newFolderName.trim() || creatingFolder}
                  className="rounded-md bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
                >
                  {creatingFolder ? "Creating…" : "Create client"}
                </button>
                <button
                  onClick={() => {
                    setShowNewFolder(false);
                    setNewFolderName("");
                    setNewFolderEmail("");
                    setNewFolderPhone("");
                    setNewFolderCompany("");
                  }}
                  className="rounded-md border border-magic-border px-3 py-1.5 text-xs hover:bg-magic-soft"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
          {selectedFolder && !showNewFolder && (
            <div className="text-[11px] text-magic-ink/70 space-y-0.5 pt-4">
              <div><span className="font-semibold">Email:</span> {selectedFolder.client_email || "—"}</div>
              <div><span className="font-semibold">Phone:</span> {selectedFolder.client_phone || "—"}</div>
              <div><span className="font-semibold">Company:</span> {selectedFolder.client_company || "—"}</div>
              <div className="text-magic-ink/40 italic">
                Client info comes from this folder. Edit it on the Quotations page.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Quotation preview & table editor ───────────────────────────────
          Hidden in create mode until a client folder is picked so the user
          has a single clear next action (Step 1: pick a client) instead of
          facing an empty preview they can't save anyway. */}
      {showDesignUI && (
      <div className="rounded-2xl border border-magic-border bg-white p-4">
        <div className="no-print flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Quotation preview</h3>
          <div className="flex items-center gap-2">
            {editMode && saveStatus && (
              <span
                className={`text-[11px] italic ${
                  saveStatus.startsWith("Error")
                    ? "text-red-600"
                    : "text-magic-ink/60"
                }`}
              >
                {saveStatus}
              </span>
            )}
            <button
              onClick={clearAll}
              disabled={items.length === 0 || saving}
              className="rounded-md border border-magic-border px-3 py-1.5 text-xs hover:bg-magic-soft disabled:opacity-40"
            >
              Clear
            </button>
            <button
              onClick={printQuotation}
              disabled={items.length === 0}
              title="Print the current quotation preview"
              className="rounded-md bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
            >
              Print / PDF
            </button>
            <button
              onClick={saveQuotation}
              disabled={
                items.length === 0 || saving || (!editMode && !folderId)
              }
              title={
                !editMode && !folderId
                  ? "Select a client before saving"
                  : undefined
              }
              className="rounded-md bg-magic-red text-white px-3 py-1.5 text-xs font-semibold hover:bg-red-700 disabled:opacity-50"
            >
              {saving
                ? "Saving…"
                : editMode
                  ? "Save updates"
                  : "Save & open printable"}
            </button>
          </div>
        </div>
        <QuotationPreview
          header={{
            project_name: projectName,
            client_name: clientName,
            client_email: clientEmail,
            client_phone: clientPhone,
            sales_engineer: salesEng,
            sales_phone: salesPhone,
            prepared_by: preparedBy,
            design_engineer: designEng,
            site_name: siteName,
            ref: refCode || "PREVIEW",
            tax_percent: taxPercent,
            date: new Date().toLocaleDateString("en-GB"),
            extra_columns: extraColumns,
            scope_intro: scopeIntro,
          }}
          items={items}
          setItems={setItems}
          setHeader={(patch) => {
            if (patch.project_name !== undefined)
              setProjectName(patch.project_name);
            if (patch.client_name !== undefined)
              setClientName(patch.client_name);
            if (patch.client_email !== undefined)
              setClientEmail(patch.client_email);
            if (patch.client_phone !== undefined)
              setClientPhone(patch.client_phone);
            if (patch.sales_engineer !== undefined)
              setSalesEng(patch.sales_engineer);
            if (patch.sales_phone !== undefined)
              setSalesPhone(patch.sales_phone);
            if (patch.prepared_by !== undefined)
              setPreparedBy(patch.prepared_by);
            if (patch.ref !== undefined) setRefCode(patch.ref);
            if (patch.site_name !== undefined) setSiteName(patch.site_name);
            if (patch.extra_columns !== undefined)
              setExtraColumns(patch.extra_columns);
            if (patch.scope_intro !== undefined)
              setScopeIntro(patch.scope_intro);
            if (patch.design_engineer !== undefined)
              setDesignEng(patch.design_engineer);
          }}
          // While `printMode` is on we re-render in read-only form so the
          // browser print dialog captures the same DOM the /quotation
          // viewer produces — no editable inputs, no add-row toolbars, no
          // empty-state sheet with an "Add manual item" button.
          editable={!printMode}
          showPictures={showPictures}
          terms={terms}
          setTerms={setTerms}
          includeTax={includeTax}
          taxInclusive={taxInclusive}
          clientLocked={clientLocked}
          footerText={appSettings.footerText}
        />
      </div>
      )}
    </div>
  );
}
