import { ReportsManager } from "./ReportsManager";

export default function ReportsPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Reports</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          รายงาน Stock, QC, Supplier Quality, Forecast, Traceability — Export CSV/PDF ทำงานเป็น background job
          (สร้างคำขอแล้วรอผลด้านล่าง ไม่ต้องรอหน้าจอค้าง)
        </p>
      </div>

      <ReportsManager />
    </div>
  );
}
