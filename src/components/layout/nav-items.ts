export type NavItem = {
  label: string;
  href: string;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

// Grouped by the operational flow in the master spec (section 2.1), not by
// Phase number — this is what a user sees walking through their workday.
export const navGroups: NavGroup[] = [
  {
    label: "ภาพรวม",
    items: [{ label: "Dashboard", href: "/" }],
  },
  {
    label: "วางแผน",
    items: [
      { label: "Customer Forecast", href: "/forecast" },
      { label: "Demand & Stock Planning", href: "/planning" },
      { label: "Forecast Accuracy", href: "/forecast-accuracy" },
    ],
  },
  {
    label: "จัดซื้อ & รับของ",
    items: [
      { label: "Purchase Orders", href: "/purchase-orders" },
      { label: "Receiving", href: "/receiving" },
    ],
  },
  {
    label: "QC",
    items: [
      { label: "Incoming QC (IQC)", href: "/iqc" },
      { label: "WIP Stock", href: "/wip-stock" },
      { label: "WIP Request", href: "/wip-requests" },
      { label: "FG Inspection", href: "/fg-inspection" },
      { label: "OQC / Final QC", href: "/oqc" },
    ],
  },
  {
    label: "ขาย & จัดส่ง",
    items: [
      { label: "FG Stock", href: "/fg-stock" },
      { label: "Sales Orders", href: "/sales-orders" },
      { label: "Stock Allocation", href: "/allocation" },
      { label: "Picking", href: "/picking" },
      { label: "Packing & Shipping", href: "/shipping" },
    ],
  },
  {
    label: "ข้อมูลอ้างอิง",
    items: [
      { label: "Traceability", href: "/traceability" },
      { label: "Reports", href: "/reports" },
      { label: "Stock Adjustments", href: "/stock-adjustments" },
      { label: "Master Data", href: "/master-data" },
      { label: "Users & Permissions", href: "/settings/users" },
    ],
  },
];
