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

// ✅ IMPORTANT for Deno Edge: use Fetch HTTP client
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  httpClient: Stripe.createFetchHttpClient(),
});

const supabase = createClient(SB_URL, SB_SERVICE_ROLE_KEY);

/** Helpers */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

const ts = (unix?: number | null): string | null =>
  typeof unix === "number" ? new Date(unix * 1000).toISOString() : null;

async function findUserIdByCustomer(customerId?: string) {
  if (!customerId) return undefined;
  const { data } = await supabase
    .from("users")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data?.id as string) || undefined;
}

async function findUserIdByEmail(email?: string | null) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return undefined;

  // ✅ case-insensitive match
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

// Used for lifetime purchases
function farFutureISO() {
  return new Date("2099-12-31T23:59:59.000Z").toISOString();
}

type UserUpdate = {
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
  subscription_status?:
    | Stripe.Subscription.Status
    | "canceled"
    | "past_due"
    | "active"
    | null;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean;
  is_premium?: boolean;
  price_id?: string | null;
  tier?: "free" | "pro";

  premium_access_expires_at?: string | null;
  grandfathered?: boolean | null;
};

async function upsertStripeIdsOnUser(opts: {
  userId: string;
  customerId?: string | null;
  subscription?: Stripe.Subscription | null;
  priceId?: string | null;
}) {
  const { userId, customerId, subscription, priceId } = opts;

  const update: UserUpdate = {};
  if (customerId) update.stripe_customer_id = customerId;

  if (subscription) {
    update.stripe_subscription_id = subscription.id;
    update.subscription_status = subscription.status;
    update.current_period_end = ts(subscription.current_period_end);
    update.cancel_at_period_end = Boolean(subscription.cancel_at_period_end);

    const firstItem = subscription.items?.data?.[0];
    let subPriceId: string | null = null;
    if (firstItem?.price) {
      subPriceId =
        typeof firstItem.price === "string"
          ? firstItem.price
          : firstItem.price.id ?? null;
    }
    update.price_id = subPriceId ?? priceId ?? null;

    const premium =
      subscription.status === "active" || subscription.status === "trialing";

    update.is_premium = premium;
    update.tier = premium ? "pro" : "free";

    update.premium_access_expires_at = premium
      ? ts(subscription.current_period_end)
      : null;

    update.grandfathered = false;
  } else if (typeof priceId === "string") {
    update.price_id = priceId;
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from("users").update(update).eq("id", userId);
    if (error) console.error("Failed updating users for stripe ids:", error);
  }
}

Deno.serve(async (req) => {
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

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const s = event.data.object as Stripe.Checkout.Session;

        const customerId = (s.customer as string) || undefined;
        const email = s.customer_details?.email || s.customer_email || undefined;
        const meta = (s.metadata || {}) as Record<string, string>;
        const userIdFromMeta = meta.user_id || meta.supabase_user_id;
        const userIdFromClientRef = s.client_reference_id || undefined;

        const byCustomer = await findUserIdByCustomer(customerId);
        const byEmail = !byCustomer ? await findUserIdByEmail(email) : undefined;

        const userId =
          userIdFromMeta || userIdFromClientRef || byCustomer || byEmail;

        if (!userId) {
          console.warn("No user match for checkout.session.completed", {
            customerId,
            email,
            client_reference_id: userIdFromClientRef,
          });
          return json({ ok: true });
        }

        // Try to fetch priceId from line items (nice-to-have)
        let priceId: string | null = null;
        try {
          const items = await stripe.checkout.sessions.listLineItems(s.id, {
            limit: 1,
            expand: ["data.price"],
          });
          const li = items.data?.[0];
          if (li?.price) {
            priceId =
              typeof li.price === "string" ? li.price : li.price.id ?? null;
          }
        } catch (e) {
          console.warn("Could not fetch session line items for price_id", e);
        }

        await upsertStripeIdsOnUser({
          userId,
          customerId,
          subscription: null,
          priceId,
        });

        if (customerId) await tagCustomerWithUserId(customerId, userId);

        if (s.mode === "subscription" && s.subscription) {
          // subscription checkout (monthly/yearly)
          const sub = await stripe.subscriptions.retrieve(s.subscription as string);
          await upsertStripeIdsOnUser({
            userId,
            customerId,
            subscription: sub,
          });
        } else {
          // one-time checkout (lifetime)
          const update: UserUpdate = {
            tier: "pro",
            is_premium: true,
            subscription_status: "active",
            current_period_end: null,
            cancel_at_period_end: false,
            premium_access_expires_at: farFutureISO(),
            grandfathered: false,
            price_id: priceId ?? null,
          };

          const { error } = await supabase.from("users").update(update).eq("id", userId);
          if (error) console.error("Failed marking user pro (one-time):", error);
        }

        return json({ ok: true });
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        let userId = await findUserIdByCustomer(customerId);
        if (!userId) userId = await getUserIdFromCustomerMetadata(customerId);

        if (!userId) {
          console.warn("No user for subscription event", { customerId, type: event.type });
          return json({ ok: true });
        }

        await upsertStripeIdsOnUser({ userId, customerId, subscription: sub });
        await tagCustomerWithUserId(customerId, userId);
        return json({ ok: true });
      }

      case "invoice.payment_succeeded": {
        // ✅ Most reliable “they paid” signal for subscriptions
        const inv = event.data.object as Stripe.Invoice;

        const customerId = (inv.customer as string) || undefined;
        if (!customerId) return json({ ok: true });

        let userId = await findUserIdByCustomer(customerId);
        if (!userId) userId = await getUserIdFromCustomerMetadata(customerId);

        if (!userId) {
          console.warn("No user for invoice.payment_succeeded", { customerId });
          return json({ ok: true });
        }

        const subId = (inv.subscription as string) || undefined;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertStripeIdsOnUser({ userId, customerId, subscription: sub });
          await tagCustomerWithUserId(customerId, userId);
          return json({ ok: true });
        }

        // Rare fallback
        const update: UserUpdate = {
          tier: "pro",
          is_premium: true,
          subscription_status: "active",
          grandfathered: false,
        };
        await supabase.from("users").update(update).eq("id", userId);
        return json({ ok: true });
      }

      case "customer.deleted": {
        const c = event.data.object as Stripe.Customer;
        const userId = await findUserIdByCustomer(c.id);

        if (userId) {
          const update: UserUpdate = {
            stripe_customer_id: null,
            stripe_subscription_id: null,
            subscription_status: "canceled",
            current_period_end: null,
            cancel_at_period_end: false,
            is_premium: false,
            tier: "free",
            premium_access_expires_at: null,
            grandfathered: false,
          };
          await supabase.from("users").update(update).eq("id", userId);
        }

        return json({ ok: true });
      }

      case "invoice.payment_failed": {
        const inv = event.data.object as Stripe.Invoice;
        const customerId = inv.customer as string;

        let userId = await findUserIdByCustomer(customerId);
        if (!userId) userId = await getUserIdFromCustomerMetadata(customerId);

        if (userId) {
          const update: UserUpdate = {
            subscription_status: "past_due",
            is_premium: false,
            tier: "free",
            premium_access_expires_at: null,
            grandfathered: false,
          };
          await supabase.from("users").update(update).eq("id", userId);
        }

        return json({ ok: true });
      }

      default:
        return json({ received: true });
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    return json({ error: "Handler failure" }, 500);
  }
});
