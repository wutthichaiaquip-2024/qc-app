"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroups } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-surface h-full overflow-y-auto px-3 py-4">
      <div className="flex items-center gap-2 px-2 pb-5">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-brand-foreground text-xs font-bold">
          AQ
        </span>
        <span className="text-sm font-semibold tracking-tight text-foreground">AQUIP QC &amp; Inventory</span>
      </div>
      <nav className="flex flex-col gap-5">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">
              {group.label}
            </div>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const active =
                  item.href === "/"
                    ? pathname === "/"
                    : pathname.startsWith(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`relative block rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                        active
                          ? "bg-brand-muted font-medium text-brand"
                          : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
