// supabase/functions/create-checkout-session/index.ts
import Stripe from "npm:stripe@14";

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

const APP_URL = Deno.env.get("APP_URL") ?? "http://localhost:5173";

const SUCCESS_URL =
  Deno.env.get("STRIPE_SUCCESS_URL") ??
  `${APP_URL}/pay/success?session_id={CHECKOUT_SESSION_ID}`;

const CANCEL_URL =
  Deno.env.get("STRIPE_CANCEL_URL") ?? `${APP_URL}/pay/cancel`;

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

  let body: Incoming = {};
  try {
    body = (await req.json()) as Incoming;
  } catch {
    // keep empty
  }

  const user_id = body.user_id ?? body.userId ?? undefined;
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
    const mode: Stripe.Checkout.SessionCreateParams.Mode =
      plan === "lifetime" ? "payment" : "subscription";

    const common: Stripe.Checkout.SessionCreateParams = {
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL,
      allow_promotion_codes: true,

      ...(user_id ? { client_reference_id: user_id } : {}),
      ...(body.email ? { customer_email: body.email } : {}),

      metadata: {
        ...(user_id ? { user_id } : {}),
        ...(body.email ? { email: body.email } : {}),
        ...(referral_code ? { referral_code } : {}),
        plan,
      },
    };

    // IMPORTANT:
    // - customer_creation is ONLY valid for payment mode
    // - for subscription mode, Stripe will handle customer creation automatically
    const params: Stripe.Checkout.SessionCreateParams =
      mode === "payment"
        ? {
            ...common,
            customer_creation: "always",
          }
        : {
            ...common,
            subscription_data: {
              metadata: user_id ? { supabase_user_id: user_id } : {},
            },
          };

    const session = await stripe.checkout.sessions.create(params);

    return ok({ id: session.id, url: session.url });
  } catch (e: unknown) {
    console.error("[create-checkout-session] error:", e);
    return err(500, messageFrom(e));
  }
});
