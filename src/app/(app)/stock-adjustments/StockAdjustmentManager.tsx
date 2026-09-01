"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { StockAdjustment, StockPosition } from "@/types/stock-adjustments";

function positionKey(lotId: string, locationId: string) {
  return `${lotId}|${locationId}`;
}

export function StockAdjustmentManager({
  stockRows,
  initialAdjustments,
  canCreate,
  canApprove,
  canReject,
}: {
  stockRows: StockPosition[];
  initialAdjustments: StockAdjustment[];
  canCreate: boolean;
  canApprove: boolean;
  canReject: boolean;
}) {
  const [adjustments, setAdjustments] = useState(initialAdjustments);
  const [positionKeyValue, setPositionKeyValue] = useState("");
  const [qtyDelta, setQtyDelta] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedPosition = stockRows.find((p) => positionKey(p.lot_id, p.location_id) === positionKeyValue);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPosition || !qtyDelta || !reason.trim()) return;

    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("request_stock_adjustment", {
      p_lot_id: selectedPosition.lot_id,
      p_location_id: selectedPosition.location_id,
      p_qty_delta: Number(qtyDelta),
      p_reason: reason,
    });

    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }

    const { data: adj } = await supabase.rpc("get_stock_adjustments");
    const created = (adj as StockAdjustment[] | null)?.find((a) => a.id === data);
    if (created) setAdjustments((prev) => [created, ...prev]);

    setPositionKeyValue("");
    setQtyDelta("");
    setReason("");
  }

  async function handleApprove(id: string) {
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("approve_stock_adjustment", { p_id: id });
    if (error) {
      setActionError(error.message);
      return;
    }
    setAdjustments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "APPROVED" } : a)));
  }

  async function handleReject(id: string) {
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("reject_stock_adjustment", { p_id: id });
    if (error) {
      setActionError(error.message);
      return;
    }
    setAdjustments((prev) => prev.map((a) => (a.id === id ? { ...a, status: "REJECTED" } : a)));
  }

  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-lg border border-black/10 dark:border-white/10 p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-black/50 dark:text-white/50">Lot @ Location</label>
            <select
              value={positionKeyValue}
              onChange={(e) => setPositionKeyValue(e.target.value)}
              className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm min-w-[16rem]"
            >
              <option value="">—</option>
              {stockRows.map((p) => (
                <option key={positionKey(p.lot_id, p.location_id)} value={positionKey(p.lot_id, p.location_id)}>
                  {p.lot_no} — {p.part_no} ({p.qty} @ {p.location_code})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-black/50 dark:text-white/50">Qty Delta (+/-)</label>
            <input
              type="number"
              value={qtyDelta}
              onChange={(e) => setQtyDelta(e.target.value)}
              placeholder="เช่น -5 หรือ 3"
              className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm w-28"
            />
          </div>
          <div className="flex flex-col gap-1 flex-1 min-w-[12rem]">
            <label className="text-xs text-black/50 dark:text-white/50">เหตุผล</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น นับจริงไม่ตรง, ของเสียหาย"
              className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "กำลังบันทึก..." : "ขอ Adjustment"}
          </button>
          {error && <span className="text-sm text-red-600 w-full">{error}</span>}
        </form>
      )}

      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
              <th className="px-3 py-2 font-medium">Adjustment No.</th>
              <th className="px-3 py-2 font-medium">Part No.</th>
              <th className="px-3 py-2 font-medium">Lot No.</th>
              <th className="px-3 py-2 font-medium">Location</th>
              <th className="px-3 py-2 font-medium">Qty Delta</th>
              <th className="px-3 py-2 font-medium">เหตุผล</th>
              <th className="px-3 py-2 font-medium">สถานะ</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {adjustments.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-4 text-black/50 dark:text-white/50">
                  ยังไม่มี Stock Adjustment
                </td>
              </tr>
            )}
            {adjustments.map((a) => (
              <tr key={a.id} className="border-b border-black/5 dark:border-white/5 last:border-0">
                <td className="px-3 py-2">{a.adjustment_no}</td>
                <td className="px-3 py-2">{a.part_no}</td>
                <td className="px-3 py-2">{a.lot_no}</td>
                <td className="px-3 py-2">{a.location_code}</td>
                <td className={`px-3 py-2 ${a.qty_delta < 0 ? "text-red-600" : "text-green-600"}`}>
                  {a.qty_delta > 0 ? `+${a.qty_delta}` : a.qty_delta}
                </td>
                <td className="px-3 py-2">{a.reason}</td>
                <td className="px-3 py-2">{a.status}</td>
                <td className="px-3 py-2">
                  {a.status === "PENDING" && (
                    <div className="flex gap-1">
                      {canApprove && (
                        <button
                          onClick={() => handleApprove(a.id)}
                          className="rounded-md border border-black/15 dark:border-white/15 px-2 py-0.5 text-xs hover:bg-black/[.04] dark:hover:bg-white/[.06]"
                        >
                          Approve
                        </button>
                      )}
                      {canReject && (
                        <button
                          onClick={() => handleReject(a.id)}
                          className="rounded-md border border-black/15 dark:border-white/15 px-2 py-0.5 text-xs hover:bg-black/[.04] dark:hover:bg-white/[.06]"
                        >
                          Reject
                        </button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
