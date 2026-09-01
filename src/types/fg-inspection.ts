export const INSPECTION_MODES = ["SAMPLING", "FULL"] as const;
export type InspectionMode = (typeof INSPECTION_MODES)[number];

export const MEASUREMENT_METHODS = ["COUNT", "WEIGHT"] as const;
export type MeasurementMethod = (typeof MEASUREMENT_METHODS)[number];

export type FgInspection = {
  id: string;
  fg_no: string;
  wip_request_id: string;
  item_id: string;
  new_lot_id: string;
  inspection_mode: InspectionMode;
  measurement_method: MeasurementMethod;
  lot_size: number;
  sample_size: number | null;
  qty_pass: number;
  qty_hold: number;
  qty_ng: number;
  started_at: string | null;
  completed_at: string;
};

export type ItemDocument = {
  id: string;
  item_id: string;
  doc_type: "WORK_INSTRUCTION" | "PACKING_STD";
  title: string;
  file_path: string;
  file_name: string;
  uploaded_at: string;
};
