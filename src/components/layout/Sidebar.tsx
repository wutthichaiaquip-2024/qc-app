"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { navGroups } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 shrink-0 border-r border-black/10 dark:border-white/10 h-full overflow-y-auto px-3 py-4">
      <div className="px-2 pb-4 text-sm font-semibold tracking-wide">
        AQUIP QC &amp; Inventory
      </div>
      <nav className="flex flex-col gap-4">
        {navGroups.map((group) => (
          <div key={group.label}>
            <div className="px-2 pb-1 text-xs font-medium uppercase text-black/40 dark:text-white/40">
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
                      className={`block rounded-md px-2 py-1.5 text-sm ${
                        active
                          ? "bg-black/[.06] dark:bg-white/[.08] font-medium"
                          : "hover:bg-black/[.04] dark:hover:bg-white/[.06]"
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
