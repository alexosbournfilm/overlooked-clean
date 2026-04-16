// supabase/functions/revenuecat-webhook/index.ts
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: any) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });

type RcWebhookEvent = {
  id?: string;
  type?: string;
  app_user_id?: string;
  original_app_user_id?: string;
  aliases?: string[];
  environment?: string | null;
  entitlement_id?: string | null;
  entitlement_ids?: string[] | null;
  product_id?: string | null;
  event_timestamp_ms?: number | null;
};

type RcEntitlementV1 = {
  product_identifier?: string | null;
  purchase_date?: string | null;
  expires_date?: string | null;
};

type RcSubscriberV1 = {
  request_date?: string;
  request_date_ms?: number;
  subscriber?: {
    original_app_user_id?: string | null;
    original_application_version?: string | null;
    original_purchase_date?: string | null;
    management_url?: string | null;
    first_seen?: string | null;
    last_seen?: string | null;
    subscriptions?: Record<
      string,
      {
        expires_date?: string | null;
        purchase_date?: string | null;
        original_purchase_date?: string | null;
        ownership_type?: string | null;
        period_type?: string | null;
        store?: string | null;
        unsubscribe_detected_at?: string | null;
        billing_issues_detected_at?: string | null;
        grace_period_expires_date?: string | null;
        refunded_at?: string | null;
      }
    >;
    entitlements?: Record<string, RcEntitlementV1>;
    non_subscriptions?: Record<string, any[]>;
  };
};

type UserBillingRow = {
  id: string;
  tier: string | null;
  is_premium: boolean | null;
  grandfathered: boolean | null;
  subscription_status: string | null;
  cancel_at_period_end: boolean | null;
  current_period_end: string | null;
  premium_access_expires_at: string | null;
  stripe_customer_id?: string | null;
  stripe_subscription_id?: string | null;
};

function normalizeAuthHeader(value: string | null): string {
  if (!value) return "";
  return value.trim();
}

function isAuthorized(received: string | null, expected: string | null): boolean {
  if (!expected) return true;
  const got = normalizeAuthHeader(received);
  const want = normalizeAuthHeader(expected);

  if (!got) return false;
  if (got === want) return true;
  if (got === `Bearer ${want}`) return true;

  return false;
}

function makeSyntheticEventId(event: RcWebhookEvent): string {
  return [
    event.type ?? "unknown",
    event.app_user_id ?? "unknown-user",
    event.product_id ?? "unknown-product",
    String(event.event_timestamp_ms ?? Date.now()),
  ].join(":");
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

function isStripeishStatusActive(status?: string | null): boolean {
  return (
    status === "trialing" ||
    status === "active" ||
    status === "past_due" ||
    status === "unpaid" ||
    status === "canceled"
  );
}

function hasEffectiveStripeAccess(row: UserBillingRow | null): boolean {
  if (!row) return false;

  const hasStripeIds =
    Boolean(row.stripe_customer_id) || Boolean(row.stripe_subscription_id);

  if (!hasStripeIds) return false;

  const expiresAt =
    row.premium_access_expires_at ?? row.current_period_end ?? null;

  if (expiresAt && isFuture(expiresAt, 5_000)) {
    return true;
  }

  if (isStripeishStatusActive(row.subscription_status)) {
    return true;
  }

  return false;
}

async function markEventSeen(
  supabaseAdmin: any,
  eventId: string,
  event: RcWebhookEvent,
) {
  const { error } = await supabaseAdmin.from("revenuecat_webhook_events").insert({
    event_id: eventId,
    app_user_id: event.app_user_id ?? null,
    event_type: event.type ?? "UNKNOWN",
    environment: event.environment ?? null,
    payload: event,
  });

  if (!error) {
    return { inserted: true };
  }

  if (error.code === "23505") {
    return { inserted: false };
  }

  throw error;
}

async function fetchRevenueCatSubscriber(
  appUserId: string,
  secretApiKey: string,
): Promise<RcSubscriberV1> {
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
    parsed = { raw: text };
  }

  if (!resp.ok) {
    throw new Error(
      `RevenueCat GET /subscribers failed (${resp.status}): ${
        parsed?.message || parsed?.error || text || "Unknown error"
      }`,
    );
  }

  return parsed as RcSubscriberV1;
}

function pickCurrentProEntitlement(
  subscriber: RcSubscriberV1,
): RcEntitlementV1 | null {
  const entitlements = subscriber?.subscriber?.entitlements ?? {};
  const pro = entitlements?.pro ?? null;
  return pro ?? null;
}

function deriveCurrentPeriodEnd(
  subscriber: RcSubscriberV1,
  entitlement: RcEntitlementV1 | null,
): string | null {
  const entitlementExpiry = toIso(entitlement?.expires_date ?? null);
  if (entitlementExpiry) return entitlementExpiry;

  const subscriptions = subscriber?.subscriber?.subscriptions ?? {};
  let latest: string | null = null;

  for (const sub of Object.values(subscriptions)) {
    const expires = toIso(sub?.expires_date ?? null);
    if (!expires) continue;
    if (!latest || new Date(expires).getTime() > new Date(latest).getTime()) {
      latest = expires;
    }
  }

  return latest;
}

function deriveCancelAtPeriodEnd(subscriber: RcSubscriberV1): boolean {
  const subscriptions = subscriber?.subscriber?.subscriptions ?? {};

  for (const sub of Object.values(subscriptions)) {
    if (sub?.unsubscribe_detected_at) return true;
  }

  return false;
}

function deriveBillingIssue(subscriber: RcSubscriberV1): boolean {
  const subscriptions = subscriber?.subscriber?.subscriptions ?? {};

  for (const sub of Object.values(subscriptions)) {
    if (sub?.billing_issues_detected_at) return true;
  }

  return false;
}

function deriveRefunded(subscriber: RcSubscriberV1): boolean {
  const subscriptions = subscriber?.subscriber?.subscriptions ?? {};

  for (const sub of Object.values(subscriptions)) {
    if (sub?.refunded_at) return true;
  }

  return false;
}

function deriveSubscriptionStatus(args: {
  hasActivePaidPro: boolean;
  cancelAtPeriodEnd: boolean;
  billingIssue: boolean;
  refunded: boolean;
  isGrandfathered: boolean;
  preserveExistingStatus?: string | null;
}): string {
  if (args.isGrandfathered) return "grandfathered";
  if (args.refunded) return "refunded";
  if (args.hasActivePaidPro && args.billingIssue) return "billing_issue";
  if (args.hasActivePaidPro && args.cancelAtPeriodEnd) return "canceled";
  if (args.hasActivePaidPro) return "active";
  return args.preserveExistingStatus ?? "expired";
}

async function getCurrentUserBillingRow(
  supabaseAdmin: any,
  userId: string,
): Promise<UserBillingRow | null> {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select(
      [
        "id",
        "tier",
        "is_premium",
        "grandfathered",
        "subscription_status",
        "cancel_at_period_end",
        "current_period_end",
        "premium_access_expires_at",
        "stripe_customer_id",
        "stripe_subscription_id",
      ].join(","),
    )
    .eq("id", userId)
    .single();

  if (error) throw error;

  return (data ?? null) as unknown as UserBillingRow | null;
}

async function syncUserFromRevenueCat(
  supabaseAdmin: any,
  userId: string,
  subscriber: RcSubscriberV1,
) {
  const existingUser = await getCurrentUserBillingRow(supabaseAdmin, userId);
  const isGrandfathered = Boolean(existingUser?.grandfathered);
  const hasStripeAccess = hasEffectiveStripeAccess(existingUser);

  const proEntitlement = pickCurrentProEntitlement(subscriber);
  const currentPeriodEnd = deriveCurrentPeriodEnd(subscriber, proEntitlement);

  const hasActivePaidPro =
    !!proEntitlement && isFuture(currentPeriodEnd, 5_000);

  const cancelAtPeriodEnd = deriveCancelAtPeriodEnd(subscriber);
  const billingIssue = deriveBillingIssue(subscriber);
  const refunded = deriveRefunded(subscriber);

  const hasEffectivePro =
    isGrandfathered || hasActivePaidPro || hasStripeAccess;

  // If RevenueCat is active, let it refresh the shared effective-access fields.
  // If RevenueCat is not active but Stripe is still active, preserve the existing Stripe snapshot.
  let payload: Record<string, any>;

  if (hasActivePaidPro) {
    const subscriptionStatus = deriveSubscriptionStatus({
      hasActivePaidPro,
      cancelAtPeriodEnd,
      billingIssue,
      refunded,
      isGrandfathered,
    });

    payload = {
      tier: "pro",
      is_premium: true,
      subscription_status: subscriptionStatus,
      cancel_at_period_end: cancelAtPeriodEnd,
      current_period_end: currentPeriodEnd,
      premium_access_expires_at: currentPeriodEnd,
    };
  } else if (isGrandfathered) {
    payload = {
      tier: "pro",
      is_premium: true,
      subscription_status: "grandfathered",
      cancel_at_period_end: false,
      current_period_end: null,
      premium_access_expires_at: null,
    };
  } else if (hasStripeAccess) {
    payload = {
      tier: "pro",
      is_premium: true,
      subscription_status: existingUser?.subscription_status ?? "active",
      cancel_at_period_end: existingUser?.cancel_at_period_end ?? false,
      current_period_end: existingUser?.current_period_end ?? null,
      premium_access_expires_at:
        existingUser?.premium_access_expires_at ?? existingUser?.current_period_end ?? null,
    };
  } else {
    payload = {
      tier: "free",
      is_premium: false,
      subscription_status: refunded ? "refunded" : "expired",
      cancel_at_period_end: false,
      current_period_end: null,
      premium_access_expires_at: null,
    };
  }

  const { error } = await supabaseAdmin
    .from("users")
    .update(payload)
    .eq("id", userId);

  if (error) throw error;

  return {
    isGrandfathered,
    hasStripeAccess,
    hasActivePaidPro,
    hasEffectivePro,
    cancelAtPeriodEnd: hasActivePaidPro ? cancelAtPeriodEnd : (payload.cancel_at_period_end ?? false),
    billingIssue,
    refunded,
    currentPeriodEnd:
      hasActivePaidPro
        ? currentPeriodEnd
        : (payload.current_period_end ?? null),
    subscriptionStatus: payload.subscription_status,
    productIdentifier: proEntitlement?.product_identifier ?? null,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  const SUPABASE_URL =
    Deno.env.get("SUPABASE_URL") ||
    Deno.env.get("PROJECT_URL") ||
    Deno.env.get("SB_URL");

  const SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SERVICE_ROLE_KEY") ||
    Deno.env.get("SB_SERVICE_ROLE_KEY");

  const REVENUECAT_WEBHOOK_AUTH =
    Deno.env.get("REVENUECAT_WEBHOOK_AUTH") || "";

  const REVENUECAT_SECRET_API_KEY =
    Deno.env.get("REVENUECAT_SECRET_API_KEY") || "";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "Missing Supabase service environment variables" });
  }

  if (!REVENUECAT_SECRET_API_KEY) {
    return json(500, { error: "Missing REVENUECAT_SECRET_API_KEY" });
  }

  if (!isAuthorized(req.headers.get("Authorization"), REVENUECAT_WEBHOOK_AUTH)) {
    return json(401, { error: "Unauthorized webhook request" });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "Invalid JSON body" });
  }

  const event: RcWebhookEvent | undefined = body?.event;
  if (!event || typeof event !== "object") {
    return json(400, { error: "Missing RevenueCat event payload" });
  }

  const appUserId = event.app_user_id ?? null;
  const eventType = event.type ?? "UNKNOWN";
  const eventId = event.id ?? makeSyntheticEventId(event);

  if (!appUserId) {
    return json(400, { error: "Missing app_user_id in RevenueCat event" });
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const seen = await markEventSeen(supabaseAdmin, eventId, event);
    if (!seen.inserted) {
      return json(200, {
        ok: true,
        duplicate: true,
        event_id: eventId,
        event_type: eventType,
        user_id: appUserId,
      });
    }

    if (eventType === "TEST") {
      return json(200, {
        ok: true,
        processed: true,
        event_id: eventId,
        event_type: eventType,
        message: "Test webhook received",
      });
    }

    const subscriber = await fetchRevenueCatSubscriber(
      appUserId,
      REVENUECAT_SECRET_API_KEY,
    );

    const syncResult = await syncUserFromRevenueCat(
      supabaseAdmin,
      appUserId,
      subscriber,
    );

    return json(200, {
      ok: true,
      processed: true,
      event_id: eventId,
      event_type: eventType,
      user_id: appUserId,
      result: syncResult,
    });
  } catch (e: any) {
    console.error("[revenuecat-webhook-v2] unhandled", e);

    return json(500, {
      error: "Unhandled webhook processing error",
      details: String(e?.message ?? e),
      event_id: eventId,
      event_type: eventType,
      user_id: appUserId,
    });
  }
});