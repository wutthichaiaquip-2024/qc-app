"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { NotificationRow } from "@/types/notifications";

const POLL_MS = 60_000;

export function NotificationBell() {
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const { data } = await supabase.rpc("get_my_notifications");
      if (!cancelled && data) setItems(data as NotificationRow[]);
    }

    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  const unreadCount = items.filter((n) => !n.read_at).length;

  async function markRead(id: string) {
    const supabase = createClient();
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)),
    );
    await supabase.rpc("mark_notification_read", { p_notification_id: id });
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-md p-1.5 hover:bg-surface-muted"
        aria-label="การแจ้งเตือน"
      >
        <BellIcon />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-lg border border-border bg-white dark:bg-neutral-900 shadow-lg">
          <div className="border-b border-border px-3 py-2 text-sm font-medium">
            การแจ้งเตือน
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-3 py-4 text-sm text-foreground-muted">ไม่มีการแจ้งเตือน</p>
            )}
            {items.map((n) => {
              const content = (
                <div
                  className={`px-3 py-2 text-sm border-b border-border last:border-0 ${
                    n.read_at ? "" : "bg-brand-muted"
                  }`}
                >
                  <div className="font-medium">{n.title}</div>
                  <div className="text-foreground-muted">{n.message}</div>
                  <div className="mt-0.5 text-xs text-foreground-muted">
                    {new Date(n.created_at).toLocaleString("th-TH")}
                  </div>
                </div>
              );
              return (
                <div key={n.id} onClick={() => !n.read_at && markRead(n.id)}>
                  {n.link ? (
                    <Link href={n.link} onClick={() => setOpen(false)}>
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
