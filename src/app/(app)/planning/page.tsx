import { createClient } from "@/lib/supabase/server";
import type { Item } from "@/types/master-data";
import type { StockPlanningRow, StockPlanningStatus } from "@/types/planning";
import { RefreshButton } from "./RefreshButton";

const STATUS_STYLE: Record<StockPlanningStatus, string> = {
  GREEN: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
  YELLOW: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  RED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
};

export default async function PlanningPage() {
  const supabase = await createClient();

  const [snapshot, items] = await Promise.all([
    supabase
      .from("stock_planning_snapshot")
      .select("*")
      .order("status", { ascending: true })
      .returns<StockPlanningRow[]>(),
    supabase.from("items").select("*").returns<Item[]>(),
  ]);

  const itemRows = items.data ?? [];
  const rows = snapshot.data ?? [];
  const partNoById = Object.fromEntries(itemRows.map((i) => [i.id, i.part_no]));

  const calculatedAt = rows[0]?.calculated_at
    ? new Date(rows[0].calculated_at).toLocaleString("th-TH")
    : "—";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Demand & Stock Planning</h1>
          <p className="text-sm text-black/50 dark:text-white/50">
            คำนวณล่าสุด: {calculatedAt} (รีเฟรชอัตโนมัติทุก 1 ชม. ผ่าน pg_cron)
          </p>
        </div>
        <RefreshButton />
      </div>

      <p className="text-sm text-amber-600 dark:text-amber-500">
        ⚠️ ระบบยังอยู่แค่ Phase 4 — Customer Order Qty / FG Stock / WIP Stock / Incoming / Open PO
        ยังเป็น 0 เสมอ (Phase 5, 6, 8, 11, 12 ยังไม่ได้สร้าง) ตัวเลข Projected Stock ด้านล่าง
        <strong> ยังไม่ใช่ค่าจริงที่ใช้ตัดสินใจสั่งซื้อได้</strong> คำนวณจาก Forecast + Safety
        Stock เท่านั้นตอนนี้
      </p>

      <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
              <th className="px-3 py-2 font-medium">Part No.</th>
              <th className="px-3 py-2 font-medium">Forecast (next month)</th>
              <th className="px-3 py-2 font-medium">Safety Stock</th>
              <th className="px-3 py-2 font-medium">Projected Stock</th>
              <th className="px-3 py-2 font-medium">Shortage</th>
              <th className="px-3 py-2 font-medium">Surplus</th>
              <th className="px-3 py-2 font-medium">Purchase Req.</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-black/50 dark:text-white/50">
                  ยังไม่มีข้อมูล — ต้องมี Active Item ก่อนถึงจะคำนวณได้
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.item_id} className="border-b border-black/5 dark:border-white/5 last:border-0">
                <td className="px-3 py-2">{partNoById[r.item_id] ?? "—"}</td>
                <td className="px-3 py-2">{r.forecast_qty}</td>
                <td className="px-3 py-2">{r.safety_stock}</td>
                <td className="px-3 py-2">{r.projected_stock}</td>
                <td className="px-3 py-2">{r.shortage_qty}</td>
                <td className="px-3 py-2">{r.surplus_qty}</td>
                <td className="px-3 py-2">{r.purchase_requirement_qty}</td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                    {r.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
