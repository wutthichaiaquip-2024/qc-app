import { TraceabilityViewer } from "./TraceabilityViewer";

export default function TraceabilityPage() {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Traceability</h1>
        <p className="text-sm text-black/50 dark:text-white/50">
          สแกน/พิมพ์ Lot No. เพื่อดู genealogy ทั้งสองทิศทาง (ย้อนกลับไป Supplier / ไปข้างหน้าถึงลูกค้า)
        </p>
      </div>

      <TraceabilityViewer />
    </div>
  );
}
