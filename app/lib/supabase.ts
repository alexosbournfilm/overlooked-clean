// app/lib/supabase.ts
import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

declare const process:
  | {
      env?: {
        EXPO_PUBLIC_SUPABASE_URL?: string;
        EXPO_PUBLIC_SUPABASE_ANON_KEY?: string;
        [key: string]: string | undefined;
      };
    }
  | undefined;

// =======================
// 🔐 SUPABASE CONFIG
// =======================

const SUPABASE_URL_ENV =
  typeof process !== "undefined" && process?.env
    ? process.env.EXPO_PUBLIC_SUPABASE_URL
    : undefined;

const SUPABASE_ANON_KEY_ENV =
  typeof process !== "undefined" && process?.env
    ? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    : undefined;

// Fallbacks (DEV ONLY)
const FALLBACK_URL = "https://sdatmuzzsebvckfmnqsv.supabase.co";
const FALLBACK_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkYXRtdXp6c2VidmNrZm1ucXN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMyOTIwNzIsImV4cCI6MjA2ODg2ODA3Mn0.IO2vFDIsb8JF6cunEu_URFRPoaAk0aZIRZa-BBcT450";

// Detect if web or native
const isWeb = typeof window !== "undefined" && typeof document !== "undefined";

// ✅ Expo provides __DEV__ globally
const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : false;

function sanitizeUrl(url: string) {
  return (url || "").replace(/\/+$/, "");
}

// Resolve URL/key with safety rules
let resolvedUrlRaw = "";
let resolvedKeyRaw = "";

// Did we get the real env vars?
export const SUPABASE_ENV_OK = Boolean(SUPABASE_URL_ENV && SUPABASE_ANON_KEY_ENV);

if (SUPABASE_ENV_OK) {
  resolvedUrlRaw = sanitizeUrl(SUPABASE_URL_ENV!);
  resolvedKeyRaw = SUPABASE_ANON_KEY_ENV!;
} else {
  // ✅ In DEV we can fallback; in PROD we should fail loudly
  if (isDev) {
    console.warn(
      "⚠️ Supabase env vars missing (DEV). Using FALLBACK_URL/FALLBACK_ANON_KEY."
    );
    resolvedUrlRaw = sanitizeUrl(FALLBACK_URL);
    resolvedKeyRaw = FALLBACK_ANON_KEY;
  } else {
    console.error(
      "❌ Supabase env vars missing (PROD). Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY."
    );
    // Fail safe: empty values will cause obvious errors instead of silently pointing to the wrong project
    resolvedUrlRaw = "";
    resolvedKeyRaw = "";
  }
}

export const SUPABASE_URL = resolvedUrlRaw;
export const SUPABASE_ANON_KEY = resolvedKeyRaw;

// =======================
// 🧠 CLIENT INITIALIZATION
// =======================

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: isWeb
    ? {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
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
});

// Optional: explicitly start/stop refresh on native lifecycle (usually not needed)
// Keeping it simple: rely on autoRefreshToken.
// If you *do* want it, do it once:
if (!isWeb) {
  try {
    supabase.auth.startAutoRefresh();
  } catch (e) {
    console.warn("[supabase] startAutoRefresh error", e);
  }
}

// Handy constants for manual fetch fallbacks / debugging
export const FUNCTIONS_URL = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1` : "";

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
