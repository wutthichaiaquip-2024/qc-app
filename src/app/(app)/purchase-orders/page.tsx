import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { Item, Supplier } from "@/types/master-data";
import type { PurchaseOrder } from "@/types/purchase-order";
import { PurchaseOrderManager } from "./PurchaseOrderManager";

export default async function PurchaseOrdersPage() {
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
    .eq("module", "purchase_orders")
    .maybeSingle<{ can_create: boolean }>();

  const [orders, suppliers, items] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("id, po_no, supplier_id, po_date, currency, delivery_date, status, created_at")
      .order("created_at", { ascending: false })
      .returns<PurchaseOrder[]>(),
    supabase.from("suppliers").select("*").order("code").returns<Supplier[]>(),
    supabase.from("items").select("*").order("part_no").returns<Item[]>(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Purchase Orders</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          สร้าง PO พร้อมแนบไฟล์สเปก/แบบวาดต่อ Line ได้
        </p>
      </div>

      <PurchaseOrderManager
        initialOrders={orders.data ?? []}
        suppliers={suppliers.data ?? []}
        items={items.data ?? []}
        canCreate={perm?.can_create ?? false}
      />
    </div>
  );
}
