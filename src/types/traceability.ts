export type LotGenealogy = {
  lot_id: string;
  lot_no: string;
  part_no: string;
  upstream_receiving: {
    gr_no: string;
    received_date: string;
    po_no: string;
    po_date: string;
    supplier_code: string;
    supplier_name: string;
  } | null;
  iqc_results: {
    iqc_no: string;
    inspected_at: string;
    qty_pass: number;
    qty_hold: number;
    qty_ng: number;
  }[];
  downstream_wip_requests: {
    request_no: string;
    requested_qty: number;
    fg_no: string | null;
    new_lot_id: string | null;
    new_lot_no: string | null;
    qty_pass: number | null;
    qty_hold: number | null;
    qty_ng: number | null;
  }[];
  downstream_allocations: {
    so_no: string;
    customer_code: string;
    qty: number;
    status: string;
    picking_no: string | null;
    oqc_no: string | null;
    oqc_result: string | null;
    shipment_no: string | null;
    shipped_at: string | null;
  }[];
  upstream_source_lot: LotGenealogy | null;
};
