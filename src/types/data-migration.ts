export type CustomerImportRow = {
  code: string;
  name: string;
  type?: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
};

export type SupplierImportRow = {
  code: string;
  name: string;
  contact_name?: string;
  contact_phone?: string;
  contact_email?: string;
  lead_time_days?: string;
};

export type LocationImportRow = {
  site_code: string;
  code: string;
  name?: string;
  zone_type: string;
  physical_address?: string;
};

export type ItemImportRow = {
  part_no: string;
  description?: string;
  base_uom: string;
  purchase_uom: string;
  uom_conversion_factor?: string;
  customer_code?: string;
  supplier_code?: string;
  safety_stock?: string;
  moq?: string;
  lead_time_days?: string;
};

export type OpeningBalanceRow = {
  part_no: string;
  lot_no?: string;
  location_code: string;
  qty: number;
};

export type RlsAuditRow = {
  table_name: string;
  rls_enabled: boolean;
  policy_count: number;
};
