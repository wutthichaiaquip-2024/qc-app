export type WipRequestStatus = "PENDING" | "CONFIRMED" | "CANCELLED";

export type WipRequest = {
  id: string;
  request_no: string;
  item_id: string;
  wip_lot_id: string;
  wip_location_id: string;
  requested_qty: number;
  inspection_plan_id: string | null;
  purpose: string | null;
  request_date: string;
  status: WipRequestStatus;
};
