export type ForecastAccuracyRow = {
  customer_id: string;
  customer_code: string;
  item_id: string;
  part_no: string;
  forecast_month: string;
  forecast_qty: number;
  actual_order_qty: number;
  actual_shipment_qty: number;
  accuracy_pct: number | null;
  bias_pct: number | null;
  variance_qty: number;
};
