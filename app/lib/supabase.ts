// app/lib/supabase.ts
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

// =======================
// 🔐 SUPABASE CONFIG
// =======================

// IMPORTANT:
// Do NOT wrap process.env in "typeof process !== 'undefined'" checks.
// On Expo Web builds, bundlers often inline these values at build-time.
// If you guard it, the bundler can’t inline, and runtime "process" may be undefined -> blank screen.
const SUPABASE_URL_ENV =
  (process as any)?.env?.EXPO_PUBLIC_SUPABASE_URL ||
  (globalThis as any)?.process?.env?.EXPO_PUBLIC_SUPABASE_URL ||
  (typeof window !== "undefined" ? (window as any)?.EXPO_PUBLIC_SUPABASE_URL : undefined);

const SUPABASE_ANON_KEY_ENV =
  (process as any)?.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  (globalThis as any)?.process?.env?.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  (typeof window !== "undefined" ? (window as any)?.EXPO_PUBLIC_SUPABASE_ANON_KEY : undefined);

// Fallbacks (LAST RESORT — prevents blank screen if env is misconfigured)
const FALLBACK_URL = "https://sdatmuzzsebvckfmnqsv.supabase.co";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkYXRtdXp6c2VidmNrZm1ucXN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMyOTIwNzIsImV4cCI6MjA2ODg2ODA3Mn0.IO2vFDIsb8JF6cunEu_URFRPoaAk0aZIRZa-BBcT450";

const isWeb = typeof window !== "undefined" && typeof document !== "undefined";
const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : false;

function sanitizeUrl(url?: string) {
  return (url || "").trim().replace(/\/+$/, "");
}

const envUrl = sanitizeUrl(SUPABASE_URL_ENV);
const envKey = (SUPABASE_ANON_KEY_ENV || "").trim();

// Did we get the real env vars?
export const SUPABASE_ENV_OK = Boolean(envUrl && envKey);

// Always resolve to something non-empty to avoid crashing to a blank screen.
export const SUPABASE_URL = SUPABASE_ENV_OK ? envUrl : sanitizeUrl(FALLBACK_URL);
export const SUPABASE_ANON_KEY = SUPABASE_ENV_OK ? envKey : FALLBACK_ANON_KEY;

if (!SUPABASE_ENV_OK) {
  console.error(
    "❌ SUPABASE ENV MISSING: EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY not found.\n" +
      "➡️ App is using FALLBACK_URL/FALLBACK_ANON_KEY to avoid a blank screen.\n" +
      "➡️ FIX YOUR DEPLOY ENV VARS to ensure billing/auth uses the correct project."
  );
}

// =======================
// ⚡ SPEED: only detect session in URL when it’s actually present
// =======================
function shouldDetectSessionInUrl() {
  if (!isWeb) return false;

  try {
    const hash = window.location.hash || "";
    const search = window.location.search || "";

    // Supabase redirects commonly include:
    // - access_token in hash (implicit)
    // - code in query (PKCE)
    // - type=signup / type=recovery / etc
    return (
      hash.includes("access_token=") ||
      hash.includes("refresh_token=") ||
      search.includes("code=") ||
      search.includes("type=")
    );
  } catch {
    return false;
  }
}

// =======================
// 🧠 CLIENT INITIALIZATION
// =======================

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: isWeb
    ? {
        persistSession: true,

        // ✅ IMPORTANT: we manage refresh ourselves in MainTabs (AppState / visibility)
        // This avoids extra timers + work.
        autoRefreshToken: false,

        // ✅ SPEED: only parse URL when a redirect param exists
        detectSessionInUrl: shouldDetectSessionInUrl(),
      }
    : {
        persistSession: true,

        // ✅ IMPORTANT: we manage refresh ourselves in MainTabs (AppState)
        autoRefreshToken: false,

        detectSessionInUrl: false,
        storage: AsyncStorage,
        storageKey: "overlooked.supabase.auth",
      },
  realtime: {
    params: {
      eventsPerSecond: 5,
    },
  },
});

// ❗️IMPORTANT CHANGE:
// Do NOT call supabase.auth.startAutoRefresh() here.
// On native, backgrounding pauses timers; starting/stopping refresh should be handled
// at the app lifecycle level (AppState / visibility change) inside MainTabs or App root.

// Handy constants for functions
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Debug (safe)
try {
  (globalThis as any).supabaseClient = supabase;
  (globalThis as any).functionsUrl = FUNCTIONS_URL;
} catch {}

if (isDev) {
  console.log("🔑 SUPABASE_URL =", SUPABASE_URL);
  console.log("🔑 SUPABASE_ENV_OK =", SUPABASE_ENV_OK);
  console.log("🔧 FUNCTIONS_URL =", FUNCTIONS_URL);
}

// =======================
// 🏆 GAMIFICATION (FRONTEND VIEW)
// =======================

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
  if (!userId) return;
  if (!amount || amount === 0) return;

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
  free: 0,
  pro: 2,
};
