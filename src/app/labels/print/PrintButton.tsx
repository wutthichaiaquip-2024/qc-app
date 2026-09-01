"use client";

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-medium print:hidden"
    >
      พิมพ์ป้าย
    </button>
  );
}
