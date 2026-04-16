// supabase/functions/resume-subscription/index.ts
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@13.10.0?target=deno";

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

function toIso(value?: string | null): string | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function isFuture(value?: string | null, graceMs = 0): boolean {
  if (!value) return false;
  const t = new Date(value).getTime();
  if (!Number.isFinite(t)) return false;
  return t > Date.now() - graceMs;
}

type UserBillingRow = {
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  grandfathered: boolean | null;
  premium_access_expires_at?: string | null;
  current_period_end?: string | null;
};

type RcSubscriberV1 = {
  subscriber?: {
    management_url?: string | null;
    subscriptions?: Record<
      string,
      {
        expires_date?: string | null;
        unsubscribe_detected_at?: string | null;
        store?: string | null;
      }
    >;
  };
};

async function fetchRevenueCatSubscriber(
  appUserId: string,
  secretApiKey: string,
): Promise<RcSubscriberV1 | null> {
  if (!secretApiKey) return null;

  const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(appUserId)}`;

  const resp = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secretApiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Platform": "server",
    },
  });

  const text = await resp.text();

  let parsed: any = {};
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = {};
  }

  if (!resp.ok) {
    console.warn("[resume-subscription] RevenueCat lookup failed", resp.status, text);
    return null;
  }

  return parsed as RcSubscriberV1;
}

function getRevenueCatRenewableState(subscriber: RcSubscriberV1 | null) {
  const subscriptions = subscriber?.subscriber?.subscriptions ?? {};
  const managementUrl = subscriber?.subscriber?.management_url ?? null;

  let hasRenewableSubscription = false;
  let cancelAtPeriodEnd = false;
  let latestExpiry: string | null = null;
  let store: string | null = null;

  for (const sub of Object.values(subscriptions)) {
    const expires = toIso(sub?.expires_date ?? null);
    const unsubscribeDetected = Boolean(sub?.unsubscribe_detected_at);

    if (expires && isFuture(expires, 5_000)) {
      hasRenewableSubscription = true;

      if (!latestExpiry || new Date(expires).getTime() > new Date(latestExpiry).getTime()) {
        latestExpiry = expires;
        store = sub?.store ?? null;
      }
    }

    if (unsubscribeDetected) {
      cancelAtPeriodEnd = true;
    }
  }

  return {
    hasRenewableSubscription,
    cancelAtPeriodEnd,
    latestExpiry,
    managementUrl,
    store,
  };
}

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
  const REVENUECAT_SECRET_API_KEY = Deno.env.get("REVENUECAT_SECRET_API_KEY") || "";

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

    const { data, error: rowErr } = await supaRls
      .from("users")
      .select(
        [
          "stripe_customer_id",
          "stripe_subscription_id",
          "subscription_status",
          "grandfathered",
          "premium_access_expires_at",
          "current_period_end",
        ].join(","),
      )
      .eq("id", user.id)
      .single();

    if (rowErr) {
      console.error("[resume-subscription] load row error", rowErr.message);
      return json(500, {
        error: "Failed to load user billing row",
        details: rowErr.message,
      });
    }

    const row = (data ?? null) as unknown as UserBillingRow | null;

    const customerId = row?.stripe_customer_id ?? null;
    const savedSubId = row?.stripe_subscription_id ?? null;
    const isGrandfathered = Boolean(row?.grandfathered);

    if (customerId) {
      const allSubs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });

      const renewableSubs = (allSubs.data as Stripe.Subscription[]).filter(
        (s) => s.status === "active" || s.status === "trialing",
      );

      let target: Stripe.Subscription | null = null;

      if (savedSubId) {
        target = renewableSubs.find((s) => s.id === savedSubId) ?? null;
      }

      if (!target) {
        target =
          renewableSubs
            .slice()
            .sort((a, b) => {
              const bc = typeof b.created === "number" ? b.created : 0;
              const ac = typeof a.created === "number" ? a.created : 0;
              return bc - ac;
            })[0] ?? null;
      }

      if (target) {
        if (!target.cancel_at_period_end) {
          const cpeIso = toIsoFromStripeUnix(target.current_period_end);

          await supaRls
            .from("users")
            .update({
              stripe_subscription_id: target.id,
              subscription_status: target.status,
              cancel_at_period_end: false,
              current_period_end: cpeIso,
              premium_access_expires_at: cpeIso,
              tier: "pro",
              is_premium: true,
            })
            .eq("id", user.id);

          return json(200, {
            ok: true,
            action: "already_active",
            message: "Renewal is already active for this subscription.",
            period_end: cpeIso,
          });
        }

        const updated = await stripe.subscriptions.update(target.id, {
          cancel_at_period_end: false,
        });

        const latestIso = toIsoFromStripeUnix(updated.current_period_end);

        await supaRls
          .from("users")
          .update({
            stripe_subscription_id: updated.id,
            subscription_status: updated.status,
            cancel_at_period_end: false,
            current_period_end: latestIso,
            premium_access_expires_at: latestIso,
            tier: "pro",
            is_premium: true,
          })
          .eq("id", user.id);

        return json(200, {
          ok: true,
          action: "stripe_resumed",
          message: "Subscription renewal has been turned back on.",
          period_end: latestIso,
        });
      }
    }

    const rcSubscriber = await fetchRevenueCatSubscriber(user.id, REVENUECAT_SECRET_API_KEY);
    const rcState = getRevenueCatRenewableState(rcSubscriber);

    if (rcState.hasRenewableSubscription) {
      return json(200, {
        ok: true,
        action: "manage_external",
        provider: "revenuecat",
        store: rcState.store,
        management_url: rcState.managementUrl,
        period_end: rcState.latestExpiry,
        cancel_at_period_end: rcState.cancelAtPeriodEnd,
        message: rcState.managementUrl
          ? "This subscription is managed through your mobile app store. Use the store management page to turn renewal back on."
          : "This subscription is managed through your mobile app store. Turn renewal back on in Google Play or the App Store.",
      });
    }

    if (isGrandfathered) {
      return json(200, {
        ok: true,
        action: "nothing_to_resume",
        is_grandfathered: true,
        message: "This account has grandfathered Pro access and no renewable subscription.",
      });
    }

    return json(200, {
      ok: true,
      action: "nothing_to_resume",
      message: "No renewable subscription was found for this account.",
    });
  } catch (e: any) {
    console.error("[resume-subscription] unhandled", e);
    return json(500, { error: "Unhandled error", details: String(e) });
  }
});