"use client";

import { useState } from "react";
import CatalogueUpload from "@/components/CatalogueUpload";

export default function CatalogUploadSection() {
  const [show, setShow] = useState(false);

  return (
    <div className="mb-6">
      <button
        onClick={() => setShow(!show)}
        className="rounded-lg border border-magic-border bg-white px-4 py-2 text-sm font-semibold text-magic-ink hover:bg-magic-soft transition-colors"
      >
        {show ? "Hide upload" : "Upload Excel catalogue"}
      </button>
      {show && (
        <div className="mt-4">
          <CatalogueUpload onDone={() => { setShow(false); window.location.reload(); }} />
        </div>
      )}
    </div>
  );
}
