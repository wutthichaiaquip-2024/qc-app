"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function RefreshButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh() {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.rpc("refresh_stock_planning");

    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={handleRefresh}
        disabled={loading}
        className="rounded-md border border-black/15 dark:border-white/15 px-3 py-1.5 text-sm disabled:opacity-50"
      >
        {loading ? "กำลังคำนวณ..." : "Refresh now"}
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </div>
  );
}
