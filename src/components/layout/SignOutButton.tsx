"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  const router = useRouter();

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleSignOut}
      className="rounded-md px-2 py-1 text-sm hover:bg-black/[.04] dark:hover:bg-white/[.06]"
    >
      ออกจากระบบ
    </button>
  );
}
