"use client";

import { Fragment, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  PO_TRANSITIONS,
  type PoLineAttachment,
  type PoStatus,
  type PurchaseOrder,
  type PurchaseOrderLine,
} from "@/types/purchase-order";
import type { Item, Supplier } from "@/types/master-data";

type LineDraft = {
  item_id: string;
  qty: string;
  unit: string;
  unit_price: string;
  required_date: string;
  eta: string;
  technical_spec: string;
};

const emptyLine: LineDraft = {
  item_id: "",
  qty: "",
  unit: "",
  unit_price: "",
  required_date: "",
  eta: "",
  technical_spec: "",
};

export function PurchaseOrderManager({
  initialOrders,
  suppliers,
  items,
  canCreate,
}: {
  initialOrders: PurchaseOrder[];
  suppliers: Supplier[];
  items: Item[];
  canCreate: boolean;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [supplierId, setSupplierId] = useState("");
  const [poDate, setPoDate] = useState(new Date().toISOString().slice(0, 10));
  const [currency, setCurrency] = useState("THB");
  const [deliveryDate, setDeliveryDate] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ ...emptyLine }]);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [poLines, setPoLines] = useState<Record<string, PurchaseOrderLine[]>>({});
  const [attachments, setAttachments] = useState<Record<string, PoLineAttachment[]>>({});
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const supplierCode = (id: string) => suppliers.find((s) => s.id === id)?.code ?? "—";
  const partNo = (id: string) => items.find((i) => i.id === id)?.part_no ?? "—";

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);

    const payloadLines = lines
      .filter((l) => l.item_id && l.qty && l.unit)
      .map((l) => ({
        item_id: l.item_id,
        qty: Number(l.qty),
        unit: l.unit,
        unit_price: Number(l.unit_price || 0),
        required_date: l.required_date || null,
        eta: l.eta || null,
        technical_spec: l.technical_spec || null,
      }));

    if (!supplierId || payloadLines.length === 0) {
      setSubmitError("ต้องเลือก Supplier และมีอย่างน้อย 1 line");
      setSubmitting(false);
      return;
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_purchase_order", {
      p_supplier_id: supplierId,
      p_po_date: poDate,
      p_currency: currency,
      p_delivery_date: deliveryDate || null,
      p_lines: payloadLines,
    });

    setSubmitting(false);

    if (error) {
      setSubmitError(error.message);
      return;
    }

    const { data: po } = await supabase
      .from("purchase_orders")
      .select("id, po_no, supplier_id, po_date, currency, delivery_date, status, barcode_value, created_at")
      .eq("id", data)
      .single<PurchaseOrder>();

    if (po) setOrders((prev) => [po, ...prev]);
    setSupplierId("");
    setDeliveryDate("");
    setLines([{ ...emptyLine }]);
  }

  async function handleTransition(poId: string, newStatus: PoStatus) {
    const supabase = createClient();
    const { error } = await supabase.rpc("update_purchase_order_status", {
      p_po_id: poId,
      p_new_status: newStatus,
    });

    if (error) {
      alert(error.message);
      return;
    }

    setOrders((prev) => prev.map((o) => (o.id === poId ? { ...o, status: newStatus } : o)));
  }

  async function toggleExpand(poId: string) {
    if (expanded === poId) {
      setExpanded(null);
      return;
    }
    setExpanded(poId);

    if (!poLines[poId]) {
      const supabase = createClient();
      const { data } = await supabase
        .from("purchase_order_lines")
        .select("id, po_id, line_no, item_id, qty, unit, unit_price, required_date, eta, technical_spec")
        .eq("po_id", poId)
        .order("line_no")
        .returns<PurchaseOrderLine[]>();
      setPoLines((prev) => ({ ...prev, [poId]: data ?? [] }));

      if (data && data.length > 0) {
        const { data: atts } = await supabase
          .from("purchase_order_line_attachments")
          .select("id, line_id, file_path, file_name, file_size, content_type, uploaded_at")
          .in("line_id", data.map((l) => l.id))
          .returns<PoLineAttachment[]>();
        const grouped: Record<string, PoLineAttachment[]> = {};
        (atts ?? []).forEach((a) => {
          grouped[a.line_id] = [...(grouped[a.line_id] ?? []), a];
        });
        setAttachments((prev) => ({ ...prev, ...grouped }));
      }
    }
  }

  async function handleUpload(lineId: string, file: File) {
    const supabase = createClient();
    const path = `${lineId}/${crypto.randomUUID()}-${file.name}`;

    const { error: uploadError } = await supabase.storage.from("po-attachments").upload(path, file);
    if (uploadError) {
      alert(uploadError.message);
      return;
    }

    const { data, error } = await supabase
      .from("purchase_order_line_attachments")
      .insert({
        line_id: lineId,
        file_path: path,
        file_name: file.name,
        file_size: file.size,
        content_type: file.type,
      })
      .select()
      .single<PoLineAttachment>();

    if (error) {
      alert(error.message);
      return;
    }

    setAttachments((prev) => ({ ...prev, [lineId]: [...(prev[lineId] ?? []), data] }));
  }

  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-foreground-muted">Supplier</label>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-foreground-muted">PO Date</label>
              <input
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-foreground-muted">Currency</label>
              <input
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm w-20"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-foreground-muted">Delivery Date</label>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((line, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-border p-2">
                <select
                  value={line.item_id}
                  onChange={(e) => updateLine(i, { item_id: e.target.value })}
                  className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
                >
                  <option value="">Part No.</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.part_no}
                    </option>
                  ))}
                </select>
                <input
                  placeholder="Qty"
                  type="number"
                  value={line.qty}
                  onChange={(e) => updateLine(i, { qty: e.target.value })}
                  className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm w-20"
                />
                <input
                  placeholder="Unit"
                  value={line.unit}
                  onChange={(e) => updateLine(i, { unit: e.target.value })}
                  className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm w-20"
                />
                <input
                  placeholder="Unit Price"
                  type="number"
                  step="0.01"
                  value={line.unit_price}
                  onChange={(e) => updateLine(i, { unit_price: e.target.value })}
                  className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm w-24"
                />
                <input
                  placeholder="Required Date"
                  type="date"
                  value={line.required_date}
                  onChange={(e) => updateLine(i, { required_date: e.target.value })}
                  className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
                />
                <input
                  placeholder="ETA"
                  type="date"
                  value={line.eta}
                  onChange={(e) => updateLine(i, { eta: e.target.value })}
                  className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
                />
                <input
                  placeholder="Technical Spec / Drawing Rev"
                  value={line.technical_spec}
                  onChange={(e) => updateLine(i, { technical_spec: e.target.value })}
                  className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm flex-1 min-w-[10rem]"
                />
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-sm text-danger"
                  >
                    ลบ
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
              className="self-start text-sm text-foreground-muted hover:text-black dark:hover:text-white"
            >
              + เพิ่ม line
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded-md bg-brand text-brand-foreground hover:brightness-110 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "กำลังบันทึก..." : "Create PO"}
          </button>
          {submitError && <p className="text-sm text-danger">{submitError}</p>}
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th className="px-3 py-2 font-medium">PO No.</th>
              <th className="px-3 py-2 font-medium">Supplier</th>
              <th className="px-3 py-2 font-medium">PO Date</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-foreground-muted">
                  ยังไม่มี Purchase Order
                </td>
              </tr>
            )}
            {orders.map((po) => (
              <Fragment key={po.id}>
                <tr
                  className="border-b border-border cursor-pointer"
                  onClick={() => toggleExpand(po.id)}
                >
                  <td className="px-3 py-2">{po.po_no}</td>
                  <td className="px-3 py-2">{supplierCode(po.supplier_id)}</td>
                  <td className="px-3 py-2">{po.po_date}</td>
                  <td className="px-3 py-2">{po.status}</td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1 flex-wrap">
                      {PO_TRANSITIONS[po.status].map((next) => (
                        <button
                          key={next}
                          onClick={() => handleTransition(po.id, next)}
                          className="rounded-md border border-border-strong px-2 py-0.5 text-xs hover:bg-surface-muted"
                        >
                          → {next}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
                {expanded === po.id && (
                  <tr>
                    <td colSpan={5} className="px-3 py-2 bg-surface-muted">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-foreground-muted">
                            <th className="px-2 py-1">Part No.</th>
                            <th className="px-2 py-1">Qty</th>
                            <th className="px-2 py-1">Unit</th>
                            <th className="px-2 py-1">Unit Price</th>
                            <th className="px-2 py-1">Spec/Drawing</th>
                            <th className="px-2 py-1">Attachments</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(poLines[po.id] ?? []).map((l) => (
                            <tr key={l.id}>
                              <td className="px-2 py-1">{partNo(l.item_id)}</td>
                              <td className="px-2 py-1">{l.qty}</td>
                              <td className="px-2 py-1">{l.unit}</td>
                              <td className="px-2 py-1">{l.unit_price}</td>
                              <td className="px-2 py-1">{l.technical_spec ?? "—"}</td>
                              <td className="px-2 py-1">
                                <div className="flex flex-col gap-1">
                                  {(attachments[l.id] ?? []).map((a) => (
                                    <span key={a.id}>{a.file_name}</span>
                                  ))}
                                  {canCreate && (
                                    <>
                                      <input
                                        ref={(el) => {
                                          fileInputs.current[l.id] = el;
                                        }}
                                        type="file"
                                        accept=".pdf,.dwg,.dxf,.png,.jpg,.jpeg"
                                        className="hidden"
                                        onChange={(e) => {
                                          const file = e.target.files?.[0];
                                          if (file) handleUpload(l.id, file);
                                          e.target.value = "";
                                        }}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => fileInputs.current[l.id]?.click()}
                                        className="text-left text-foreground-muted hover:text-black dark:hover:text-white"
                                      >
                                        + แนบไฟล์
                                      </button>
                                    </>
                                  )}
                                </div>
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
