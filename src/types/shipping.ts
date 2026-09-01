export type ShippingQueueItem = {
  allocation_id: string;
  so_id: string;
  so_no: string;
  customer_code: string;
  item_id: string;
  part_no: string;
  lot_id: string;
  lot_no: string;
  location_id: string;
  location_code: string;
  qty: number;
};

export type Shipment = {
  id: string;
  shipment_no: string;
  so_id: string;
  shipped_at: string;
};

export type ShipmentBox = {
  id: string;
  shipment_id: string;
  box_no: number;
};
