export function Header() {
  return (
    <header className="h-14 shrink-0 border-b border-black/10 dark:border-white/10 flex items-center justify-between px-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-black/50 dark:text-white/50">Site:</span>
        {/* Site switcher wires up once Location Master (Phase 2) and
            site-scoped RLS (Phase 1) exist. */}
        <span className="font-medium">— select site —</span>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <span className="text-black/50 dark:text-white/50">— not signed in —</span>
      </div>
    </header>
  );
}
