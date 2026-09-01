export type WipStockRow = {
  lot_id: string;
  lot_no: string;
  item_id: string;
  part_no: string;
  location_id: string;
  location_code: string;
  qty: number;
  iqc_id: string | null;
  iqc_no: string | null;
  iqc_date: string | null;
};

export type LotTraceability = {
  lot_no: string;
  part_no: string;
  iqc_no: string | null;
  iqc_date: string | null;
  iqc_qty_pass: number | null;
  iqc_qty_hold: number | null;
  iqc_qty_ng: number | null;
  gr_no: string | null;
  received_date: string | null;
  po_no: string | null;
  po_date: string | null;
  supplier_code: string | null;
  supplier_name: string | null;
};
