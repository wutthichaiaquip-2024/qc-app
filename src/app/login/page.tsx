"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Supabase's password-recovery email links land back on this page
  // with an access_token in the URL fragment (not a query param, so
  // the server/middleware never sees it) — detected here via
  // onAuthStateChange's PASSWORD_RECOVERY event, the pattern Supabase
  // itself documents for this flow.
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    router.push(searchParams.get("next") || "/");
    router.refresh();
  }

  async function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setUpdateError("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      return;
    }
    setUpdateLoading(true);
    setUpdateError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    setUpdateLoading(false);

    if (error) {
      setUpdateError(error.message);
      return;
    }

    router.push("/");
    router.refresh();
  }

  const logo = (
    <div className="flex items-center gap-2.5 mb-1">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-brand-foreground text-sm font-bold">
        AQ
      </span>
      <span className="text-base font-semibold tracking-tight text-foreground">AQUIP QC &amp; Inventory</span>
    </div>
  );

  if (recoveryMode) {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <Card className="w-full max-w-sm p-7">
          <form onSubmit={handleUpdatePassword} className="flex flex-col gap-4">
            {logo}
            <p className="text-sm text-foreground-muted -mt-2">ตั้งรหัสผ่านใหม่สำหรับบัญชีของคุณ</p>

            <div className="flex flex-col gap-1">
              <label htmlFor="new-password" className="text-sm font-medium text-foreground">
                รหัสผ่านใหม่
              </label>
              <Input
                id="new-password"
                type="password"
                required
                minLength={6}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label htmlFor="confirm-password" className="text-sm font-medium text-foreground">
                ยืนยันรหัสผ่านใหม่
              </label>
              <Input
                id="confirm-password"
                type="password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>

            {updateError && <p className="text-sm text-danger">{updateError}</p>}

            <Button type="submit" disabled={updateLoading} className="mt-1 w-full">
              {updateLoading ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
            </Button>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <Card className="w-full max-w-sm p-7">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {logo}
          <p className="text-sm text-foreground-muted -mt-2">เข้าสู่ระบบเพื่อใช้งาน</p>

          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-sm font-medium text-foreground">
              อีเมล
            </label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="password" className="text-sm font-medium text-foreground">
              รหัสผ่าน
            </label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button type="submit" disabled={loading} className="mt-1 w-full">
            {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
          </Button>
        </form>
      </Card>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
