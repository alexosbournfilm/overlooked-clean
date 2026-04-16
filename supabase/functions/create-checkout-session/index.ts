// supabase/functions/create-checkout-session/index.ts
// deno-lint-ignore-file no-explicit-any
import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

type Plan = "monthly" | "yearly" | "lifetime";

const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type",
  "access-control-allow-methods": "POST,OPTIONS",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";

// Prices
const PRICE_MONTHLY =
  Deno.env.get("STRIPE_PRICE_MONTHLY") ??
  Deno.env.get("STRIPE_PRICE_ID") ??
  "";

const PRICE_YEARLY = Deno.env.get("STRIPE_PRICE_YEARLY") ?? "";
const PRICE_LIFETIME = Deno.env.get("STRIPE_PRICE_LIFETIME") ?? "";

// RevenueCat
const REVENUECAT_SECRET_API_KEY =
  Deno.env.get("REVENUECAT_SECRET_API_KEY") ?? "";

// App URLs
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:5173";

const SUCCESS_URL =
  Deno.env.get("STRIPE_SUCCESS_URL") ??
  `${APP_URL}/pay/success?session_id={CHECKOUT_SESSION_ID}`;

const CANCEL_URL =
  Deno.env.get("STRIPE_CANCEL_URL") ?? `${APP_URL}/pay/cancel`;

// Supabase
const SB_URL = Deno.env.get("SB_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SB_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
});

// ---------- helpers ----------
function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function err(status: number, message: string, extra?: Record<string, unknown>): Response {
  return ok({ error: message, ...(extra ?? {}) }, status);
}

function messageFrom(e: unknown): string {
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Unknown error";
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

function isStripeRenewableStatus(status?: string | null) {
  return (
    status === "trialing" ||
    status === "active" ||
    status === "past_due" ||
    status === "unpaid"
  );
}

// ---------- types ----------
type Incoming = {
  user_id?: string;
  userId?: string;
  email?: string;
  plan?: Plan;
  referral_code?: string;
  promoCode?: string;
  priceId?: string;
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

type UserRow = {
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  grandfathered?: boolean | null;
  subscription_status?: string | null;
  cancel_at_period_end?: boolean | null;
  current_period_end?: string | null;
  premium_access_expires_at?: string | null;
  is_premium?: boolean | null;
  tier?: string | null;
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
      "[create-checkout-session] RevenueCat lookup failed",
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

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (req.method !== "POST") return err(405, "Method not allowed");
  if (!STRIPE_SECRET_KEY) return err(500, "Missing STRIPE_SECRET_KEY");
  if (!SB_URL) return err(500, "Missing SB_URL / SUPABASE_URL");
  if (!SB_SERVICE_ROLE_KEY) {
    return err(500, "Missing SB_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY");
  }

  const authHeader =
    req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader) return err(401, "Missing Authorization header");

  const supabase = createClient(SB_URL, SB_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  let body: Incoming = {};
  try {
    body = (await req.json()) as Incoming;
  } catch {
    body = {};
  }

  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user?.id) {
    return err(401, "Invalid session");
  }

  const userId = userRes.user.id;
  const emailFromAuth = userRes.user.email ?? undefined;
  const email = body.email ?? emailFromAuth;
  const referral_code = body.referral_code ?? body.promoCode ?? undefined;

  const plan: Plan =
    body.plan === "lifetime"
      ? "lifetime"
      : body.plan === "yearly"
      ? "yearly"
      : "monthly";

  const fallbackPrice =
    plan === "monthly"
      ? PRICE_MONTHLY
      : plan === "yearly"
      ? PRICE_YEARLY
      : PRICE_LIFETIME;

  const priceId = body.priceId ?? fallbackPrice;

  if (!priceId) {
    return err(
      500,
      plan === "monthly"
        ? "Missing STRIPE_PRICE_MONTHLY (or legacy STRIPE_PRICE_ID)"
        : plan === "yearly"
        ? "Missing STRIPE_PRICE_YEARLY"
        : "Missing STRIPE_PRICE_LIFETIME",
    );
  }

  try {
    // Load user billing snapshot first
    const { data: userRowRaw, error: userRowErr } = await supabase
      .from("users")
      .select(
        [
          "stripe_customer_id",
          "stripe_subscription_id",
          "grandfathered",
          "subscription_status",
          "cancel_at_period_end",
          "current_period_end",
          "premium_access_expires_at",
          "is_premium",
          "tier",
        ].join(","),
      )
      .eq("id", userId)
      .maybeSingle();

    if (userRowErr) {
      console.warn("[create-checkout-session] failed to load user row", userRowErr);
    }

    const userRow = (userRowRaw ?? null) as UserRow | null;
    const stripeCustomerIdFromDb = userRow?.stripe_customer_id ?? null;
    const stripeSubscriptionIdFromDb = userRow?.stripe_subscription_id ?? null;
    const isGrandfathered = Boolean(userRow?.grandfathered);

    // Lifetime / grandfathered users should not enter checkout again
    if (isGrandfathered || plan === "lifetime" && isGrandfathered) {
      return err(
        409,
        "This account already has lifetime Pro access.",
        {
          action: "already_has_lifetime",
          provider: "internal",
        },
      );
    }

    // Check Stripe first to avoid duplicate Stripe subscriptions
    let stripeCustomerId: string | null = stripeCustomerIdFromDb;

    if (stripeCustomerId) {
      try {
        const subs = await stripe.subscriptions.list({
          customer: stripeCustomerId,
          status: "all",
          limit: 100,
        });

        const renewableSubs = subs.data.filter((s) =>
          isStripeRenewableStatus(s.status),
        );

        let activeSub: Stripe.Subscription | null = null;

        if (stripeSubscriptionIdFromDb) {
          activeSub =
            renewableSubs.find((s) => s.id === stripeSubscriptionIdFromDb) ?? null;
        }

        if (!activeSub) {
          activeSub =
            renewableSubs
              .slice()
              .sort((a, b) => {
                const bc = typeof b.created === "number" ? b.created : 0;
                const ac = typeof a.created === "number" ? a.created : 0;
                return bc - ac;
              })[0] ?? null;
        }

        if (activeSub) {
          const periodEnd =
            typeof activeSub.current_period_end === "number"
              ? new Date(activeSub.current_period_end * 1000).toISOString()
              : null;

          return err(
            409,
            activeSub.cancel_at_period_end
              ? "This account already has a Stripe subscription that is active until the end of the billing period."
              : "This account already has an active Stripe subscription.",
            {
              action: activeSub.cancel_at_period_end
                ? "already_canceled_but_active"
                : "already_subscribed",
              provider: "stripe",
              cancel_at_period_end: Boolean(activeSub.cancel_at_period_end),
              period_end: periodEnd,
              subscription_id: activeSub.id,
            },
          );
        }
      } catch (e) {
        console.warn("[create-checkout-session] Stripe active-sub check failed", e);
      }
    }

    // Check RevenueCat / mobile subscriptions to avoid cross-platform double billing
    const rcSubscriber = await fetchRevenueCatSubscriber(
      userId,
      REVENUECAT_SECRET_API_KEY,
    );
    const rcState = getRevenueCatRenewableState(rcSubscriber);

    if (rcState.hasRenewableSubscription) {
      return err(
        409,
        rcState.cancelAtPeriodEnd
          ? "This account already has a mobile subscription that remains active until the current period ends."
          : "This account already has an active mobile subscription.",
        {
          action: rcState.cancelAtPeriodEnd
            ? "already_canceled_but_active"
            : "already_subscribed",
          provider: "revenuecat",
          store: rcState.store,
          management_url: rcState.managementUrl,
          cancel_at_period_end: rcState.cancelAtPeriodEnd,
          period_end: rcState.latestExpiry,
          store_managed: isStoreManagedStore(rcState.store),
        },
      );
    }

    // If we still do not have a Stripe customer id, keep null and let checkout create one
    if (!stripeCustomerId) {
      try {
        const { data: row, error: rowErr } = await supabase
          .from("users")
          .select("stripe_customer_id")
          .eq("id", userId)
          .maybeSingle();

        if (!rowErr && row?.stripe_customer_id) {
          stripeCustomerId = String(row.stripe_customer_id);
        }
      } catch {
        // non-fatal
      }
    }

    const mode: Stripe.Checkout.SessionCreateParams.Mode =
      plan === "lifetime" ? "payment" : "subscription";

    const metadataBase: Record<string, string> = {
      user_id: userId,
      supabase_user_id: userId,
      plan,
      ...(email ? { email } : {}),
      ...(referral_code ? { referral_code } : {}),
    };

    const common: Stripe.Checkout.SessionCreateParams = {
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      allow_promotion_codes: true,
      client_reference_id: userId,
      metadata: metadataBase,
      ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),
      ...(!stripeCustomerId && email ? { customer_email: email } : {}),
    };

    const params: Stripe.Checkout.SessionCreateParams =
      mode === "payment"
        ? {
            ...common,
            customer_creation: stripeCustomerId ? undefined : "always",
            payment_intent_data: {
              metadata: metadataBase,
            },
          }
        : {
            ...common,
            subscription_data: {
              metadata: {
                supabase_user_id: userId,
                user_id: userId,
                plan,
              },
            },
          };

    const session = await stripe.checkout.sessions.create(params);

    return ok({
      id: session.id,
      url: session.url,
      provider: "stripe",
      action: "checkout_created",
    });
  } catch (e: unknown) {
    console.error("[create-checkout-session] error:", e);
    return err(500, messageFrom(e));
  }
});