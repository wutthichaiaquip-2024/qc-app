export const ALLOCATION_METHODS = ["FIFO", "FEFO", "MANUAL"] as const;
export type AllocationMethod = (typeof ALLOCATION_METHODS)[number];

export type Allocation = {
  id: string;
  so_line_id: string;
  lot_id: string;
  location_id: string;
  qty: number;
  method: AllocationMethod;
  status: "ACTIVE" | "RELEASED";
  allocated_at: string;
};

export type OpenSoLine = {
  so_line_id: string;
  so_id: string;
  so_no: string;
  customer_code: string;
  site_id: string;
  item_id: string;
  part_no: string;
  qty: number;
  allocated_qty: number;
  remaining_qty: number;
};
