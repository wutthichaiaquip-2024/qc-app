export type SalesOrderStatus = "OPEN" | "CANCELLED";

export type SalesOrder = {
  id: string;
  so_no: string;
  customer_id: string;
  order_date: string;
  required_date: string | null;
  status: SalesOrderStatus;
  created_at: string;
};

export type SalesOrderLine = {
  id: string;
  so_id: string;
  line_no: number;
  item_id: string;
  qty: number;
  delivery_date: string | null;
};
