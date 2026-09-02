"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ScanInput } from "@/components/ScanInput";
import { parseBarcodePayload } from "@/lib/barcode";
import type { LotGenealogy } from "@/types/traceability";

function flattenUpstream(g: LotGenealogy): LotGenealogy[] {
  const chain = g.upstream_source_lot ? flattenUpstream(g.upstream_source_lot) : [];
  return [...chain, g];
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-surface-muted px-2 py-1 text-xs whitespace-nowrap">
      {children}
    </span>
  );
}

export function TraceabilityViewer() {
  const [genealogy, setGenealogy] = useState<LotGenealogy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup(code: string) {
    setError(null);
    setGenealogy(null);
    setLoading(true);

    const payload = parseBarcodePayload(code);
    const lotNo = payload?.type === "LOT" ? payload.code : code;

    const supabase = createClient();
    const { data: found } = await supabase
      .rpc("find_lot_by_no", { p_lot_no: lotNo })
      .maybeSingle<{ lot_id: string; item_id: string; part_no: string }>();

    if (!found) {
      setError(`ไม่พบ Lot "${lotNo}"`);
      setLoading(false);
      return;
    }

    const { data } = await supabase.rpc("get_lot_genealogy", { p_lot_id: found.lot_id });
    setLoading(false);

    if (!data) {
      setError("ไม่พบข้อมูล genealogy");
      return;
    }

    setGenealogy(data as LotGenealogy);
  }

  const stages = genealogy ? flattenUpstream(genealogy) : [];
  const last = genealogy ? stages[stages.length - 1] : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 max-w-sm">
        <label className="text-xs text-foreground-muted">Lot No.</label>
        <ScanInput onScan={lookup} placeholder="เช่น LOT-2026-00001" />
      </div>

      {loading && <p className="text-sm text-foreground-muted">กำลังค้นหา...</p>}
      {error && <p className="text-sm text-danger">{error}</p>}

      {genealogy && (
        <div className="flex flex-col gap-4">
          <div className="text-sm">
            <span className="font-medium">{genealogy.part_no}</span> — สาย Traceability{" "}
            {stages.length} lot
          </div>

          <div className="flex flex-col gap-3">
            {stages.map((stage, i) => (
              <div key={stage.lot_id} className="rounded-lg border border-border p-3">
                <div className="text-sm font-medium mb-2">
                  Lot {i + 1}: {stage.lot_no}
                </div>

                <div className="flex flex-col gap-2 text-xs">
                  {stage.upstream_receiving && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Chip>Supplier: {stage.upstream_receiving.supplier_code}</Chip>
                      <span>→</span>
                      <Chip>PO: {stage.upstream_receiving.po_no}</Chip>
                      <span>→</span>
                      <Chip>
                        Receiving: {stage.upstream_receiving.gr_no} (
                        {stage.upstream_receiving.received_date})
                      </Chip>
                    </div>
                  )}

                  {stage.iqc_results.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      {stage.iqc_results.map((iqc) => (
                        <Chip key={iqc.iqc_no}>
                          IQC {iqc.iqc_no}: Pass {iqc.qty_pass} / Hold {iqc.qty_hold} / NG {iqc.qty_ng}
                        </Chip>
                      ))}
                    </div>
                  )}

                  {stage.downstream_wip_requests.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                      {stage.downstream_wip_requests.map((wr) => (
                        <div key={wr.request_no} className="flex items-center gap-2">
                          <Chip>WIP Request: {wr.request_no}</Chip>
                          {wr.fg_no && (
                            <>
                              <span>→</span>
                              <Chip>
                                FG Inspection {wr.fg_no} → New Lot {wr.new_lot_no}
                              </Chip>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {last && last.downstream_allocations.length > 0 && (
            <div className="rounded-lg border border-border p-3">
              <div className="text-sm font-medium mb-2">ปลายทาง (Sales / Shipment)</div>
              <div className="flex flex-col gap-2">
                {last.downstream_allocations.map((a, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                    <Chip>SO: {a.so_no}</Chip>
                    <span>→</span>
                    <Chip>Customer: {a.customer_code}</Chip>
                    <span>→</span>
                    <Chip>Qty: {a.qty}</Chip>
                    {a.picking_no && (
                      <>
                        <span>→</span>
                        <Chip>Picking: {a.picking_no}</Chip>
                      </>
                    )}
                    {a.oqc_no && (
                      <>
                        <span>→</span>
                        <Chip>
                          OQC: {a.oqc_no} ({a.oqc_result})
                        </Chip>
                      </>
                    )}
                    {a.shipment_no && (
                      <>
                        <span>→</span>
                        <Chip>Shipment: {a.shipment_no}</Chip>
                      </>
                    )}
                    <Chip>สถานะ: {a.status}</Chip>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
