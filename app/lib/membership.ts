// app/lib/membership.ts
import { supabase, TIER_SUBMISSION_LIMITS, type UserTier } from './supabase';

export type SubmissionQuotaInfo = {
  tier: UserTier;
  limit: number;
  used: number;
  remaining: number;
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
let cachedTier: UserTier | null = null;
let cachedMembershipSnapshot: MembershipSnapshot | null = null;
let cacheTimeMs = 0;
const CACHE_TTL_MS = 10_000;

export function invalidateMembershipCache() {
  cachedTier = null;
  cachedMembershipSnapshot = null;
  cacheTimeMs = 0;
}

// =======================
// 🔐 TYPES
// =======================

export type MembershipSnapshot = {
  userId: string;
  dbTier: UserTier;
  effectiveTier: UserTier;
  isPremium: boolean;
  subscriptionStatus: string | null;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  premiumAccessExpiresAt: string | null;
  hasProAccess: boolean;
};

// =======================
// 🔐 BASIC HELPERS
// =======================

export async function getCurrentUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user.id;
}

function toMs(value?: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function isFuture(value?: string | null, graceMs = 0): boolean {
  const t = toMs(value);
  if (t === null) return false;
  return t > Date.now() - graceMs;
}

function isSubscriptionStatusActive(status?: string | null): boolean {
  if (!status) return false;
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

/**
 * Pro access rules:
 *
 * A user should have Pro if:
 * - DB tier says "pro", OR
 * - is_premium is true, OR
 * - premium_access_expires_at is still in the future, OR
 * - subscription_status is active/trialing/past_due AND current_period_end is still in the future
 *
 * Important for cancel-at-period-end:
 * - user keeps Pro until current_period_end / premium_access_expires_at
 * - after that date passes, effective tier becomes free
 */
function computeEffectiveTier(row: {
  tier?: string | null;
  is_premium?: boolean | null;
  subscription_status?: string | null;
  cancel_at_period_end?: boolean | null;
  current_period_end?: string | null;
  premium_access_expires_at?: string | null;
}): UserTier {
  const dbTier = (row.tier as UserTier | null) ?? 'free';
  const premiumByFlag = Boolean(row.is_premium);
  const premiumByExpiry = isFuture(row.premium_access_expires_at, 5_000);

  const subStatusActive = isSubscriptionStatusActive(row.subscription_status);
  const subPeriodStillActive = isFuture(row.current_period_end, 5_000);
  const premiumBySubscriptionWindow = subStatusActive && subPeriodStillActive;

  const hasPro =
    dbTier === 'pro' ||
    premiumByFlag ||
    premiumByExpiry ||
    premiumBySubscriptionWindow;

  return hasPro ? 'pro' : 'free';
}

// =======================
// 🔐 MEMBERSHIP SNAPSHOT
// =======================

export async function getMembershipSnapshot(opts?: {
  force?: boolean;
}): Promise<MembershipSnapshot | null> {
  const force = opts?.force === true;

  if (
    !force &&
    cachedMembershipSnapshot &&
    Date.now() - cacheTimeMs < CACHE_TTL_MS
  ) {
    return cachedMembershipSnapshot;
  }

  const userId = await getCurrentUserId();
  if (!userId) return null;

  const { data, error } = await supabase
    .from('users')
    .select(
      [
        'tier',
        'is_premium',
        'subscription_status',
        'cancel_at_period_end',
        'current_period_end',
        'premium_access_expires_at',
      ].join(',')
    )
    .eq('id', userId)
    .single();

  if (error || !data) {
    console.log('getMembershipSnapshot error', error);
    return null;
  }

  const dbTier = (data.tier as UserTier | null) ?? 'free';
  const effectiveTier = computeEffectiveTier(data);
  const hasProAccess = effectiveTier === 'pro';

  const snapshot: MembershipSnapshot = {
    userId,
    dbTier,
    effectiveTier,
    isPremium: Boolean(data.is_premium),
    subscriptionStatus: data.subscription_status ?? null,
    cancelAtPeriodEnd: Boolean(data.cancel_at_period_end),
    currentPeriodEnd: data.current_period_end ?? null,
    premiumAccessExpiresAt: data.premium_access_expires_at ?? null,
    hasProAccess,
  };

  cachedMembershipSnapshot = snapshot;
  cachedTier = effectiveTier;
  cacheTimeMs = Date.now();

  return snapshot;
}

/**
 * Reads effective tier from DB, with optional caching.
 * Use force=true when the user has just upgraded, restored, or cancelled.
 */
export async function getCurrentUserTier(opts?: {
  force?: boolean;
}): Promise<UserTier | null> {
  const force = opts?.force === true;

  if (!force && cachedTier && Date.now() - cacheTimeMs < CACHE_TTL_MS) {
    return cachedTier;
  }

  const snapshot = await getMembershipSnapshot({ force });
  return snapshot?.effectiveTier ?? null;
}

export async function getCurrentUserTierOrFree(opts?: {
  force?: boolean;
}): Promise<UserTier> {
  const tier = await getCurrentUserTier({ force: opts?.force });
  return tier ?? 'free';
}

export async function isCurrentUserPro(opts?: {
  force?: boolean;
}): Promise<boolean> {
  const snapshot = await getMembershipSnapshot({ force: opts?.force });
  return snapshot?.hasProAccess ?? false;
}

// =======================
// 📅 CANCELLATION HELPERS
// =======================

/**
 * True when the subscription has been set to cancel
 * but the user should still keep Pro until the end date.
 */
export async function isInCancelGracePeriod(opts?: {
  force?: boolean;
}): Promise<boolean> {
  const snapshot = await getMembershipSnapshot({ force: opts?.force });
  if (!snapshot) return false;

  const stillActiveByCurrentPeriod = isFuture(snapshot.currentPeriodEnd, 5_000);
  const stillActiveByPremiumExpiry = isFuture(snapshot.premiumAccessExpiresAt, 5_000);

  return (
    snapshot.cancelAtPeriodEnd &&
    snapshot.hasProAccess &&
    (stillActiveByCurrentPeriod || stillActiveByPremiumExpiry)
  );
}

/**
 * Returns the best end date to show in UI when a subscription is cancelled.
 */
export async function getMembershipAccessEndsAt(opts?: {
  force?: boolean;
}): Promise<string | null> {
  const snapshot = await getMembershipSnapshot({ force: opts?.force });
  if (!snapshot) return null;

  return snapshot.premiumAccessExpiresAt ?? snapshot.currentPeriodEnd ?? null;
}

// =======================
// 🎥 SUBMISSION QUOTAS
// =======================

export async function getSubmissionQuota(): Promise<SubmissionQuotaInfo | null> {
  const userId = await getCurrentUserId();
  if (!userId) return null;

  const tier = await getCurrentUserTierOrFree();
  const limit = TIER_SUBMISSION_LIMITS[tier];

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthStartStr = monthStart.toISOString().split('T')[0];

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
  const tier = await getCurrentUserTier();

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
    console.log('has_workshopAccess error', error);
    return false;
  }

  return !!data;
}