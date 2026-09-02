"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

  if (recoveryMode) {
    return (
      <div className="min-h-full flex items-center justify-center p-6">
        <form
          onSubmit={handleUpdatePassword}
          className="w-full max-w-sm flex flex-col gap-4 rounded-lg border border-black/10 dark:border-white/10 p-6"
        >
          <h1 className="text-lg font-semibold">ตั้งรหัสผ่านใหม่</h1>

          <div className="flex flex-col gap-1">
            <label htmlFor="new-password" className="text-sm">
              รหัสผ่านใหม่
            </label>
            <input
              id="new-password"
              type="password"
              required
              minLength={6}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-3 py-1.5 text-sm"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="confirm-password" className="text-sm">
              ยืนยันรหัสผ่านใหม่
            </label>
            <input
              id="confirm-password"
              type="password"
              required
              minLength={6}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-3 py-1.5 text-sm"
            />
          </div>

          {updateError && <p className="text-sm text-red-600">{updateError}</p>}

          <button
            type="submit"
            disabled={updateLoading}
            className="rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {updateLoading ? "กำลังบันทึก..." : "บันทึกรหัสผ่านใหม่"}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm flex flex-col gap-4 rounded-lg border border-black/10 dark:border-white/10 p-6"
      >
        <h1 className="text-lg font-semibold">AQUIP QC & Inventory</h1>

        <div className="flex flex-col gap-1">
          <label htmlFor="email" className="text-sm">
            อีเมล
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-3 py-1.5 text-sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="password" className="text-sm">
            รหัสผ่าน
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-md border border-black/15 dark:border-white/15 bg-transparent px-3 py-1.5 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="rounded-md bg-black text-white dark:bg-white dark:text-black px-3 py-1.5 text-sm font-medium disabled:opacity-50"
        >
          {loading ? "กำลังเข้าสู่ระบบ..." : "เข้าสู่ระบบ"}
        </button>
      </form>
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
