import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { Item, Location } from "@/types/master-data";
import type { DefectCode, IqcInspection, PendingLot } from "@/types/iqc";
import { EntityManager } from "@/components/master-data/EntityManager";
import { IqcManager } from "./IqcManager";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function IqcPage() {
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
    .eq("module", "iqc")
    .maybeSingle<{ can_create: boolean }>();

  const [locationsRes, itemsRes, defectCodesRes, inspectionsRes] = await Promise.all([
    supabase.from("locations").select("*").returns<Location[]>(),
    supabase.from("items").select("*").returns<Item[]>(),
    supabase.from("defect_codes").select("*").order("code").returns<DefectCode[]>(),
    supabase
      .from("iqc_inspections")
      .select("id, iqc_no, lot_id, inspection_plan_id, lot_size, sample_size, accept_no, reject_no, qty_pass, qty_hold, qty_ng, inspected_at")
      .order("inspected_at", { ascending: false })
      .returns<IqcInspection[]>(),
  ]);

  const locations = locationsRes.data ?? [];
  const items = itemsRes.data ?? [];
  const incomingLocationIds = locations.filter((l) => l.zone_type === "INCOMING").map((l) => l.id);

  const { data: balances } = await supabase
    .from("stock_balance")
    .select("lot_id, location_id, qty, lots(lot_no, item_id)")
    .in("location_id", incomingLocationIds.length > 0 ? incomingLocationIds : ["00000000-0000-0000-0000-000000000000"])
    .gt("qty", 0);

  const locationById = Object.fromEntries(locations.map((l) => [l.id, l]));
  const itemById = Object.fromEntries(items.map((i) => [i.id, i]));
  const activeDefectCodes = (defectCodesRes.data ?? []).filter((d) => d.status === "ACTIVE");

  const pendingLots: PendingLot[] = (balances ?? []).map((b) => {
    const lot = b.lots as unknown as { lot_no: string; item_id: string };
    const loc = locationById[b.location_id];
    return {
      lot_id: b.lot_id,
      lot_no: lot.lot_no,
      item_id: lot.item_id,
      part_no: itemById[lot.item_id]?.part_no ?? "—",
      incoming_location_id: b.location_id,
      incoming_location_code: loc?.code ?? "—",
      site_id: loc?.site_id ?? "",
      qty: Number(b.qty),
    };
  });

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Incoming QC (IQC)" description="เลือก Lot ที่รอตรวจ → ระบบคำนวณ Sample Size ให้อัตโนมัติ → บันทึกผล Split-Lot" />

      <IqcManager
        pendingLots={pendingLots}
        locations={locations}
        defectCodes={activeDefectCodes}
        initialInspections={inspectionsRes.data ?? []}
        canCreate={perm?.can_create ?? false}
      />

      <div>
        <h2 className="text-lg font-semibold mb-2">Defect Codes</h2>
        <EntityManager<DefectCode>
          table="defect_codes"
          editable={perm?.can_create ?? false}
          emptyLabel="ยังไม่มี Defect Code"
          columns={[
            { key: "code", label: "Code" },
            { key: "description", label: "Description" },
            { key: "status", label: "Status" },
          ]}
          initialRows={defectCodesRes.data ?? []}
          fields={[
            { key: "code", label: "Code", type: "text", required: true },
            { key: "description", label: "Description", type: "text", required: true },
          ]}
        />
      </div>
    </div>
  );
}
