// app/lib/billing.ts
import { supabase } from './supabase';

function isPremiumStillActive(premiumAccessExpiresAt?: string | null) {
  if (!premiumAccessExpiresAt) return false;
  const t = new Date(premiumAccessExpiresAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t > Date.now();
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

  // ✅ make TS happy + avoid spreading null
  const row = (data ?? {}) as any;

  const premiumByFlag = Boolean(row.is_premium);
  const premiumByExpiry = isPremiumStillActive(row.premium_access_expires_at ?? null);
  const tier = (row.tier as 'free' | 'pro' | null) ?? 'free';

  const hasProAccess = tier === 'pro' || premiumByFlag || premiumByExpiry;

  return {
    ...row,
    hasProAccess,
    effectiveTier: hasProAccess ? 'pro' : 'free',
    accessEndsAt: row.premium_access_expires_at ?? null,
  };
}
