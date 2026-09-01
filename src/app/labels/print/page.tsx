import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { buildBarcodePayload } from "@/lib/barcode";
import type { LabelType, LotLabelData, LocationLabelData, ShipmentBoxLabelData } from "@/types/labels";
import { PrintButton } from "./PrintButton";

const LABEL_TYPES: LabelType[] = ["LOT", "LOCATION", "SHIPMENT_BOX"];

export default async function LabelPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; id?: string }>;
}) {
  const { type, id } = await searchParams;

  if (!type || !id || !LABEL_TYPES.includes(type as LabelType)) {
    notFound();
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_label_data", { p_type: type, p_id: id });

  if (error || !data) {
    return (
      <div className="p-6 text-sm text-red-600">
        ไม่สามารถโหลดข้อมูลป้ายได้: {error?.message ?? "ไม่พบข้อมูล"}
      </div>
    );
  }

  const labelType = type as LabelType;
  const { qrDataUrl, lines, title } = await buildLabel(labelType, data);

  return (
    <div className="min-h-screen flex flex-col items-center gap-4 p-6 print:p-0 print:gap-0 bg-white text-black">
      <div className="print:hidden">
        <PrintButton />
      </div>

      <div className="label-card flex flex-col items-center gap-2 border border-black/20 rounded-lg p-4 print:border-0 print:rounded-none">
        <div className="text-sm font-semibold">{title}</div>
        {/* eslint-disable-next-line @next/next/no-img-element -- data: URI, not an optimizable remote/local asset */}
        <img src={qrDataUrl} alt="QR code" width={160} height={160} />
        <div className="flex flex-col items-center gap-0.5 text-xs">
          {lines.map(([label, value]) => (
            <div key={label}>
              <span className="text-black/50">{label}: </span>
              <span className="font-medium">{value}</span>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media print {
          @page { size: 100mm 60mm; margin: 4mm; }
          body { background: white; }
          .label-card { width: 92mm; }
        }
      `}</style>
    </div>
  );
}

async function buildLabel(
  type: LabelType,
  data: unknown,
): Promise<{ qrDataUrl: string; lines: [string, string][]; title: string }> {
  if (type === "LOT") {
    const d = data as LotLabelData;
    const qrDataUrl = await QRCode.toDataURL(
      buildBarcodePayload({ v: 1, type: "LOT", id: d.lot_id, code: d.lot_no, part_no: d.part_no }),
    );
    return {
      qrDataUrl,
      title: "Lot Label",
      lines: [
        ["Part No.", d.part_no],
        ["Lot No.", d.lot_no],
        ...(d.description ? ([["Desc.", d.description]] as [string, string][]) : []),
      ],
    };
  }

  if (type === "LOCATION") {
    const d = data as LocationLabelData;
    const qrDataUrl = await QRCode.toDataURL(
      buildBarcodePayload({ v: 1, type: "LOCATION", id: d.location_id, code: d.code, site: d.site_code }),
    );
    return {
      qrDataUrl,
      title: "Location Label",
      lines: [
        ["Site", d.site_code],
        ["Location", d.code],
        ["Zone", d.zone_type],
        ...(d.name ? ([["Name", d.name]] as [string, string][]) : []),
      ],
    };
  }

  const d = data as ShipmentBoxLabelData;
  const code = `${d.shipment_no}-BOX${d.box_no}`;
  const qrDataUrl = await QRCode.toDataURL(
    buildBarcodePayload({ v: 1, type: "SHIPMENT_BOX", id: d.box_id, code }),
  );
  return {
    qrDataUrl,
    title: "Shipment Box Label",
    lines: [
      ["Shipment", d.shipment_no],
      ["Box No.", String(d.box_no)],
      ["SO", d.so_no],
      ["Customer", d.customer_code],
    ],
  };
}
