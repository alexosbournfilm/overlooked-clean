// app/lib/billing.ts
import { supabase } from './supabase';

export async function getMySubscriptionStatus() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('users')
    .select('subscription_status, grandfathered, premium_access_expires_at')
    .eq('id', user.id)
    .single();

  if (error) throw error;
  return data; // { subscription_status, grandfathered, premium_access_expires_at }
}
