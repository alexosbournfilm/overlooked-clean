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
====================================================== */

export async function supportUser(targetUserId: string) {
  const current = await getCurrentUserId();
  if (!current) return { error: "Not logged in." };

  if (current === targetUserId) return { error: "Cannot support yourself." };

  return await supabase.from("user_supports").insert({
    supporter_id: current,
    supported_id: targetUserId,
  });
}

/* ======================================================
   2. UNSUPPORT another user
====================================================== */

export async function unsupportUser(targetUserId: string) {
  const current = await getCurrentUserId();
  if (!current) return { error: "Not logged in." };

  return await supabase
    .from("user_supports")
    .delete()
    .match({
      supporter_id: current,
      supported_id: targetUserId,
    });
}

/* ======================================================
   3. CHECK SUPPORT STATUS
====================================================== */

export async function getSupportStatus(otherUserId: string) {
  const current = await getCurrentUserId();
  if (!current) return "none";

  const { data: youSupport } = await supabase
    .from("user_supports")
    .select("*")
    .match({
      supporter_id: current,
      supported_id: otherUserId,
    })
    .maybeSingle();

  if (youSupport) return "supporting";

  const { data: theySupport } = await supabase
    .from("user_supports")
    .select("*")
    .match({
      supporter_id: otherUserId,
      supported_id: current,
    })
    .maybeSingle();

  if (theySupport) return "supported_by";

  return "none";
}
