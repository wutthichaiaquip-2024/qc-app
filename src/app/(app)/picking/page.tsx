import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { PickingQueueItem, Picking } from "@/types/picking";
import { PickingManager } from "./PickingManager";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function PickingPage() {
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
    .select("can_create")
    .eq("role", currentProfile?.role ?? "")
    .eq("module", "picking")
    .maybeSingle<{ can_create: boolean }>();

  const [queueRes, pickingsRes] = await Promise.all([
    supabase.rpc("get_picking_queue"),
    supabase
      .from("pickings")
      .select("id, picking_no, so_id, picked_at")
      .order("picked_at", { ascending: false })
      .returns<Picking[]>(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Picking" description="สแกน Lot เพื่อยืนยันว่าหยิบถูกล็อต ก่อน Confirm Picking" />

      <PickingManager
        queue={(queueRes.data ?? []) as PickingQueueItem[]}
        initialPickings={pickingsRes.data ?? []}
        canCreate={perm?.can_create ?? false}
      />
    </div>
  );
}
