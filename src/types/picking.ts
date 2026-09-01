export type PickingQueueItem = {
  allocation_id: string;
  so_id: string;
  so_no: string;
  customer_code: string;
  so_line_id: string;
  item_id: string;
  part_no: string;
  lot_id: string;
  lot_no: string;
  location_id: string;
  location_code: string;
  qty: number;
};

export type Picking = {
  id: string;
  picking_no: string;
  so_id: string;
  picked_at: string;
};
