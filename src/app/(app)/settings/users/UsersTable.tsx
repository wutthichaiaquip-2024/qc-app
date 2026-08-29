"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { APP_ROLES, type AppRole, type UserProfile, type UserStatus } from "@/types/auth";

const USER_STATUSES: UserStatus[] = ["PENDING", "ACTIVE", "INACTIVE"];

export function UsersTable({
  initialProfiles,
  editable,
}: {
  initialProfiles: UserProfile[];
  editable: boolean;
}) {
  const [profiles, setProfiles] = useState(initialProfiles);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [errorId, setErrorId] = useState<string | null>(null);

  async function updateProfile(id: string, patch: Partial<Pick<UserProfile, "role" | "status">>) {
    setSavingId(id);
    setErrorId(null);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("user_profiles")
      .update(patch)
      .eq("id", id)
      .select("id, full_name, role, status, created_at, updated_at")
      .single<UserProfile>();

    setSavingId(null);

    if (error || !data) {
      setErrorId(id);
      return;
    }

    setProfiles((prev) => prev.map((p) => (p.id === id ? data : p)));
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
            <th className="px-3 py-2 font-medium">ชื่อ</th>
            <th className="px-3 py-2 font-medium">Role</th>
            <th className="px-3 py-2 font-medium">สถานะ</th>
          </tr>
        </thead>
        <tbody>
          {profiles.map((p) => (
            <tr key={p.id} className="border-b border-black/5 dark:border-white/5 last:border-0">
              <td className="px-3 py-2">{p.full_name || "—"}</td>
              <td className="px-3 py-2">
                {editable ? (
                  <select
                    value={p.role ?? ""}
                    disabled={savingId === p.id}
                    onChange={(e) =>
                      updateProfile(p.id, { role: (e.target.value || null) as AppRole | null })
                    }
                    className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1"
                  >
                    <option value="">— ยังไม่กำหนด —</option>
                    {APP_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                ) : (
                  (p.role ?? "— ยังไม่กำหนด —")
                )}
              </td>
              <td className="px-3 py-2">
                {editable ? (
                  <select
                    value={p.status}
                    disabled={savingId === p.id}
                    onChange={(e) =>
                      updateProfile(p.id, { status: e.target.value as UserStatus })
                    }
                    className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1"
                  >
                    {USER_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                ) : (
                  p.status
                )}
                {errorId === p.id && (
                  <span className="ml-2 text-xs text-red-600">บันทึกไม่สำเร็จ</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
