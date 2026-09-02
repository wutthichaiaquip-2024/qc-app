import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import type { FgStockRow } from "@/types/fg-stock";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function FgStockPage() {
  const supabase = await createClient();

  const { data } = await supabase.rpc("get_fg_stock");
  const rows = (data ?? []) as FgStockRow[];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="FG Stock" description="สินค้าสำเร็จที่ผ่าน FG Inspection แล้วเท่านั้น (บังคับด้วย DB constraint)" />

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th className="px-3 py-2 font-medium">Part No.</th>
              <th className="px-3 py-2 font-medium">FG Lot</th>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Reserved</th>
              <th className="px-3 py-2 font-medium">Available</th>
              <th className="px-3 py-2 font-medium">Inspection No.</th>
              <th className="px-3 py-2 font-medium">Inspection Date</th>
              <th className="px-3 py-2 font-medium">QC Status</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-4 text-foreground-muted">
                  ยังไม่มีสต็อกใน FG
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={`${r.lot_id}-${r.location_id}`} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{r.part_no}</td>
                <td className="px-3 py-2">{r.lot_no}</td>
                <td className="px-3 py-2">{r.location_code}</td>
                <td className="px-3 py-2">{r.qty}</td>
                <td className="px-3 py-2">{r.reserved_qty}</td>
                <td className="px-3 py-2">{r.available_qty}</td>
                <td className="px-3 py-2">{r.fg_no ?? "—"}</td>
                <td className="px-3 py-2">
                  {r.inspected_at ? new Date(r.inspected_at).toLocaleDateString("th-TH") : "—"}
                </td>
                <td className="px-3 py-2">PASS</td>
                <td className="px-3 py-2">
                  <Link href={`/labels/print?type=LOT&id=${r.lot_id}`} target="_blank" className="underline text-xs">
                    พิมพ์ป้าย
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
