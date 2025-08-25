// @ts-nocheck
// Referral redirect: logs click -> redirects to app with ?ref

import { serve } from "https://deno.land/std@0.203.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.43.1";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

serve(async (req: Request) => {
  try {
    const url = new URL(req.url);

    // support /r/:code and ?code=...
    const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
    const code = url.searchParams.get("code") || (segments.length ? segments.pop()! : "");

    if (!code) return new Response("Missing referral code", { status: 400 });

    // capture basic client info
    const ip =
      req.headers.get("x-forwarded-for") ||
      req.headers.get("cf-connecting-ip") ||
      req.headers.get("x-real-ip") ||
      "unknown";
    const ua = req.headers.get("user-agent") || "unknown";

    // log click (Phase 1 SQL created this table)
    const { error } = await supabase.from("referral_clicks").insert({
      code,
      ip,
      user_agent: ua,
    });
    if (error) console.error("referral_clicks insert error:", error.message);

    // redirect to your app/web
    const redirectUrl = `https://overlooked.app/?ref=${encodeURIComponent(code)}`;
    return Response.redirect(redirectUrl, 302);
  } catch (e) {
    console.error("referral-redirect error:", e);
    return new Response("Internal error", { status: 500 });
  }
});
