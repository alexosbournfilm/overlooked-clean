import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY");
}

const isWeb = typeof window !== "undefined" && typeof document !== "undefined";
const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : false;

export const supabase =
  SUPABASE_URL && SUPABASE_ANON_KEY
    ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: isWeb
          ? {
              persistSession: true,
              autoRefreshToken: true,

              /**
               * IMPORTANT:
               * Keep this false on web.
               *
               * Your app already manually handles Supabase auth links in:
               * - App.tsx
               * - SignInScreen.tsx
               * - NewPassword.tsx
               *
               * If this is true, Supabase can auto-create a temporary reset-password
               * session before NewPassword.tsx controls the flow. That can make the
               * app think the user is normally signed in with an incomplete profile,
               * which then redirects to CreateProfile.
               */
              detectSessionInUrl: false,
            }
          : {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: false,
              storage: AsyncStorage,
              storageKey: "overlooked.supabase.auth",
            },
        realtime: {
          params: {
            eventsPerSecond: 5,
          },
        },
      })
    : (null as any);

export const FUNCTIONS_URL = SUPABASE_URL
  ? `${SUPABASE_URL}/functions/v1`
  : "";

try {
  (globalThis as any).supabaseClient = supabase;
  (globalThis as any).functionsUrl = FUNCTIONS_URL;
} catch {}

if (isDev) {
  console.log("🔑 SUPABASE_URL =", SUPABASE_URL);
  console.log("🔧 FUNCTIONS_URL =", FUNCTIONS_URL);
}

export const XP_VALUES = {
  CHALLENGE_SUBMISSION: 300,
  CHALLENGE_WIN: 500,
  JOB_POSTED: 100,
  JOB_APPLIED: 50,
} as const;

export type XpReason =
  | "challenge_submission"
  | "challenge_win"
  | "job_posted"
  | "job_application"
  | "manual_adjust";

export async function giveXp(
  userId: string | null | undefined,
  amount: number,
  reason: XpReason
) {
  if (!userId || !amount || amount === 0 || !supabase) return;

  const { error } = await supabase.rpc("add_xp", {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
  });

  if (error) {
    console.log("⚠️ giveXp error", { error, userId, amount, reason });
  } else {
    console.log(`🏅 MANUAL XP: +${amount} XP for ${reason} (user ${userId})`);
  }
}

export type UserTier = "free" | "pro";

export const TIER_SUBMISSION_LIMITS: Record<UserTier, number> = {
  free: 1,
  pro: 999999,
};