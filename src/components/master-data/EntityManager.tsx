"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { FieldInput, type FieldDef } from "./Field";

export function EntityManager<T extends Record<string, unknown>>({
  table,
  fields,
  columns,
  initialRows,
  editable,
  emptyLabel,
  formatCell,
}: {
  table: string;
  fields: FieldDef[];
  columns: { key: string; label: string }[];
  initialRows: T[];
  editable: boolean;
  emptyLabel: string;
  formatCell?: (row: T, key: string) => React.ReactNode;
}) {
  const [rows, setRows] = useState(initialRows);
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload: Record<string, unknown> = {};
    for (const f of fields) {
      const raw = form[f.key];
      if (raw === undefined || raw === "") continue;
      payload[f.key] = f.type === "number" ? Number(raw) : raw;
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from(table)
      .insert(payload)
      .select()
      .single();

    setSaving(false);

    if (error) {
      setError(error.message);
      return;
    }

    setRows((prev) => [...prev, data as T]);
    setForm({});
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
              {columns.map((c) => (
                <th key={c.key} className="px-3 py-2 font-medium whitespace-nowrap">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-4 text-black/50 dark:text-white/50">
                  {emptyLabel}
                </td>
              </tr>
            )}
            {rows.map((row, i) => (
              <tr key={i} className="border-b border-black/5 dark:border-white/5 last:border-0">
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-2 whitespace-nowrap">
                    {formatCell ? formatCell(row, c.key) : String(row[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable && (
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 rounded-lg border border-black/10 dark:border-white/10 p-3">
          {fields.map((f) => (
            <div key={f.key} className="flex flex-col gap-1 min-w-[10rem]">
              <label className="text-xs text-black/50 dark:text-white/50">{f.label}</label>
              <FieldInput
                field={f}
                value={form[f.key] ?? ""}
                onChange={(v) => setForm((prev) => ({ ...prev, [f.key]: v }))}
              />
            </div>
          ))}
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {saving ? "กำลังบันทึก..." : "เพิ่ม"}
          </button>
          {error && <span className="text-sm text-red-600 w-full">{error}</span>}
        </form>
      )}
    </div>
  );
}
