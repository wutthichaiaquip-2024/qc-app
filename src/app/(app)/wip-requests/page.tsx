import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { InspectionPlan } from "@/types/master-data";
import type { WipStockRow } from "@/types/wip-stock";
import type { WipRequest } from "@/types/wip-request";
import { WipRequestManager } from "./WipRequestManager";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function WipRequestsPage() {
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
    .eq("module", "wip_stock")
    .maybeSingle<{ can_create: boolean; can_approve: boolean; can_reject: boolean }>();

  const [wipStockRes, plansRes, requestsRes] = await Promise.all([
    supabase.rpc("get_wip_stock"),
    supabase.from("inspection_plans").select("*").eq("status", "ACTIVE").returns<InspectionPlan[]>(),
    supabase
      .from("wip_requests")
      .select("id, request_no, item_id, wip_lot_id, wip_location_id, requested_qty, inspection_plan_id, purpose, request_date, status")
      .order("request_date", { ascending: false })
      .returns<WipRequest[]>(),
  ]);

  const wipStock = (wipStockRes.data ?? []) as WipStockRow[];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="WIP Request / FG Inspection Request" description="เบิก WIP Lot เพื่อส่งตรวจ FG Inspection — Confirm แล้วจึงตัดสต็อกจริง" />

      <WipRequestManager
        wipStock={wipStock}
        inspectionPlans={plansRes.data ?? []}
        initialRequests={requestsRes.data ?? []}
        canCreate={perm?.can_create ?? false}
        canConfirm={perm?.can_approve ?? false}
        canCancel={perm?.can_reject ?? false}
      />
    </div>
  );
}
