export const PO_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "CONFIRMED",
  "PARTIAL_RECEIVED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export type PurchaseOrder = {
  id: string;
  po_no: string;
  supplier_id: string;
  po_date: string;
  currency: string;
  delivery_date: string | null;
  status: PoStatus;
  barcode_value: string | null;
  created_at: string;
};

export type PurchaseOrderLine = {
  id: string;
  po_id: string;
  line_no: number;
  item_id: string;
  qty: number;
  unit: string;
  unit_price: number;
  required_date: string | null;
  eta: string | null;
  technical_spec: string | null;
};

export type PoLineAttachment = {
  id: string;
  line_id: string;
  file_path: string;
  file_name: string;
  file_size: number | null;
  content_type: string | null;
  uploaded_at: string;
};

// PARTIAL_RECEIVED / COMPLETED are set by Phase 6 (Receiving), not
// reachable through the manual status-transition UI.
export const PO_TRANSITIONS: Record<PoStatus, PoStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["CONFIRMED", "DRAFT", "CANCELLED"],
  CONFIRMED: ["CANCELLED"],
  PARTIAL_RECEIVED: [],
  COMPLETED: [],
  CANCELLED: [],
};
