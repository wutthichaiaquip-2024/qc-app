"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ScanInput } from "@/components/ScanInput";
import { parseBarcodePayload } from "@/lib/barcode";
import type { Picking, PickingQueueItem } from "@/types/picking";

export function PickingManager({
  queue,
  initialPickings,
  canCreate,
}: {
  queue: PickingQueueItem[];
  initialPickings: Picking[];
  canCreate: boolean;
}) {
  const [items, setItems] = useState(queue);
  const [pickings, setPickings] = useState(initialPickings);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [scanError, setScanError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<string | null>(null);

  const bySo = new Map<string, PickingQueueItem[]>();
  items.forEach((i) => {
    bySo.set(i.so_id, [...(bySo.get(i.so_id) ?? []), i]);
  });

  function handleScan(soId: string, code: string) {
    setScanError(null);
    const payload = parseBarcodePayload(code);
    const scannedLotNo = payload?.type === "LOT" ? payload.code : code;

    const lines = bySo.get(soId) ?? [];
    const match = lines.find((l) => l.lot_no === scannedLotNo && !confirmed.has(l.allocation_id));

    if (!match) {
      setScanError(`ไม่พบ Lot "${scannedLotNo}" ในรายการที่รอหยิบของ SO นี้ (หรือสแกนซ้ำ)`);
      return;
    }

    setConfirmed((prev) => new Set(prev).add(match.allocation_id));
  }

  async function handleConfirm(soId: string) {
    const lines = bySo.get(soId) ?? [];
    const allocationIds = lines.map((l) => l.allocation_id);

    setSubmitting(soId);
    setSubmitError(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("confirm_picking", {
      p_so_id: soId,
      p_allocation_ids: allocationIds,
    });

    setSubmitting(null);

    if (error) {
      setSubmitError(error.message);
      return;
    }

    const { data: picking } = await supabase
      .from("pickings")
      .select("id, picking_no, so_id, picked_at")
      .eq("id", data)
      .single<Picking>();

    if (picking) setPickings((prev) => [picking, ...prev]);
    setItems((prev) => prev.filter((i) => i.so_id !== soId));
    setConfirmed((prev) => {
      const next = new Set(prev);
      allocationIds.forEach((id) => next.delete(id));
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {bySo.size === 0 && (
        <p className="text-sm text-foreground-muted">ไม่มี SO ที่รอหยิบของ</p>
      )}

      {Array.from(bySo.entries()).map(([soId, lines]) => {
        const allConfirmed = lines.every((l) => confirmed.has(l.allocation_id));
        return (
          <div key={soId} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-sm">
                {lines[0].so_no} — {lines[0].customer_code}
              </span>
              {canCreate && (
                <ScanInput onScan={(code) => handleScan(soId, code)} placeholder="สแกน Lot No." />
              )}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-foreground-muted">
                  <th className="px-2 py-1">Part No.</th>
                  <th className="px-2 py-1">Lot</th>
                  <th className="px-2 py-1">Location</th>
                  <th className="px-2 py-1">Qty</th>
                  <th className="px-2 py-1">Scanned</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.allocation_id} className="border-t border-border">
                    <td className="px-2 py-1">{l.part_no}</td>
                    <td className="px-2 py-1">{l.lot_no}</td>
                    <td className="px-2 py-1">{l.location_code}</td>
                    <td className="px-2 py-1">{l.qty}</td>
                    <td className="px-2 py-1">
                      {confirmed.has(l.allocation_id) ? (
                        <span className="text-success">✓</span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {canCreate && (
              <button
                onClick={() => handleConfirm(soId)}
                disabled={!allConfirmed || submitting === soId}
                className="self-start rounded-md bg-brand text-brand-foreground hover:brightness-110 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {submitting === soId ? "กำลังยืนยัน..." : "Confirm Picking"}
              </button>
            )}
          </div>
        );
      })}

      {scanError && <p className="text-sm text-danger">{scanError}</p>}
      {submitError && <p className="text-sm text-danger">{submitError}</p>}

      <div>
        <h2 className="text-lg font-semibold mb-2">Picking History</h2>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-foreground-muted">
                <th className="px-3 py-2 font-medium">Picking No.</th>
                <th className="px-3 py-2 font-medium">Picked At</th>
              </tr>
            </thead>
            <tbody>
              {pickings.length === 0 && (
                <tr>
                  <td colSpan={2} className="px-3 py-4 text-foreground-muted">
                    ยังไม่มีการหยิบของ
                  </td>
                </tr>
              )}
              {pickings.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">{p.picking_no}</td>
                  <td className="px-3 py-2">{new Date(p.picked_at).toLocaleString("th-TH")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
