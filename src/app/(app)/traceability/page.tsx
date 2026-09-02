import { TraceabilityViewer } from "./TraceabilityViewer";
import { PageHeader } from "@/components/ui/PageHeader";

export default function TraceabilityPage() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Traceability" description="สแกน/พิมพ์ Lot No. เพื่อดู genealogy ทั้งสองทิศทาง (ย้อนกลับไป Supplier / ไปข้างหน้าถึงลูกค้า)" />

      <TraceabilityViewer />
    </div>
  );
}
