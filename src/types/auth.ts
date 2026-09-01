export const APP_ROLES = [
  "ADMIN",
  "MANAGEMENT",
  "PLANNING",
  "PURCHASING",
  "WAREHOUSE",
  "QC",
  "SALES",
] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const MODULES = [
  "dashboard",
  "forecast",
  "planning",
  "purchase_orders",
  "receiving",
  "iqc",
  "wip_stock",
  "fg_inspection",
  "oqc",
  "fg_stock",
  "sales_orders",
  "allocation",
  "picking",
  "shipping",
  "traceability",
  "reports",
  "master_data",
  "users_permissions",
  "stock_adjustments",
] as const;

export type Module = (typeof MODULES)[number];

export type UserStatus = "PENDING" | "ACTIVE" | "INACTIVE";

export type UserProfile = {
  id: string;
  full_name: string | null;
  role: AppRole | null;
  status: UserStatus;
  created_at: string;
  updated_at: string;
};

export type RolePermission = {
  role: AppRole;
  module: Module;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_approve: boolean;
  can_reject: boolean;
  can_delete: boolean;
};
