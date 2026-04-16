// supabase/functions/delete-account/index.ts
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

/** CORS + helpers */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Treat these as "needs cancelling now" */
const ACTIVEISH = new Set<Stripe.Subscription.Status>([
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "incomplete",
]);

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
      "[delete-account] RevenueCat subscriber lookup failed:",
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

async function deleteRevenueCatSubscriber(
  appUserId: string,
  secretApiKey: string,
): Promise<{ ok: boolean; status?: number; details?: string }> {
  if (!secretApiKey) {
    return { ok: false, details: "REVENUECAT_SECRET_API_KEY missing" };
  }

  const url = `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(
    appUserId,
  )}`;

  const resp = await fetch(url, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${secretApiKey}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Platform": "server",
    },
  });

  const text = await resp.text();

  if (!resp.ok) {
    console.warn(
      "[delete-account] RevenueCat delete subscriber failed:",
      resp.status,
      text,
    );
    return { ok: false, status: resp.status, details: text || "Delete failed" };
  }

  return { ok: true, status: resp.status };
}

Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json(405, { error: "Method not allowed" });
  }

  /** Auth from the app */
  const userAuth = req.headers.get("Authorization");
  if (!userAuth) {
    return json(401, { error: "Missing Authorization header" });
  }

  /** Env */
  const SUPABASE_URL =
    Deno.env.get("SUPABASE_URL") ||
    Deno.env.get("PROJECT_URL") ||
    Deno.env.get("SB_URL") ||
    "";

  const SERVICE_ROLE_KEY =
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
    Deno.env.get("SERVICE_ROLE_KEY") ||
    Deno.env.get("SB_SERVICE_ROLE_KEY") ||
    "";

  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
  const REVENUECAT_SECRET_API_KEY =
    Deno.env.get("REVENUECAT_SECRET_API_KEY") || "";

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(500, { error: "Supabase service env missing" });
  }

  if (!STRIPE_SECRET_KEY) {
    return json(500, { error: "STRIPE_SECRET_KEY is not set" });
  }

  /** Clients */
  const supaRls = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: userAuth } },
  });

  const supaAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const stripe = new Stripe(STRIPE_SECRET_KEY, {
    httpClient: Stripe.createFetchHttpClient(),
  });

  try {
    // 1) Verify session
    const { data: userRes, error: userErr } = await supaRls.auth.getUser();
    if (userErr || !userRes?.user) {
      return json(401, { error: "Invalid session" });
    }

    const user = userRes.user;
    const userEmail = user.email ?? undefined;

    // 2) Check RevenueCat/mobile subscription state first.
    // If a mobile subscription is still actively renewing, do NOT delete the account yet.
    const rcSubscriber = await fetchRevenueCatSubscriber(
      user.id,
      REVENUECAT_SECRET_API_KEY,
    );
    const rcState = getRevenueCatRenewableState(rcSubscriber);

    if (rcState.hasRenewableSubscription && !rcState.cancelAtPeriodEnd) {
      return json(409, {
        ok: false,
        action: "cancel_external_first",
        provider: "revenuecat",
        store: rcState.store,
        management_url: rcState.managementUrl,
        period_end: rcState.latestExpiry,
        message: isStoreManagedStore(rcState.store)
          ? rcState.managementUrl
            ? "This account still has an active mobile subscription that is renewing. Cancel it in the app store first using the management link, then delete the account."
            : "This account still has an active mobile subscription that is renewing. Cancel it in Google Play or the App Store first, then delete the account."
          : "This account still has an active externally managed subscription. Cancel it first, then delete the account.",
      });
    }

    // 3) Read any stored Stripe IDs (may be null if webhook hasn’t finished)
    const { data: row } = await supaRls
      .from("users")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("id", user.id)
      .maybeSingle();

    const knownCustomerId: string | null = row?.stripe_customer_id ?? null;
    const knownSubId: string | null = row?.stripe_subscription_id ?? null;

    // 4) Build a complete set of candidate customers to process
    const candidateCustomerIds = new Set<string>();
    if (knownCustomerId) {
      candidateCustomerIds.add(knownCustomerId);
    }

    // 4a) Find by metadata.supabase_user_id (authoritative)
    try {
      const byMeta = await stripe.customers.search({
        query: `metadata['supabase_user_id']:'${user.id}'`,
        limit: 100,
      });
      for (const c of byMeta.data) {
        candidateCustomerIds.add(c.id);
      }
    } catch (e) {
      console.warn("[delete-account] customers.search by metadata failed:", e);
    }

    // 4b) Also include ALL customers with same email
    if (userEmail) {
      try {
        const byEmail = await stripe.customers.search({
          query: `email:'${userEmail}'`,
          limit: 100,
        });
        for (const c of byEmail.data) {
          candidateCustomerIds.add(c.id);
        }
      } catch (e) {
        console.warn("[delete-account] customers.search by email failed:", e);
      }
    }

    const canceledSubs: string[] = [];
    const canceledSchedules: string[] = [];
    const deletedCustomers: string[] = [];

    // 5) If we have a specific subscription id already, cancel it first
    if (knownSubId) {
      try {
        const res = await stripe.subscriptions.cancel(knownSubId);
        canceledSubs.push(res.id);
      } catch (e) {
        console.warn("[delete-account] direct cancel known sub failed:", e);
      }
    }

    // 6) For every candidate customer, cancel ALL active-ish subs + schedules; then delete the customer
    for (const cid of candidateCustomerIds) {
      try {
        // Cancel subscriptions
        const subs = await stripe.subscriptions.list({
          customer: cid,
          status: "all",
          limit: 100,
        });

        for (const s of subs.data) {
          if (ACTIVEISH.has(s.status)) {
            try {
              const res = await stripe.subscriptions.cancel(s.id);
              canceledSubs.push(res.id);
            } catch (e) {
              console.warn("[delete-account] cancel sub failed:", s.id, e);
            }
          }
        }

        // Cancel schedules
        const schedules = await stripe.subscriptionSchedules.list({
          customer: cid,
          limit: 100,
        });

        for (const sch of schedules.data) {
          if (sch.status !== "canceled" && sch.status !== "released") {
            try {
              const res = await stripe.subscriptionSchedules.cancel(sch.id);
              canceledSchedules.push(res.id);
            } catch (e) {
              console.warn(
                "[delete-account] cancel schedule failed:",
                sch.id,
                e,
              );
            }
          }
        }

        // Best-effort: delete customer to prevent future orphaned billing
        try {
          await stripe.customers.del(cid);
          deletedCustomers.push(cid);
        } catch (e) {
          console.warn(
            "[delete-account] customer delete failed (ignored):",
            cid,
            e,
          );
        }
      } catch (e) {
        console.warn("[delete-account] processing customer failed:", cid, e);
      }
    }

    // 7) Best-effort: delete RevenueCat subscriber record too.
    // This does NOT cancel store subscriptions by itself, which is why we blocked
    // active-renewing mobile subscriptions above.
    const rcDeleteResult = await deleteRevenueCatSubscriber(
      user.id,
      REVENUECAT_SECRET_API_KEY,
    );

    // 8) Delete app data + auth user
    await supaRls.from("users").delete().eq("id", user.id);
    await supaAdmin.auth.admin.deleteUser(user.id);

    return json(200, {
      ok: true,
      message:
        rcState.hasRenewableSubscription && rcState.cancelAtPeriodEnd
          ? "Account deleted. Stripe subscriptions were cancelled, and the mobile subscription was already set not to renew."
          : "Account deleted; Stripe subscriptions and schedules cancelled.",
      canceledSubscriptions: Array.from(new Set(canceledSubs)),
      canceledSchedules: Array.from(new Set(canceledSchedules)),
      customersProcessed: Array.from(candidateCustomerIds),
      customersDeleted: deletedCustomers,
      revenuecat: {
        hadSubscription: rcState.hasRenewableSubscription,
        cancel_at_period_end: rcState.cancelAtPeriodEnd,
        store: rcState.store,
        period_end: rcState.latestExpiry,
        subscriber_deleted: rcDeleteResult.ok,
        delete_status: rcDeleteResult.status ?? null,
        delete_details: rcDeleteResult.details ?? null,
      },
    });
  } catch (e) {
    console.error("[delete-account] unhandled", e);
    return json(500, { error: "Unhandled error", details: String(e) });
  }
});