// app/lib/supabase.ts
import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Some tooling in RN / Expo doesn't have Node types by default,
// so we defensively type process to avoid TS "cannot find name 'process'" errors.
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
  typeof process !== 'undefined' && process?.env
    ? process.env.EXPO_PUBLIC_SUPABASE_URL
    : undefined;

const SUPABASE_ANON_KEY_ENV =
  typeof process !== 'undefined' && process?.env
    ? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    : undefined;

// Fallbacks (safe for local/dev; replace in production)
const FALLBACK_URL = 'https://sdatmuzzsebvckfmnqsv.supabase.co';
const FALLBACK_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNkYXRtdXp6c2VidmNrZm1ucXN2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTMyOTIwNzIsImV4cCI6MjA2ODg2ODA3Mn0.IO2vFDIsb8JF6cunEu_URFRPoaAk0aZIRZa-BBcT450';

export const SUPABASE_URL = (SUPABASE_URL_ENV || FALLBACK_URL).replace(
  /\/+$/,
  '',
);
export const SUPABASE_ANON_KEY = SUPABASE_ANON_KEY_ENV || FALLBACK_ANON_KEY;

// Detect if web or native
const isWeb = typeof window !== 'undefined' && typeof document !== 'undefined';

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
        storageKey: 'overlooked.supabase.auth',
      },
  realtime: {
    params: {
      eventsPerSecond: 5,
    },
  },
});

// 🚀 Ensure sessions auto-refresh properly
supabase.auth.onAuthStateChange((_event, session) => {
  if (!session) return;
  try {
    supabase.auth.startAutoRefresh();
  } catch (e) {
    console.warn('[supabase] autoRefresh error', e);
  }
});

// Handy constants for manual fetch fallbacks / debugging
export const FUNCTIONS_URL = `${SUPABASE_URL}/functions/v1`;

// Debug (can remove later)
try {
  (globalThis as any).supabaseClient = supabase;
  (globalThis as any).functionsUrl = FUNCTIONS_URL;
} catch {}
console.log('🔑 SUPABASE_URL =', SUPABASE_URL);
console.log('🔑 Anon key defined =', !!SUPABASE_ANON_KEY);
console.log('🔧 FUNCTIONS_URL =', FUNCTIONS_URL);

// =======================
// 🏆 GAMIFICATION (FRONTEND VIEW)
// =======================

/**
 * XP reward values used for DISPLAY + UX copy.
 * Backend triggers now own the real XP updates.
 *
 * Keep these IN SYNC with:
 * - trg_award_xp_for_submission      → +300
 * - trg_award_xp_for_challenge_win   → +500
 * - trg_award_xp_for_job_post        → +100
 * - trg_award_xp_for_job_apply       → +50
 */
export const XP_VALUES = {
  CHALLENGE_SUBMISSION: 300, // submitting a film
  CHALLENGE_WIN: 500, // winning the monthly challenge
  JOB_POSTED: 100, // posting a job
  JOB_APPLIED: 50, // applying to a job
} as const;

export type XpReason =
  | 'challenge_submission'
  | 'challenge_win'
  | 'job_posted'
  | 'job_application'
  | 'manual_adjust';

/**
 * 🔴 IMPORTANT:
 * The normal app flow SHOULD NOT call this for challenge submissions,
 * wins, job posts, or applications.
 *
 * Those are handled automatically by Postgres triggers calling public.add_xp().
 *
 * This helper is ONLY for:
 * - manual admin adjustments
 * - one-off fixes
 * - tooling / migrations
 */
export async function giveXp(
  userId: string | null | undefined,
  amount: number,
  reason: XpReason,
) {
  if (!userId) return;
  if (!amount || amount === 0) return;

  const { error } = await supabase.rpc('add_xp', {
    p_user_id: userId,
    p_amount: amount,
    p_reason: reason,
  });

  if (error) {
    console.log('⚠️ giveXp error', { error, userId, amount, reason });
  } else {
    console.log(`🏅 MANUAL XP: +${amount} XP for ${reason} (user ${userId})`);
  }
}

// =======================
// 🎟️ MEMBERSHIP / TIERS
// =======================

// These names match the `users.tier` CHECK constraint in SQL.
export type UserTier = 'networking' | 'artist' | 'tommy';

/**
 * Frontend mirror of the backend logic:
 *  - networking → 0 submissions/month
 *  - artist     → 3 submissions/month
 *  - tommy      → 6 submissions/month
 *
 * Keep this in sync with:
 *  - public.allowed_submissions_by_tier(p_tier text)
 */
export const TIER_SUBMISSION_LIMITS: Record<UserTier, number> = {
  networking: 0,
  artist: 3,
  tommy: 6,
};
