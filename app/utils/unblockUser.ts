import { supabase } from '../lib/supabase';

export async function unblockUser({
  blockedUserId,
}: {
  blockedUserId: string;
}): Promise<boolean> {
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return false;
  }

  const { error } = await supabase
    .from('user_blocks')
    .delete()
    .eq('blocker_id', authData.user.id)
    .eq('blocked_id', blockedUserId);

  if (error) {
    console.error('Unblock user error:', error);
    return false;
  }

  return true;
}
