import Stripe from "npm:stripe@14";
import { createClient } from "npm:@supabase/supabase-js@2";

/** CORS/JSON */
const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const SB_URL = Deno.env.get("SB_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SB_SERVICE_ROLE_KEY =
  Deno.env.get("SB_SERVICE_ROLE_KEY") ??
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
  "";

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(SB_URL, SB_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

function requireEnv() {
  const missing: string[] = [];
  if (!STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!SB_URL) missing.push("SB_URL or SUPABASE_URL");
  if (!SB_SERVICE_ROLE_KEY) {
    missing.push("SB_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY");
  }

  if (missing.length) {
    console.error("Missing required env vars:", missing);
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

const ts = (unix?: number | null): string | null =>
  typeof unix === "number" ? new Date(unix * 1000).toISOString() : null;

function farFutureISO() {
  return new Date("2099-12-31T23:59:59.000Z").toISOString();
}

function isSubscriptionStatusActive(status?: string | null) {
  return status === "active" || status === "trialing" || status === "past_due";
}

type UserRow = {
  id: string;
  email: string | null;
  grandfathered: boolean | null;
  tier: string | null;
  is_premium: boolean | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  premium_access_expires_at: string | null;
  price_id: string | null;
  is_pro?: boolean | null;
  pro_since?: string | null;
};

/** --- Logging helpers (DB) --- */
async function logEventStart(event: Stripe.Event) {
  await supabase.from("stripe_webhook_log").upsert(
    {
      event_id: event.id,
      event_type: event.type,
      processed_ok: false,
      payload: event as unknown as Record<string, unknown>,
    },
    { onConflict: "event_id" },
  );
}

async function logEventEnd(eventId: string, ok: boolean, error?: string) {
  await supabase
    .from("stripe_webhook_log")
    .update({
      processed_ok: ok,
      error: error ?? null,
    })
    .eq("event_id", eventId);
}

/** --- Find user helpers --- */
async function findUserIdByCustomer(customerId?: string) {
  if (!customerId) return undefined;

  const { data: u1 } = await supabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (u1?.id) return u1.id as string;

  const { data: u2 } = await supabase
    .from("stripe_customers")
    .select("user_id")
    .eq("customer_id", customerId)
    .maybeSingle();
  if (u2?.user_id) return u2.user_id as string;

  return undefined;
}

async function findUserIdByEmail(email?: string | null) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return undefined;

  const { data } = await supabase
    .from("users")
    .select("id")
    .ilike("email", normalized)
    .maybeSingle();

  return (data?.id as string) || undefined;
}

async function getUserIdFromCustomerMetadata(customerId: string) {
  try {
    const cust = await stripe.customers.retrieve(customerId);
    const meta = (cust as Stripe.Customer).metadata || {};
    return (meta.supabase_user_id as string) || undefined;
  } catch (e) {
    console.warn("Could not read Stripe customer metadata", e);
    return undefined;
  }
}

async function tagCustomerWithUserId(customerId: string, userId: string) {
  try {
    await stripe.customers.update(customerId, {
      metadata: { supabase_user_id: userId },
    });
  } catch (e) {
    console.warn("Failed to set customer metadata.supabase_user_id", e);
  }
}

async function upsertStripeCustomerMap(opts: {
  userId: string;
  customerId: string;
  email?: string | null;
}) {
  const { userId, customerId, email } = opts;

  await supabase.from("stripe_customers").upsert(
    {
      user_id: userId,
      customer_id: customerId,
      email: email ?? null,
    },
    { onConflict: "customer_id" },
  );
}

async function getUserRow(userId: string): Promise<UserRow | null> {
  const { data, error } = await supabase
    .from("users")
    .select(
      [
        "id",
        "email",
        "grandfathered",
        "tier",
        "is_premium",
        "stripe_customer_id",
        "stripe_subscription_id",
        "subscription_status",
        "current_period_end",
        "cancel_at_period_end",
        "premium_access_expires_at",
        "price_id",
        "is_pro",
        "pro_since",
      ].join(","),
    )
    .eq("id", userId)
    .single();

  if (error) {
    console.error("getUserRow error:", error);
    return null;
  }

  return (data ?? null) as unknown as UserRow | null;
}

/** --- Updates --- */
type UserUpdate = Record<string, unknown>;

async function markUserProLifetime(opts: {
  userId: string;
  customerId?: string | null;
  priceId?: string | null;
  setGrandfathered?: boolean;
}) {
  const { userId, customerId, priceId, setGrandfathered = false } = opts;

  const existing = await getUserRow(userId);
  const alreadyGrandfathered = Boolean(existing?.grandfathered);
  const grandfathered = alreadyGrandfathered || setGrandfathered;

  const update: UserUpdate = {
    stripe_customer_id: customerId ?? existing?.stripe_customer_id ?? null,
    stripe_subscription_id: null,
    subscription_status: grandfathered ? "grandfathered" : "active",
    current_period_end: null,
    cancel_at_period_end: false,
    is_premium: true,
    premium_access_expires_at: farFutureISO(),
    price_id: priceId ?? null,
    grandfathered,

    tier: "pro",
    is_pro: true,
    pro_since: existing?.pro_since ?? new Date().toISOString(),
  };

  const { error } = await supabase.from("users").update(update).eq("id", userId);
  if (error) console.error("markUserProLifetime error:", error);
}

async function upsertSubscriptionOnUser(opts: {
  userId: string;
  customerId: string;
  sub: Stripe.Subscription;
  priceId?: string | null;
}) {
  const { userId, customerId, sub, priceId } = opts;

  const existing = await getUserRow(userId);
  const isGrandfathered = Boolean(existing?.grandfathered);

  const firstItem = sub.items?.data?.[0];
  let subPriceId: string | null = null;

  if (firstItem?.price) {
    subPriceId =
      typeof firstItem.price === "string"
        ? firstItem.price
        : firstItem.price.id ?? null;
  }

  const premium = isSubscriptionStatusActive(sub.status);

  const hasEffectivePro = isGrandfathered || premium;

  const update: UserUpdate = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    subscription_status: isGrandfathered
      ? "grandfathered"
      : sub.status,
    current_period_end: premium ? ts(sub.current_period_end) : null,
    cancel_at_period_end: premium ? Boolean(sub.cancel_at_period_end) : false,
    is_premium: hasEffectivePro,
    premium_access_expires_at: premium ? ts(sub.current_period_end) : null,
    price_id: subPriceId ?? priceId ?? null,
    grandfathered: isGrandfathered,

    tier: hasEffectivePro ? "pro" : "free",
    is_pro: hasEffectivePro,
    ...(hasEffectivePro
      ? { pro_since: existing?.pro_since ?? new Date().toISOString() }
      : {}),
  };

  const { error } = await supabase.from("users").update(update).eq("id", userId);
  if (error) console.error("upsertSubscriptionOnUser error:", error);
}

async function markUserFree(opts: { userId: string }) {
  const { userId } = opts;

  const existing = await getUserRow(userId);
  const isGrandfathered = Boolean(existing?.grandfathered);

  const update: UserUpdate = isGrandfathered
    ? {
        stripe_subscription_id: null,
        subscription_status: "grandfathered",
        current_period_end: null,
        cancel_at_period_end: false,
        is_premium: true,
        premium_access_expires_at: farFutureISO(),
        price_id: null,
        grandfathered: true,

        tier: "pro",
        is_pro: true,
        pro_since: existing?.pro_since ?? new Date().toISOString(),
      }
    : {
        stripe_subscription_id: null,
        subscription_status: "canceled",
        current_period_end: null,
        cancel_at_period_end: false,
        is_premium: false,
        premium_access_expires_at: null,
        price_id: null,
        grandfathered: false,

        tier: "free",
        is_pro: false,
      };

  const { error } = await supabase.from("users").update(update).eq("id", userId);
  if (error) console.error("markUserFree error:", error);
}

Deno.serve(async (req: Request): Promise<Response> => {
  try {
    requireEnv();
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...JSON_HEADERS,
        "access-control-allow-methods": "POST,OPTIONS",
        "access-control-allow-headers": "content-type, stripe-signature",
      },
    });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return json({ error: "Missing Stripe-Signature" }, 400);
  }

  const raw = await req.text();
  let event: Stripe.Event;

  try {
    event = await stripe.webhooks.constructEventAsync(
      raw,
      signature,
      STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    console.error("Stripe signature verification failed:", err);
    return json({ error: "Invalid signature" }, 400);
  }

  await logEventStart(event);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;

        const customerId = (s.customer as string) || undefined;
        const email = s.customer_details?.email || s.customer_email || undefined;

        const meta = (s.metadata || {}) as Record<string, string>;
        const userIdFromMeta = meta.user_id || meta.supabase_user_id || undefined;
        const userIdFromClientRef = s.client_reference_id || undefined;
        const planKind = meta.plan_kind || meta.plan_type || "";

        const userId =
          userIdFromMeta ||
          userIdFromClientRef ||
          (await findUserIdByCustomer(customerId)) ||
          (await findUserIdByEmail(email));

        if (!userId) {
          console.warn("No user match for checkout.session.completed", {
            customerId,
            email,
            client_reference_id: userIdFromClientRef,
          });
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        let priceId: string | null = null;
        try {
          const items = await stripe.checkout.sessions.listLineItems(s.id, {
            limit: 1,
            expand: ["data.price"],
          });
          const li = items.data?.[0];
          if (li?.price) {
            priceId = typeof li.price === "string" ? li.price : li.price.id ?? null;
          }
        } catch (e) {
          console.warn("Could not fetch session line items", e);
        }

        if (customerId) {
          await upsertStripeCustomerMap({ userId, customerId, email });
          await tagCustomerWithUserId(customerId, userId);
        }

        if (s.mode === "subscription" && s.subscription && customerId) {
          const sub = await stripe.subscriptions.retrieve(s.subscription as string);
          await upsertSubscriptionOnUser({ userId, customerId, sub, priceId });
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        const isLifetimePurchase =
          planKind === "lifetime" ||
          planKind === "one_time_pro" ||
          planKind === "lifetime_pro";

        await markUserProLifetime({
          userId,
          customerId: customerId ?? null,
          priceId,
          setGrandfathered: isLifetimePurchase,
        });

        await logEventEnd(event.id, true);
        return json({ ok: true });
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        let userId = await findUserIdByCustomer(customerId);
        if (!userId) {
          userId = await getUserIdFromCustomerMetadata(customerId);
        }

        if (!userId) {
          console.warn("No user for subscription event", {
            customerId,
            type: event.type,
          });
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        await upsertStripeCustomerMap({ userId, customerId });
        await tagCustomerWithUserId(customerId, userId);
        await upsertSubscriptionOnUser({ userId, customerId, sub });

        await logEventEnd(event.id, true);
        return json({ ok: true });
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        let userId = await findUserIdByCustomer(customerId);
        if (!userId) {
          userId = await getUserIdFromCustomerMetadata(customerId);
        }

        if (!userId) {
          console.warn("No user for subscription.deleted", { customerId });
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        await markUserFree({ userId });

        await logEventEnd(event.id, true);
        return json({ ok: true });
      }

      case "invoice.payment_succeeded": {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = (inv.customer as string) || undefined;

        if (!customerId) {
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        let userId = await findUserIdByCustomer(customerId);
        if (!userId) {
          userId = await getUserIdFromCustomerMetadata(customerId);
        }

        if (!userId) {
          console.warn("No user for invoice.payment_succeeded", { customerId });
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        const subId = (inv.subscription as string) || undefined;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscriptionOnUser({ userId, customerId, sub });
          await tagCustomerWithUserId(customerId, userId);
        }

        await logEventEnd(event.id, true);
        return json({ ok: true });
      }

      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = (inv.customer as string) || undefined;

        if (!customerId) {
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        let userId = await findUserIdByCustomer(customerId);
        if (!userId) {
          userId = await getUserIdFromCustomerMetadata(customerId);
        }

        if (!userId) {
          console.warn("No user for invoice.payment_failed", { customerId });
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        const subId = (inv.subscription as string) || undefined;

        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscriptionOnUser({ userId, customerId, sub });
          await tagCustomerWithUserId(customerId, userId);
        } else {
          const existing = await getUserRow(userId);
          const isGrandfathered = Boolean(existing?.grandfathered);

          await supabase
            .from("users")
            .update({
              subscription_status: isGrandfathered ? "grandfathered" : "past_due",
              tier: isGrandfathered ? "pro" : existing?.tier ?? "free",
              is_premium: isGrandfathered ? true : existing?.is_premium ?? false,
              is_pro: isGrandfathered ? true : existing?.is_pro ?? false,
            })
            .eq("id", userId);
        }

        await logEventEnd(event.id, true);
        return json({ ok: true });
      }

      default:
        await logEventEnd(event.id, true);
        return json({ received: true });
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    await logEventEnd(event.id, false, (err as Error).message);
    return json({ error: "Handler failure" }, 500);
  }
});