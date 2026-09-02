"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Location } from "@/types/master-data";
import type { DefectCode, IqcInspection, PendingLot, SampleSizePlanPreview } from "@/types/iqc";

type DefectDraft = { defect_code_id: string; qty: string; condition_note: string };

export function IqcManager({
  pendingLots,
  locations,
  defectCodes,
  initialInspections,
  canCreate,
}: {
  pendingLots: PendingLot[];
  locations: Location[];
  defectCodes: DefectCode[];
  initialInspections: IqcInspection[];
  canCreate: boolean;
}) {
  const [inspections, setInspections] = useState(initialInspections);
  const [selected, setSelected] = useState<PendingLot | null>(null);
  const [preview, setPreview] = useState<SampleSizePlanPreview | null>(null);
  const [qtyPass, setQtyPass] = useState("");
  const [qtyHold, setQtyHold] = useState("");
  const [qtyNg, setQtyNg] = useState("");
  const [wipLocationId, setWipLocationId] = useState("");
  const [holdLocationId, setHoldLocationId] = useState("");
  const [ngLocationId, setNgLocationId] = useState("");
  const [defects, setDefects] = useState<DefectDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const siteLocations = (zone: string) =>
    locations.filter((l) => l.zone_type === zone && l.site_id === selected?.site_id);

  async function selectLot(lotId: string) {
    const lot = pendingLots.find((l) => l.lot_id === lotId) ?? null;
    setSelected(lot);
    setPreview(null);
    setQtyPass("");
    setQtyHold("");
    setQtyNg("");
    setWipLocationId("");
    setHoldLocationId("");
    setNgLocationId("");
    setDefects([]);
    setError(null);

    if (!lot) return;

    const supabase = createClient();
    const { data } = await supabase
      .rpc("get_sample_size_plan", { p_item_id: lot.item_id, p_lot_size: Math.trunc(lot.qty) })
      .maybeSingle<SampleSizePlanPreview>();
    setPreview(data ?? null);
  }

  function addDefect() {
    setDefects((prev) => [...prev, { defect_code_id: "", qty: "", condition_note: "" }]);
  }

  function updateDefect(i: number, patch: Partial<DefectDraft>) {
    setDefects((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  async function handleSubmit() {
    if (!selected) return;
    setError(null);

    const pass = Number(qtyPass || 0);
    const hold = Number(qtyHold || 0);
    const ng = Number(qtyNg || 0);

    if (pass + hold + ng <= 0) {
      setError("กรอกจำนวนอย่างน้อย 1 สถานะ (Pass/Hold/NG)");
      return;
    }
    if (pass > 0 && !wipLocationId) {
      setError("เลือก WIP Location สำหรับจำนวนที่ Pass");
      return;
    }
    if (hold > 0 && !holdLocationId) {
      setError("เลือก HOLD Location สำหรับจำนวนที่ Hold");
      return;
    }
    if (ng > 0 && !ngLocationId) {
      setError("เลือก NG Location สำหรับจำนวนที่ NG");
      return;
    }

    const defectPayload = defects
      .filter((d) => d.defect_code_id && Number(d.qty) > 0)
      .map((d) => ({
        defect_code_id: d.defect_code_id,
        qty: Number(d.qty),
        condition_note: d.condition_note || null,
      }));

    setSubmitting(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("confirm_iqc_inspection", {
      p_lot_id: selected.lot_id,
      p_incoming_location_id: selected.incoming_location_id,
      p_wip_location_id: wipLocationId || null,
      p_hold_location_id: holdLocationId || null,
      p_ng_location_id: ngLocationId || null,
      p_qty_pass: pass,
      p_qty_hold: hold,
      p_qty_ng: ng,
      p_defects: defectPayload,
    });

    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }

    const { data: iqc } = await supabase
      .from("iqc_inspections")
      .select("id, iqc_no, lot_id, inspection_plan_id, lot_size, sample_size, accept_no, reject_no, qty_pass, qty_hold, qty_ng, inspected_at")
      .eq("id", data)
      .single<IqcInspection>();

    if (iqc) setInspections((prev) => [iqc, ...prev]);
    selectLot("");
  }

  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-foreground-muted">Lot ที่รอตรวจ (อยู่ใน INCOMING)</label>
            <select
              value={selected?.lot_id ?? ""}
              onChange={(e) => selectLot(e.target.value)}
              className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
            >
              <option value="">—</option>
              {pendingLots.map((l) => (
                <option key={l.lot_id} value={l.lot_id}>
                  {l.lot_no} — {l.part_no} ({l.qty} @ {l.incoming_location_code})
                </option>
              ))}
            </select>
          </div>

          {selected && (
            <>
              {preview && (
                <p className="text-sm text-foreground-muted">
                  Inspection Plan: {preview.sampling_standard ?? "— ไม่มี —"} / Level{" "}
                  {preview.inspection_level ?? "—"} / AQL {preview.aql ?? "—"} → Sample Size{" "}
                  {preview.sample_size ?? "— ยังไม่มีข้อมูล Ac/Re สำหรับ code letter นี้ —"}
                  {preview.accept_no != null && ` (Ac=${preview.accept_no}, Re=${preview.reject_no})`}
                </p>
              )}
              {!preview && (
                <p className="text-sm text-warning">
                  ⚠️ ไม่มี Inspection Plan สำหรับ Item นี้ — กรอกผลตรวจได้ตามปกติ แต่ไม่มีคำแนะนำ Sample Size
                </p>
              )}

              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-foreground-muted">Qty Pass</label>
                  <input
                    type="number"
                    value={qtyPass}
                    onChange={(e) => setQtyPass(e.target.value)}
                    className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm w-24"
                  />
                  {Number(qtyPass) > 0 && (
                    <select
                      value={wipLocationId}
                      onChange={(e) => setWipLocationId(e.target.value)}
                      className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
                    >
                      <option value="">WIP Location</option>
                      {siteLocations("WIP").map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-foreground-muted">Qty Hold</label>
                  <input
                    type="number"
                    value={qtyHold}
                    onChange={(e) => setQtyHold(e.target.value)}
                    className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm w-24"
                  />
                  {Number(qtyHold) > 0 && (
                    <select
                      value={holdLocationId}
                      onChange={(e) => setHoldLocationId(e.target.value)}
                      className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
                    >
                      <option value="">HOLD Location</option>
                      {siteLocations("HOLD").map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-foreground-muted">Qty NG</label>
                  <input
                    type="number"
                    value={qtyNg}
                    onChange={(e) => setQtyNg(e.target.value)}
                    className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm w-24"
                  />
                  {Number(qtyNg) > 0 && (
                    <select
                      value={ngLocationId}
                      onChange={(e) => setNgLocationId(e.target.value)}
                      className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
                    >
                      <option value="">NG Location</option>
                      {siteLocations("NG").map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs text-foreground-muted">Defect Details</span>
                {defects.map((d, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <select
                      value={d.defect_code_id}
                      onChange={(e) => updateDefect(i, { defect_code_id: e.target.value })}
                      className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
                    >
                      <option value="">Defect Code</option>
                      {defectCodes.map((dc) => (
                        <option key={dc.id} value={dc.id}>
                          {dc.code} — {dc.description}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder="Qty"
                      type="number"
                      value={d.qty}
                      onChange={(e) => updateDefect(i, { qty: e.target.value })}
                      className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm w-20"
                    />
                    <textarea
                      placeholder="Condition Note (บรรยายลักษณะปัญหา)"
                      value={d.condition_note}
                      onChange={(e) => updateDefect(i, { condition_note: e.target.value })}
                      className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm flex-1 min-w-[14rem]"
                      rows={1}
                    />
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addDefect}
                  className="self-start text-sm text-foreground-muted hover:text-black dark:hover:text-white"
                >
                  + เพิ่ม Defect
                </button>
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="self-start rounded-md bg-brand text-brand-foreground hover:brightness-110 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {submitting ? "กำลังบันทึก..." : "Confirm IQC"}
              </button>
            </>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th className="px-3 py-2 font-medium">IQC No.</th>
              <th className="px-3 py-2 font-medium">Lot Size</th>
              <th className="px-3 py-2 font-medium">Sample</th>
              <th className="px-3 py-2 font-medium">Pass</th>
              <th className="px-3 py-2 font-medium">Hold</th>
              <th className="px-3 py-2 font-medium">NG</th>
            </tr>
          </thead>
          <tbody>
            {inspections.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-foreground-muted">
                  ยังไม่มีการตรวจ IQC
                </td>
              </tr>
            )}
            {inspections.map((i) => (
              <tr key={i.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{i.iqc_no}</td>
                <td className="px-3 py-2">{i.lot_size}</td>
                <td className="px-3 py-2">{i.sample_size ?? "—"}</td>
                <td className="px-3 py-2">{i.qty_pass}</td>
                <td className="px-3 py-2">{i.qty_hold}</td>
                <td className="px-3 py-2">{i.qty_ng}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
