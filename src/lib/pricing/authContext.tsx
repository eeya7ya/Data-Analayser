"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * Pricing-module auth adapter.
 *
 * The pricing-sheet UI was originally written against its own
 * `AuthUser` shape — id / username / fullName / role / color /
 * manufacturerId. The host's session has a different shape and richer
 * roles ("admin" | "viewer" | "user"), but the pricing-sheet
 * components only ever look at `role`, `id`, `fullName` and (rarely)
 * `color`. This adapter loads the host's `/api/auth/me` once and
 * projects it onto the shape the legacy components expect, so the
 * components can be reused verbatim:
 *
 *   • host "admin" OR "viewer" → pricing "admin" (canReadAll())
 *   • host "user"              → pricing "user"
 *
 * That keeps every existing client-side `user.role === "admin"`
 * branch honest under the host's policy — viewers can see everything,
 * but the API gate still rejects their writes.
 */
export interface AuthUser {
  id: number;
  username: string;
  fullName: string;
  role: "admin" | "user";
  color: string;
  manufacturerId: number | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface RawSession {
  id: number;
  username: string;
  display_name: string;
  role: "admin" | "viewer" | "user";
}

function adapt(raw: RawSession | null): AuthUser | null {
  if (!raw) return null;
  return {
    id: raw.id,
    username: raw.username,
    fullName: raw.display_name || raw.username,
    role: raw.role === "admin" || raw.role === "viewer" ? "admin" : "user",
    color: "cyan",
    manufacturerId: null,
  };
}

export function PricingAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchedOnce = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      if (res.ok) {
        const body = (await res.json()) as { user: RawSession | null };
        setUser(adapt(body.user));
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (fetchedOnce.current) return;
    fetchedOnce.current = true;
    refresh();
  }, [refresh]);

  const signOut = useCallback(async () => {
    // The host owns its own session lifecycle; the pricing module
    // should never log a user out from inside its sub-tree.
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <PricingAuthProvider>");
  }
  return ctx;
}
