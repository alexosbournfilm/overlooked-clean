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

type UserBillingRow = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  grandfathered: boolean | null;
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const userAuth = req.headers.get("Authorization");
  if (!userAuth) {
    return json(401, { error: "Missing Authorization header" });
  }

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

    if (userErr || !userRes?.user) {
      return json(401, { error: "Invalid session" });
    }

    const user = userRes.user;

    console.log("[cancel-subscription] user", user.id);

    const { data, error: rowErr } = await supaRls
      .from("users")
      .select(
        [
          "stripe_customer_id",
          "stripe_subscription_id",
          "subscription_status",
          "grandfathered",
        ].join(","),
      )
      .eq("id", user.id)
      .single();

    if (rowErr) {
      console.error("[cancel-subscription] load row error", rowErr.message);
      return json(500, {
        error: "Failed to load user billing row",
        details: rowErr.message,
      });
    }

    const rawRow = data ?? null;
const row = rawRow as unknown as UserBillingRow | null;

    const customerId = row?.stripe_customer_id ?? null;
    const savedSubId = row?.stripe_subscription_id ?? null;
    const isGrandfathered = Boolean(row?.grandfathered);

    console.log(
      "[cancel-subscription] customerId",
      customerId,
      "savedSubId",
      savedSubId,
      "grandfathered",
      isGrandfathered,
    );

    // Real lifetime/grandfathered user: nothing to cancel in Stripe.
    if (isGrandfathered && !customerId && !savedSubId) {
      return json(200, {
        ok: true,
        message:
          "This account has grandfathered Pro access and no active Stripe subscription to cancel.",
        is_grandfathered: true,
      });
    }

    // No Stripe customer => no monthly subscription exists.
    // Clear stale billing fields so UI stops thinking billing is still active.
    if (!customerId) {
      await supaRls
        .from("users")
        .update({
          cancel_at_period_end: false,
          current_period_end: null,
          premium_access_expires_at: null,
          stripe_subscription_id: null,
          subscription_status: null,
          price_id: null,
          tier: isGrandfathered ? "pro" : "free",
          is_premium: isGrandfathered,
        })
        .eq("id", user.id);

      return json(200, {
        ok: true,
        message: isGrandfathered
          ? "No Stripe subscription found. Grandfathered Pro remains active."
          : "No active Stripe customer; monthly subscription is already inactive.",
        is_grandfathered: isGrandfathered,
      });
    }

    const allSubs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });

    const activeSubs = (allSubs.data as Stripe.Subscription[]).filter(
      (s) => s.status === "active" || s.status === "trialing",
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
          price_id: null,
          tier: isGrandfathered ? "pro" : "free",
          is_premium: isGrandfathered,
        })
        .eq("id", user.id);

      return json(200, {
        ok: true,
        message: isGrandfathered
          ? "No active Stripe subscription found. Grandfathered Pro remains active."
          : "No active subscription found.",
        is_grandfathered: isGrandfathered,
      });
    }

    let target: Stripe.Subscription | null = null;

    if (savedSubId) {
      target = activeSubs.find((s) => s.id === savedSubId) ?? null;
      if (!target) {
        console.warn(
          "[cancel-subscription] savedSubId not active; will choose another active sub",
        );
      }
    }

    if (!target) {
      target =
        activeSubs
          .slice()
          .sort((a, b) => {
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
          stripe_subscription_id: null,
          subscription_status: null,
          price_id: null,
          tier: isGrandfathered ? "pro" : "free",
          is_premium: isGrandfathered,
        })
        .eq("id", user.id);

      return json(200, {
        ok: true,
        message: "No cancellable subscription found.",
      });
    }

    if (target.cancel_at_period_end) {
      const cpeIso = toIsoFromStripeUnix(target.current_period_end);

      await supaRls
        .from("users")
        .update({
          stripe_subscription_id: target.id,
          subscription_status: target.status,
          cancel_at_period_end: true,
          current_period_end: cpeIso,
          premium_access_expires_at: cpeIso,
          tier: "pro",
          is_premium: true,
        })
        .eq("id", user.id);

      return json(200, {
        ok: true,
        message: "Subscription already scheduled to cancel at period end.",
        period_end: cpeIso,
        is_grandfathered: false,
      });
    }

    const updated = await stripe.subscriptions.update(target.id, {
      cancel_at_period_end: true,
    });

    const latestIso = toIsoFromStripeUnix(updated.current_period_end);

    console.log(
      "[cancel-subscription] set cancel_at_period_end for",
      updated.id,
      "cpe",
      updated.current_period_end,
    );

    await supaRls
      .from("users")
      .update({
        stripe_subscription_id: updated.id,
        subscription_status: updated.status,
        cancel_at_period_end: true,
        current_period_end: latestIso,
        premium_access_expires_at: latestIso,
        tier: "pro",
        is_premium: true,
      })
      .eq("id", user.id);

    return json(200, {
      ok: true,
      message: "Subscription scheduled to cancel at period end.",
      period_end: latestIso,
      is_grandfathered: false,
    });
  } catch (e: any) {
    console.error("[cancel-subscription] unhandled", e);
    return json(500, { error: "Unhandled error", details: String(e) });
  }
});