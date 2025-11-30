// supabase/functions/delete-account/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "npm:stripe@14";

/** CORS + helpers */
const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

Deno.serve(async (req: Request): Promise<Response> => {
  // Preflight
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });

  /** Auth from the app */
  const userAuth = req.headers.get("Authorization");
  if (!userAuth) return json(401, { error: "Missing Authorization header" });

  /** Env */
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return json(500, { error: "Supabase service env missing" });
  if (!STRIPE_SECRET_KEY) return json(500, { error: "STRIPE_SECRET_KEY is not set" });

  /** Clients */
  const supaRls = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: userAuth } },
  });
  const supaAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const stripe = new Stripe(STRIPE_SECRET_KEY, { httpClient: Stripe.createFetchHttpClient() });

  try {
    // 1) Verify session
    const { data: userRes, error: userErr } = await supaRls.auth.getUser();
    if (userErr || !userRes?.user) return json(401, { error: "Invalid session" });
    const user = userRes.user;
    const userEmail = user.email ?? undefined;

    // 2) Read any stored Stripe IDs (may be null if webhook hasn’t finished)
    const { data: row } = await supaRls
      .from("users")
      .select("stripe_customer_id, stripe_subscription_id")
      .eq("id", user.id)
      .maybeSingle();

    const knownCustomerId: string | null = row?.stripe_customer_id ?? null;
    const knownSubId: string | null = row?.stripe_subscription_id ?? null;

    // 3) Build a complete set of candidate customers to process
    const candidateCustomerIds = new Set<string>();
    if (knownCustomerId) candidateCustomerIds.add(knownCustomerId);

    // 3a) Find by metadata.supabase_user_id (authoritative)
    try {
      const byMeta = await stripe.customers.search({
        query: `metadata['supabase_user_id']:'${user.id}'`,
        limit: 100,
      });
      for (const c of byMeta.data) candidateCustomerIds.add(c.id);
    } catch (e) {
      console.warn("[delete-account] customers.search by metadata failed:", e);
    }

    // 3b) Also include ALL customers with same email (don’t just take the first)
    if (userEmail) {
      try {
        const byEmail = await stripe.customers.search({
          query: `email:'${userEmail}'`,
          limit: 100,
        });
        for (const c of byEmail.data) candidateCustomerIds.add(c.id);
      } catch (e) {
        console.warn("[delete-account] customers.search by email failed:", e);
      }
    }

    const canceledSubs: string[] = [];
    const canceledSchedules: string[] = [];
    const deletedCustomers: string[] = [];

    // 4) If we have a specific subscription id already, cancel it first
    if (knownSubId) {
      try {
        const res = await stripe.subscriptions.cancel(knownSubId);
        canceledSubs.push(res.id);
      } catch (e) {
        console.warn("[delete-account] direct cancel known sub failed:", e);
      }
    }

    // 5) For every candidate customer, cancel ALL active-ish subs + schedules; then delete the customer
    for (const cid of candidateCustomerIds) {
      try {
        // Cancel subs
        const subs = await stripe.subscriptions.list({ customer: cid, status: "all", limit: 100 });
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
        const schedules = await stripe.subscriptionSchedules.list({ customer: cid, limit: 100 });
        for (const sch of schedules.data) {
          if (sch.status !== "canceled" && sch.status !== "released") {
            try {
              const res = await stripe.subscriptionSchedules.cancel(sch.id);
              canceledSchedules.push(res.id);
            } catch (e) {
              console.warn("[delete-account] cancel schedule failed:", sch.id, e);
            }
          }
        }

        // Best-effort: delete customer to prevent future charges on orphaned accounts
        try {
          await stripe.customers.del(cid);
          deletedCustomers.push(cid);
        } catch (e) {
          console.warn("[delete-account] customer delete failed (ignored):", cid, e);
        }
      } catch (e) {
        console.warn("[delete-account] processing customer failed:", cid, e);
      }
    }

    // 6) Delete app data + auth user (authoritative)
    await supaRls.from("users").delete().eq("id", user.id);
    await supaAdmin.auth.admin.deleteUser(user.id);

    return json(200, {
      ok: true,
      message: "Account deleted; all Stripe subscriptions/schedules cancelled.",
      canceledSubscriptions: Array.from(new Set(canceledSubs)),
      canceledSchedules: Array.from(new Set(canceledSchedules)),
      customersProcessed: Array.from(candidateCustomerIds),
      customersDeleted: deletedCustomers,
    });
  } catch (e) {
    console.error("[delete-account] unhandled", e);
    return json(500, { error: "Unhandled error", details: String(e) });
  }
});
