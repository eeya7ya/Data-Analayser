"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginForm() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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
      className="rounded-2xl bg-white border border-slate-200 shadow-lg shadow-slate-200/50 p-8 space-y-6"
    >
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
          Username
        </label>
        <input
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-magic-red/30 focus:border-magic-red/30 transition"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Enter your username"
          autoComplete="username"
          required
        />
      </div>
      <div>
        <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1.5">
          Password
        </label>
        <input
          type="password"
          className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-magic-red/30 focus:border-magic-red/30 transition"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Enter your password"
          autoComplete="current-password"
          required
        />
      </div>
      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 text-red-600 text-xs px-4 py-2.5 font-medium">
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-xl bg-magic-red text-white font-semibold py-3.5 text-sm tracking-wide hover:bg-red-700 active:scale-[0.98] disabled:opacity-60 transition-all duration-150 shadow-md shadow-red-200/50"
      >
        {loading ? "Signing in..." : "Sign In"}
      </button>
    </form>
  );
}
