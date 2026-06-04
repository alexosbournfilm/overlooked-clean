import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type NotifyBody = {
  report_id?: string;
};

type ContentReport = {
  id: string;
  reporter_id: string;
  reported_user_id: string | null;
  content_type: string;
  content_id: string | null;
  reason: string;
  details: string | null;
  created_at: string;
};

type UserProfile = {
  id: string;
  full_name: string | null;
  email?: string | null;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function escapeHtml(value: string | null | undefined) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sendResendEmail(args: {
  to: string;
  from: string;
  subject: string;
  html: string;
  text: string;
}) {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");

  if (!resendApiKey) {
    throw new Error("Missing RESEND_API_KEY");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });

  const text = await res.text();

  if (!res.ok) {
    throw new Error(`Resend failed (${res.status}): ${text}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!jwt) {
      return json({ error: "Missing Authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return json({ error: "Invalid user session" }, 401);
    }

    const body = (await req.json()) as NotifyBody;
    const reportId = body.report_id;

    if (!reportId) {
      return json({ error: "Missing report_id" }, 400);
    }

    const { data: report, error: reportError } = await serviceClient
      .from("content_reports")
      .select("id, reporter_id, reported_user_id, content_type, content_id, reason, details, created_at")
      .eq("id", reportId)
      .single<ContentReport>();

    if (reportError || !report) {
      return json({ error: reportError?.message ?? "Report not found" }, 404);
    }

    if (report.reporter_id !== user.id) {
      return json({ error: "Report does not belong to current user" }, 403);
    }

    const userIds = [report.reporter_id, report.reported_user_id].filter(Boolean) as string[];
    const { data: profiles } = userIds.length
      ? await serviceClient
          .from("users")
          .select("id, full_name, email")
          .in("id", userIds)
      : { data: [] as UserProfile[] };

    const profileMap = new Map<string, UserProfile>(
      ((profiles ?? []) as UserProfile[]).map((profile) => [profile.id, profile])
    );

    const reporter = profileMap.get(report.reporter_id);
    const reported = report.reported_user_id
      ? profileMap.get(report.reported_user_id)
      : null;

    const to = Deno.env.get("MODERATION_ALERT_EMAIL");
    const from = Deno.env.get("RESEND_FROM_EMAIL") ?? "Overlooked <onboarding@resend.dev>";

    if (!to) {
      throw new Error("Missing MODERATION_ALERT_EMAIL");
    }

    const subject = `[Overlooked] New ${report.content_type} report: ${report.reason}`;
    const createdAt = new Date(report.created_at).toLocaleString("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "UTC",
    });

    const text = [
      "New Overlooked content report",
      "",
      `Report ID: ${report.id}`,
      `Created: ${createdAt} UTC`,
      `Reason: ${report.reason}`,
      `Content type: ${report.content_type}`,
      `Content ID: ${report.content_id ?? "n/a"}`,
      `Reporter: ${reporter?.full_name ?? user.email ?? report.reporter_id} (${report.reporter_id})`,
      `Reported user: ${reported?.full_name ?? report.reported_user_id ?? "n/a"} (${report.reported_user_id ?? "n/a"})`,
      "",
      "Details:",
      report.details?.trim() || "No details provided.",
      "",
      "Review within 24 hours: remove offending content and ban/eject abusive users where needed.",
    ].join("\n");

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.45;color:#111">
        <h2>New Overlooked content report</h2>
        <p><strong>Review target:</strong> within 24 hours.</p>
        <table cellpadding="6" cellspacing="0" style="border-collapse:collapse">
          <tr><td><strong>Report ID</strong></td><td>${escapeHtml(report.id)}</td></tr>
          <tr><td><strong>Created</strong></td><td>${escapeHtml(createdAt)} UTC</td></tr>
          <tr><td><strong>Reason</strong></td><td>${escapeHtml(report.reason)}</td></tr>
          <tr><td><strong>Content type</strong></td><td>${escapeHtml(report.content_type)}</td></tr>
          <tr><td><strong>Content ID</strong></td><td>${escapeHtml(report.content_id ?? "n/a")}</td></tr>
          <tr><td><strong>Reporter</strong></td><td>${escapeHtml(reporter?.full_name ?? user.email ?? report.reporter_id)} (${escapeHtml(report.reporter_id)})</td></tr>
          <tr><td><strong>Reported user</strong></td><td>${escapeHtml(reported?.full_name ?? report.reported_user_id ?? "n/a")} (${escapeHtml(report.reported_user_id ?? "n/a")})</td></tr>
        </table>
        <h3>Details</h3>
        <p style="white-space:pre-wrap;background:#f6f6f6;border-radius:10px;padding:12px">${escapeHtml(
          report.details?.trim() || "No details provided."
        )}</p>
      </div>
    `;

    const resendResult = await sendResendEmail({ to, from, subject, html, text });

    await serviceClient
      .from("content_reports")
      .update({ developer_notified: true })
      .eq("id", report.id);

    return json({ ok: true, report_id: report.id, resend: resendResult });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown notify-content-report error";

    console.error("notify-content-report error:", message);
    return json({ error: message }, 500);
  }
});
