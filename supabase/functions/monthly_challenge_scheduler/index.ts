import { createClient } from "@supabase/supabase-js"

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { error } = await supabase.rpc("create_monthly_challenges_if_missing")

  if (error) {
    return new Response("Error: " + error.message, { status: 500 })
  }

  const { error: cleanupError } = await supabase.rpc("delete_expired_creator_challenges")

  if (cleanupError) {
    return new Response("Error: " + cleanupError.message, { status: 500 })
  }

  return new Response("OK")
})
