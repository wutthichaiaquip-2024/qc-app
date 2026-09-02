"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ScanInput } from "@/components/ScanInput";
import { parseBarcodePayload } from "@/lib/barcode";
import type { GoodsReceipt } from "@/types/receiving";
import type { PurchaseOrder, PurchaseOrderLine } from "@/types/purchase-order";
import type { Item, Location, Supplier } from "@/types/master-data";

type LineState = { po_line_id: string; qty_received: string; location_id: string };

export function ReceivingManager({
  initialReceipts,
  openPos,
  suppliers,
  items,
  incomingLocations,
  canCreate,
}: {
  initialReceipts: (GoodsReceipt & { po_no: string })[];
  openPos: PurchaseOrder[];
  suppliers: Supplier[];
  items: Item[];
  incomingLocations: Location[];
  canCreate: boolean;
}) {
  const [receipts, setReceipts] = useState(initialReceipts);
  const [poId, setPoId] = useState("");
  const [lines, setLines] = useState<PurchaseOrderLine[]>([]);
  const [remaining, setRemaining] = useState<Record<string, number>>({});
  const [lineState, setLineState] = useState<Record<string, LineState>>({});
  const [loadingLines, setLoadingLines] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const supplierCode = (id: string) => suppliers.find((s) => s.id === id)?.code ?? "—";
  const partNo = (id: string) => items.find((i) => i.id === id)?.part_no ?? "—";

  async function loadPoLines(id: string) {
    setPoId(id);
    setLines([]);
    setLineState({});
    setError(null);
    if (!id) return;

    setLoadingLines(true);
    const supabase = createClient();

    const { data: poLines } = await supabase
      .from("purchase_order_lines")
      .select("id, po_id, line_no, item_id, qty, unit, unit_price, required_date, eta, technical_spec")
      .eq("po_id", id)
      .order("line_no")
      .returns<PurchaseOrderLine[]>();

    const { data: received } = await supabase
      .from("goods_receipt_lines")
      .select("po_line_id, qty_received")
      .in("po_line_id", (poLines ?? []).map((l) => l.id));

    const totals: Record<string, number> = {};
    (received ?? []).forEach((r) => {
      totals[r.po_line_id] = (totals[r.po_line_id] ?? 0) + Number(r.qty_received);
    });

    const rem: Record<string, number> = {};
    const initState: Record<string, LineState> = {};
    (poLines ?? []).forEach((l) => {
      rem[l.id] = l.qty - (totals[l.id] ?? 0);
      initState[l.id] = { po_line_id: l.id, qty_received: "", location_id: "" };
    });

    setLines(poLines ?? []);
    setRemaining(rem);
    setLineState(initState);
    setLoadingLines(false);
  }

  function handleScan(code: string) {
    const payload = parseBarcodePayload(code);
    const targetPoId = payload?.type === "PURCHASE_ORDER" ? payload.id : null;

    const match =
      openPos.find((p) => p.id === targetPoId) ??
      openPos.find((p) => p.po_no === code || p.barcode_value === code);

    if (match) {
      loadPoLines(match.id);
    } else {
      setError(`ไม่พบ PO ที่ตรงกับ "${code}"`);
    }
  }

  function updateLine(lineId: string, patch: Partial<LineState>) {
    setLineState((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }));
  }

  async function handleSubmit() {
    const payloadLines = Object.values(lineState)
      .filter((l) => Number(l.qty_received) > 0 && l.location_id)
      .map((l) => ({
        po_line_id: l.po_line_id,
        qty_received: Number(l.qty_received),
        location_id: l.location_id,
      }));

    if (payloadLines.length === 0) {
      setError("กรอกจำนวนรับและเลือก Location อย่างน้อย 1 line");
      return;
    }

    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("confirm_goods_receipt", {
      p_po_id: poId,
      p_lines: payloadLines,
    });

    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }

    const { data: gr } = await supabase
      .from("goods_receipts")
      .select("id, gr_no, po_id, received_date, created_at")
      .eq("id", data)
      .single<GoodsReceipt>();

    const po = openPos.find((p) => p.id === poId);
    if (gr) setReceipts((prev) => [{ ...gr, po_no: po?.po_no ?? "" }, ...prev]);

    setPoId("");
    setLines([]);
    setLineState({});
  }

  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-foreground-muted">
                สแกน PO (barcode/QR หรือพิมพ์ PO No.)
              </label>
              <ScanInput onScan={handleScan} placeholder="เช่น PO-2026-00001" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-foreground-muted">หรือเลือก PO</label>
              <select
                value={poId}
                onChange={(e) => loadPoLines(e.target.value)}
                className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {openPos.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.po_no} — {supplierCode(p.supplier_id)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {loadingLines && <p className="text-sm text-foreground-muted">กำลังโหลด...</p>}

          {lines.length > 0 && (
            <div className="flex flex-col gap-2">
              {lines.map((l) => (
                <div key={l.id} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
                  <div className="text-sm min-w-[8rem]">
                    {partNo(l.item_id)} <span className="text-foreground-muted">(สั่ง {l.qty}, เหลือรับ {remaining[l.id]})</span>
                  </div>
                  <input
                    placeholder="จำนวนรับ"
                    type="number"
                    value={lineState[l.id]?.qty_received ?? ""}
                    onChange={(e) => updateLine(l.id, { qty_received: e.target.value })}
                    className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm w-24"
                  />
                  <select
                    value={lineState[l.id]?.location_id ?? ""}
                    onChange={(e) => updateLine(l.id, { location_id: e.target.value })}
                    className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
                  >
                    <option value="">Location (INCOMING)</option>
                    {incomingLocations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.code}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="self-start rounded-md bg-brand text-brand-foreground hover:brightness-110 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {submitting ? "กำลังบันทึก..." : "Confirm Receiving"}
              </button>
            </div>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th className="px-3 py-2 font-medium">GR No.</th>
              <th className="px-3 py-2 font-medium">PO No.</th>
              <th className="px-3 py-2 font-medium">Received Date</th>
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-foreground-muted">
                  ยังไม่มีการรับของ
                </td>
              </tr>
            )}
            {receipts.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{r.gr_no}</td>
                <td className="px-3 py-2">{r.po_no}</td>
                <td className="px-3 py-2">{r.received_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
