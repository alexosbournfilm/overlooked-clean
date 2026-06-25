import { createClient } from "@supabase/supabase-js"

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  )

  const { error: finalizeWeeklyError } = await supabase.rpc("finalize_last_week_winner_if_needed")

  if (finalizeWeeklyError) {
    return new Response("Error: " + finalizeWeeklyError.message, { status: 500 })
  }

  const { error: weeklyError } = await supabase.rpc("create_weekly_challenges_if_missing", {
    p_weeks_ahead: 4,
  })

  if (weeklyError) {
    return new Response("Error: " + weeklyError.message, { status: 500 })
  }

  const { error: promptError } = await supabase.rpc("create_daily_prompts_if_missing", {
    p_days_ahead: 14,
  })

  if (promptError) {
    return new Response("Error: " + promptError.message, { status: 500 })
  }

  const { error: cleanupError } = await supabase.rpc("delete_expired_creator_challenges")

  if (cleanupError) {
    return new Response("Error: " + cleanupError.message, { status: 500 })
  }

  return new Response("OK")
})
