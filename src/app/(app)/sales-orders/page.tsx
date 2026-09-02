import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { Customer, Item, Site } from "@/types/master-data";
import type { SalesOrder } from "@/types/sales-order";
import { SalesOrderManager } from "./SalesOrderManager";
import { PageHeader } from "@/components/ui/PageHeader";

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

  const [orders, customers, items, sites] = await Promise.all([
    supabase
      .from("sales_orders")
      .select("id, so_no, customer_id, order_date, required_date, site_id, status, created_at")
      .order("created_at", { ascending: false })
      .returns<SalesOrder[]>(),
    supabase.from("customers").select("*").order("code").returns<Customer[]>(),
    supabase.from("items").select("*").order("part_no").returns<Item[]>(),
    supabase.from("sites").select("*").order("code").returns<Site[]>(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Sales Orders" description="Free Stock (Available − Reserved) แสดงแบบ real-time ตอนเลือก Part" />

      <SalesOrderManager
        initialOrders={orders.data ?? []}
        customers={customers.data ?? []}
        items={items.data ?? []}
        sites={sites.data ?? []}
        canCreate={perm?.can_create ?? false}
      />
    </div>
  );
}
