// supabase/functions/stripe-webhook/index.ts
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
  if (!SB_SERVICE_ROLE_KEY)
    missing.push("SB_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY");

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

/** --- Logging helpers (DB) --- */
async function logEventStart(event: Stripe.Event) {
  // Try insert; if duplicate event_id, ignore
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

  // 1) direct column on users
  const { data: u1 } = await supabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  if (u1?.id) return u1.id as string;

  // 2) stripe_customers mapping table
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

  // ilike is fine, but email should generally match exactly
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
    const uid = (meta.supabase_user_id as string) || undefined;
    return uid;
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
  // best-effort
  await supabase.from("stripe_customers").upsert(
    {
      user_id: userId,
      customer_id: customerId,
      email: email ?? null,
    },
    { onConflict: "customer_id" },
  );
}

/** --- Updates --- */
type UserUpdate = Record<string, unknown>;

async function markUserProLifetime(opts: {
  userId: string;
  customerId?: string | null;
  priceId?: string | null;
}) {
  const { userId, customerId, priceId } = opts;

  const update: UserUpdate = {
    // Stripe fields
    stripe_customer_id: customerId ?? null,
    stripe_subscription_id: null,
    subscription_status: "active",
    current_period_end: null,
    cancel_at_period_end: false,
    is_premium: true,
    premium_access_expires_at: farFutureISO(),
    price_id: priceId ?? null,
    grandfathered: false,

    // App/UI fields
    tier: "pro",
    is_pro: true,
    pro_since: new Date().toISOString(),
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

  const firstItem = sub.items?.data?.[0];
  let subPriceId: string | null = null;
  if (firstItem?.price) {
    subPriceId =
      typeof firstItem.price === "string"
        ? firstItem.price
        : firstItem.price.id ?? null;
  }

  const premium =
    sub.status === "active" ||
    sub.status === "trialing" ||
    sub.status === "past_due";

  const update: UserUpdate = {
    stripe_customer_id: customerId,
    stripe_subscription_id: sub.id,
    subscription_status: sub.status,
    current_period_end: ts(sub.current_period_end),
    cancel_at_period_end: Boolean(sub.cancel_at_period_end),
    is_premium: premium,
    premium_access_expires_at: premium ? ts(sub.current_period_end) : null,
    price_id: subPriceId ?? priceId ?? null,
    grandfathered: false,

    // UI fields
    tier: premium ? "pro" : "free",
    is_pro: premium,
    ...(premium ? { pro_since: new Date().toISOString() } : {}),
  };

  const { error } = await supabase.from("users").update(update).eq("id", userId);
  if (error) console.error("upsertSubscriptionOnUser error:", error);
}

async function markUserFree(opts: { userId: string }) {
  const { userId } = opts;

  const update: UserUpdate = {
    stripe_subscription_id: null,
    subscription_status: "canceled",
    current_period_end: null,
    cancel_at_period_end: false,
    is_premium: false,
    premium_access_expires_at: null,
    price_id: null,
    grandfathered: false,

    // UI fields
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
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const signature = req.headers.get("stripe-signature");
  if (!signature) return json({ error: "Missing Stripe-Signature" }, 400);

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

        // Pull a price id from line item (best effort)
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

        // Save mapping + tag customer metadata
        if (customerId) {
          await upsertStripeCustomerMap({ userId, customerId, email });
          await tagCustomerWithUserId(customerId, userId);
        }

        // Subscription checkout (monthly/yearly)
        if (s.mode === "subscription" && s.subscription && customerId) {
          const sub = await stripe.subscriptions.retrieve(s.subscription as string);
          await upsertSubscriptionOnUser({ userId, customerId, sub, priceId });
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        // Lifetime
        await markUserProLifetime({ userId, customerId: customerId ?? null, priceId });
        await logEventEnd(event.id, true);
        return json({ ok: true });
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        let userId = await findUserIdByCustomer(customerId);
        if (!userId) userId = await getUserIdFromCustomerMetadata(customerId);

        if (!userId) {
          console.warn("No user for subscription event", { customerId, type: event.type });
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
        if (!userId) userId = await getUserIdFromCustomerMetadata(customerId);

        if (!userId) {
          console.warn("No user for subscription.deleted", { customerId });
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        // ✅ This is the moment Stripe has actually ended the subscription.
        // ✅ This is what guarantees "downgrade ends payments" + user returns to free.
        await markUserFree({ userId });

        await logEventEnd(event.id, true);
        return json({ ok: true });
      }

      case "invoice.payment_succeeded": {
        // Reliable signal a subscription actually paid
        const inv = event.data.object as Stripe.Invoice;
        const customerId = (inv.customer as string) || undefined;

        if (!customerId) {
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        let userId = await findUserIdByCustomer(customerId);
        if (!userId) userId = await getUserIdFromCustomerMetadata(customerId);

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
        // ✅ IMPORTANT FIX:
        // Do NOT force user to free here.
        // Payment can fail transiently; Stripe retries; user may still be within paid period.
        // Mark status and (best effort) sync subscription from Stripe.
        const inv = event.data.object as Stripe.Invoice;
        const customerId = (inv.customer as string) || undefined;

        if (!customerId) {
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        let userId = await findUserIdByCustomer(customerId);
        if (!userId) userId = await getUserIdFromCustomerMetadata(customerId);

        if (!userId) {
          console.warn("No user for invoice.payment_failed", { customerId });
          await logEventEnd(event.id, true);
          return json({ ok: true });
        }

        const subId = (inv.subscription as string) || undefined;

        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          // This will set status=past_due and keep access until period end.
          await upsertSubscriptionOnUser({ userId, customerId, sub });
          await tagCustomerWithUserId(customerId, userId);
        } else {
          // If no subscription id, just record status (do NOT downgrade access hard)
          await supabase
            .from("users")
            .update({
              subscription_status: "past_due",
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
