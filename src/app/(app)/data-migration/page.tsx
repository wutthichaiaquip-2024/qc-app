import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { Item, Location } from "@/types/master-data";
import { DataMigrationManager } from "./DataMigrationManager";

export default async function DataMigrationPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: currentProfile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .single<Pick<UserProfile, "role">>();

  const role = currentProfile?.role ?? "";

  const [masterDataPerm, adjustmentPerm, itemsRes, locationsRes] = await Promise.all([
    supabase.from("role_permissions").select("can_create").eq("role", role).eq("module", "master_data").maybeSingle<{ can_create: boolean }>(),
    supabase.from("role_permissions").select("can_approve").eq("role", role).eq("module", "stock_adjustments").maybeSingle<{ can_approve: boolean }>(),
    supabase.from("items").select("id, part_no, description, brand, category, base_uom, purchase_uom, uom_conversion_factor, customer_id, supplier_id, safety_stock, moq, lead_time_days, barcode_value, status").returns<Item[]>(),
    supabase.from("locations").select("id, site_id, code, name, zone_type, physical_address, barcode_value, status").returns<Location[]>(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Data Migration</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          นำเข้า Master Data และยอดยกมา (Opening Stock Balance) จากระบบเดิม — ใช้ครั้งเดียวตอน Cutover
          ตรวจสอบข้อมูลก่อน Import เสมอ (ทั้งไฟล์ผิดแม้แถวเดียว จะไม่มีข้อมูลเข้าตารางจริงเลย)
        </p>
      </div>

      <DataMigrationManager
        role={role}
        canImportMasterData={masterDataPerm.data?.can_create ?? false}
        canImportOpeningBalance={adjustmentPerm.data?.can_approve ?? false}
        items={itemsRes.data ?? []}
        locations={locationsRes.data ?? []}
      />
    </div>
  );
}
