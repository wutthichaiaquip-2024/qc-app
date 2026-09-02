import { createClient } from "@/lib/supabase/server";
import type { UserProfile } from "@/types/auth";
import type { Shipment, ShipmentBox, ShippingQueueItem } from "@/types/shipping";
import { ShippingManager } from "./ShippingManager";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function ShippingPage() {
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
    .eq("module", "shipping")
    .maybeSingle<{ can_create: boolean }>();

  const [queueRes, shipmentsRes] = await Promise.all([
    supabase.rpc("get_shipping_queue"),
    supabase
      .from("shipments")
      .select("id, shipment_no, so_id, shipped_at")
      .order("shipped_at", { ascending: false })
      .returns<Shipment[]>(),
  ]);

  const shipmentIds = (shipmentsRes.data ?? []).map((s) => s.id);
  const boxesRes =
    shipmentIds.length > 0
      ? await supabase
          .from("shipment_boxes")
          .select("id, shipment_id, box_no")
          .in("shipment_id", shipmentIds)
          .order("box_no")
          .returns<ShipmentBox[]>()
      : { data: [] as ShipmentBox[] };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Packing & Shipping" description="จัดของลงกล่อง → Confirm Shipment ตัดสต็อกออกจากระบบจริง" />

      <ShippingManager
        queue={(queueRes.data ?? []) as ShippingQueueItem[]}
        initialShipments={shipmentsRes.data ?? []}
        boxes={boxesRes.data ?? []}
        canCreate={perm?.can_create ?? false}
      />
    </div>
  );
}
