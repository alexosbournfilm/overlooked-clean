// app/lib/membership.ts
import { supabase, TIER_SUBMISSION_LIMITS, type UserTier } from './supabase';

export type SubmissionQuotaInfo = {
  tier: UserTier;
  limit: number;      // 0 / 2
  used: number;       // how many this month
  remaining: number;  // limit - used (never negative)
};

export type CanSubmitResult =
  | {
      allowed: true;
      reason: null;
      remaining: number;
    }
  | {
      allowed: false;
      reason: 'not_logged_in' | 'tier_too_low' | 'no_submissions_left';
      remaining: number;
    };

export type CanApplyResult =
  | {
      allowed: true;
      reason: null;
    }
  | {
      allowed: false;
      reason: 'not_logged_in' | 'tier_too_low';
    };

// =======================
// 🔐 MEMBERSHIP CACHE
// =======================
// Prevents "I upgraded but app still thinks I'm free" across screens.
let cachedTier: UserTier | null = null;
let cacheTimeMs = 0;
const CACHE_TTL_MS = 10_000; // 10s (and we manually invalidate on upgrade)

export function invalidateMembershipCache() {
  cachedTier = null;
  cacheTimeMs = 0;
}

// =======================
// 🔐 BASIC HELPERS
// =======================

export async function getCurrentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}

function isPremiumStillActive(premiumAccessExpiresAt?: string | null) {
  if (!premiumAccessExpiresAt) return false;
  const t = new Date(premiumAccessExpiresAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t > Date.now();
}

/**
 * Reads tier from DB, with optional caching.
 * IMPORTANT: We compute an "effective tier" so cancel-at-period-end users
 * keep Pro access until premium_access_expires_at.
 *
 * Use force=true when you *just upgraded/downgraded*.
 */
export async function getCurrentUserTier(opts?: { force?: boolean }): Promise<UserTier | null> {
  const force = opts?.force === true;

  if (!force && cachedTier && Date.now() - cacheTimeMs < CACHE_TTL_MS) {
    return cachedTier;
  }

  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('users')
    .select('tier, is_premium, premium_access_expires_at')
    .eq('id', userId)
    .single();

  if (error || !data) {
    console.log('getCurrentUserTier error', error);
    return null;
  }

  const dbTier = (data.tier as UserTier | null) ?? 'free';
  const premiumByFlag = Boolean(data.is_premium);
  const premiumByExpiry = isPremiumStillActive(data.premium_access_expires_at as string | null);

  // Effective Pro rules:
  // - If DB tier says pro, OR
  // - If is_premium true, OR
  // - If premium_access_expires_at still in future
  const effectiveTier: UserTier = (dbTier === 'pro' || premiumByFlag || premiumByExpiry) ? 'pro' : 'free';

  cachedTier = effectiveTier;
  cacheTimeMs = Date.now();
  return cachedTier;
}

/**
 * Convenience: never returns null tier – falls back to 'free'.
 */
export async function getCurrentUserTierOrFree(opts?: { force?: boolean }): Promise<UserTier> {
  const tier = await getCurrentUserTier({ force: opts?.force });
  return tier ?? 'free';
}

// =======================
// 🎥 SUBMISSION QUOTAS
// =======================

export async function getSubmissionQuota(): Promise<SubmissionQuotaInfo | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  // Use effective tier (handles cancel-at-period-end correctly)
  const tier = await getCurrentUserTierOrFree();
  const limit = TIER_SUBMISSION_LIMITS[tier];

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().split('T')[0]; // 'YYYY-MM-DD'

  const { data, error } = await supabase
    .from('submission_quotas')
    .select('submissions_used')
    .eq('user_id', userId)
    .eq('month_start', monthStartStr)
    .maybeSingle();

  if (error) {
    console.log('getSubmissionQuota error', error);
  }

  const used = (data?.submissions_used ?? 0) as number;
  const remaining = Math.max(0, limit - used);

  return { tier, limit, used, remaining };
}

export async function canSubmitToChallenge(): Promise<CanSubmitResult> {
  const quota = await getSubmissionQuota();

  if (!quota) {
    return { allowed: false, reason: 'not_logged_in', remaining: 0 };
  }

  if (quota.limit === 0) {
    return { allowed: false, reason: 'tier_too_low', remaining: 0 };
  }

  if (quota.remaining <= 0) {
    return { allowed: false, reason: 'no_submissions_left', remaining: 0 };
  }

  return { allowed: true, reason: null, remaining: quota.remaining };
}

// =======================
// 💼 JOB APPLICATIONS
// =======================

export async function canApplyToJob(isPaidJob: boolean): Promise<CanApplyResult> {
  const tier = await getCurrentUserTier(); // effective tier

  if (!tier) {
    return { allowed: false, reason: 'not_logged_in' };
  }

  if (!isPaidJob) {
    return { allowed: true, reason: null };
  }

  if (tier === 'pro') {
    return { allowed: true, reason: null };
  }

  return { allowed: false, reason: 'tier_too_low' };
}

// =======================
// 🎓 WORKSHOP ACCESS
// =======================

export async function hasWorkshopAccess(productId: string): Promise<boolean> {
  const userId = await getCurrentUserId();
  if (!userId) return false;

  const { data, error } = await supabase.rpc('has_workshop_access', {
    p_user_id: userId,
    p_product_id: productId,
  });

  if (error) {
    console.log('hasWorkshopAccess error', error);
    return false;
  }

  return !!data;
}
