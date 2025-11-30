// app/lib/connections.ts
import { supabase } from "./supabase";

/* ======================================================
   Helpers
====================================================== */
async function getCurrentUserId() {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

/* ======================================================
   1. SUPPORT another user
   (writes to user_supports table)
====================================================== */
export async function supportUser(targetUserId: string) {
  const current = await getCurrentUserId();
  if (!current) return { error: "Not logged in." };

  if (current === targetUserId) return { error: "Cannot support yourself." };

  const { error, data } = await supabase
    .from("user_supports")        // ✔ MATCHES SQL TABLE
    .insert({
      supporter_id: current,
      supported_id: targetUserId,
    })
    .select("*")
    .single();

  return { error, data };
}

/* ======================================================
   2. UNSUPPORT another user
   (deletes from user_supports table)
====================================================== */
export async function unsupportUser(targetUserId: string) {
  const current = await getCurrentUserId();
  if (!current) return { error: "Not logged in." };

  const { error, data } = await supabase
    .from("user_supports")        // ✔ MATCHES SQL TABLE
    .delete()
    .match({
      supporter_id: current,
      supported_id: targetUserId,
    })
    .select("*")
    .single();

  return { error, data };
}

/* ======================================================
   3. CHECK SUPPORT STATUS
   (uses the real table)
====================================================== */
export async function getSupportStatus(otherUserId: string) {
  const current = await getCurrentUserId();
  if (!current) return "none";

  // Do you support them?
  const { data: youSupport } = await supabase
    .from("user_supports")        // ✔ correct
    .select("*")
    .match({
      supporter_id: current,
      supported_id: otherUserId,
    })
    .maybeSingle();

  if (youSupport) return "supporting";

  // Do they support you?
  const { data: theySupport } = await supabase
    .from("user_supports")        // ✔ correct
    .select("*")
    .match({
      supporter_id: otherUserId,
      supported_id: current,
    })
    .maybeSingle();

  if (theySupport) return "supported_by";

  return "none";
}

/* ======================================================
   4. GET LIST OF USERS YOU SUPPORT
   (uses view: user_supporting)
====================================================== */
export async function getSupporting(userId: string) {
  const { data } = await supabase
    .from("user_supporting")      // ✔ MATCHES SQL VIEW
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return data ?? [];
}

/* ======================================================
   5. GET LIST OF USERS WHO SUPPORT YOU
   (uses view: user_supporters)
====================================================== */
export async function getSupporters(userId: string) {
  const { data } = await supabase
    .from("user_supporters")      // ✔ MATCHES SQL VIEW
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  return data ?? [];
}
