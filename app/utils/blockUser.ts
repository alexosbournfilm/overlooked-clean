// app/utils/blockUser.ts

import { Alert } from 'react-native';
import { supabase } from '../lib/supabase';

export async function blockUser({
  blockedUserId,
  reason = 'Blocked user',
  showAlert = true,
}: {
  blockedUserId: string;
  reason?: string;
  showAlert?: boolean;
}): Promise<boolean> {
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    if (showAlert) {
      Alert.alert('Sign In Required', 'Please sign in to block users.');
    }
    return false;
  }

  const currentUserId = authData.user.id;

  if (currentUserId === blockedUserId) {
    if (showAlert) {
      Alert.alert('Not Allowed', 'You cannot block yourself.');
    }
    return false;
  }

  const { error } = await supabase.rpc('block_user_and_notify', {
    target_user_id: blockedUserId,
    block_reason: reason,
  });

  if (error) {
    console.error('Block user error:', error);

    if (showAlert) {
      Alert.alert('Error', 'Could not block this user. Please try again.');
    }

    return false;
  }

  if (showAlert) {
    Alert.alert(
      'User blocked.',
      'They have been reported to the developer and removed from your feed.'
    );
  }

  return true;
}
