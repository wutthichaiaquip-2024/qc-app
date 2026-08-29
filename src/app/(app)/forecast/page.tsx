import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { Customer, Item } from "@/types/master-data";
import type { ForecastBatch } from "@/types/forecast";
import { ForecastManager } from "./ForecastManager";

export default async function ForecastPage() {
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
    .eq("module", "forecast")
    .maybeSingle<{ can_create: boolean }>();

  const [batches, customers, items] = await Promise.all([
    supabase
      .from("forecast_batches")
      .select("id, forecast_no, customer_id, revision_no, status, created_at")
      .order("created_at", { ascending: false })
      .returns<ForecastBatch[]>(),
    supabase.from("customers").select("*").order("code").returns<Customer[]>(),
    supabase.from("items").select("*").order("part_no").returns<Item[]>(),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Customer Forecast</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          Import CSV แล้ว submit เป็น Forecast Batch — ทุก revision เก็บไว้ตลอด ไม่มีการลบของเดิม
        </p>
      </div>

      <ForecastManager
        initialBatches={batches.data ?? []}
        customers={customers.data ?? []}
        items={items.data ?? []}
        canCreate={perm?.can_create ?? false}
      />
    </div>
  );
}
