"use client";

import { Fragment, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SalesOrder, SalesOrderLine } from "@/types/sales-order";
import type { Customer, Item } from "@/types/master-data";

type LineDraft = { item_id: string; qty: string; delivery_date: string; freeStock: number | null };

const emptyLine: LineDraft = { item_id: "", qty: "", delivery_date: "", freeStock: null };

export function SalesOrderManager({
  initialOrders,
  customers,
  items,
  canCreate,
}: {
  initialOrders: SalesOrder[];
  customers: Customer[];
  items: Item[];
  canCreate: boolean;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [customerId, setCustomerId] = useState("");
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [requiredDate, setRequiredDate] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([{ ...emptyLine }]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [soLines, setSoLines] = useState<Record<string, SalesOrderLine[]>>({});

  const customerCode = (id: string) => customers.find((c) => c.id === id)?.code ?? "—";
  const partNo = (id: string) => items.find((i) => i.id === id)?.part_no ?? "—";

  function updateLine(i: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function handleItemChange(i: number, itemId: string) {
    updateLine(i, { item_id: itemId, freeStock: null });
    if (!itemId) return;

    const supabase = createClient();
    const { data } = await supabase.rpc("get_fg_free_stock", { p_item_id: itemId });
    updateLine(i, { item_id: itemId, freeStock: data != null ? Number(data) : null });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const payloadLines = lines
      .filter((l) => l.item_id && l.qty)
      .map((l) => ({
        item_id: l.item_id,
        qty: Number(l.qty),
        delivery_date: l.delivery_date || null,
      }));

    if (!customerId || payloadLines.length === 0) {
      setError("ต้องเลือก Customer และมีอย่างน้อย 1 line");
      setSubmitting(false);
      return;
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_sales_order", {
      p_customer_id: customerId,
      p_order_date: orderDate,
      p_required_date: requiredDate || null,
      p_lines: payloadLines,
    });

    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }

    const { data: so } = await supabase
      .from("sales_orders")
      .select("id, so_no, customer_id, order_date, required_date, status, created_at")
      .eq("id", data)
      .single<SalesOrder>();

    if (so) setOrders((prev) => [so, ...prev]);
    setCustomerId("");
    setRequiredDate("");
    setLines([{ ...emptyLine }]);
  }

  async function handleCancel(soId: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("cancel_sales_order", { p_so_id: soId });
    if (error) {
      alert(error.message);
      return;
    }
    setOrders((prev) => prev.map((o) => (o.id === soId ? { ...o, status: "CANCELLED" } : o)));
  }

  async function toggleExpand(soId: string) {
    if (expanded === soId) {
      setExpanded(null);
      return;
    }
    setExpanded(soId);

    if (!soLines[soId]) {
      const supabase = createClient();
      const { data } = await supabase
        .from("sales_order_lines")
        .select("id, so_id, line_no, item_id, qty, delivery_date")
        .eq("so_id", soId)
        .order("line_no")
        .returns<SalesOrderLine[]>();
      setSoLines((prev) => ({ ...prev, [soId]: data ?? [] }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-black/10 dark:border-white/10 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-black/50 dark:text-white/50">Customer</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-black/50 dark:text-white/50">Order Date</label>
              <input
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-black/50 dark:text-white/50">Required Date</label>
              <input
                type="date"
                value={requiredDate}
                onChange={(e) => setRequiredDate(e.target.value)}
                className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            {lines.map((line, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2 rounded-md border border-black/5 dark:border-white/5 p-2">
                <select
                  value={line.item_id}
                  onChange={(e) => handleItemChange(i, e.target.value)}
                  className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
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
                  className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm w-24"
                />
                <input
                  placeholder="Delivery Date"
                  type="date"
                  value={line.delivery_date}
                  onChange={(e) => updateLine(i, { delivery_date: e.target.value })}
                  className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
                />
                {line.item_id && (
                  <span
                    className={`text-xs ${
                      line.freeStock != null && Number(line.qty || 0) > line.freeStock
                        ? "text-red-600"
                        : "text-black/50 dark:text-white/50"
                    }`}
                  >
                    Free Stock: {line.freeStock ?? "..."}
                  </span>
                )}
                {lines.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-sm text-red-600"
                  >
                    ลบ
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}
              className="self-start text-sm text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white"
            >
              + เพิ่ม line
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="self-start rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "กำลังบันทึก..." : "Create Sales Order"}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </form>
      )}

      <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
              <th className="px-3 py-2 font-medium">SO No.</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Order Date</th>
              <th className="px-3 py-2 font-medium">Required Date</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-black/50 dark:text-white/50">
                  ยังไม่มี Sales Order
                </td>
              </tr>
            )}
            {orders.map((so) => (
              <Fragment key={so.id}>
                <tr
                  className="border-b border-black/5 dark:border-white/5 cursor-pointer"
                  onClick={() => toggleExpand(so.id)}
                >
                  <td className="px-3 py-2">{so.so_no}</td>
                  <td className="px-3 py-2">{customerCode(so.customer_id)}</td>
                  <td className="px-3 py-2">{so.order_date}</td>
                  <td className="px-3 py-2">{so.required_date ?? "—"}</td>
                  <td className="px-3 py-2">{so.status}</td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    {so.status === "OPEN" && (
                      <button
                        onClick={() => handleCancel(so.id)}
                        className="rounded-md border border-black/15 dark:border-white/15 px-2 py-0.5 text-xs hover:bg-black/[.04] dark:hover:bg-white/[.06]"
                      >
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
                {expanded === so.id && (
                  <tr>
                    <td colSpan={6} className="px-3 py-2 bg-black/[.02] dark:bg-white/[.03]">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-black/50 dark:text-white/50">
                            <th className="px-2 py-1">Part No.</th>
                            <th className="px-2 py-1">Qty</th>
                            <th className="px-2 py-1">Delivery Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(soLines[so.id] ?? []).map((l) => (
                            <tr key={l.id}>
                              <td className="px-2 py-1">{partNo(l.item_id)}</td>
                              <td className="px-2 py-1">{l.qty}</td>
                              <td className="px-2 py-1">{l.delivery_date ?? "—"}</td>
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
