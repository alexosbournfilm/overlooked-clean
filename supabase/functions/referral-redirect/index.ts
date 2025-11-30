// supabase/functions/referral-redirect/index.ts
const JSON_HEADERS: Record<string, string> = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
};

const APP_URL = Deno.env.get("APP_URL") ?? "https://example.com";

Deno.serve((req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...JSON_HEADERS,
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-headers": "content-type",
      },
    });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: JSON_HEADERS,
    });
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const redirectTo = code
    ? `${APP_URL}/?ref=${encodeURIComponent(code)}`
    : APP_URL;

  return new Response(null, {
    status: 302,
    headers: { Location: redirectTo },
  });
});
