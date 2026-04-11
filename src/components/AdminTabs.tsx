"use client";

import { useState } from "react";
import UserManager from "./UserManager";
import AdminSettings from "./AdminSettings";
import type { AppSettings } from "@/lib/settings";

type Tab = "users" | "settings" | "database";

export default function AdminTabs({
  initialSettings,
}: {
  initialSettings: AppSettings;
}) {
  const [tab, setTab] = useState<Tab>("users");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 border-b border-magic-border">
        <TabButton active={tab === "users"} onClick={() => setTab("users")}>
          Users
        </TabButton>
        <TabButton
          active={tab === "settings"}
          onClick={() => setTab("settings")}
        >
          Settings
        </TabButton>
        <TabButton
          active={tab === "database"}
          onClick={() => setTab("database")}
        >
          Database
        </TabButton>
      </div>

      {tab === "users" && (
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">Users</h2>
          <UserManager />
        </section>
      )}

      {tab === "settings" && (
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Global presets
          </h2>
          <AdminSettings initialSettings={initialSettings} />
        </section>
      )}

      {tab === "database" && (
        <section>
          <h2 className="text-lg font-semibold text-magic-ink mb-3">
            Database maintenance
          </h2>
          <DatabasePanel />
        </section>
      )}
    </div>
  );
}

function DatabasePanel() {
  const [status, setStatus] = useState<
    "idle" | "running" | "ok" | "error"
  >("idle");
  const [message, setMessage] = useState("");

  async function rebaseSchema() {
    setStatus("running");
    setMessage("");
    try {
      const res = await fetch("/api/admin/reset-schema", { method: "POST" });
      const data = (await res.json()) as { ok: boolean; message?: string; error?: string };
      if (data.ok) {
        setStatus("ok");
        setMessage(data.message ?? "Done.");
      } else {
        setStatus("error");
        setMessage(data.error ?? "Unknown error");
      }
    } catch (err) {
      setStatus("error");
      setMessage((err as Error).message);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-magic-border bg-white p-5">
        <h3 className="font-semibold text-magic-ink mb-1">Rebase schema</h3>
        <p className="text-sm text-magic-ink/60 mb-4">
          Re-runs the full database schema bootstrap and applies any pending
          migrations (e.g. new indexes). All statements use{" "}
          <code className="text-xs bg-magic-soft px-1 rounded">IF NOT EXISTS</code>{" "}
          guards —{" "}
          <strong>no quotations, folders or user data is ever modified.</strong>
        </p>
        <button
          onClick={rebaseSchema}
          disabled={status === "running"}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-magic-red text-white hover:bg-magic-red/90 disabled:opacity-50 transition-colors"
        >
          {status === "running" ? "Running…" : "Rebase schema"}
        </button>
        {status === "ok" && (
          <p className="mt-3 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            {message}
          </p>
        )}
        {status === "error" && (
          <p className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Error: {message}
          </p>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px px-4 py-2 text-sm font-semibold border-b-2 transition-colors ${
        active
          ? "border-magic-red text-magic-red"
          : "border-transparent text-magic-ink/60 hover:text-magic-ink"
      }`}
    >
      {children}
    </button>
  );
}
