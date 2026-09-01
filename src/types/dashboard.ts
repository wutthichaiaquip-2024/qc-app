export type WarehouseDashboard = {
  wip_qty: number;
  fg_qty: number;
  hold_qty: number;
  ng_qty: number;
  pending_wip_requests: number;
  pending_allocations: number;
  pending_oqc: number;
  ready_to_ship: number;
  refreshed_at: string;
};

export type QcDashboard = {
  pending_iqc_lots: number;
  pending_fg_inspection: number;
  pending_oqc: number;
  iqc_pass_qty_30d: number;
  iqc_hold_qty_30d: number;
  iqc_ng_qty_30d: number;
  fg_pass_qty_30d: number;
  fg_hold_qty_30d: number;
  fg_ng_qty_30d: number;
  oqc_pass_count_30d: number;
  oqc_fail_count_30d: number;
  refreshed_at: string;
};

export type PlanningDashboard = {
  green_count: number;
  yellow_count: number;
  red_count: number;
  total_purchase_requirement_qty: number;
  refreshed_at: string;
};

export type ManagementDashboard = {
  open_po_count: number;
  open_po_value: number;
  open_so_count: number;
  total_fg_qty: number;
  shipments_30d_count: number;
  iqc_pass_rate_30d: number | null;
  oqc_pass_rate_30d: number | null;
  refreshed_at: string;
};
