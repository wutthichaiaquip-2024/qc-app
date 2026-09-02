import { createClient } from "@/lib/supabase/server";
import type { WipStockRow } from "@/types/wip-stock";
import { WipStockTable } from "./WipStockTable";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function WipStockPage() {
  const supabase = await createClient();

  const { data } = await supabase.rpc("get_wip_stock");
  const rows = (data ?? []) as WipStockRow[];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="WIP Stock" description="สต็อกที่ผ่าน IQC แล้วอยู่ในคลังพักงานระหว่างผลิต — คลิกแถวเพื่อดู Traceability" />

      <WipStockTable rows={rows} />
    </div>
  );
}
