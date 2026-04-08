"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Login failed");
      router.push("/designer");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      className="rounded-2xl bg-white border border-magic-border shadow-xl p-8 space-y-5"
    >
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-magic-ink/70">
          Username
        </label>
        <input
          className="mt-1 w-full rounded-lg border border-magic-border bg-magic-soft/40 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-magic-red/40"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-magic-ink/70">
          Password
        </label>
        <input
          type="password"
          className="mt-1 w-full rounded-lg border border-magic-border bg-magic-soft/40 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-magic-red/40"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-2">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-magic-red text-white font-semibold py-3 text-sm uppercase tracking-wide hover:bg-red-700 disabled:opacity-60 transition"
      >
        {loading ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
