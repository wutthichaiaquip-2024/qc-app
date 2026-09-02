import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { StockAdjustment, StockPosition } from "@/types/stock-adjustments";
import { StockAdjustmentManager } from "./StockAdjustmentManager";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function StockAdjustmentsPage() {
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
    .select("can_create, can_approve, can_reject")
    .eq("role", currentProfile?.role ?? "")
    .eq("module", "stock_adjustments")
    .maybeSingle<{ can_create: boolean; can_approve: boolean; can_reject: boolean }>();

  const [stockRes, adjustmentsRes] = await Promise.all([
    supabase.rpc("get_stock_positions"),
    supabase.rpc("get_stock_adjustments"),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Stock Adjustments" description="ปรับปรุงสต็อกกรณีนับจริงไม่ตรง/ของเสียหาย — เป็น Adjustment Transaction ใหม่เสมอ (ledger เดิมแก้ไขไม่ได้) ต้องมีเหตุผลและผู้อนุมัติก่อนตัดสต็อกจริง" />

      <StockAdjustmentManager
        stockRows={(stockRes.data ?? []) as StockPosition[]}
        initialAdjustments={(adjustmentsRes.data ?? []) as StockAdjustment[]}
        canCreate={perm?.can_create ?? false}
        canApprove={perm?.can_approve ?? false}
        canReject={perm?.can_reject ?? false}
      />
    </div>
  );
}
