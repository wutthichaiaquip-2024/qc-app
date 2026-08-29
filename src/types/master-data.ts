export type MasterStatus = "ACTIVE" | "INACTIVE";

export type Customer = {
  id: string;
  code: string;
  name: string;
  type: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  status: MasterStatus;
};

export type Supplier = {
  id: string;
  code: string;
  name: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  lead_time_days: number | null;
  rating: number | null;
  status: MasterStatus;
};

export type Item = {
  id: string;
  part_no: string;
  description: string | null;
  brand: string | null;
  category: string | null;
  base_uom: string;
  purchase_uom: string;
  uom_conversion_factor: number;
  customer_id: string | null;
  supplier_id: string | null;
  safety_stock: number;
  moq: number | null;
  lead_time_days: number | null;
  barcode_value: string | null;
  status: MasterStatus;
};

export const ZONE_TYPES = ["INCOMING", "WIP", "FG", "HOLD", "NG", "REWORK", "RETURN"] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export type Site = {
  id: string;
  code: string;
  name: string;
  status: MasterStatus;
};

export type Location = {
  id: string;
  site_id: string;
  code: string;
  name: string | null;
  zone_type: ZoneType;
  physical_address: string | null;
  barcode_value: string | null;
  status: MasterStatus;
};

export const SAMPLING_STANDARDS = ["ISO_2859_1", "ANSI_Z1_4"] as const;
export type SamplingStandard = (typeof SAMPLING_STANDARDS)[number];

export const INSPECTION_LEVELS = ["S1", "S2", "S3", "S4", "I", "II", "III"] as const;
export type InspectionLevel = (typeof INSPECTION_LEVELS)[number];

export type InspectionPlanStatus = "DRAFT" | "ACTIVE" | "SUPERSEDED";

export type InspectionPlan = {
  id: string;
  item_id: string;
  sampling_standard: SamplingStandard;
  inspection_level: InspectionLevel;
  aql: number;
  effective_date: string;
  revision_no: number;
  status: InspectionPlanStatus;
};

export type AqlSamplingPlan = {
  standard: SamplingStandard;
  code_letter: string;
  aql: number;
  sample_size: number;
  accept_no: number;
  reject_no: number;
};
