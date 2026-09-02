"use client";

import { Fragment, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { parseCsv } from "@/lib/csv";
import { FORECAST_TRANSITIONS, type ForecastBatch, type ForecastLine, type ForecastStatus } from "@/types/forecast";
import type { Customer, Item } from "@/types/master-data";
import { FileInput } from "@/components/ui/FileInput";

type LineDraft = { item_id: string; forecast_month: string; forecast_qty: number };

export function ForecastManager({
  initialBatches,
  customers,
  items,
  canCreate,
}: {
  initialBatches: ForecastBatch[];
  customers: Customer[];
  items: Item[];
  canCreate: boolean;
}) {
  const [batches, setBatches] = useState(initialBatches);
  const [customerId, setCustomerId] = useState("");
  const [preview, setPreview] = useState<LineDraft[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lines, setLines] = useState<Record<string, ForecastLine[]>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const itemByPartNo = new Map(items.map((i) => [i.part_no, i]));
  const customerCode = (id: string) => customers.find((c) => c.id === id)?.code ?? "—";

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError(null);
    setPreview(null);

    file.text().then((text) => {
      const rows = parseCsv(text);
      if (rows.length < 2) {
        setParseError("ไฟล์ต้องมี header + อย่างน้อย 1 แถวข้อมูล");
        return;
      }

      const header = rows[0].map((h) => h.trim().toLowerCase());
      const partIdx = header.indexOf("part_no");
      const monthIdx = header.indexOf("forecast_month");
      const qtyIdx = header.indexOf("forecast_qty");

      if (partIdx === -1 || monthIdx === -1 || qtyIdx === -1) {
        setParseError("Header ต้องมีคอลัมน์: part_no, forecast_month, forecast_qty");
        return;
      }

      const drafts: LineDraft[] = [];
      const errors: string[] = [];

      rows.slice(1).forEach((r, i) => {
        const partNo = r[partIdx]?.trim();
        const month = r[monthIdx]?.trim();
        const qty = Number(r[qtyIdx]);
        const item = itemByPartNo.get(partNo);

        if (!item) {
          errors.push(`แถว ${i + 2}: ไม่พบ part_no "${partNo}" ใน Item Master`);
          return;
        }
        if (!/^\d{4}-\d{2}(-\d{2})?$/.test(month)) {
          errors.push(`แถว ${i + 2}: forecast_month ต้องเป็น YYYY-MM หรือ YYYY-MM-DD`);
          return;
        }
        if (!Number.isFinite(qty) || qty < 0) {
          errors.push(`แถว ${i + 2}: forecast_qty ต้องเป็นตัวเลข >= 0`);
          return;
        }

        drafts.push({
          item_id: item.id,
          forecast_month: month.length === 7 ? `${month}-01` : month,
          forecast_qty: qty,
        });
      });

      if (errors.length > 0) {
        setParseError(errors.join("\n"));
        return;
      }

      setPreview(drafts);
    });
  }

  async function handleSubmit() {
    if (!customerId || !preview || preview.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_forecast_batch", {
      p_customer_id: customerId,
      p_lines: preview,
    });

    setSubmitting(false);

    if (error) {
      setSubmitError(error.message);
      return;
    }

    const { data: batch } = await supabase
      .from("forecast_batches")
      .select("id, forecast_no, customer_id, revision_no, status, created_at")
      .eq("id", data)
      .single<ForecastBatch>();

    if (batch) setBatches((prev) => [batch, ...prev]);
    setPreview(null);
    setCustomerId("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function handleTransition(batchId: string, newStatus: ForecastStatus) {
    const supabase = createClient();
    const { error } = await supabase.rpc("update_forecast_batch_status", {
      p_batch_id: batchId,
      p_new_status: newStatus,
    });

    if (error) {
      alert(error.message);
      return;
    }

    setBatches((prev) => prev.map((b) => (b.id === batchId ? { ...b, status: newStatus } : b)));
  }

  async function toggleExpand(batchId: string) {
    if (expanded === batchId) {
      setExpanded(null);
      return;
    }
    setExpanded(batchId);

    if (!lines[batchId]) {
      const supabase = createClient();
      const { data } = await supabase
        .from("forecast_lines")
        .select("id, batch_id, item_id, forecast_month, forecast_qty, version")
        .eq("batch_id", batchId)
        .order("forecast_month")
        .returns<ForecastLine[]>();
      setLines((prev) => ({ ...prev, [batchId]: data ?? [] }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-foreground-muted">Customer</label>
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
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
              <label className="text-xs text-foreground-muted">
                CSV (header: part_no, forecast_month, forecast_qty)
              </label>
              <FileInput ref={fileRef} accept=".csv,text/csv" onChange={handleFile} />
            </div>
          </div>

          {parseError && (
            <pre className="text-sm text-danger whitespace-pre-wrap">{parseError}</pre>
          )}

          {preview && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-foreground-muted">
                Preview {preview.length} บรรทัด — ตรวจสอบก่อนกด Submit
              </p>
              <div className="overflow-x-auto rounded-md border border-border max-h-48 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-foreground-muted">
                      <th className="px-2 py-1">Part No.</th>
                      <th className="px-2 py-1">Month</th>
                      <th className="px-2 py-1">Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((l, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="px-2 py-1">{items.find((it) => it.id === l.item_id)?.part_no}</td>
                        <td className="px-2 py-1">{l.forecast_month}</td>
                        <td className="px-2 py-1">{l.forecast_qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                onClick={handleSubmit}
                disabled={!customerId || submitting}
                className="self-start rounded-md bg-brand text-brand-foreground hover:brightness-110 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {submitting ? "กำลังบันทึก..." : "Submit Forecast Batch"}
              </button>
              {submitError && <p className="text-sm text-danger">{submitError}</p>}
            </div>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th className="px-3 py-2 font-medium">Forecast No.</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Rev.</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {batches.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-foreground-muted">
                  ยังไม่มี Forecast
                </td>
              </tr>
            )}
            {batches.map((b) => (
              <Fragment key={b.id}>
                <tr
                  className="border-b border-border cursor-pointer"
                  onClick={() => toggleExpand(b.id)}
                >
                  <td className="px-3 py-2">{b.forecast_no}</td>
                  <td className="px-3 py-2">{customerCode(b.customer_id)}</td>
                  <td className="px-3 py-2">{b.revision_no}</td>
                  <td className="px-3 py-2">{b.status}</td>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <div className="flex gap-1 flex-wrap">
                      {FORECAST_TRANSITIONS[b.status].map((next) => (
                        <button
                          key={next}
                          onClick={() => handleTransition(b.id, next)}
                          className="rounded-md border border-border-strong px-2 py-0.5 text-xs hover:bg-surface-muted"
                        >
                          → {next}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
                {expanded === b.id && (
                  <tr>
                    <td colSpan={5} className="px-3 py-2 bg-surface-muted">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-foreground-muted">
                            <th className="px-2 py-1">Part No.</th>
                            <th className="px-2 py-1">Month</th>
                            <th className="px-2 py-1">Qty</th>
                            <th className="px-2 py-1">Version</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(lines[b.id] ?? []).map((l) => (
                            <tr key={l.id}>
                              <td className="px-2 py-1">
                                {items.find((i) => i.id === l.item_id)?.part_no ?? "—"}
                              </td>
                              <td className="px-2 py-1">{l.forecast_month}</td>
                              <td className="px-2 py-1">{l.forecast_qty}</td>
                              <td className="px-2 py-1">{l.version}</td>
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
