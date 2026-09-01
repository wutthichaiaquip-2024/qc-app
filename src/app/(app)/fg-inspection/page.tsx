import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { DefectCode } from "@/types/iqc";
import type { Item, Location } from "@/types/master-data";
import type { WipRequest } from "@/types/wip-request";
import type { FgInspection, ItemDocument } from "@/types/fg-inspection";
import { FgInspectionManager } from "./FgInspectionManager";
import { ItemDocuments } from "./ItemDocuments";

export default async function FgInspectionPage() {
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
    .eq("module", "fg_inspection")
    .maybeSingle<{ can_create: boolean }>();

  const [confirmedWr, inspectedWrIds, locations, items, defectCodes, inspections, itemDocs] = await Promise.all([
    supabase
      .from("wip_requests")
      .select("id, request_no, item_id, wip_lot_id, wip_location_id, requested_qty, inspection_plan_id, purpose, request_date, status")
      .eq("status", "CONFIRMED")
      .returns<WipRequest[]>(),
    supabase.from("fg_inspections").select("wip_request_id"),
    supabase.from("locations").select("*").returns<Location[]>(),
    supabase.from("items").select("*").returns<Item[]>(),
    supabase.from("defect_codes").select("*").eq("status", "ACTIVE").order("code").returns<DefectCode[]>(),
    supabase
      .from("fg_inspections")
      .select("id, fg_no, wip_request_id, item_id, new_lot_id, inspection_mode, measurement_method, lot_size, sample_size, qty_pass, qty_hold, qty_ng, started_at, completed_at")
      .order("completed_at", { ascending: false })
      .returns<FgInspection[]>(),
    supabase.from("item_documents").select("*").order("uploaded_at", { ascending: false }).returns<ItemDocument[]>(),
  ]);

  const inspectedIds = new Set((inspectedWrIds.data ?? []).map((r) => r.wip_request_id));
  const pendingWr = (confirmedWr.data ?? []).filter((r) => !inspectedIds.has(r.id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold">FG Inspection</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          ตรวจสอบ WIP Request ที่ Confirm แล้ว → สร้าง FG Lot ใหม่พร้อม Split-Lot
        </p>
      </div>

      <FgInspectionManager
        pendingRequests={pendingWr}
        locations={locations.data ?? []}
        items={items.data ?? []}
        defectCodes={defectCodes.data ?? []}
        initialInspections={inspections.data ?? []}
        canCreate={perm?.can_create ?? false}
      />

      <div>
        <h2 className="text-lg font-semibold mb-2">Work Instruction / Packing Std. Lookup</h2>
        <ItemDocuments items={items.data ?? []} initialDocs={itemDocs.data ?? []} canCreate={perm?.can_create ?? false} />
      </div>
    </div>
  );
}
