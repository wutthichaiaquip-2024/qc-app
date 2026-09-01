"use client";

import { useState } from "react";

// A dedicated USB/Bluetooth barcode scanner behaves like a keyboard:
// it types the decoded value then sends Enter. This input is built for
// that hardware (real warehouse setup), not a phone camera — it also
// works fine for manual typing/testing.
export function ScanInput({
  onScan,
  placeholder,
}: {
  onScan: (code: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");

  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && value.trim()) {
          e.preventDefault();
          onScan(value.trim());
          setValue("");
        }
      }}
      placeholder={placeholder ?? "สแกนบาร์โค้ด/QR หรือพิมพ์แล้วกด Enter"}
      className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-2 py-1 text-sm"
    />
  );
}
