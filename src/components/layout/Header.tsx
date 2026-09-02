import type { UserProfile } from "@/types/auth";
import { SignOutButton } from "./SignOutButton";
import { NotificationBell } from "./NotificationBell";
import { Badge } from "@/components/ui/Badge";

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
    <header className="h-14 shrink-0 border-b border-border bg-surface flex items-center justify-between px-4">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-foreground-muted">Site:</span>
        {/* Site switcher wires up once Location Master (Phase 2) exists. */}
        <span className="font-medium text-foreground">— select site —</span>
      </div>
      <div className="flex items-center gap-3 text-sm">
        <NotificationBell />
        <div className="flex flex-col items-end leading-tight">
          <span className="font-medium text-foreground">{profile?.full_name || email}</span>
          {profile?.role ? (
            <Badge tone="brand" className="mt-0.5">
              {profile.role}
            </Badge>
          ) : (
            <span className="text-xs text-foreground-muted">{STATUS_LABEL[profile?.status ?? "PENDING"]}</span>
          )}
        </div>
        <SignOutButton />
      </div>
    </header>
  );
}
