export type FgStockRow = {
  lot_id: string;
  lot_no: string;
  item_id: string;
  part_no: string;
  location_id: string;
  location_code: string;
  qty: number;
  reserved_qty: number;
  available_qty: number;
  fg_inspection_id: string | null;
  fg_no: string | null;
  inspected_at: string | null;
};
