"use client";

import { useState } from "react";

export function Tabs({
  tabs,
}: {
  tabs: { key: string; label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.key);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 border-b border-black/10 dark:border-white/10">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setActive(t.key)}
            className={`px-3 py-2 text-sm border-b-2 -mb-px ${
              active === t.key
                ? "border-black dark:border-white font-medium"
                : "border-transparent text-black/50 dark:text-white/50 hover:text-black dark:hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.find((t) => t.key === active)?.content}
    </div>
  );
}
