import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type {
  Customer,
  Supplier,
  Item,
  Site,
  Location,
  InspectionPlan,
  AqlSamplingPlan,
} from "@/types/master-data";
import { ZONE_TYPES, SAMPLING_STANDARDS, INSPECTION_LEVELS } from "@/types/master-data";
import { EntityManager } from "@/components/master-data/EntityManager";
import { Tabs } from "./Tabs";

export default async function MasterDataPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: currentProfile } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("id", user?.id ?? "")
    .single<Pick<UserProfile, "role">>();

  const { data: perm } = await supabase
    .from("role_permissions")
    .select("can_create")
    .eq("role", currentProfile?.role ?? "")
    .eq("module", "master_data")
    .maybeSingle<{ can_create: boolean }>();

  const editable = perm?.can_create ?? false;

  const [customers, suppliers, items, sites, locations, inspectionPlans, aqlPlans] =
    await Promise.all([
      supabase.from("customers").select("*").order("code").returns<Customer[]>(),
      supabase.from("suppliers").select("*").order("code").returns<Supplier[]>(),
      supabase.from("items").select("*").order("part_no").returns<Item[]>(),
      supabase.from("sites").select("*").order("code").returns<Site[]>(),
      supabase.from("locations").select("*").order("code").returns<Location[]>(),
      supabase
        .from("inspection_plans")
        .select("*")
        .order("effective_date", { ascending: false })
        .returns<InspectionPlan[]>(),
      supabase
        .from("aql_sampling_plans")
        .select("*")
        .order("code_letter")
        .returns<AqlSamplingPlan[]>(),
    ]);

  const customerRows = customers.data ?? [];
  const supplierRows = suppliers.data ?? [];
  const itemRows = items.data ?? [];
  const siteRows = sites.data ?? [];
  const locationRows = locations.data ?? [];
  const inspectionPlanRows = inspectionPlans.data ?? [];
  const aqlPlanRows = aqlPlans.data ?? [];

  const customerIdToCode = Object.fromEntries(customerRows.map((c) => [c.id, c.code]));
  const supplierIdToCode = Object.fromEntries(supplierRows.map((s) => [s.id, s.code]));
  const siteIdToCode = Object.fromEntries(siteRows.map((s) => [s.id, s.code]));
  const itemIdToPartNo = Object.fromEntries(itemRows.map((i) => [i.id, i.part_no]));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Master Data</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          Customer, Supplier, Item, Location, Inspection Plan
        </p>
      </div>

      <Tabs
        tabs={[
          {
            key: "customers",
            label: "Customer",
            content: (
              <EntityManager<Customer>
                table="customers"
                editable={editable}
                emptyLabel="ยังไม่มีข้อมูลลูกค้า"
                columns={[
                  { key: "code", label: "Code" },
                  { key: "name", label: "Name" },
                  { key: "type", label: "Type" },
                  { key: "contact_name", label: "Contact" },
                  { key: "status", label: "Status" },
                ]}
                initialRows={customerRows}
                fields={[
                  { key: "code", label: "Code", type: "text", required: true },
                  { key: "name", label: "Name", type: "text", required: true },
                  { key: "type", label: "Type", type: "text" },
                  { key: "contact_name", label: "Contact name", type: "text" },
                  { key: "contact_phone", label: "Contact phone", type: "text" },
                  { key: "contact_email", label: "Contact email", type: "text" },
                ]}
              />
            ),
          },
          {
            key: "suppliers",
            label: "Supplier",
            content: (
              <EntityManager<Supplier>
                table="suppliers"
                editable={editable}
                emptyLabel="ยังไม่มีข้อมูล supplier"
                columns={[
                  { key: "code", label: "Code" },
                  { key: "name", label: "Name" },
                  { key: "contact_name", label: "Contact" },
                  { key: "lead_time_days", label: "Lead time (days)" },
                  { key: "rating", label: "Rating" },
                  { key: "status", label: "Status" },
                ]}
                initialRows={supplierRows}
                fields={[
                  { key: "code", label: "Code", type: "text", required: true },
                  { key: "name", label: "Name", type: "text", required: true },
                  { key: "contact_name", label: "Contact name", type: "text" },
                  { key: "contact_phone", label: "Contact phone", type: "text" },
                  { key: "contact_email", label: "Contact email", type: "text" },
                  { key: "lead_time_days", label: "Lead time (days)", type: "number" },
                  { key: "rating", label: "Rating (1-5)", type: "number" },
                ]}
              />
            ),
          },
          {
            key: "items",
            label: "Item",
            content: (
              <EntityManager<Item>
                table="items"
                editable={editable}
                emptyLabel="ยังไม่มีข้อมูล item"
                columns={[
                  { key: "part_no", label: "Part No." },
                  { key: "description", label: "Description" },
                  { key: "base_uom", label: "Base UoM" },
                  { key: "purchase_uom", label: "Purchase UoM" },
                  { key: "customer_id", label: "Customer" },
                  { key: "supplier_id", label: "Supplier" },
                  { key: "safety_stock", label: "Safety Stock" },
                  { key: "status", label: "Status" },
                ]}
                initialRows={itemRows}
                cellLabelMaps={{ customer_id: customerIdToCode, supplier_id: supplierIdToCode }}
                fields={[
                  { key: "part_no", label: "Part No.", type: "text", required: true },
                  { key: "description", label: "Description", type: "text" },
                  { key: "brand", label: "Brand", type: "text" },
                  { key: "category", label: "Category", type: "text" },
                  { key: "base_uom", label: "Base UoM", type: "text", required: true },
                  { key: "purchase_uom", label: "Purchase UoM", type: "text", required: true },
                  { key: "uom_conversion_factor", label: "UoM factor", type: "number", step: "0.0001" },
                  {
                    key: "customer_id",
                    label: "Customer",
                    type: "select",
                    options: customerRows.map((c) => ({ value: c.id, label: c.code })),
                  },
                  {
                    key: "supplier_id",
                    label: "Supplier",
                    type: "select",
                    options: supplierRows.map((s) => ({ value: s.id, label: s.code })),
                  },
                  { key: "safety_stock", label: "Safety Stock", type: "number" },
                  { key: "moq", label: "MOQ", type: "number" },
                  { key: "lead_time_days", label: "Lead time (days)", type: "number" },
                  { key: "barcode_value", label: "Barcode value", type: "text" },
                ]}
              />
            ),
          },
          {
            key: "locations",
            label: "Location",
            content: (
              <EntityManager<Location>
                table="locations"
                editable={editable}
                emptyLabel="ยังไม่มีข้อมูล location"
                columns={[
                  { key: "site_id", label: "Site" },
                  { key: "code", label: "Code" },
                  { key: "name", label: "Name" },
                  { key: "zone_type", label: "Zone" },
                  { key: "physical_address", label: "Physical" },
                  { key: "status", label: "Status" },
                ]}
                initialRows={locationRows}
                cellLabelMaps={{ site_id: siteIdToCode }}
                fields={[
                  {
                    key: "site_id",
                    label: "Site",
                    type: "select",
                    required: true,
                    options: siteRows.map((s) => ({ value: s.id, label: s.code })),
                  },
                  { key: "code", label: "Code", type: "text", required: true },
                  { key: "name", label: "Name", type: "text" },
                  {
                    key: "zone_type",
                    label: "Zone type",
                    type: "select",
                    required: true,
                    options: ZONE_TYPES.map((z) => ({ value: z, label: z })),
                  },
                  { key: "physical_address", label: "Physical location", type: "text" },
                  { key: "barcode_value", label: "Barcode value", type: "text" },
                ]}
              />
            ),
          },
          {
            key: "inspection_plans",
            label: "Inspection Plan",
            content: (
              <EntityManager<InspectionPlan>
                table="inspection_plans"
                editable={editable}
                emptyLabel="ยังไม่มี Inspection Plan"
                columns={[
                  { key: "item_id", label: "Item" },
                  { key: "sampling_standard", label: "Standard" },
                  { key: "inspection_level", label: "Level" },
                  { key: "aql", label: "AQL" },
                  { key: "effective_date", label: "Effective" },
                  { key: "revision_no", label: "Rev." },
                  { key: "status", label: "Status" },
                ]}
                initialRows={inspectionPlanRows}
                cellLabelMaps={{ item_id: itemIdToPartNo }}
                fields={[
                  {
                    key: "item_id",
                    label: "Item",
                    type: "select",
                    required: true,
                    options: itemRows.map((i) => ({ value: i.id, label: i.part_no })),
                  },
                  {
                    key: "sampling_standard",
                    label: "Standard",
                    type: "select",
                    required: true,
                    options: SAMPLING_STANDARDS.map((s) => ({ value: s, label: s })),
                  },
                  {
                    key: "inspection_level",
                    label: "Level",
                    type: "select",
                    required: true,
                    options: INSPECTION_LEVELS.map((l) => ({ value: l, label: l })),
                  },
                  { key: "aql", label: "AQL", type: "number", step: "0.01", required: true },
                  { key: "effective_date", label: "Effective date", type: "date", required: true },
                  {
                    key: "status",
                    label: "Status",
                    type: "select",
                    options: [
                      { value: "DRAFT", label: "DRAFT" },
                      { value: "ACTIVE", label: "ACTIVE" },
                      { value: "SUPERSEDED", label: "SUPERSEDED" },
                    ],
                  },
                ]}
              />
            ),
          },
          {
            key: "aql_table",
            label: "AQL Sampling Table",
            content: (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-amber-600 dark:text-amber-500">
                  ตารางนี้กำหนดผล accept/reject ของการตรวจจริง — กรอกค่าจากเอกสารมาตรฐาน ISO
                  2859-1 / ANSI Z1.4 ฉบับจริงที่บริษัทถืออยู่เท่านั้น ห้ามเดา
                </p>
                <EntityManager<AqlSamplingPlan>
                  table="aql_sampling_plans"
                  editable={editable}
                  emptyLabel="ยังไม่มีข้อมูล — กรอกจากเอกสารมาตรฐานฉบับจริง"
                  columns={[
                    { key: "standard", label: "Standard" },
                    { key: "code_letter", label: "Code Letter" },
                    { key: "aql", label: "AQL" },
                    { key: "sample_size", label: "Sample Size" },
                    { key: "accept_no", label: "Accept (Ac)" },
                    { key: "reject_no", label: "Reject (Re)" },
                  ]}
                  initialRows={aqlPlanRows}
                  fields={[
                    {
                      key: "standard",
                      label: "Standard",
                      type: "select",
                      required: true,
                      options: SAMPLING_STANDARDS.map((s) => ({ value: s, label: s })),
                    },
                    { key: "code_letter", label: "Code Letter", type: "text", required: true },
                    { key: "aql", label: "AQL", type: "number", step: "0.01", required: true },
                    { key: "sample_size", label: "Sample Size", type: "number", required: true },
                    { key: "accept_no", label: "Accept (Ac)", type: "number", required: true },
                    { key: "reject_no", label: "Reject (Re)", type: "number", required: true },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}
