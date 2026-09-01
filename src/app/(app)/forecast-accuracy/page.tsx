import { createClient } from "@/lib/supabase/server";
import type { ForecastAccuracyRow } from "@/types/forecast-accuracy";

export default async function ForecastAccuracyPage() {
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_forecast_accuracy");
  const rows = (data ?? []) as ForecastAccuracyRow[];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Forecast Accuracy</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          เปรียบเทียบ Forecast vs Actual Order vs Actual Shipment ต่อ Customer/Part/เดือน — อัปเดตตามข้อมูลล่าสุดเสมอ
          (ไม่ใช่ค่าที่แคชไว้) ใช้ประกอบการตัดสินใจใน Demand &amp; Stock Planning
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
              <th className="px-3 py-2 font-medium">Month</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Part No.</th>
              <th className="px-3 py-2 font-medium">Forecast</th>
              <th className="px-3 py-2 font-medium">Actual Order</th>
              <th className="px-3 py-2 font-medium">Actual Shipment</th>
              <th className="px-3 py-2 font-medium">Accuracy</th>
              <th className="px-3 py-2 font-medium">Bias</th>
              <th className="px-3 py-2 font-medium">Variance</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-black/50 dark:text-white/50">
                  ยังไม่มีข้อมูล
                </td>
              </tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-b border-black/5 dark:border-white/5 last:border-0">
                <td className="px-3 py-2">{r.forecast_month}</td>
                <td className="px-3 py-2">{r.customer_code}</td>
                <td className="px-3 py-2">{r.part_no}</td>
                <td className="px-3 py-2">{r.forecast_qty}</td>
                <td className="px-3 py-2">{r.actual_order_qty}</td>
                <td className="px-3 py-2">{r.actual_shipment_qty}</td>
                <td className="px-3 py-2">{r.accuracy_pct != null ? `${r.accuracy_pct}%` : "—"}</td>
                <td className="px-3 py-2">
                  <span className={r.bias_pct != null && r.bias_pct < 0 ? "text-red-600" : r.bias_pct != null && r.bias_pct > 0 ? "text-amber-600" : ""}>
                    {r.bias_pct != null ? `${r.bias_pct}%` : "—"}
                  </span>
                </td>
                <td className="px-3 py-2">{r.variance_qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
