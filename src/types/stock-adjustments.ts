export type StockPosition = {
  lot_id: string;
  location_id: string;
  lot_no: string;
  part_no: string;
  location_code: string;
  qty: number;
};

export type StockAdjustment = {
  id: string;
  adjustment_no: string;
  lot_no: string;
  part_no: string;
  location_code: string;
  qty_delta: number;
  reason: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  requested_at: string;
  decided_at: string | null;
  decision_note: string | null;
};
