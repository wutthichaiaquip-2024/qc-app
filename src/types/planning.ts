export type StockPlanningStatus = "GREEN" | "YELLOW" | "RED";

export type StockPlanningRow = {
  item_id: string;
  calculated_at: string;
  forecast_qty: number;
  customer_order_qty: number;
  fg_stock_qty: number;
  wip_stock_qty: number;
  incoming_qty: number;
  open_po_qty: number;
  safety_stock: number;
  lead_time_days: number | null;
  projected_stock: number;
  shortage_qty: number;
  surplus_qty: number;
  purchase_requirement_qty: number;
  status: StockPlanningStatus;
};
