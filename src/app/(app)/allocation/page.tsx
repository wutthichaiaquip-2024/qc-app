import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { OpenSoLine } from "@/types/allocation";
import type { FgStockRow } from "@/types/fg-stock";
import { AllocationManager } from "./AllocationManager";

export default async function AllocationPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: currentProfile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .single<Pick<UserProfile, "role">>();

  const { data: perm } = await supabase
    .from("role_permissions")
    .select("can_create, can_delete")
    .eq("role", currentProfile?.role ?? "")
    .eq("module", "allocation")
    .maybeSingle<{ can_create: boolean; can_delete: boolean }>();

  const [openLinesRes, fgStockRes] = await Promise.all([
    supabase.rpc("get_open_so_lines"),
    supabase.rpc("get_fg_stock"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Stock Allocation</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          FIFO / FEFO / Manual — allocate เฉพาะ FG ที่ PASS เท่านั้น
        </p>
      </div>

      <AllocationManager
        openLines={(openLinesRes.data ?? []) as OpenSoLine[]}
        fgStock={(fgStockRes.data ?? []) as FgStockRow[]}
        canCreate={perm?.can_create ?? false}
        canRelease={perm?.can_delete ?? false}
      />
    </div>
  );
}
