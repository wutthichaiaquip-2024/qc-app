import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import type { UserProfile } from "@/types/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("id, full_name, role, status, created_at, updated_at")
    .eq("id", user.id)
    .single<UserProfile>();

  return (
    <div className="h-full flex">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header email={user.email ?? ""} profile={profile} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
