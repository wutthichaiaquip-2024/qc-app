export const FORECAST_STATUSES = ["DRAFT", "SUBMITTED", "APPROVED", "REVISED", "CANCELLED"] as const;
export type ForecastStatus = (typeof FORECAST_STATUSES)[number];

export type ForecastBatch = {
  id: string;
  forecast_no: string;
  customer_id: string;
  revision_no: number;
  status: ForecastStatus;
  created_at: string;
};

export type ForecastLine = {
  id: string;
  batch_id: string;
  item_id: string;
  forecast_month: string;
  forecast_qty: number;
  version: number;
};

export const FORECAST_TRANSITIONS: Record<ForecastStatus, ForecastStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["APPROVED", "DRAFT", "CANCELLED"],
  APPROVED: ["REVISED", "CANCELLED"],
  REVISED: [],
  CANCELLED: [],
};
