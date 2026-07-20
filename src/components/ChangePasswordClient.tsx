"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, ShieldCheck, Check } from "@/lib/icons";

/**
 * Set-your-own-password screen. Reached when `must_change_password` is set
 * (admin created/reset the account, or a first-run upgrade), enforced by the
 * middleware gate. Also usable voluntarily. On success the server clears the
 * flag and re-issues the session, so the app unlocks without a re-login.
 */
export default function ChangePasswordClient({
  displayName,
  forced,
}: {
  displayName: string;
  forced: boolean;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (next.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (next !== confirm) {
      setError("The new passwords don’t match.");
      return;
    }
    if (next === current) {
      setError("New password must be different from the current one.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not change password");
      router.push("/");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setLoading(false);
    }
  }

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/login");
    router.refresh();
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#131418] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center gap-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-[#ED1C24]/15 text-[#ff6b63]">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-lg font-bold text-white">Set your password</h1>
            <p className="text-[13px] text-white/55">
              {displayName ? `Signed in as ${displayName}` : "Secure your account"}
            </p>
          </div>
        </div>

        <form
          onSubmit={onSubmit}
          className="rounded-2xl border border-white/10 bg-white p-6 shadow-2xl"
        >
          <p className="mb-5 text-[13.5px] leading-relaxed text-slate-600">
            {forced
              ? "Your password was set by an administrator. Choose a new password only you know to continue."
              : "Choose a new password for your account."}
          </p>

          <Field
            id="cur"
            label="Current password"
            value={current}
            onChange={setCurrent}
            show={show}
            autoComplete="current-password"
          />
          <Field
            id="new"
            label="New password"
            value={next}
            onChange={setNext}
            show={show}
            autoComplete="new-password"
            hint="At least 8 characters."
          />
          <Field
            id="cfm"
            label="Confirm new password"
            value={confirm}
            onChange={setConfirm}
            show={show}
            autoComplete="new-password"
          />

          <label className="mb-4 flex cursor-pointer select-none items-center gap-2 text-[13px] text-slate-500">
            <input
              type="checkbox"
              checked={show}
              onChange={(e) => setShow(e.target.checked)}
              className="h-4 w-4 accent-[#ED1C24]"
            />
            Show passwords
          </label>

          {error && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] font-medium text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#ED1C24] py-3.5 text-[15px] font-bold text-white shadow-lg shadow-[#ED1C24]/30 transition hover:bg-[#c4151c] disabled:opacity-60"
          >
            {loading ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            ) : (
              <>
                <Check className="h-4 w-4" />
                Save new password
              </>
            )}
          </button>
        </form>

        <button
          type="button"
          onClick={signOut}
          className="mx-auto mt-5 block text-[13px] font-medium text-white/50 transition hover:text-white/80"
        >
          Sign out
        </button>
      </div>
    </main>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  show,
  autoComplete,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  autoComplete: string;
  hint?: string;
}) {
  return (
    <div className="mb-4">
      <label
        htmlFor={id}
        className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500"
      >
        {label}
      </label>
      <div className="relative flex items-center">
        <Lock className="pointer-events-none absolute left-3.5 h-[15px] w-[15px] text-slate-400" />
        <input
          id={id}
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          required
          className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3.5 text-[15px] text-slate-900 transition focus:border-[#ED1C24]/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#ED1C24]/15"
        />
      </div>
      {hint && <p className="mt-1 text-[11.5px] text-slate-400">{hint}</p>}
    </div>
  );
}
