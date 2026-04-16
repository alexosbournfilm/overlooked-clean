// supabase/functions/create-checkout-session/index.ts
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
  Deno.env.get("STRIPE_PRICE_ID") ?? // legacy fallback
  "";

const PRICE_YEARLY = Deno.env.get("STRIPE_PRICE_YEARLY") ?? "";
const PRICE_LIFETIME = Deno.env.get("STRIPE_PRICE_LIFETIME") ?? "";

// App URLs
const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:5173";

const SUCCESS_URL =
  Deno.env.get("STRIPE_SUCCESS_URL") ??
  `${APP_URL}/pay/success?session_id={CHECKOUT_SESSION_ID}`;

const CANCEL_URL =
  Deno.env.get("STRIPE_CANCEL_URL") ?? `${APP_URL}/pay/cancel`;

// Supabase (for auth verification + existing stripe_customer_id lookup)
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
function err(status: number, message: string): Response {
  return ok({ error: message }, status);
}
function messageFrom(e: unknown): string {
  if (e && typeof e === "object") {
    const m = (e as { message?: unknown }).message;
    if (typeof m === "string") return m;
  }
  return "Unknown error";
}

// ---------- types ----------
type Incoming = {
  // legacy fields (we no longer trust these, but we accept them)
  user_id?: string;
  userId?: string;

  email?: string;
  plan?: Plan;

  referral_code?: string;
  promoCode?: string;

  priceId?: string; // optional override for debugging
};

// ---------- handler ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (req.method !== "POST") return err(405, "Method not allowed");
  if (!STRIPE_SECRET_KEY) return err(500, "Missing STRIPE_SECRET_KEY");
  if (!SB_URL) return err(500, "Missing SB_URL / SUPABASE_URL");
  if (!SB_SERVICE_ROLE_KEY) return err(500, "Missing SB_SERVICE_ROLE_KEY / SUPABASE_SERVICE_ROLE_KEY");

  // ✅ Require auth header so we can verify the user
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!authHeader) return err(401, "Missing Authorization header");

  // Service role client (bypasses RLS for reading users.stripe_customer_id)
  // But we still validate the caller via JWT using getUser with the caller token.
  const supabase = createClient(SB_URL, SB_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  let body: Incoming = {};
  try {
    body = (await req.json()) as Incoming;
  } catch {
    // keep empty
  }

  // ✅ Auth-verified user (do NOT trust body.user_id)
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userRes?.user?.id) {
    return err(401, "Invalid session");
  }

  const userId = userRes.user.id;
  const emailFromAuth = userRes.user.email ?? undefined;

  // Optional: allow client to pass email, but never override authenticated email with something else
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
    // ✅ If we already have a Stripe customer id, reuse it (prevents duplicates)
    let stripeCustomerId: string | null = null;
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

    const mode: Stripe.Checkout.SessionCreateParams.Mode =
      plan === "lifetime" ? "payment" : "subscription";

    const metadataBase: Record<string, string> = {
      user_id: userId,
      supabase_user_id: userId, // helpful for consistency
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

      // ✅ easiest matching in webhook
      client_reference_id: userId,

      // ✅ always attach metadata at session-level
      metadata: metadataBase,

      // ✅ If we already know the customer, attach it (best)
      ...(stripeCustomerId ? { customer: stripeCustomerId } : {}),

      // ✅ If we don't know customer yet, Stripe can create it; provide email
      ...(!stripeCustomerId && email ? { customer_email: email } : {}),
    };

    // IMPORTANT:
    // - customer_creation is ONLY valid for payment mode
    // - for subscription mode, Stripe will handle customer creation automatically
    const params: Stripe.Checkout.SessionCreateParams =
      mode === "payment"
        ? {
            ...common,
            customer_creation: stripeCustomerId ? undefined : "always",

            // ✅ Ensure lifetime payment has metadata too (useful for debugging)
            payment_intent_data: {
              metadata: metadataBase,
            },
          }
        : {
            ...common,
            subscription_data: {
              // ✅ Super important: persists onto the subscription object
              metadata: { supabase_user_id: userId, user_id: userId, plan },
            },
          };

    const session = await stripe.checkout.sessions.create(params);

    return ok({ id: session.id, url: session.url });
  } catch (e: unknown) {
    console.error("[create-checkout-session] error:", e);
    return err(500, messageFrom(e));
  }
});
