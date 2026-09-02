"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Item, Location } from "@/types/master-data";
import type { RlsAuditRow } from "@/types/data-migration";
import { CsvImportPanel } from "./CsvImportPanel";

export function DataMigrationManager({
  role,
  canImportMasterData,
  canImportOpeningBalance,
  items,
  locations,
}: {
  role: string;
  canImportMasterData: boolean;
  canImportOpeningBalance: boolean;
  items: Item[];
  locations: Location[];
}) {
  const [auditRows, setAuditRows] = useState<RlsAuditRow[] | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const partNos = new Set(items.map((i) => i.part_no));
  const locationCodes = new Set(locations.map((l) => l.code));

  async function runRpc(fn: string, rows: Record<string, string>[]): Promise<number> {
    const supabase = createClient();
    const { data, error } = await supabase.rpc(fn, { p_rows: rows });
    if (error) throw new Error(error.message);
    return data as number;
  }

  async function runAudit() {
    setAuditLoading(true);
    setAuditError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("audit_rls_coverage");
    setAuditLoading(false);
    if (error) {
      setAuditError(error.message);
      return;
    }
    setAuditRows(data as RlsAuditRow[]);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Master Data Import</h2>
        {!canImportMasterData && (
          <p className="text-sm text-black/50 dark:text-white/50">
            Role &quot;{role}&quot; ไม่มีสิทธิ์ master_data.create — ติดต่อ ADMIN
          </p>
        )}
        {canImportMasterData && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <CsvImportPanel
              title="Customers"
              description="ลูกค้า"
              columns={[
                { key: "code", label: "Code", required: true },
                { key: "name", label: "Name", required: true },
                { key: "type", label: "Type" },
                { key: "contact_name", label: "Contact Name" },
                { key: "contact_phone", label: "Contact Phone" },
                { key: "contact_email", label: "Contact Email" },
              ]}
              onSubmit={(rows) => runRpc("import_customers", rows)}
            />
            <CsvImportPanel
              title="Suppliers"
              description="ผู้จำหน่าย"
              columns={[
                { key: "code", label: "Code", required: true },
                { key: "name", label: "Name", required: true },
                { key: "contact_name", label: "Contact Name" },
                { key: "contact_phone", label: "Contact Phone" },
                { key: "contact_email", label: "Contact Email" },
                { key: "lead_time_days", label: "Lead Time (days)" },
              ]}
              onSubmit={(rows) => runRpc("import_suppliers", rows)}
            />
            <CsvImportPanel
              title="Locations"
              description="ต้องมี Site (site_code) อยู่ในระบบก่อน"
              columns={[
                { key: "site_code", label: "Site Code", required: true },
                { key: "code", label: "Code", required: true },
                { key: "name", label: "Name" },
                { key: "zone_type", label: "Zone Type", required: true },
                { key: "physical_address", label: "Physical Address" },
              ]}
              onSubmit={(rows) => runRpc("import_locations", rows)}
            />
            <CsvImportPanel
              title="Items"
              description="customer_code/supplier_code ต้องมีอยู่แล้ว (เว้นว่างได้ถ้าไม่มี)"
              columns={[
                { key: "part_no", label: "Part No.", required: true },
                { key: "description", label: "Description" },
                { key: "base_uom", label: "Base UoM", required: true },
                { key: "purchase_uom", label: "Purchase UoM", required: true },
                { key: "uom_conversion_factor", label: "UoM Factor" },
                { key: "customer_code", label: "Customer Code" },
                { key: "supplier_code", label: "Supplier Code" },
                { key: "safety_stock", label: "Safety Stock" },
                { key: "moq", label: "MOQ" },
                { key: "lead_time_days", label: "Lead Time (days)" },
              ]}
              onSubmit={(rows) => runRpc("import_items", rows)}
            />
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Opening Stock Balance</h2>
        {!canImportOpeningBalance && (
          <p className="text-sm text-black/50 dark:text-white/50">
            Role &quot;{role}&quot; ไม่มีสิทธิ์ stock_adjustments.approve — Opening Balance เขียน ledger จริง
            จึงต้องมีสิทธิ์ระดับผู้อนุมัติ
          </p>
        )}
        {canImportOpeningBalance && (
          <CsvImportPanel
            title="Opening Stock Balance"
            description="part_no และ location_code ต้องมีอยู่แล้วใน Master Data — lot_no เว้นว่างได้ (ระบบจะออกเลขให้อัตโนมัติ) แต่ละแถวสร้าง Lot ใหม่ + OPENING_BALANCE ledger entry จริง แก้ไขย้อนหลังไม่ได้ (ต้องออก Stock Adjustment ใหม่)"
            columns={[
              { key: "part_no", label: "Part No.", required: true },
              { key: "lot_no", label: "Lot No. (optional)" },
              { key: "location_code", label: "Location Code", required: true },
              { key: "qty", label: "Qty", required: true },
            ]}
            validateRow={(row) => {
              if (!partNos.has(row.part_no)) return `ไม่พบ part_no "${row.part_no}" ใน Item Master`;
              if (!locationCodes.has(row.location_code)) return `ไม่พบ location_code "${row.location_code}"`;
              const qty = Number(row.qty);
              if (!Number.isFinite(qty) || qty <= 0) return "qty ต้องเป็นตัวเลข > 0";
              return null;
            }}
            onSubmit={(rows) => runRpc("import_opening_balance", rows)}
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">RLS Coverage Audit</h2>
        <p className="text-sm text-black/50 dark:text-white/50">
          ตรวจสอบว่าทุกตารางเปิด Row Level Security และมี Policy ก่อน Go-live (ADMIN เท่านั้น)
        </p>
        <button
          onClick={runAudit}
          disabled={auditLoading}
          className="self-start rounded-md border border-black/15 dark:border-white/15 px-3 py-1.5 text-sm hover:bg-black/5 dark:hover:bg-white/10 disabled:opacity-50"
        >
          {auditLoading ? "กำลังตรวจสอบ..." : "รัน RLS Audit"}
        </button>
        {auditError && <p className="text-sm text-red-600">{auditError}</p>}
        {auditRows && (
          <div className="overflow-x-auto rounded-lg border border-black/10 dark:border-white/10 max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black/10 dark:border-white/10 text-left text-black/50 dark:text-white/50">
                  <th className="px-3 py-2 font-medium">Table</th>
                  <th className="px-3 py-2 font-medium">RLS Enabled</th>
                  <th className="px-3 py-2 font-medium">Policy Count</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((r) => {
                  const flagged = !r.rls_enabled || r.policy_count === 0;
                  return (
                    <tr key={r.table_name} className="border-b border-black/5 dark:border-white/5 last:border-0">
                      <td className="px-3 py-2">{r.table_name}</td>
                      <td className={`px-3 py-2 ${r.rls_enabled ? "" : "text-red-600 font-medium"}`}>
                        {r.rls_enabled ? "Yes" : "NO"}
                      </td>
                      <td className={`px-3 py-2 ${flagged ? "text-amber-600" : ""}`}>{r.policy_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
