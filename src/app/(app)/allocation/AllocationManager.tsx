"use client";

import { Fragment, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ALLOCATION_METHODS, type Allocation, type AllocationMethod, type OpenSoLine } from "@/types/allocation";
import type { FgStockRow } from "@/types/fg-stock";

export function AllocationManager({
  openLines,
  fgStock,
  canCreate,
  canRelease,
}: {
  openLines: OpenSoLine[];
  fgStock: FgStockRow[];
  canCreate: boolean;
  canRelease: boolean;
}) {
  const [lines, setLines] = useState(openLines);
  const [soLineId, setSoLineId] = useState("");
  const [method, setMethod] = useState<AllocationMethod>("FIFO");
  const [qty, setQty] = useState("");
  const [manualLotId, setManualLotId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [allocations, setAllocations] = useState<Record<string, Allocation[]>>({});

  const selectedLine = lines.find((l) => l.so_line_id === soLineId);
  const manualCandidates = fgStock.filter(
    (f) => f.item_id === selectedLine?.item_id && f.available_qty > 0,
  );

  async function refreshLine(soLineId: string) {
    const supabase = createClient();
    const { data } = await supabase.rpc("get_open_so_lines");
    const updated = ((data ?? []) as OpenSoLine[]).find((l) => l.so_line_id === soLineId);
    setLines((prev) => {
      if (!updated) return prev.filter((l) => l.so_line_id !== soLineId);
      return prev.map((l) => (l.so_line_id === soLineId ? updated : l));
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLine || !qty) return;

    if (method === "MANUAL" && !manualLotId) {
      setError("เลือก Lot สำหรับ Manual allocation");
      return;
    }

    setSubmitting(true);
    setError(null);

    const manual = manualCandidates.find((c) => c.lot_id === manualLotId);

    const supabase = createClient();
    const { error } = await supabase.rpc("allocate_stock", {
      p_so_line_id: soLineId,
      p_method: method,
      p_qty: Number(qty),
      p_manual_lot_id: method === "MANUAL" ? manual?.lot_id ?? null : null,
      p_manual_location_id: method === "MANUAL" ? manual?.location_id ?? null : null,
    });

    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }

    await refreshLine(soLineId);
    setQty("");
    setManualLotId("");
    setAllocations((prev) => {
      const next = { ...prev };
      delete next[soLineId];
      return next;
    });
  }

  async function toggleExpand(soLineId: string) {
    if (expanded === soLineId) {
      setExpanded(null);
      return;
    }
    setExpanded(soLineId);

    const supabase = createClient();
    const { data } = await supabase
      .from("allocations")
      .select("id, so_line_id, lot_id, location_id, qty, method, status, allocated_at")
      .eq("so_line_id", soLineId)
      .eq("status", "ACTIVE")
      .returns<Allocation[]>();
    setAllocations((prev) => ({ ...prev, [soLineId]: data ?? [] }));
  }

  async function handleRelease(allocationId: string, soLineId: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("release_allocation", { p_allocation_id: allocationId });
    if (error) {
      alert(error.message);
      return;
    }
    await refreshLine(soLineId);
    setAllocations((prev) => ({
      ...prev,
      [soLineId]: (prev[soLineId] ?? []).filter((a) => a.id !== allocationId),
    }));
  }

  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground-muted">SO Line ที่รอ allocate</label>
            <select
              value={soLineId}
              onChange={(e) => {
                setSoLineId(e.target.value);
                setManualLotId("");
              }}
              className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm min-w-[16rem]"
            >
              <option value="">—</option>
              {lines.map((l) => (
                <option key={l.so_line_id} value={l.so_line_id}>
                  {l.so_no} — {l.part_no} (เหลือ {l.remaining_qty}/{l.qty})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground-muted">Method</label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as AllocationMethod)}
              className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
            >
              {ALLOCATION_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground-muted">Qty</label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm w-24"
            />
          </div>
          {method === "MANUAL" && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-foreground-muted">Lot (FG)</label>
              <select
                value={manualLotId}
                onChange={(e) => setManualLotId(e.target.value)}
                className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {manualCandidates.map((c) => (
                  <option key={c.lot_id} value={c.lot_id}>
                    {c.lot_no} @ {c.location_code} (ว่าง {c.available_qty})
                  </option>
                ))}
              </select>
            </div>
          )}
          <button
            type="submit"
            disabled={submitting || !soLineId}
            className="rounded-md bg-brand text-brand-foreground hover:brightness-110 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "กำลังจอง..." : "Allocate"}
          </button>
          {error && <span className="text-sm text-danger w-full">{error}</span>}
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th className="px-3 py-2 font-medium">SO No.</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Part No.</th>
              <th className="px-3 py-2 font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Allocated</th>
              <th className="px-3 py-2 font-medium">Remaining</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-foreground-muted">
                  ไม่มี SO Line ที่รอ allocate
                </td>
              </tr>
            )}
            {lines.map((l) => (
              <Fragment key={l.so_line_id}>
                <tr
                  className="border-b border-border cursor-pointer"
                  onClick={() => toggleExpand(l.so_line_id)}
                >
                  <td className="px-3 py-2">{l.so_no}</td>
                  <td className="px-3 py-2">{l.customer_code}</td>
                  <td className="px-3 py-2">{l.part_no}</td>
                  <td className="px-3 py-2">{l.qty}</td>
                  <td className="px-3 py-2">{l.allocated_qty}</td>
                  <td className="px-3 py-2">{l.remaining_qty}</td>
                </tr>
                {expanded === l.so_line_id && (
                  <tr>
                    <td colSpan={6} className="px-3 py-2 bg-surface-muted">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-foreground-muted">
                            <th className="px-2 py-1">Method</th>
                            <th className="px-2 py-1">Qty</th>
                            <th className="px-2 py-1">Allocated At</th>
                            <th className="px-2 py-1"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {(allocations[l.so_line_id] ?? []).map((a) => (
                            <tr key={a.id}>
                              <td className="px-2 py-1">{a.method}</td>
                              <td className="px-2 py-1">{a.qty}</td>
                              <td className="px-2 py-1">{new Date(a.allocated_at).toLocaleString("th-TH")}</td>
                              <td className="px-2 py-1">
                                {canRelease && (
                                  <button
                                    onClick={() => handleRelease(a.id, l.so_line_id)}
                                    className="text-danger underline"
                                  >
                                    Release
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
