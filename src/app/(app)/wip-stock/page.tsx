import { createClient } from "@/lib/supabase/server";
import type { WipStockRow } from "@/types/wip-stock";
import { WipStockTable } from "./WipStockTable";

export default async function WipStockPage() {
  const supabase = await createClient();

  const { data } = await supabase.rpc("get_wip_stock");
  const rows = (data ?? []) as WipStockRow[];

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">WIP Stock</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          สต็อกที่ผ่าน IQC แล้วอยู่ในคลังพักงานระหว่างผลิต — คลิกแถวเพื่อดู Traceability
        </p>
      </div>

      <WipStockTable rows={rows} />
    </div>
  );
}
