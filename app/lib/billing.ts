import { supabase } from './supabase';

type EffectiveTier = 'free' | 'pro';

function toMs(value?: string | null) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function isFuture(value?: string | null, graceMs = 0) {
  const t = toMs(value);
  if (t === null) return false;
  return t > Date.now() - graceMs;
}

function isSubscriptionStatusActive(status?: string | null) {
  if (!status) return false;
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

function computeHasProAccess(row: {
  grandfathered?: boolean | null;
  subscription_status?: string | null;
  current_period_end?: string | null;
  premium_access_expires_at?: string | null;
}) {
  const premiumByGrandfathered = Boolean(row.grandfathered);
  const premiumByExpiry = isFuture(row.premium_access_expires_at, 5_000);

  const premiumBySubscriptionWindow =
    isSubscriptionStatusActive(row.subscription_status) &&
    isFuture(row.current_period_end, 5_000);

  return (
    premiumByGrandfathered ||
    premiumByExpiry ||
    premiumBySubscriptionWindow
  );
}

export async function getMySubscriptionStatus() {
  const { data: userRes, error: userErr } = await supabase.auth.getUser();
  if (userErr) throw userErr;

  const user = userRes?.user;
  if (!user) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('users')
    .select(
      [
        'tier',
        'is_premium',
        'subscription_status',
        'cancel_at_period_end',
        'current_period_end',
        'grandfathered',
        'premium_access_expires_at',
        'stripe_customer_id',
        'stripe_subscription_id',
        'price_id',
      ].join(',')
    )
    .eq('id', user.id)
    .single();

  if (error) throw error;

  const row = (data ?? {}) as any;

  const hasProAccess = computeHasProAccess(row);
  const effectiveTier: EffectiveTier = hasProAccess ? 'pro' : 'free';

  const accessEndsAt =
    row.premium_access_expires_at ??
    row.current_period_end ??
    null;

  const inCancelGracePeriod =
    Boolean(row.cancel_at_period_end) &&
    hasProAccess &&
    (isFuture(row.premium_access_expires_at, 5_000) ||
      isFuture(row.current_period_end, 5_000));

  const hasPaymentProviderSubscriptionRecord =
    Boolean(row.stripe_customer_id) ||
    Boolean(row.stripe_subscription_id) ||
    Boolean(row.current_period_end) ||
    Boolean(row.premium_access_expires_at);

  const isGrandfathered = Boolean(row.grandfathered);

  const isActiveSubscriber =
    isSubscriptionStatusActive(row.subscription_status) &&
    isFuture(row.current_period_end, 5_000);

  return {
    ...row,
    hasProAccess,
    effectiveTier,
    accessEndsAt,
    inCancelGracePeriod,
    isGrandfathered,
    isActiveSubscriber,

    // New neutral flag for cross-platform billing flows
    hasPaymentProviderSubscriptionRecord,

    // Keep old flag too so existing screens do not break
    hasStripeSubscriptionRecord:
      Boolean(row.stripe_customer_id) || Boolean(row.stripe_subscription_id),
  };
}