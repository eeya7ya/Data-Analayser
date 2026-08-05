"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Select from "@/components/Select";

interface UserOption {
  id: number;
  username: string;
  display_name: string;
}

/**
 * Filter chip for CRM landing + drill-down pages: lets an admin /
 * viewer scope the visible rows to a single user via the `?user=<id>`
 * query param. Empty value clears the filter ("All users" — the
 * current global view).
 *
 * Non-admins should not render this component — they only ever see
 * their own rows so a picker would be misleading.
 */
export default function UserScopePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get("user") ?? "";
  const [users, setUsers] = useState<UserOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/users/list")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled) setUsers(d.users || []);
      })
      .catch(() => {
        if (!cancelled) setUsers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function update(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value === "") params.delete("user");
    else params.set("user", value);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="text-xs font-semibold text-magic-ink/60">
        Filter by user
      </label>
      <Select
        value={current}
        onChange={(next) => update(next)}
        className="rounded-md border border-magic-border bg-white px-2 py-1 text-sm"
      >
        <option value="">All users</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.display_name || u.username}
          </option>
        ))}
      </Select>
      {current && (
        <button
          onClick={() => update("")}
          className="text-xs text-magic-red hover:underline"
          type="button"
        >
          clear
        </button>
      )}
    </div>
  );
}
