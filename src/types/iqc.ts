export type DefectCode = {
  id: string;
  code: string;
  description: string;
  status: "ACTIVE" | "INACTIVE";
};

export type IqcInspection = {
  id: string;
  iqc_no: string;
  lot_id: string;
  inspection_plan_id: string | null;
  lot_size: number;
  sample_size: number | null;
  accept_no: number | null;
  reject_no: number | null;
  qty_pass: number;
  qty_hold: number;
  qty_ng: number;
  inspected_at: string;
};

export type PendingLot = {
  lot_id: string;
  lot_no: string;
  item_id: string;
  part_no: string;
  incoming_location_id: string;
  incoming_location_code: string;
  site_id: string;
  qty: number;
};

export type SampleSizePlanPreview = {
  inspection_plan_id: string | null;
  sampling_standard: string | null;
  inspection_level: string | null;
  aql: number | null;
  code_letter: string | null;
  sample_size: number | null;
  accept_no: number | null;
  reject_no: number | null;
};
