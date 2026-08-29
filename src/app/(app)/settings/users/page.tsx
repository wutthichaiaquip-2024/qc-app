import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import { UsersTable } from "./UsersTable";

export default async function UsersPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: currentProfile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .single<Pick<UserProfile, "role">>();

  const isAdmin = currentProfile?.role === "ADMIN";

  const { data: profiles, error } = await supabase
    .from("user_profiles")
    .select("id, full_name, role, status, created_at, updated_at")
    .order("created_at", { ascending: true })
    .returns<UserProfile[]>();

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Users & Permissions</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          จัดการ Role และสถานะผู้ใช้งาน — เฉพาะ ADMIN แก้ไขได้
        </p>
      </div>

      {error && (
        <p className="text-sm text-red-600">
          โหลดรายชื่อผู้ใช้งานไม่สำเร็จ: {error.message}
        </p>
      )}

      {!error && profiles && profiles.length === 0 && (
        <p className="text-sm text-black/50 dark:text-white/50">
          ยังไม่มีผู้ใช้งานในระบบ
        </p>
      )}

      {!error && profiles && profiles.length > 0 && (
        <UsersTable initialProfiles={profiles} editable={isAdmin} />
      )}
    </div>
  );
}
