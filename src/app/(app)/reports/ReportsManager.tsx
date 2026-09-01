"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { ReportFormat, ReportJob, ReportType } from "@/types/reports";

const REPORT_TYPES: { key: ReportType; label: string }[] = [
  { key: "STOCK", label: "Stock" },
  { key: "QC", label: "QC" },
  { key: "SUPPLIER_QUALITY", label: "Supplier Quality" },
  { key: "FORECAST", label: "Forecast" },
  { key: "TRACEABILITY", label: "Traceability" },
];

const STATUS_LABEL: Record<ReportJob["status"], string> = {
  PENDING: "รอดำเนินการ",
  PROCESSING: "กำลังสร้างไฟล์...",
  DONE: "พร้อมดาวน์โหลด",
  FAILED: "ล้มเหลว",
};

const COLUMNS: Record<ReportType, { key: string; label: string }[]> = {
  STOCK: [
    { key: "site_code", label: "Site" },
    { key: "location_code", label: "Location" },
    { key: "zone_type", label: "Zone" },
    { key: "part_no", label: "Part No." },
    { key: "lot_no", label: "Lot No." },
    { key: "qty", label: "Qty" },
    { key: "reserved_qty", label: "Reserved" },
    { key: "available_qty", label: "Available" },
  ],
  QC: [
    { key: "inspection_type", label: "ประเภท" },
    { key: "doc_no", label: "เลขที่เอกสาร" },
    { key: "inspected_at", label: "วันที่ตรวจ" },
    { key: "part_no", label: "Part No." },
    { key: "lot_no", label: "Lot No." },
    { key: "qty_pass", label: "Pass" },
    { key: "qty_hold", label: "Hold" },
    { key: "qty_ng", label: "NG" },
    { key: "result", label: "ผล" },
  ],
  SUPPLIER_QUALITY: [
    { key: "supplier_code", label: "Supplier" },
    { key: "supplier_name", label: "ชื่อ Supplier" },
    { key: "lots_received", label: "Lot รับเข้า" },
    { key: "qty_received", label: "Qty รับเข้า" },
    { key: "lots_with_ng", label: "Lot มี NG" },
    { key: "qty_ng", label: "Qty NG" },
    { key: "ng_rate_pct", label: "NG Rate %" },
  ],
  FORECAST: [
    { key: "customer_code", label: "Customer" },
    { key: "part_no", label: "Part No." },
    { key: "forecast_month", label: "เดือน" },
    { key: "forecast_qty", label: "Forecast" },
    { key: "actual_order_qty", label: "Actual Order" },
    { key: "actual_shipment_qty", label: "Actual Shipment" },
    { key: "accuracy_pct", label: "Accuracy %" },
    { key: "bias_pct", label: "Bias %" },
    { key: "variance_qty", label: "Variance" },
  ],
  TRACEABILITY: [],
};

const RPC_BY_TYPE: Record<ReportType, string | null> = {
  STOCK: "get_stock_report",
  QC: "get_qc_report",
  SUPPLIER_QUALITY: "get_supplier_quality_report",
  FORECAST: "get_forecast_accuracy",
  TRACEABILITY: null,
};

function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function formatCell(v: unknown) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

export function ReportsManager() {
  const [reportType, setReportType] = useState<ReportType>("STOCK");
  const [from, setFrom] = useState(todayStr(-30));
  const [to, setTo] = useState(todayStr());
  const [lotNo, setLotNo] = useState("");

  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const [jobs, setJobs] = useState<ReportJob[]>([]);

  // Nested `load`/`run` functions (not top-level setState calls in the
  // effect body itself) — same shape as NotificationBell.tsx, which
  // avoids the react-hooks/set-state-in-effect lint rule.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.rpc("get_my_report_jobs");
      if (!cancelled && data) setJobs(data as ReportJob[]);
    }
    load();
    const interval = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setRows([]);
      setPreviewError(null);
      const rpcName = RPC_BY_TYPE[reportType];
      if (!rpcName) return;

      setLoading(true);
      const supabase = createClient();
      const args =
        reportType === "QC" || reportType === "SUPPLIER_QUALITY" ? { p_from: from, p_to: to } : undefined;
      const { data, error } = await supabase.rpc(rpcName, args);
      if (cancelled) return;

      if (error) {
        setPreviewError(error.message);
      } else {
        setRows((data ?? []) as Record<string, unknown>[]);
      }
      setLoading(false);
    }
    run();
    return () => {
      cancelled = true;
    };
    // Only re-run when the report type changes — date range changes are picked up by the explicit "ดูตัวอย่าง" button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType]);

  async function loadPreview() {
    const rpcName = RPC_BY_TYPE[reportType];
    if (!rpcName) return;

    setLoading(true);
    setPreviewError(null);

    const supabase = createClient();
    const args =
      reportType === "QC" || reportType === "SUPPLIER_QUALITY" ? { p_from: from, p_to: to } : undefined;
    const { data, error } = await supabase.rpc(rpcName, args);

    if (error) {
      setPreviewError(error.message);
      setRows([]);
    } else {
      setRows((data ?? []) as Record<string, unknown>[]);
    }
    setLoading(false);
  }

  async function loadJobs() {
    const supabase = createClient();
    const { data } = await supabase.rpc("get_my_report_jobs");
    if (data) setJobs(data as ReportJob[]);
  }

  async function exportReport(format: ReportFormat) {
    if (reportType === "TRACEABILITY" && !lotNo.trim()) {
      alert("กรุณาระบุ Lot No.");
      return;
    }

    const filters =
      reportType === "QC" || reportType === "SUPPLIER_QUALITY"
        ? { from, to }
        : reportType === "TRACEABILITY"
          ? { lot_no: lotNo.trim() }
          : {};

    const supabase = createClient();
    const { error } = await supabase.rpc("create_report_job", {
      p_report_type: reportType,
      p_format: format,
      p_filters: filters,
    });
    if (error) {
      alert(error.message);
      return;
    }
    loadJobs();
  }

  async function download(job: ReportJob) {
    if (!job.file_path) return;
    const supabase = createClient();
    const { data, error } = await supabase.storage.from("report-exports").createSignedUrl(job.file_path, 300);
    if (error || !data) {
      alert(error?.message ?? "ไม่พบไฟล์");
      return;
    }
    window.open(data.signedUrl, "_blank");
  }

  const columns = COLUMNS[reportType];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 border-b border-black/10 dark:border-white/10">
        {REPORT_TYPES.map((t) => (
          <button
            key={t.key}
            onClick={() => setReportType(t.key)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${
              reportType === t.key
                ? "border-black dark:border-white font-medium"
                : "border-transparent text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        {(reportType === "QC" || reportType === "SUPPLIER_QUALITY") && (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-black/50 dark:text-white/50">จากวันที่</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-black/50 dark:text-white/50">ถึงวันที่</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
              />
            </div>
            <button
              onClick={loadPreview}
              className="rounded-md border border-black/15 dark:border-white/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10"
            >
              ดูตัวอย่าง
            </button>
          </>
        )}

        {reportType === "TRACEABILITY" && (
          <div className="flex flex-col gap-1 max-w-sm">
            <label className="text-xs text-black/50 dark:text-white/50">Lot No. (สำหรับ Export)</label>
            <input
              value={lotNo}
              onChange={(e) => setLotNo(e.target.value)}
              placeholder="เช่น LOT-2026-00001"
              className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
            />
            <p className="text-xs text-black/40 dark:text-white/40">
              ดู genealogy แบบเต็มได้ที่หน้า{" "}
              <Link href="/traceability" className="underline">
                Traceability
              </Link>
            </p>
          </div>
        )}

        <div className="flex gap-2 ml-auto">
          <button
            onClick={() => exportReport("CSV")}
            className="rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm"
          >
            Export CSV
          </button>
          <button
            onClick={() => exportReport("PDF")}
            className="rounded-md border border-black/15 dark:border-white/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            Export PDF
          </button>
        </div>
      </div>

      {reportType !== "TRACEABILITY" && (
        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
                {columns.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-4 text-black/50 dark:text-white/50">
                    กำลังโหลด...
                  </td>
                </tr>
              )}
              {!loading && previewError && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-4 text-red-600">
                    {previewError}
                  </td>
                </tr>
              )}
              {!loading && !previewError && rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-4 text-black/50 dark:text-white/50">
                    ยังไม่มีข้อมูล
                  </td>
                </tr>
              )}
              {!loading &&
                rows.map((r, i) => (
                  <tr key={i} className="border-b border-black/5 dark:border-white/5 last:border-0">
                    {columns.map((c) => (
                      <td key={c.key} className="px-3 py-2">
                        {formatCell(r[c.key])}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-medium">ไฟล์ Export</h2>
        <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
                <th className="px-3 py-2 font-medium">Report</th>
                <th className="px-3 py-2 font-medium">Format</th>
                <th className="px-3 py-2 font-medium">สถานะ</th>
                <th className="px-3 py-2 font-medium">เวลา</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {jobs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-4 text-black/50 dark:text-white/50">
                    ยังไม่มีคำขอ Export
                  </td>
                </tr>
              )}
              {jobs.map((j) => (
                <tr key={j.id} className="border-b border-black/5 dark:border-white/5 last:border-0">
                  <td className="px-3 py-2">{REPORT_TYPES.find((t) => t.key === j.report_type)?.label ?? j.report_type}</td>
                  <td className="px-3 py-2">{j.format}</td>
                  <td className="px-3 py-2">
                    {j.status === "FAILED" ? (
                      <span className="text-red-600" title={j.error ?? ""}>
                        {STATUS_LABEL[j.status]}
                      </span>
                    ) : (
                      STATUS_LABEL[j.status]
                    )}
                  </td>
                  <td className="px-3 py-2">{new Date(j.created_at).toLocaleString("th-TH")}</td>
                  <td className="px-3 py-2">
                    {j.status === "DONE" && (
                      <button onClick={() => download(j)} className="underline text-sm">
                        ดาวน์โหลด
                      </button>
                    )}
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
