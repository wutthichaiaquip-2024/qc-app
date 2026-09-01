import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { Customer, Item } from "@/types/master-data";
import type { SalesOrder } from "@/types/sales-order";
import { SalesOrderManager } from "./SalesOrderManager";

export default async function SalesOrdersPage() {
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
    .eq("module", "sales_orders")
    .maybeSingle<{ can_create: boolean }>();

  const [orders, customers, items] = await Promise.all([
    supabase
      .from("sales_orders")
      .select("id, so_no, customer_id, order_date, required_date, status, created_at")
      .order("created_at", { ascending: false })
      .returns<SalesOrder[]>(),
    supabase.from("customers").select("*").order("code").returns<Customer[]>(),
    supabase.from("items").select("*").order("part_no").returns<Item[]>(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Sales Orders</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          Free Stock (Available − Reserved) แสดงแบบ real-time ตอนเลือก Part
        </p>
      </div>

      <SalesOrderManager
        initialOrders={orders.data ?? []}
        customers={customers.data ?? []}
        items={items.data ?? []}
        canCreate={perm?.can_create ?? false}
      />
    </div>
  );
}
