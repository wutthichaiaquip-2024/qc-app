import { ReportsManager } from "./ReportsManager";
import { PageHeader } from "@/components/ui/PageHeader";

export default function ReportsPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" description="รายงาน Stock, QC, Supplier Quality, Forecast, Traceability — Export CSV/PDF ทำงานเป็น background job (สร้างคำขอแล้วรอผลด้านล่าง ไม่ต้องรอหน้าจอค้าง)" />

      <ReportsManager />
    </div>
  );
}
