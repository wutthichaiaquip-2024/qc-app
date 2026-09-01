"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { DefectCode } from "@/types/iqc";
import type { Item, Location } from "@/types/master-data";
import type { WipRequest } from "@/types/wip-request";
import {
  INSPECTION_MODES,
  MEASUREMENT_METHODS,
  type FgInspection,
  type InspectionMode,
  type MeasurementMethod,
} from "@/types/fg-inspection";

type CharacteristicDraft = { characteristic_name: string; spec_value: string; measured_value: string; unit: string; result: "PASS" | "NG" };
type DefectDraft = { defect_code_id: string; qty: string; condition_note: string; photo_path: string; uploading: boolean };

export function FgInspectionManager({
  pendingRequests,
  locations,
  items,
  defectCodes,
  initialInspections,
  canCreate,
}: {
  pendingRequests: WipRequest[];
  locations: Location[];
  items: Item[];
  defectCodes: DefectCode[];
  initialInspections: FgInspection[];
  canCreate: boolean;
}) {
  const [inspections, setInspections] = useState(initialInspections);
  const [wrId, setWrId] = useState("");
  const [mode, setMode] = useState<InspectionMode>("SAMPLING");
  const [method, setMethod] = useState<MeasurementMethod>("COUNT");
  const [qtyPass, setQtyPass] = useState("");
  const [qtyHold, setQtyHold] = useState("");
  const [qtyNg, setQtyNg] = useState("");
  const [fgLocationId, setFgLocationId] = useState("");
  const [holdLocationId, setHoldLocationId] = useState("");
  const [ngLocationId, setNgLocationId] = useState("");
  const [characteristics, setCharacteristics] = useState<CharacteristicDraft[]>([]);
  const [defects, setDefects] = useState<DefectDraft[]>([]);
  const [startedAt] = useState(() => new Date().toISOString());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedWr = pendingRequests.find((r) => r.id === wrId);
  const selectedWrLocation = locations.find((l) => l.id === selectedWr?.wip_location_id);
  const siteLocations = (zone: string) =>
    locations.filter((l) => l.zone_type === zone && l.site_id === selectedWrLocation?.site_id);
  const partNo = (itemId: string) => items.find((i) => i.id === itemId)?.part_no ?? "—";

  function resetForm() {
    setWrId("");
    setQtyPass("");
    setQtyHold("");
    setQtyNg("");
    setFgLocationId("");
    setHoldLocationId("");
    setNgLocationId("");
    setCharacteristics([]);
    setDefects([]);
  }

  function addCharacteristic() {
    setCharacteristics((prev) => [...prev, { characteristic_name: "", spec_value: "", measured_value: "", unit: "", result: "PASS" }]);
  }
  function updateCharacteristic(i: number, patch: Partial<CharacteristicDraft>) {
    setCharacteristics((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  }

  function addDefect() {
    setDefects((prev) => [...prev, { defect_code_id: "", qty: "", condition_note: "", photo_path: "", uploading: false }]);
  }
  function updateDefect(i: number, patch: Partial<DefectDraft>) {
    setDefects((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  async function handlePhotoUpload(i: number, file: File) {
    updateDefect(i, { uploading: true });
    const supabase = createClient();
    const path = `${wrId}/${crypto.randomUUID()}-${file.name}`;
    const { error } = await supabase.storage.from("qc-photos").upload(path, file);
    if (error) {
      setError(error.message);
      updateDefect(i, { uploading: false });
      return;
    }
    updateDefect(i, { photo_path: path, uploading: false });
  }

  async function handleSubmit() {
    if (!selectedWr) return;

    const pass = Number(qtyPass || 0);
    const hold = Number(qtyHold || 0);
    const ng = Number(qtyNg || 0);

    if (pass + hold + ng <= 0) {
      setError("กรอกจำนวนอย่างน้อย 1 สถานะ (Pass/Hold/NG)");
      return;
    }
    if (pass > 0 && !fgLocationId) {
      setError("เลือก FG Location สำหรับจำนวนที่ Pass");
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

    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("confirm_fg_inspection", {
      p_wip_request_id: wrId,
      p_inspection_mode: mode,
      p_measurement_method: method,
      p_fg_location_id: fgLocationId || null,
      p_hold_location_id: holdLocationId || null,
      p_ng_location_id: ngLocationId || null,
      p_qty_pass: pass,
      p_qty_hold: hold,
      p_qty_ng: ng,
      p_started_at: startedAt,
      p_characteristics: characteristics
        .filter((c) => c.characteristic_name)
        .map((c) => ({
          characteristic_name: c.characteristic_name,
          spec_value: c.spec_value || null,
          measured_value: c.measured_value ? Number(c.measured_value) : null,
          unit: c.unit || null,
          result: c.result,
        })),
      p_defects: defects
        .filter((d) => d.defect_code_id && Number(d.qty) > 0)
        .map((d) => ({
          defect_code_id: d.defect_code_id,
          qty: Number(d.qty),
          condition_note: d.condition_note || null,
          photo_path: d.photo_path || null,
        })),
    });

    setSubmitting(false);

    if (error) {
      setError(error.message);
      return;
    }

    const { data: fg } = await supabase
      .from("fg_inspections")
      .select("id, fg_no, wip_request_id, item_id, new_lot_id, inspection_mode, measurement_method, lot_size, sample_size, qty_pass, qty_hold, qty_ng, started_at, completed_at")
      .eq("id", data)
      .single<FgInspection>();

    if (fg) setInspections((prev) => [fg, ...prev]);
    resetForm();
  }

  return (
    <div className="flex flex-col gap-4">
      {canCreate && (
        <div className="flex flex-col gap-3 rounded-lg border border-black/10 dark:border-white/10 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-black/50 dark:text-white/50">WIP Request ที่พร้อมตรวจ</label>
              <select
                value={wrId}
                onChange={(e) => setWrId(e.target.value)}
                className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
              >
                <option value="">—</option>
                {pendingRequests.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.request_no} — {partNo(r.item_id)} ({r.requested_qty})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-black/50 dark:text-white/50">Inspection Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as InspectionMode)}
                className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
              >
                {INSPECTION_MODES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-black/50 dark:text-white/50">Measurement Method</label>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as MeasurementMethod)}
                className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
              >
                {MEASUREMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {selectedWr && (
            <>
              <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-black/50 dark:text-white/50">Qty Pass</label>
                  <input
                    type="number"
                    value={qtyPass}
                    onChange={(e) => setQtyPass(e.target.value)}
                    className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm w-24"
                  />
                  {Number(qtyPass) > 0 && (
                    <select
                      value={fgLocationId}
                      onChange={(e) => setFgLocationId(e.target.value)}
                      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
                    >
                      <option value="">FG Location</option>
                      {siteLocations("FG").map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-black/50 dark:text-white/50">Qty Hold</label>
                  <input
                    type="number"
                    value={qtyHold}
                    onChange={(e) => setQtyHold(e.target.value)}
                    className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm w-24"
                  />
                  {Number(qtyHold) > 0 && (
                    <select
                      value={holdLocationId}
                      onChange={(e) => setHoldLocationId(e.target.value)}
                      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
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
                  <label className="text-xs text-black/50 dark:text-white/50">Qty NG</label>
                  <input
                    type="number"
                    value={qtyNg}
                    onChange={(e) => setQtyNg(e.target.value)}
                    className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm w-24"
                  />
                  {Number(qtyNg) > 0 && (
                    <select
                      value={ngLocationId}
                      onChange={(e) => setNgLocationId(e.target.value)}
                      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
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
                <span className="text-xs text-black/50 dark:text-white/50">Characteristics / Measurement</span>
                {characteristics.map((c, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <input
                      placeholder="Characteristic"
                      value={c.characteristic_name}
                      onChange={(e) => updateCharacteristic(i, { characteristic_name: e.target.value })}
                      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
                    />
                    <input
                      placeholder="Spec"
                      value={c.spec_value}
                      onChange={(e) => updateCharacteristic(i, { spec_value: e.target.value })}
                      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm w-28"
                    />
                    <input
                      placeholder="Measured"
                      type="number"
                      step="0.01"
                      value={c.measured_value}
                      onChange={(e) => updateCharacteristic(i, { measured_value: e.target.value })}
                      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm w-24"
                    />
                    <input
                      placeholder="Unit"
                      value={c.unit}
                      onChange={(e) => updateCharacteristic(i, { unit: e.target.value })}
                      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm w-16"
                    />
                    <select
                      value={c.result}
                      onChange={(e) => updateCharacteristic(i, { result: e.target.value as "PASS" | "NG" })}
                      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
                    >
                      <option value="PASS">PASS</option>
                      <option value="NG">NG</option>
                    </select>
                  </div>
                ))}
                <button type="button" onClick={addCharacteristic} className="self-start text-sm text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white">
                  + เพิ่ม Characteristic
                </button>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs text-black/50 dark:text-white/50">Defect Details</span>
                {defects.map((d, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-2">
                    <select
                      value={d.defect_code_id}
                      onChange={(e) => updateDefect(i, { defect_code_id: e.target.value })}
                      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
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
                      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm w-20"
                    />
                    <textarea
                      placeholder="Condition Note (3 Gen: บรรยายลักษณะจริง)"
                      value={d.condition_note}
                      onChange={(e) => updateDefect(i, { condition_note: e.target.value })}
                      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm flex-1 min-w-[14rem]"
                      rows={1}
                    />
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={d.uploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handlePhotoUpload(i, file);
                      }}
                      className="text-xs"
                    />
                    {d.photo_path && <span className="text-xs text-green-600">แนบรูปแล้ว</span>}
                  </div>
                ))}
                <button type="button" onClick={addDefect} className="self-start text-sm text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white">
                  + เพิ่ม Defect
                </button>
              </div>

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="self-start rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium disabled:opacity-50"
              >
                {submitting ? "กำลังบันทึก..." : "Confirm FG Inspection"}
              </button>
            </>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
              <th className="px-3 py-2 font-medium">FG No.</th>
              <th className="px-3 py-2 font-medium">Part No.</th>
              <th className="px-3 py-2 font-medium">Mode</th>
              <th className="px-3 py-2 font-medium">Pass</th>
              <th className="px-3 py-2 font-medium">Hold</th>
              <th className="px-3 py-2 font-medium">NG</th>
            </tr>
          </thead>
          <tbody>
            {inspections.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-black/50 dark:text-white/50">
                  ยังไม่มีการตรวจ FG
                </td>
              </tr>
            )}
            {inspections.map((i) => (
              <tr key={i.id} className="border-b border-black/5 dark:border-white/5 last:border-0">
                <td className="px-3 py-2">{i.fg_no}</td>
                <td className="px-3 py-2">{partNo(i.item_id)}</td>
                <td className="px-3 py-2">{i.inspection_mode}</td>
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
