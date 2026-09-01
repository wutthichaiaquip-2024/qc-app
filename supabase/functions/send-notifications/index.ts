// Phase 20: sends pending EMAIL/LINE rows from notification_channel_log.
//
// This code is real and intended to be correct, but it is NOT deployed and
// NOT tested in this environment — there are no real Resend or LINE
// Messaging API credentials available here. To actually use it:
//   supabase secrets set RESEND_API_KEY=... RESEND_FROM_EMAIL=... LINE_CHANNEL_ACCESS_TOKEN=...
//   supabase functions deploy send-notifications
// and something needs to call this function's URL on a schedule after
// generate_notifications() runs (e.g. pg_cron + pg_net, or an external
// scheduler) — this repo does not set that trigger up.
//
// LINE delivery additionally requires each user's LINE userId to be saved
// into user_profiles.line_user_id first; there is no linking flow built
// for that yet, so LINE sends will simply have zero recipients until one
// exists. See PROJECT_STATE.md for exactly what is/isn't verified.

import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const RESEND_FROM_EMAIL = Deno.env.get("RESEND_FROM_EMAIL");
const LINE_CHANNEL_ACCESS_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");

type PendingLog = {
  id: string;
  channel: "EMAIL" | "LINE";
  notification_id: string;
  notifications: {
    title: string;
    message: string;
    link: string | null;
    role: string;
  };
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: pending, error } = await supabase
    .from("notification_channel_log")
    .select("id, channel, notification_id, notifications(title, message, link, role)")
    .eq("status", "PENDING")
    .returns<PendingLog[]>();

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let sent = 0;
  let failed = 0;

  for (const log of pending ?? []) {
    try {
      if (log.channel === "EMAIL") {
        await sendEmail(supabase, log);
      } else {
        await sendLine(supabase, log);
      }
      await supabase
        .from("notification_channel_log")
        .update({ status: "SENT", sent_at: new Date().toISOString() })
        .eq("id", log.id);
      sent++;
    } catch (err) {
      await supabase
        .from("notification_channel_log")
        .update({ status: "FAILED", error: String(err) })
        .eq("id", log.id);
      failed++;
    }
  }

  return new Response(JSON.stringify({ sent, failed }), {
    headers: { "content-type": "application/json" },
  });
});

async function recipientsForRole(supabase: SupabaseClient, role: string) {
  const { data: profiles, error } = await supabase
    .from("user_profiles")
    .select("id, line_user_id")
    .eq("role", role)
    .eq("status", "ACTIVE");
  if (error) throw error;
  return profiles ?? [];
}

async function sendEmail(supabase: SupabaseClient, log: PendingLog) {
  if (!RESEND_API_KEY || !RESEND_FROM_EMAIL) {
    throw new Error("RESEND_API_KEY/RESEND_FROM_EMAIL not configured");
  }
  const profiles = await recipientsForRole(supabase, log.notifications.role);
  const emails: string[] = [];
  for (const p of profiles) {
    const { data } = await supabase.auth.admin.getUserById(p.id);
    if (data?.user?.email) emails.push(data.user.email);
  }
  if (emails.length === 0) return;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      from: RESEND_FROM_EMAIL,
      to: emails,
      subject: log.notifications.title,
      text: `${log.notifications.message}${log.notifications.link ? `\n\n${log.notifications.link}` : ""}`,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${await res.text()}`);
}

async function sendLine(supabase: SupabaseClient, log: PendingLog) {
  if (!LINE_CHANNEL_ACCESS_TOKEN) {
    throw new Error("LINE_CHANNEL_ACCESS_TOKEN not configured");
  }
  const profiles = await recipientsForRole(supabase, log.notifications.role);
  const lineUserIds = profiles.map((p) => p.line_user_id).filter((id): id is string => !!id);
  if (lineUserIds.length === 0) return;

  const text = `${log.notifications.title}\n${log.notifications.message}${
    log.notifications.link ? `\n${log.notifications.link}` : ""
  }`;

  for (const to of lineUserIds) {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
    });
    if (!res.ok) throw new Error(`LINE push ${res.status}: ${await res.text()}`);
  }
}
