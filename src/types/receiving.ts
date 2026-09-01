export type GoodsReceipt = {
  id: string;
  gr_no: string;
  po_id: string;
  received_date: string;
  created_at: string;
};

export type GoodsReceiptLine = {
  id: string;
  gr_id: string;
  po_line_id: string;
  item_id: string;
  qty_received: number;
  lot_id: string;
  location_id: string;
};

export type Lot = {
  id: string;
  lot_no: string;
  item_id: string;
};
