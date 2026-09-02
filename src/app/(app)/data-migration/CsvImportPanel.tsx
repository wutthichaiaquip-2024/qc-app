"use client";

import { useRef, useState } from "react";
import { parseCsv } from "@/lib/csv";

export type ImportColumn = { key: string; label: string; required?: boolean };

// Generic CSV-upload-then-bulk-submit panel — same shape as Phase 3's
// forecast CSV import (parse -> client validate -> preview -> one RPC
// call with the whole batch), reused here for every Master
// Data/Opening Balance import instead of repeating the same
// file-parsing UI 5 times.
export function CsvImportPanel({
  title,
  description,
  columns,
  onSubmit,
  validateRow,
}: {
  title: string;
  description: string;
  columns: ImportColumn[];
  onSubmit: (rows: Record<string, string>[]) => Promise<number>;
  /** Optional extra validation beyond "required column is non-empty" — return an error string to reject the row. */
  validateRow?: (row: Record<string, string>) => string | null;
}) {
  const [preview, setPreview] = useState<Record<string, string>[] | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setParseError(null);
    setSubmitError(null);
    setResult(null);
    setPreview(null);

    file.text().then((text) => {
      const rows = parseCsv(text);
      if (rows.length < 2) {
        setParseError("ไฟล์ต้องมี header + อย่างน้อย 1 แถวข้อมูล");
        return;
      }

      const header = rows[0].map((h) => h.trim().toLowerCase());
      const indices = columns.map((c) => header.indexOf(c.key));
      const missing = columns.filter((_, i) => indices[i] === -1);
      if (missing.length > 0) {
        setParseError(`Header ขาดคอลัมน์: ${missing.map((c) => c.key).join(", ")}`);
        return;
      }

      const drafts: Record<string, string>[] = [];
      const errors: string[] = [];

      rows.slice(1).forEach((r, i) => {
        const draft: Record<string, string> = {};
        columns.forEach((c, ci) => {
          draft[c.key] = (r[indices[ci]] ?? "").trim();
        });

        const missingRequired = columns.filter((c) => c.required && !draft[c.key]);
        if (missingRequired.length > 0) {
          errors.push(`แถว ${i + 2}: ขาดข้อมูล ${missingRequired.map((c) => c.label).join(", ")}`);
          return;
        }

        const customError = validateRow?.(draft);
        if (customError) {
          errors.push(`แถว ${i + 2}: ${customError}`);
          return;
        }

        drafts.push(draft);
      });

      if (errors.length > 0) {
        setParseError(errors.join("\n"));
        return;
      }

      setPreview(drafts);
    });
  }

  async function handleSubmit() {
    if (!preview || preview.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);

    try {
      const count = await onSubmit(preview);
      setResult(count);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-black/10 dark:border-white/10 p-3">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="text-xs text-black/50 dark:text-white/50">{description}</p>
        <p className="text-xs text-black/40 dark:text-white/40 mt-1">
          Header: {columns.map((c) => c.key).join(", ")}
        </p>
      </div>

      <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} className="text-sm" />

      {parseError && <pre className="text-sm text-red-600 whitespace-pre-wrap">{parseError}</pre>}

      {preview && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-black/50 dark:text-white/50">
            Preview {preview.length} แถว — ตรวจสอบก่อนกด Import (ถ้ามีแถวใดผิดพลาด จะไม่มีข้อมูลเข้าตารางเลยทั้งไฟล์)
          </p>
          <div className="overflow-x-auto rounded-md border border-black/10 dark:border-white/10 max-h-48 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-black/50 dark:text-white/50">
                  {columns.map((c) => (
                    <th key={c.key} className="px-2 py-1 whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i} className="border-t border-black/5 dark:border-white/5">
                    {columns.map((c) => (
                      <td key={c.key} className="px-2 py-1 whitespace-nowrap">
                        {r[c.key] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="self-start rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {submitting ? "กำลัง Import..." : `Import ${preview.length} แถว`}
          </button>
          {submitError && <p className="text-sm text-red-600">{submitError}</p>}
        </div>
      )}

      {result !== null && <p className="text-sm text-green-600">Import สำเร็จ {result} แถว</p>}
    </div>
  );
}
