import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { Location } from "@/types/master-data";
import type { OqcInspection, OqcQueueItem } from "@/types/oqc";
import { OqcManager } from "./OqcManager";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function OqcPage() {
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
    .eq("module", "oqc")
    .maybeSingle<{ can_create: boolean }>();

  const [queueRes, locationsRes, inspectionsRes] = await Promise.all([
    supabase.rpc("get_oqc_queue"),
    supabase.from("locations").select("*").in("zone_type", ["HOLD", "REWORK"]).returns<Location[]>(),
    supabase
      .from("oqc_inspections")
      .select("id, oqc_no, picking_id, so_id, result, inspected_at")
      .order("inspected_at", { ascending: false })
      .returns<OqcInspection[]>(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="OQC / Final QC" description="ตรวจครั้งสุดท้ายก่อนแพ็คส่ง — ไม่ผ่านจะวนกลับเข้า Rework/Hold queue" />

      <OqcManager
        queue={(queueRes.data ?? []) as OqcQueueItem[]}
        targetLocations={locationsRes.data ?? []}
        initialInspections={inspectionsRes.data ?? []}
        canCreate={perm?.can_create ?? false}
      />
    </div>
  );
}
