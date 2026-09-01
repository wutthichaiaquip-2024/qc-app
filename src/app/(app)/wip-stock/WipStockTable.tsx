"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { LotTraceability, WipStockRow } from "@/types/wip-stock";

export function WipStockTable({ rows }: { rows: WipStockRow[] }) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [trace, setTrace] = useState<Record<string, LotTraceability | null>>({});

  async function toggleExpand(lotId: string) {
    if (expanded === lotId) {
      setExpanded(null);
      return;
    }
    setExpanded(lotId);

    if (!(lotId in trace)) {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_lot_traceability", { p_lot_id: lotId }).maybeSingle<LotTraceability>();
      setTrace((prev) => ({ ...prev, [lotId]: data ?? null }));
    }
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
            <th className="px-3 py-2 font-medium">Part No.</th>
            <th className="px-3 py-2 font-medium">Lot No.</th>
            <th className="px-3 py-2 font-medium">Qty</th>
            <th className="px-3 py-2 font-medium">Location</th>
            <th className="px-3 py-2 font-medium">IQC No.</th>
            <th className="px-3 py-2 font-medium">IQC Date</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={8} className="px-3 py-4 text-black/50 dark:text-white/50">
                ยังไม่มีสต็อกใน WIP
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <Fragment key={r.lot_id}>
              <tr
                className="border-b border-black/5 dark:border-white/5 cursor-pointer"
                onClick={() => toggleExpand(r.lot_id)}
              >
                <td className="px-3 py-2">{r.part_no}</td>
                <td className="px-3 py-2">{r.lot_no}</td>
                <td className="px-3 py-2">{r.qty}</td>
                <td className="px-3 py-2">{r.location_code}</td>
                <td className="px-3 py-2">{r.iqc_no ?? "—"}</td>
                <td className="px-3 py-2">
                  {r.iqc_date ? new Date(r.iqc_date).toLocaleDateString("th-TH") : "—"}
                </td>
                <td className="px-3 py-2">PASS</td>
                <td className="px-3 py-2">
                  <Link
                    href={`/labels/print?type=LOT&id=${r.lot_id}`}
                    target="_blank"
                    onClick={(e) => e.stopPropagation()}
                    className="underline text-xs"
                  >
                    พิมพ์ป้าย
                  </Link>
                </td>
              </tr>
              {expanded === r.lot_id && (
                <tr>
                  <td colSpan={8} className="px-3 py-3 bg-black/[.02] dark:bg-white/[.03]">
                    {!trace[r.lot_id] && (
                      <span className="text-xs text-black/50 dark:text-white/50">กำลังโหลด...</span>
                    )}
                    {trace[r.lot_id] && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="rounded-full bg-black/10 dark:bg-white/10 px-2 py-1">
                          WIP Lot {trace[r.lot_id]!.lot_no}
                        </span>
                        <span>→</span>
                        <span className="rounded-full bg-black/10 dark:bg-white/10 px-2 py-1">
                          IQC {trace[r.lot_id]!.iqc_no ?? "—"} (Pass {trace[r.lot_id]!.iqc_qty_pass ?? 0} / Hold{" "}
                          {trace[r.lot_id]!.iqc_qty_hold ?? 0} / NG {trace[r.lot_id]!.iqc_qty_ng ?? 0})
                        </span>
                        <span>→</span>
                        <span className="rounded-full bg-black/10 dark:bg-white/10 px-2 py-1">
                          Receiving {trace[r.lot_id]!.gr_no ?? "—"} ({trace[r.lot_id]!.received_date ?? "—"})
                        </span>
                        <span>→</span>
                        <span className="rounded-full bg-black/10 dark:bg-white/10 px-2 py-1">
                          PO {trace[r.lot_id]!.po_no ?? "—"}
                        </span>
                        <span>→</span>
                        <span className="rounded-full bg-black/10 dark:bg-white/10 px-2 py-1">
                          Supplier {trace[r.lot_id]!.supplier_code ?? "—"} — {trace[r.lot_id]!.supplier_name ?? "—"}
                        </span>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}
