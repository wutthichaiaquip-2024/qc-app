import { createClient } from "@/lib/supabase/server";
import type { ManagementDashboard, PlanningDashboard, QcDashboard, WarehouseDashboard } from "@/types/dashboard";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-2xl font-semibold">{value}</span>
      <span className="text-xs text-black/50 dark:text-white/50">{label}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/10 dark:border-white/10 p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">{children}</div>
    </div>
  );
}

export default async function DashboardPage() {
  const supabase = await createClient();

  const [mgmtRes, qcRes, whRes, planRes] = await Promise.all([
    supabase.rpc("get_management_dashboard").maybeSingle(),
    supabase.rpc("get_qc_dashboard").maybeSingle(),
    supabase.rpc("get_warehouse_dashboard").maybeSingle(),
    supabase.rpc("get_planning_dashboard").maybeSingle(),
  ]);

  const mgmt = mgmtRes.data as ManagementDashboard | null;
  const qc = qcRes.data as QcDashboard | null;
  const wh = whRes.data as WarehouseDashboard | null;
  const plan = planRes.data as PlanningDashboard | null;

  const refreshedAt = mgmt?.refreshed_at ?? wh?.refreshed_at ?? qc?.refreshed_at ?? plan?.refreshed_at;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          {refreshedAt
            ? `รีเฟรชล่าสุด: ${new Date(refreshedAt).toLocaleString("th-TH")} (อัตโนมัติทุก 1 ชม.)`
            : "ไม่มีข้อมูล — คุณอาจไม่มีสิทธิ์ดูแดชบอร์ด"}
        </p>
      </div>

      {mgmt && (
        <Card title="Management">
          <Stat label="Open PO" value={mgmt.open_po_count} />
          <Stat label="มูลค่า Open PO" value={mgmt.open_po_value.toLocaleString()} />
          <Stat label="Open SO" value={mgmt.open_so_count} />
          <Stat label="FG Stock รวม" value={mgmt.total_fg_qty} />
          <Stat label="Shipment (30 วัน)" value={mgmt.shipments_30d_count} />
          <Stat label="IQC Pass Rate (30 วัน)" value={mgmt.iqc_pass_rate_30d != null ? `${mgmt.iqc_pass_rate_30d}%` : "—"} />
          <Stat label="OQC Pass Rate (30 วัน)" value={mgmt.oqc_pass_rate_30d != null ? `${mgmt.oqc_pass_rate_30d}%` : "—"} />
        </Card>
      )}

      {plan && (
        <Card title="Planning">
          <Stat label="🟢 GREEN" value={plan.green_count} />
          <Stat label="🟡 YELLOW" value={plan.yellow_count} />
          <Stat label="🔴 RED" value={plan.red_count} />
          <Stat label="Purchase Requirement รวม" value={plan.total_purchase_requirement_qty} />
        </Card>
      )}

      {wh && (
        <Card title="Warehouse">
          <Stat label="WIP Stock" value={wh.wip_qty} />
          <Stat label="FG Stock" value={wh.fg_qty} />
          <Stat label="HOLD Stock" value={wh.hold_qty} />
          <Stat label="NG Stock" value={wh.ng_qty} />
          <Stat label="WIP Request รอ Confirm" value={wh.pending_wip_requests} />
          <Stat label="รอ Pick" value={wh.pending_allocations} />
          <Stat label="รอ OQC" value={wh.pending_oqc} />
          <Stat label="พร้อมส่ง" value={wh.ready_to_ship} />
        </Card>
      )}

      {qc && (
        <Card title="QC">
          <Stat label="รอ IQC" value={qc.pending_iqc_lots} />
          <Stat label="รอ FG Inspection" value={qc.pending_fg_inspection} />
          <Stat label="รอ OQC" value={qc.pending_oqc} />
          <Stat label="IQC Pass (30 วัน)" value={qc.iqc_pass_qty_30d} />
          <Stat label="IQC Hold (30 วัน)" value={qc.iqc_hold_qty_30d} />
          <Stat label="IQC NG (30 วัน)" value={qc.iqc_ng_qty_30d} />
          <Stat label="FG Pass (30 วัน)" value={qc.fg_pass_qty_30d} />
          <Stat label="FG NG (30 วัน)" value={qc.fg_ng_qty_30d} />
          <Stat label="OQC Pass (30 วัน)" value={qc.oqc_pass_count_30d} />
          <Stat label="OQC Fail (30 วัน)" value={qc.oqc_fail_count_30d} />
        </Card>
      )}
    </div>
  );
}
