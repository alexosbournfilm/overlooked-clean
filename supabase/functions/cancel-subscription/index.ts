// supabase/functions/cancel-subscription/index.ts
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

/** CORS */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function toIsoFromStripeUnix(unix: number | null | undefined): string | null {
  if (!unix || typeof unix !== "number") return null;
  return new Date(unix * 1000).toISOString();
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  const userAuth = req.headers.get("Authorization");
  if (!userAuth) return json(401, { error: "Missing Authorization header" });

  const SUPABASE_URL =
    Deno.env.get("SUPABASE_URL") ||
    Deno.env.get("PROJECT_URL") ||
    Deno.env.get("SB_URL");

  const SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SERVICE_ROLE_KEY") ||
    Deno.env.get("SB_SERVICE_ROLE_KEY");

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "Supabase service env missing" });
  }
  if (!STRIPE_SECRET_KEY) {
    return json(500, {
      error: "STRIPE_SECRET_KEY is not set in Edge Function secrets",
    });
  }

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
      .select("stripe_customer_id, stripe_subscription_id, subscription_status")
      .eq("id", user.id)
      .single();

    if (rowErr) {
      console.error("[cancel-subscription] load row error", rowErr.message);
      return json(500, {
        error: "Failed to load user billing row",
        details: rowErr.message,
      });
    }

    const customerId: string | null = (row?.stripe_customer_id as string | null) ?? null;
    const savedSubId: string | null =
      (row?.stripe_subscription_id as string | null) ?? null;

    console.log("[cancel-subscription] customerId", customerId, "savedSubId", savedSubId);

    // No Stripe customer => nothing to cancel.
    // Clear billing period fields so UI doesn't think there is an active billing cycle.
    if (!customerId) {
      await supaRls
        .from("users")
        .update({
          cancel_at_period_end: false,
          current_period_end: null,
          premium_access_expires_at: null,
          stripe_subscription_id: null,
          subscription_status: null,
        })
        .eq("id", user.id);

      return json(200, { ok: true, message: "No Stripe customer; nothing to cancel." });
    }

    const allSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });

    const activeSubs: Stripe.Subscription[] = (allSubs.data as Stripe.Subscription[]).filter(
      (s: Stripe.Subscription) => s.status === "active" || s.status === "trialing",
    );

    if (activeSubs.length === 0) {
      await supaRls
        .from("users")
        .update({
          cancel_at_period_end: false,
          current_period_end: null,
          premium_access_expires_at: null,
          stripe_subscription_id: null,
          subscription_status: null,
        })
        .eq("id", user.id);

      return json(200, { ok: true, message: "No active subscription found." });
    }

    // Prefer cancelling the saved subscription id
    let target: Stripe.Subscription | null = null;

    if (savedSubId) {
      target = activeSubs.find((s: Stripe.Subscription) => s.id === savedSubId) ?? null;
      if (!target) {
        console.warn("[cancel-subscription] savedSubId not active; will choose another active sub");
      }
    }

    // Fallback: pick the most recent active sub (by created)
    if (!target) {
      target =
        activeSubs
          .slice()
          .sort((a: Stripe.Subscription, b: Stripe.Subscription) => {
            const bc = typeof b.created === "number" ? b.created : 0;
            const ac = typeof a.created === "number" ? a.created : 0;
            return bc - ac;
          })[0] ?? null;
    }

    if (!target) {
      await supaRls
        .from("users")
        .update({
          cancel_at_period_end: false,
          current_period_end: null,
          premium_access_expires_at: null,
        })
        .eq("id", user.id);

      return json(200, { ok: true, message: "No cancellable subscription found." });
    }

    // If already scheduled to cancel, just sync DB and return
    if (target.cancel_at_period_end) {
      const cpeIso = toIsoFromStripeUnix(target.current_period_end);
      await supaRls
        .from("users")
        .update({
          cancel_at_period_end: true,
          stripe_subscription_id: target.id,
          subscription_status: target.status,
          current_period_end: cpeIso,
          premium_access_expires_at: cpeIso,
        })
        .eq("id", user.id);

      return json(200, {
        ok: true,
        message: "Subscription already scheduled to cancel at period end.",
      });
    }

    // Set cancel_at_period_end true (stops renewals / future payments)
    const updated: Stripe.Subscription = await stripe.subscriptions.update(target.id, {
      cancel_at_period_end: true,
    });

    const latestIso = toIsoFromStripeUnix(updated.current_period_end);

    console.log(
      "[cancel-subscription] set cancel_at_period_end for",
      updated.id,
      "cpe",
      updated.current_period_end,
    );

    // Do NOT set subscription_status="canceled" here (still active until period end)
    await supaRls
      .from("users")
      .update({
        stripe_subscription_id: updated.id,
        subscription_status: updated.status, // active/trialing
        cancel_at_period_end: true,
        current_period_end: latestIso,
        premium_access_expires_at: latestIso,
      })
      .eq("id", user.id);

    return json(200, {
      ok: true,
      message: "Subscription scheduled to cancel at period end.",
      period_end: latestIso,
    });
  } catch (e: any) {
    console.error("[cancel-subscription] unhandled", e);
    return json(500, { error: "Unhandled error", details: String(e) });
  }
});
