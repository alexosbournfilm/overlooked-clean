// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

/** CORS */
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const userAuth = req.headers.get("Authorization");
  if (!userAuth) return json(401, { error: "Missing Authorization header" });

  const SUPABASE_URL =
    Deno.env.get("SUPABASE_URL") || Deno.env.get("PROJECT_URL") || Deno.env.get("SB_URL");
  const SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SERVICE_ROLE_KEY") ||
    Deno.env.get("SB_SERVICE_ROLE_KEY");
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { error: "Supabase service env missing" });
  if (!STRIPE_SECRET_KEY) return json(500, { error: "STRIPE_SECRET_KEY is not set in Edge Function secrets" });

  const supaRls = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: userAuth } },
  });

  const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: "2024-06-20" });

  try {
    const { data: userRes, error: userErr } = await supaRls.auth.getUser();
    if (userErr || !userRes?.user) return json(401, { error: "Invalid session" });
    const user = userRes.user;
    console.log("[cancel-subscription] user", user.id);

    const { data: row, error: rowErr } = await supaRls
      .from("users")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("id", user.id)
      .single();
    if (rowErr) {
      console.error("[cancel-subscription] load row error", rowErr.message);
      return json(500, { error: "Failed to load user billing row", details: rowErr.message });
    }

    const customerId: string | null = (row?.stripe_customer_id as string | null) ?? null;
    const savedSubId: string | null = (row?.stripe_subscription_id as string | null) ?? null;
    console.log("[cancel-subscription] customerId", customerId, "savedSubId", savedSubId);

    if (!customerId) {
      await supaRls.from("users").update({ subscription_status: "canceled" }).eq("id", user.id);
      return json(200, { ok: true, message: "No Stripe customer; nothing to cancel." });
    }

    const allSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      expand: ["data.latest_invoice"],
      limit: 100,
    });

    const targets: Stripe.Subscription[] = allSubs.data.filter(
      (s: Stripe.Subscription) => s.status === "active" || s.status === "trialing"
    );

    // If you only want the saved one, use:
    // const targets: Stripe.Subscription[] = allSubs.data.filter(
    //   (s: Stripe.Subscription) => (s.status === "active" || s.status === "trialing") && s.id === savedSubId
    // );

    console.log(
      "[cancel-subscription] found subs",
      allSubs.data.length,
      "targets",
      targets.map((t: Stripe.Subscription) => t.id),
    );

    if (targets.length === 0) {
      await supaRls.from("users").update({ subscription_status: "canceled" }).eq("id", user.id);
      return json(200, { ok: true, message: "No active subscription; marked as canceled." });
    }

    let latestPeriodEnd: number | null = null;
    for (const s of targets as Stripe.Subscription[]) {
      const updated: Stripe.Subscription = await stripe.subscriptions.update(s.id, { cancel_at_period_end: true });
      console.log("[cancel-subscription] set cancel_at_period_end for", s.id, "cpe", updated.current_period_end);
      if (typeof updated.current_period_end === "number") {
        latestPeriodEnd = Math.max(latestPeriodEnd ?? 0, updated.current_period_end);
      }
    }

    await supaRls
      .from("users")
      .update({
        subscription_status: "canceled",
        premium_access_expires_at: latestPeriodEnd
          ? new Date(latestPeriodEnd * 1000).toISOString()
          : null,
      })
      .eq("id", user.id);

    return json(200, {
      ok: true,
      message: "Subscription(s) scheduled to cancel at period end.",
    });
  } catch (e: any) {
    console.error("[cancel-subscription] unhandled", e);
    return json(500, { error: "Unhandled error", details: String(e) });
  }
});
