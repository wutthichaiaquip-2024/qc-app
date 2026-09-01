// QR payload format decided in Phase 0/2: versioned JSON carrying just
// an id to look up live in the DB, plus a couple of human-readable
// fields for when the scanner is broken. Never trust qty/status fields
// from a scanned payload for business logic — always re-query by id.
export type BarcodePayload = {
  v: 1;
  type: "ITEM" | "LOT" | "LOCATION" | "PURCHASE_ORDER" | "SHIPMENT" | "SHIPMENT_BOX";
  id: string;
  code: string;
  part_no?: string;
  site?: string;
};

// Serializer side of the same versioned payload — used when printing a
// label's QR code. Deliberately the mirror image of parseBarcodePayload:
// only id/code/part_no/site ever go in, never qty/status.
export function buildBarcodePayload(payload: BarcodePayload): string {
  return JSON.stringify(payload);
}

export function parseBarcodePayload(raw: string): BarcodePayload | null {
  try {
    const obj: unknown = JSON.parse(raw);
    if (
      obj &&
      typeof obj === "object" &&
      (obj as Record<string, unknown>).v === 1 &&
      typeof (obj as Record<string, unknown>).type === "string" &&
      typeof (obj as Record<string, unknown>).id === "string"
    ) {
      return obj as BarcodePayload;
    }
  } catch {
    // not a QR JSON payload — caller should fall back to plain-code matching
  }
  return null;
}
