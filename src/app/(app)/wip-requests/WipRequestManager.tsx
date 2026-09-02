"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InspectionPlan } from "@/types/master-data";
import type { WipStockRow } from "@/types/wip-stock";
import type { WipRequest } from "@/types/wip-request";

export function WipRequestManager({
  wipStock,
  inspectionPlans,
  initialRequests,
  canCreate,
  canConfirm,
  canCancel,
}: {
  wipStock: WipStockRow[];
  inspectionPlans: InspectionPlan[];
  initialRequests: WipRequest[];
  canCreate: boolean;
  canConfirm: boolean;
  canCancel: boolean;
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [lotId, setLotId] = useState("");
  const [qty, setQty] = useState("");
  const [planId, setPlanId] = useState("");
  const [purpose, setPurpose] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const selectedLot = wipStock.find((w) => w.lot_id === lotId);
  const partNo = (itemId: string) => wipStock.find((w) => w.item_id === itemId)?.part_no ?? "—";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLot || !qty) return;

    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_wip_request", {
      p_item_id: selectedLot.item_id,
      p_wip_lot_id: selectedLot.lot_id,
      p_wip_location_id: selectedLot.location_id,
      p_requested_qty: Number(qty),
      p_inspection_plan_id: planId || null,
      p_purpose: purpose || null,
    });

    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }

    const { data: req } = await supabase
      .from("wip_requests")
      .select("id, request_no, item_id, wip_lot_id, wip_location_id, requested_qty, inspection_plan_id, purpose, request_date, status")
      .eq("id", data)
      .single<WipRequest>();

    if (req) setRequests((prev) => [req, ...prev]);
    setLotId("");
    setQty("");
    setPlanId("");
    setPurpose("");
  }

  async function handleConfirm(id: string) {
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("confirm_wip_request", { p_request_id: id });
    if (error) {
      setActionError(error.message);
      return;
    }
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: "CONFIRMED" } : r)));
  }

  async function handleCancel(id: string) {
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_wip_request", { p_request_id: id });
    if (error) {
      setActionError(error.message);
      return;
    }
    setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status: "CANCELLED" } : r)));
  }

  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground-muted">WIP Lot</label>
            <select
              value={lotId}
              onChange={(e) => setLotId(e.target.value)}
              className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
            >
              <option value="">—</option>
              {wipStock.map((w) => (
                <option key={w.lot_id} value={w.lot_id}>
                  {w.lot_no} — {w.part_no} ({w.qty} @ {w.location_code})
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground-muted">Requested Qty</label>
            <input
              type="number"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm w-28"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground-muted">Inspection Plan</label>
            <select
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
            >
              <option value="">—</option>
              {inspectionPlans
                .filter((p) => p.item_id === selectedLot?.item_id)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    Rev {p.revision_no} ({p.sampling_standard})
                  </option>
                ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground-muted">Purpose</label>
            <input
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-brand text-brand-foreground hover:brightness-110 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "กำลังบันทึก..." : "สร้าง WIP Request"}
          </button>
          {error && <span className="text-sm text-danger w-full">{error}</span>}
        </form>
      )}

      {actionError && <p className="text-sm text-danger">{actionError}</p>}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th className="px-3 py-2 font-medium">Request No.</th>
              <th className="px-3 py-2 font-medium">Part No.</th>
              <th className="px-3 py-2 font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Purpose</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {requests.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-foreground-muted">
                  ยังไม่มี WIP Request
                </td>
              </tr>
            )}
            {requests.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{r.request_no}</td>
                <td className="px-3 py-2">{partNo(r.item_id)}</td>
                <td className="px-3 py-2">{r.requested_qty}</td>
                <td className="px-3 py-2">{r.purpose ?? "—"}</td>
                <td className="px-3 py-2">{r.status}</td>
                <td className="px-3 py-2">
                  {r.status === "PENDING" && (
                    <div className="flex gap-1">
                      {canConfirm && (
                        <button
                          onClick={() => handleConfirm(r.id)}
                          className="rounded-md border border-border-strong px-2 py-0.5 text-xs hover:bg-surface-muted"
                        >
                          Confirm
                        </button>
                      )}
                      {canCancel && (
                        <button
                          onClick={() => handleCancel(r.id)}
                          className="rounded-md border border-border-strong px-2 py-0.5 text-xs hover:bg-surface-muted"
                        >
                          Cancel
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
