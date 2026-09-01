"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Location } from "@/types/master-data";
import {
  OQC_CHECKLIST_ITEMS,
  OQC_ITEM_LABELS,
  type OqcChecklistItemName,
  type OqcInspection,
  type OqcQueueItem,
  type OqcResult,
} from "@/types/oqc";

type ChecklistState = Record<OqcChecklistItemName, { result: "PASS" | "FAIL"; note: string }>;

function emptyChecklist(): ChecklistState {
  return Object.fromEntries(
    OQC_CHECKLIST_ITEMS.map((item) => [item, { result: "PASS", note: "" }]),
  ) as ChecklistState;
}

export function OqcManager({
  queue,
  targetLocations,
  initialInspections,
  canCreate,
}: {
  queue: OqcQueueItem[];
  targetLocations: Location[];
  initialInspections: OqcInspection[];
  canCreate: boolean;
}) {
  const [items, setItems] = useState(queue);
  const [inspections, setInspections] = useState(initialInspections);
  const [checklists, setChecklists] = useState<Record<string, ChecklistState>>({});
  const [results, setResults] = useState<Record<string, OqcResult>>({});
  const [targetLocationIds, setTargetLocationIds] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bySo = new Map<string, OqcQueueItem[]>();
  items.forEach((i) => {
    bySo.set(i.picking_id, [...(bySo.get(i.picking_id) ?? []), i]);
  });

  function getChecklist(pickingId: string): ChecklistState {
    return checklists[pickingId] ?? emptyChecklist();
  }

  function updateChecklistItem(
    pickingId: string,
    itemName: OqcChecklistItemName,
    patch: Partial<{ result: "PASS" | "FAIL"; note: string }>,
  ) {
    setChecklists((prev) => {
      const current = prev[pickingId] ?? emptyChecklist();
      return {
        ...prev,
        [pickingId]: { ...current, [itemName]: { ...current[itemName], ...patch } },
      };
    });
  }

  async function handleSubmit(pickingId: string) {
    const result = results[pickingId] ?? "PASS";
    const targetLocationId = targetLocationIds[pickingId] ?? "";

    if (result !== "PASS" && !targetLocationId) {
      setError("เลือก Target Location (HOLD/REWORK) เมื่อผลไม่ใช่ PASS");
      return;
    }

    const checklist = getChecklist(pickingId);
    const payload = OQC_CHECKLIST_ITEMS.map((item) => ({
      item_name: item,
      result: checklist[item].result,
      note: checklist[item].note || null,
    }));

    setSubmitting(pickingId);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.rpc("confirm_oqc", {
      p_picking_id: pickingId,
      p_result: result,
      p_checklist: payload,
      p_target_location_id: result !== "PASS" ? targetLocationId : null,
    });

    setSubmitting(null);

    if (error) {
      setError(error.message);
      return;
    }

    const { data: oqc } = await supabase
      .from("oqc_inspections")
      .select("id, oqc_no, picking_id, so_id, result, inspected_at")
      .eq("id", data)
      .single<OqcInspection>();

    if (oqc) setInspections((prev) => [oqc, ...prev]);
    setItems((prev) => prev.filter((i) => i.picking_id !== pickingId));
  }

  return (
    <div className="flex flex-col gap-4">
      {bySo.size === 0 && (
        <p className="text-sm text-black/50 dark:text-white/50">ไม่มี Picking ที่รอ OQC</p>
      )}

      {Array.from(bySo.entries()).map(([pickingId, lines]) => {
        const checklist = getChecklist(pickingId);
        const result = results[pickingId] ?? "PASS";
        return (
          <div key={pickingId} className="flex flex-col gap-3 rounded-lg border border-black/10 dark:border-white/10 p-3">
            <div className="text-sm font-medium">
              {lines[0].picking_no} — {lines[0].so_no} — {lines[0].customer_code}
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-black/50 dark:text-white/50">
                  <th className="px-2 py-1">Part No.</th>
                  <th className="px-2 py-1">Lot</th>
                  <th className="px-2 py-1">Location</th>
                  <th className="px-2 py-1">Qty</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.lot_id} className="border-t border-black/5 dark:border-white/5">
                    <td className="px-2 py-1">{l.part_no}</td>
                    <td className="px-2 py-1">{l.lot_no}</td>
                    <td className="px-2 py-1">{l.location_code}</td>
                    <td className="px-2 py-1">{l.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {canCreate && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {OQC_CHECKLIST_ITEMS.map((item) => (
                    <div key={item} className="flex items-center gap-2 text-sm">
                      <span className="w-40">{OQC_ITEM_LABELS[item]}</span>
                      <select
                        value={checklist[item].result}
                        onChange={(e) =>
                          updateChecklistItem(pickingId, item, { result: e.target.value as "PASS" | "FAIL" })
                        }
                        className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
                      >
                        <option value="PASS">PASS</option>
                        <option value="FAIL">FAIL</option>
                      </select>
                      <input
                        placeholder="Note"
                        value={checklist[item].note}
                        onChange={(e) => updateChecklistItem(pickingId, item, { note: e.target.value })}
                        className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm flex-1"
                      />
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-1">
                    <label className="text-xs text-black/50 dark:text-white/50">ผลรวม</label>
                    <select
                      value={result}
                      onChange={(e) =>
                        setResults((prev) => ({ ...prev, [pickingId]: e.target.value as OqcResult }))
                      }
                      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
                    >
                      <option value="PASS">PASS</option>
                      <option value="HOLD">HOLD</option>
                      <option value="NG">NG</option>
                    </select>
                  </div>
                  {result !== "PASS" && (
                    <div className="flex flex-col gap-1">
                      <label className="text-xs text-black/50 dark:text-white/50">Target Location (HOLD/REWORK)</label>
                      <select
                        value={targetLocationIds[pickingId] ?? ""}
                        onChange={(e) =>
                          setTargetLocationIds((prev) => ({ ...prev, [pickingId]: e.target.value }))
                        }
                        className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
                      >
                        <option value="">—</option>
                        {targetLocations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.code} ({l.zone_type})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button
                    onClick={() => handleSubmit(pickingId)}
                    disabled={submitting === pickingId}
                    className="rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                  >
                    {submitting === pickingId ? "กำลังบันทึก..." : "Confirm OQC"}
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <h2 className="text-lg font-semibold mb-2">OQC History</h2>
        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
                <th className="px-3 py-2 font-medium">OQC No.</th>
                <th className="px-3 py-2 font-medium">Result</th>
                <th className="px-3 py-2 font-medium">Inspected At</th>
              </tr>
            </thead>
            <tbody>
              {inspections.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-4 text-black/50 dark:text-white/50">
                    ยังไม่มีการตรวจ OQC
                  </td>
                </tr>
              )}
              {inspections.map((o) => (
                <tr key={o.id} className="border-b border-black/5 dark:border-white/5 last:border-0">
                  <td className="px-3 py-2">{o.oqc_no}</td>
                  <td className="px-3 py-2">{o.result}</td>
                  <td className="px-3 py-2">{new Date(o.inspected_at).toLocaleString("th-TH")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
