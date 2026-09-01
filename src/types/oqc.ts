export const OQC_CHECKLIST_ITEMS = [
  "APPEARANCE",
  "PACKAGING",
  "LABEL",
  "CUSTOMER_REQUIREMENT",
  "CERTIFICATE",
  "PACKING_LIST",
] as const;
export type OqcChecklistItemName = (typeof OQC_CHECKLIST_ITEMS)[number];

export const OQC_ITEM_LABELS: Record<OqcChecklistItemName, string> = {
  APPEARANCE: "Appearance",
  PACKAGING: "Packaging",
  LABEL: "Label",
  CUSTOMER_REQUIREMENT: "Customer Requirement",
  CERTIFICATE: "Certificate",
  PACKING_LIST: "Packing List",
};

export type OqcResult = "PASS" | "HOLD" | "NG";

export type OqcQueueItem = {
  picking_id: string;
  picking_no: string;
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

export type OqcInspection = {
  id: string;
  oqc_no: string;
  picking_id: string;
  so_id: string;
  result: OqcResult;
  inspected_at: string;
};
