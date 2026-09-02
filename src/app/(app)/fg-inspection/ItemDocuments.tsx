"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Item } from "@/types/master-data";
import type { ItemDocument } from "@/types/fg-inspection";
import { FileInput } from "@/components/ui/FileInput";

export function ItemDocuments({
  items,
  initialDocs,
  canCreate,
}: {
  items: Item[];
  initialDocs: ItemDocument[];
  canCreate: boolean;
}) {
  const [docs, setDocs] = useState(initialDocs);
  const [itemId, setItemId] = useState("");
  const [docType, setDocType] = useState<"WORK_INSTRUCTION" | "PACKING_STD">("WORK_INSTRUCTION");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});

  const partNo = (id: string) => items.find((i) => i.id === id)?.part_no ?? "—";
  const filtered = itemId ? docs.filter((d) => d.item_id === itemId) : docs;

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const fileInput = document.getElementById("item-doc-file") as HTMLInputElement;
    const file = fileInput?.files?.[0];
    if (!itemId || !title || !file) {
      setError("เลือก Item, ใส่ชื่อเอกสาร, และเลือกไฟล์");
      return;
    }

    const supabase = createClient();
    const path = `${itemId}/${crypto.randomUUID()}-${file.name}`;

    const { error: uploadError } = await supabase.storage.from("item-documents").upload(path, file);
    if (uploadError) {
      setError(uploadError.message);
      return;
    }

    const { data, error } = await supabase
      .from("item_documents")
      .insert({ item_id: itemId, doc_type: docType, title, file_path: path, file_name: file.name })
      .select()
      .single<ItemDocument>();

    if (error) {
      setError(error.message);
      return;
    }

    setDocs((prev) => [data, ...prev]);
    setTitle("");
    fileInput.value = "";
  }

  async function getUrl(doc: ItemDocument) {
    if (urls[doc.id]) return;
    const supabase = createClient();
    const { data } = await supabase.storage.from("item-documents").createSignedUrl(doc.file_path, 300);
    if (data) setUrls((prev) => ({ ...prev, [doc.id]: data.signedUrl }));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1 max-w-xs">
        <label className="text-xs text-foreground-muted">สแกน/เลือก Part No. เพื่อกรอง</label>
        <select
          value={itemId}
          onChange={(e) => setItemId(e.target.value)}
          className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
        >
          <option value="">— ทั้งหมด —</option>
          {items.map((i) => (
            <option key={i.id} value={i.id}>
              {i.part_no}
            </option>
          ))}
        </select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-foreground-muted">
              <th className="px-3 py-2 font-medium">Part No.</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Title</th>
              <th className="px-3 py-2 font-medium">File</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-foreground-muted">
                  ไม่มีเอกสาร
                </td>
              </tr>
            )}
            {filtered.map((d) => (
              <tr key={d.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">{partNo(d.item_id)}</td>
                <td className="px-3 py-2">{d.doc_type}</td>
                <td className="px-3 py-2">{d.title}</td>
                <td className="px-3 py-2">
                  {urls[d.id] ? (
                    <a href={urls[d.id]} target="_blank" rel="noreferrer" className="underline">
                      {d.file_name}
                    </a>
                  ) : (
                    <button onClick={() => getUrl(d)} className="underline text-foreground-muted">
                      {d.file_name}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canCreate && (
        <form onSubmit={handleUpload} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3">
          <select
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
          >
            <option value="">Part No.</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.part_no}
              </option>
            ))}
          </select>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value as "WORK_INSTRUCTION" | "PACKING_STD")}
            className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
          >
            <option value="WORK_INSTRUCTION">Work Instruction</option>
            <option value="PACKING_STD">Packing Std.</option>
          </select>
          <input
            placeholder="ชื่อเอกสาร"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-md border border-border-strong bg-transparent px-2 py-1 text-sm"
          />
          <FileInput id="item-doc-file" accept=".pdf,.png,.jpg,.jpeg" />
          <button
            type="submit"
            className="rounded-md bg-brand text-brand-foreground hover:brightness-110 px-3 py-1.5 text-sm font-medium"
          >
            อัปโหลด
          </button>
          {error && <span className="text-sm text-danger w-full">{error}</span>}
        </form>
      )}
    </div>
  );
}
