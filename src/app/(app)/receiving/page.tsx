import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { Item, Location, Supplier } from "@/types/master-data";
import type { PurchaseOrder } from "@/types/purchase-order";
import type { GoodsReceipt } from "@/types/receiving";
import { ReceivingManager } from "./ReceivingManager";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function ReceivingPage() {
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
    .eq("module", "receiving")
    .maybeSingle<{ can_create: boolean }>();

  const [openPos, suppliers, items, incomingLocations, receipts] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, po_no, supplier_id, po_date, currency, delivery_date, status, barcode_value, created_at")
      .in("status", ["CONFIRMED", "PARTIAL_RECEIVED"])
      .order("po_no")
      .returns<PurchaseOrder[]>(),
    supabase.from("suppliers").select("*").order("code").returns<Supplier[]>(),
    supabase.from("items").select("*").order("part_no").returns<Item[]>(),
    supabase.from("locations").select("*").eq("zone_type", "INCOMING").order("code").returns<Location[]>(),
    supabase
      .from("goods_receipts")
      .select("id, gr_no, po_id, received_date, created_at, purchase_orders(po_no)")
      .order("created_at", { ascending: false }),
  ]);

  const receiptRows = (receipts.data ?? []).map((r) => ({
    id: r.id,
    gr_no: r.gr_no,
    po_id: r.po_id,
    received_date: r.received_date,
    created_at: r.created_at,
    po_no: (r as unknown as { purchase_orders: { po_no: string } | null }).purchase_orders?.po_no ?? "—",
  })) as (GoodsReceipt & { po_no: string })[];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Receiving" description="สแกน PO แล้วยืนยันรับของเข้า — ระบบสร้าง Lot ใหม่ + Stock Transaction ให้อัตโนมัติ" />

      <ReceivingManager
        initialReceipts={receiptRows}
        openPos={openPos.data ?? []}
        suppliers={suppliers.data ?? []}
        items={items.data ?? []}
        incomingLocations={incomingLocations.data ?? []}
        canCreate={perm?.can_create ?? false}
      />
    </div>
  );
}
