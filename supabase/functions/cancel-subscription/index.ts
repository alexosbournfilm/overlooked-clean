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
  cancel_at_period_end?: boolean | null;
  price_id?: string | null;
  tier?: string | null;
  is_premium?: boolean | null;
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

  const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(
    appUserId,
  )}`;

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
    console.warn(
      "[cancel-subscription] RevenueCat lookup failed",
      resp.status,
      text,
    );
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

      if (
        !latestExpiry ||
        new Date(expires).getTime() > new Date(latestExpiry).getTime()
      ) {
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

function isStoreManagedStore(store?: string | null) {
  if (!store) return false;
  const normalized = String(store).toLowerCase();

  return (
    normalized === "app_store" ||
    normalized === "play_store" ||
    normalized === "mac_app_store" ||
    normalized === "amazon"
  );
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
  const REVENUECAT_SECRET_API_KEY =
    Deno.env.get("REVENUECAT_SECRET_API_KEY") || "";

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
          "premium_access_expires_at",
          "current_period_end",
          "cancel_at_period_end",
          "price_id",
          "tier",
          "is_premium",
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

    const row = (data ?? null) as unknown as UserBillingRow | null;

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

    // 1) Stripe-managed subscription: cancel on server directly.
    if (customerId) {
      const allSubs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });

      const activeSubs = (allSubs.data as Stripe.Subscription[]).filter(
        (s) => s.status === "active" || s.status === "trialing",
      );

      if (activeSubs.length > 0) {
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

        if (target) {
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
              provider: "stripe",
              action: "already_scheduled",
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
            provider: "stripe",
            action: "stripe_canceled",
            message: "Subscription scheduled to cancel at period end.",
            period_end: latestIso,
            is_grandfathered: false,
          });
        }
      }
    }

    // 2) No active Stripe sub found. Check RevenueCat / store-managed subscriptions.
    const rcSubscriber = await fetchRevenueCatSubscriber(
      user.id,
      REVENUECAT_SECRET_API_KEY,
    );
    const rcState = getRevenueCatRenewableState(rcSubscriber);

    if (rcState.hasRenewableSubscription) {
      // Keep local billing snapshot aligned with the real renewable access window,
      // but do not forcibly set free while a mobile subscription is still active.
      await supaRls
        .from("users")
        .update({
          stripe_subscription_id: null,
          subscription_status: rcState.cancelAtPeriodEnd ? "canceled" : "active",
          cancel_at_period_end: rcState.cancelAtPeriodEnd,
          current_period_end: rcState.latestExpiry,
          premium_access_expires_at: rcState.latestExpiry,
          tier: "pro",
          is_premium: true,
        })
        .eq("id", user.id);

      return json(200, {
        ok: true,
        provider: "revenuecat",
        action: "manage_external",
        store: rcState.store,
        management_url: rcState.managementUrl,
        cancel_at_period_end: rcState.cancelAtPeriodEnd,
        period_end: rcState.latestExpiry,
        message: rcState.cancelAtPeriodEnd
          ? "This mobile subscription is already scheduled to cancel in the app store."
          : isStoreManagedStore(rcState.store)
          ? rcState.managementUrl
            ? "This subscription is managed by your mobile app store. Open the management link to cancel it there."
            : "This subscription is managed by your mobile app store. Cancel it in Google Play or the App Store."
          : "This subscription is managed externally. Use the provided management link to cancel it.",
      });
    }

    // 3) Grandfathered/lifetime access with no renewable sub.
    if (isGrandfathered) {
      await supaRls
        .from("users")
        .update({
          cancel_at_period_end: false,
          current_period_end: null,
          premium_access_expires_at: null,
          stripe_subscription_id: null,
          subscription_status: "grandfathered",
          price_id: row?.price_id ?? null,
          tier: "pro",
          is_premium: true,
        })
        .eq("id", user.id);

      return json(200, {
        ok: true,
        action: "nothing_to_cancel",
        is_grandfathered: true,
        message:
          "This account has grandfathered Pro access and no renewable subscription to cancel.",
      });
    }

    // 4) Nothing active anywhere. Clear stale local flags.
    await supaRls
      .from("users")
      .update({
        cancel_at_period_end: false,
        current_period_end: null,
        premium_access_expires_at: null,
        stripe_subscription_id: null,
        subscription_status: null,
        price_id: null,
        tier: "free",
        is_premium: false,
      })
      .eq("id", user.id);

    return json(200, {
      ok: true,
      action: "nothing_to_cancel",
      message: "No active renewable subscription found for this account.",
      is_grandfathered: false,
    });
  } catch (e: any) {
    console.error("[cancel-subscription] unhandled", e);
    return json(500, { error: "Unhandled error", details: String(e) });
  }
});