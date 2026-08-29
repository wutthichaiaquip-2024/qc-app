import type { UserProfile } from "@/types/auth";
import { SignOutButton } from "./SignOutButton";

const STATUS_LABEL: Record<UserProfile["status"], string> = {
  PENDING: "รออนุมัติสิทธิ์",
  ACTIVE: "ใช้งานได้",
  INACTIVE: "ปิดใช้งาน",
};

export function Header({
  email,
  profile,
}: {
  email: string;
  profile: UserProfile | null;
}) {
  return (
    <header className="h-14 shrink-0 border-b border-black/10 dark:border-white/10 flex items-center justify-between px-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-black/50 dark:text-white/50">Site:</span>
        {/* Site switcher wires up once Location Master (Phase 2) exists. */}
        <span className="font-medium">— select site —</span>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <div className="flex flex-col items-end leading-tight">
          <span className="font-medium">{profile?.full_name || email}</span>
          <span className="text-xs text-black/50 dark:text-white/50">
            {profile?.role ?? STATUS_LABEL[profile?.status ?? "PENDING"]}
          </span>
        </div>
        <SignOutButton />
      </div>
    </header>
  );
}
