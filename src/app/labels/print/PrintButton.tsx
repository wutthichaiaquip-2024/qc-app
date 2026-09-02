"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md bg-brand text-brand-foreground hover:brightness-110 px-4 py-2 text-sm font-medium print:hidden"
    >
      พิมพ์ป้าย
    </button>
  );
}
