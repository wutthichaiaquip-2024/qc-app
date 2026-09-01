export type ReportType = "STOCK" | "QC" | "SUPPLIER_QUALITY" | "FORECAST" | "TRACEABILITY";
export type ReportFormat = "CSV" | "PDF";

export type StockReportRow = {
  site_code: string;
  location_code: string;
  zone_type: string;
  part_no: string;
  description: string | null;
  lot_no: string;
  qty: number;
  reserved_qty: number;
  available_qty: number;
};

export type QcReportRow = {
  inspection_type: "IQC" | "FG_INSPECTION" | "OQC";
  doc_no: string;
  inspected_at: string;
  part_no: string | null;
  lot_no: string | null;
  qty_pass: number;
  qty_hold: number;
  qty_ng: number;
  result: string;
};

export type SupplierQualityReportRow = {
  supplier_code: string;
  supplier_name: string;
  lots_received: number;
  qty_received: number;
  lots_with_ng: number;
  qty_ng: number;
  ng_rate_pct: number;
};

export type ForecastAccuracyReportRow = {
  customer_code: string;
  part_no: string;
  forecast_month: string;
  forecast_qty: number;
  actual_order_qty: number;
  actual_shipment_qty: number;
  accuracy_pct: number | null;
  bias_pct: number | null;
  variance_qty: number;
};

export type ReportJob = {
  id: string;
  report_type: ReportType;
  format: ReportFormat;
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  file_path: string | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};
