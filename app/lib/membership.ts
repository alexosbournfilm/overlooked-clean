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
// 🔐 BASIC HELPERS
// =======================

export async function getCurrentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}

export async function getCurrentUserTier(): Promise<UserTier | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('users')
    .select('tier')
    .eq('id', userId)
    .single();

  if (error || !data?.tier) {
    console.log('getCurrentUserTier error', error);
    return null;
  }

  return data.tier as UserTier;
}

/**
 * Convenience: never returns null tier – falls back to 'free'.
 */
export async function getCurrentUserTierOrFree(): Promise<UserTier> {
  const tier = await getCurrentUserTier();
  return tier ?? 'free';
}

// =======================
// 🎥 SUBMISSION QUOTAS
// =======================

/**
 * Returns this month's quota info for the current user:
 *  - tier (free / pro)
 *  - limit (0 / 2)
 *  - used  (from submission_quotas)
 *  - remaining (limit - used)
 */
export async function getSubmissionQuota(): Promise<SubmissionQuotaInfo | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

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

/**
 * High-level helper for the Challenge page.
 * Uses the backend-enforced quotas but gives a nice UX message.
 */
export async function canSubmitToChallenge(): Promise<CanSubmitResult> {
  const quota = await getSubmissionQuota();

  if (!quota) {
    return {
      allowed: false,
      reason: 'not_logged_in',
      remaining: 0,
    };
  }

  if (quota.limit === 0) {
    return {
      allowed: false,
      reason: 'tier_too_low',
      remaining: 0,
    };
  }

  if (quota.remaining <= 0) {
    return {
      allowed: false,
      reason: 'no_submissions_left',
      remaining: 0,
    };
  }

  return {
    allowed: true,
    reason: null,
    remaining: quota.remaining,
  };
}

// =======================
// 💼 JOB APPLICATIONS
// =======================

/**
 * Frontend helper for the Jobs page.
 * Backend RLS also enforces this, but this gives you clean UX.
 *
 * @param isPaidJob - true if the job is paid (e.g. type starts with "Paid")
 */
export async function canApplyToJob(isPaidJob: boolean): Promise<CanApplyResult> {
  const tier = await getCurrentUserTier();

  if (!tier) {
    return { allowed: false, reason: 'not_logged_in' };
  }

  if (!isPaidJob) {
    // Free jobs are open to all tiers
    return { allowed: true, reason: null };
  }

  // Paid jobs: Pro only
  if (tier === 'pro') {
    return { allowed: true, reason: null };
  }

  return { allowed: false, reason: 'tier_too_low' };
}

// =======================
// 🎓 WORKSHOP ACCESS
// =======================

/**
 * Wrapper around the has_workshop_access RPC.
 * Returns true if:
 *  - product is free, or
 *  - user purchased it, or
 *  - user is tier 'pro' (handled in SQL)
 */
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

  // RPC returns a boolean
  return !!data;
}
