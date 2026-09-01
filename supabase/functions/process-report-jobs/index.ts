// Phase 21: background worker for report exports.
//
// Invoked every minute by pg_cron (via pg_net) — see the
// "process-report-jobs-every-minute" cron job in
// supabase/migrations/0027_reports.sql. Unlike Phase 20's
// send-notifications (which needs third-party SMTP/LINE credentials
// this environment doesn't have), this function only calls this same
// Supabase project's own Storage API, so it IS deployed and IS tested
// end-to-end: report_jobs go PENDING -> PROCESSING -> DONE/FAILED with
// a real file landing in the report-exports bucket.
//
// Picks up PENDING report_jobs, fetches the report's data via the
// service_role-only get_report_export_data() RPC (permission was
// already checked once, for real, when the job was created), renders
// CSV or a simple paginated PDF, uploads it to
// report-exports/<requested_by>/<job id>.<ext>, and marks the job
// DONE (with file_path) or FAILED (with error).

import { createClient } from "jsr:@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "npm:pdf-lib@1.17.1";

const BATCH_SIZE = 5;

type ReportJob = {
  id: string;
  requested_by: string;
  report_type: string;
  format: "CSV" | "PDF";
  filters: Record<string, unknown>;
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: jobs, error } = await supabase
    .from("report_jobs")
    .select("id, requested_by, report_type, format, filters")
    .eq("status", "PENDING")
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE)
    .returns<ReportJob[]>();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let done = 0;
  let failed = 0;

  for (const job of jobs ?? []) {
    await supabase.from("report_jobs").update({ status: "PROCESSING" }).eq("id", job.id);
    try {
      const { data: exportData, error: rpcError } = await supabase.rpc("get_report_export_data", {
        p_report_type: job.report_type,
        p_filters: job.filters ?? {},
      });
      if (rpcError) throw new Error(rpcError.message);

      const rows = toRows(exportData);
      const ext = job.format === "CSV" ? "csv" : "pdf";
      const path = `${job.requested_by}/${job.id}.${ext}`;
      const body = job.format === "CSV" ? toCsv(rows) : await toPdf(job.report_type, rows);
      const contentType = job.format === "CSV" ? "text/csv" : "application/pdf";

      const { error: uploadError } = await supabase.storage
        .from("report-exports")
        .upload(path, body, { contentType, upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      await supabase
        .from("report_jobs")
        .update({ status: "DONE", file_path: path, completed_at: new Date().toISOString() })
        .eq("id", job.id);
      done++;
    } catch (err) {
      await supabase
        .from("report_jobs")
        .update({ status: "FAILED", error: String(err), completed_at: new Date().toISOString() })
        .eq("id", job.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ done, failed }), {
    headers: { "content-type": "application/json" },
  });
});

// get_report_export_data() returns a jsonb array (Stock/QC/Supplier
// Quality/Forecast) or a single nested jsonb object (Traceability's
// genealogy tree) — flatten the latter into Field/Value rows so both
// shapes render the same way in CSV/PDF.
function toRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data as Record<string, unknown>[];
  }
  if (data && typeof data === "object") {
    const rows: Record<string, unknown>[] = [];
    flatten(data as Record<string, unknown>, "", rows);
    return rows;
  }
  return [];
}

function flatten(obj: Record<string, unknown>, prefix: string, out: Record<string, unknown>[]) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value as Record<string, unknown>, path, out);
    } else if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push({ Field: path, Value: "" });
      }
      value.forEach((item, i) => {
        if (item && typeof item === "object") {
          flatten(item as Record<string, unknown>, `${path}[${i}]`, out);
        } else {
          out.push({ Field: `${path}[${i}]`, Value: String(item) });
        }
      });
    } else {
      out.push({ Field: path, Value: value === null || value === undefined ? "" : String(value) });
    }
  }
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const columns = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escape(row[c])).join(","));
  }
  return lines.join("\n");
}

async function toPdf(title: string, rows: Record<string, unknown>[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const pageWidth = 792; // US Letter landscape
  const pageHeight = 612;
  const margin = 30;
  const rowHeight = 16;
  const fontSize = 8;

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  const colWidth = columns.length > 0 ? (pageWidth - margin * 2) / columns.length : pageWidth - margin * 2;

  let page = doc.addPage([pageWidth, pageHeight]);
  let y = pageHeight - margin;

  function drawHeader() {
    page.drawText(`Report: ${title}`, { x: margin, y, size: 12, font: boldFont });
    y -= 16;
    page.drawText(`Generated: ${new Date().toISOString()}`, { x: margin, y, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
    y -= 20;
    columns.forEach((c, i) => {
      page.drawText(truncate(c, colWidth, font, fontSize), { x: margin + i * colWidth, y, size: fontSize, font: boldFont });
    });
    y -= rowHeight;
  }

  drawHeader();

  if (rows.length === 0) {
    page.drawText("(no data)", { x: margin, y, size: fontSize, font });
  }

  for (const row of rows) {
    if (y < margin + rowHeight) {
      page = doc.addPage([pageWidth, pageHeight]);
      y = pageHeight - margin;
      drawHeader();
    }
    columns.forEach((c, i) => {
      const text = truncate(row[c] === null || row[c] === undefined ? "" : String(row[c]), colWidth, font, fontSize);
      page.drawText(text, { x: margin + i * colWidth, y, size: fontSize, font });
    });
    y -= rowHeight;
  }

  return doc.save();
}

function truncate(text: string, maxWidth: number, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, fontSize: number): string {
  let result = text;
  while (result.length > 0 && font.widthOfTextAtSize(result, fontSize) > maxWidth - 4) {
    result = result.slice(0, -1);
  }
  return result;
}
