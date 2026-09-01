"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Shipment, ShipmentBox, ShippingQueueItem } from "@/types/shipping";

export function ShippingManager({
  queue,
  initialShipments,
  boxes,
  canCreate,
}: {
  queue: ShippingQueueItem[];
  initialShipments: Shipment[];
  boxes: ShipmentBox[];
  canCreate: boolean;
}) {
  const [items, setItems] = useState(queue);
  const [shipments, setShipments] = useState(initialShipments);
  const [shipmentBoxes, setShipmentBoxes] = useState(boxes);
  const [boxNos, setBoxNos] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bySo = new Map<string, ShippingQueueItem[]>();
  items.forEach((i) => {
    bySo.set(i.so_id, [...(bySo.get(i.so_id) ?? []), i]);
  });

  function boxNoFor(allocationId: string) {
    return boxNos[allocationId] ?? "1";
  }

  async function handleConfirm(soId: string) {
    const lines = bySo.get(soId) ?? [];

    const boxMap = new Map<number, string[]>();
    lines.forEach((l) => {
      const boxNo = Number(boxNoFor(l.allocation_id)) || 1;
      boxMap.set(boxNo, [...(boxMap.get(boxNo) ?? []), l.allocation_id]);
    });

    const boxes = Array.from(boxMap.entries()).map(([box_no, allocation_ids]) => ({
      box_no,
      allocation_ids,
    }));

    setSubmitting(soId);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("confirm_shipment", {
      p_so_id: soId,
      p_boxes: boxes,
    });

    setSubmitting(null);

    if (error) {
      setError(error.message);
      return;
    }

    const { data: shipment } = await supabase
      .from("shipments")
      .select("id, shipment_no, so_id, shipped_at")
      .eq("id", data)
      .single<Shipment>();

    if (shipment) {
      setShipments((prev) => [shipment, ...prev]);
      const { data: newBoxes } = await supabase
        .from("shipment_boxes")
        .select("id, shipment_id, box_no")
        .eq("shipment_id", shipment.id)
        .order("box_no")
        .returns<ShipmentBox[]>();
      if (newBoxes) setShipmentBoxes((prev) => [...prev, ...newBoxes]);
    }
    setItems((prev) => prev.filter((i) => i.so_id !== soId));
  }

  return (
    <div className="flex flex-col gap-4">
      {bySo.size === 0 && (
        <p className="text-sm text-black/50 dark:text-white/50">
          ไม่มี SO ที่พร้อมส่ง (ต้องผ่าน Picking + OQC PASS ก่อน)
        </p>
      )}

      {Array.from(bySo.entries()).map(([soId, lines]) => (
        <div key={soId} className="flex flex-col gap-2 rounded-lg border border-black/10 dark:border-white/10 p-3">
          <div className="flex items-center justify-between">
            <span className="font-medium text-sm">
              {lines[0].so_no} — {lines[0].customer_code}
            </span>
            {canCreate && (
              <button
                onClick={() => handleConfirm(soId)}
                disabled={submitting === soId}
                className="rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {submitting === soId ? "กำลังยืนยัน..." : "Confirm Shipment"}
              </button>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-black/50 dark:text-white/50">
                <th className="px-2 py-1">Part No.</th>
                <th className="px-2 py-1">Lot</th>
                <th className="px-2 py-1">Qty</th>
                <th className="px-2 py-1">Box No.</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.allocation_id} className="border-t border-black/5 dark:border-white/5">
                  <td className="px-2 py-1">{l.part_no}</td>
                  <td className="px-2 py-1">{l.lot_no}</td>
                  <td className="px-2 py-1">{l.qty}</td>
                  <td className="px-2 py-1">
                    {canCreate ? (
                      <input
                        type="number"
                        min={1}
                        value={boxNoFor(l.allocation_id)}
                        onChange={(e) =>
                          setBoxNos((prev) => ({ ...prev, [l.allocation_id]: e.target.value }))
                        }
                        className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm w-16"
                      />
                    ) : (
                      boxNoFor(l.allocation_id)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <h2 className="text-lg font-semibold mb-2">Shipment History</h2>
        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
                <th className="px-3 py-2 font-medium">Shipment No.</th>
                <th className="px-3 py-2 font-medium">Shipped At</th>
                <th className="px-3 py-2 font-medium">กล่อง / ป้าย</th>
              </tr>
            </thead>
            <tbody>
              {shipments.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-black/50 dark:text-white/50">
                    ยังไม่มีการส่งของ
                  </td>
                </tr>
              )}
              {shipments.map((s) => (
                <tr key={s.id} className="border-b border-black/5 dark:border-white/5 last:border-0">
                  <td className="px-3 py-2">{s.shipment_no}</td>
                  <td className="px-3 py-2">{new Date(s.shipped_at).toLocaleString("th-TH")}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-2">
                      {shipmentBoxes
                        .filter((b) => b.shipment_id === s.id)
                        .map((b) => (
                          <Link
                            key={b.id}
                            href={`/labels/print?type=SHIPMENT_BOX&id=${b.id}`}
                            target="_blank"
                            className="underline text-xs"
                          >
                            Box {b.box_no}
                          </Link>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
