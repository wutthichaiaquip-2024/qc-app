export type LabelType = "LOT" | "LOCATION" | "SHIPMENT_BOX";

export type LotLabelData = {
  lot_id: string;
  lot_no: string;
  part_no: string;
  description: string | null;
};

export type LocationLabelData = {
  location_id: string;
  code: string;
  name: string | null;
  zone_type: string;
  site_code: string;
};

export type ShipmentBoxLabelData = {
  box_id: string;
  box_no: number;
  shipment_id: string;
  shipment_no: string;
  so_no: string;
  customer_code: string;
};
