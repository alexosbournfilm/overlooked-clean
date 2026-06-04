// app/utils/reportContent.ts

import { Alert } from 'react-native';
import { supabase } from '../lib/supabase';

export type ReportContentType =
  | 'submission'
  | 'job'
  | 'message'
  | 'profile'
  | 'chat'
  | 'comment'
  | 'other';

export type ReportReason =
  | 'Harassment or bullying'
  | 'Hate speech or discrimination'
  | 'Sexual content'
  | 'Violence or threats'
  | 'Spam or scam'
  | 'Illegal activity'
  | 'Impersonation'
  | 'Other';

export const REPORT_REASONS: ReportReason[] = [
  'Harassment or bullying',
  'Hate speech or discrimination',
  'Sexual content',
  'Violence or threats',
  'Spam or scam',
  'Illegal activity',
  'Impersonation',
  'Other',
];

export async function reportContent({
  reportedUserId,
  contentType,
  contentId,
  reason,
  details,
  showAlert = true,
}: {
  reportedUserId?: string | null;
  contentType: ReportContentType;
  contentId?: string | null;
  reason: ReportReason;
  details?: string | null;
  showAlert?: boolean;
}): Promise<boolean> {
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    if (showAlert) {
      Alert.alert('Sign In Required', 'Please sign in to report content.');
    }
    return false;
  }

  const { data: insertedReport, error } = await supabase
    .from('content_reports')
    .insert({
    reporter_id: authData.user.id,
    reported_user_id: reportedUserId || null,
    content_type: contentType,
    content_id: contentId || null,
    reason,
    details: details || null,
    developer_notified: false,
  })
    .select('id')
    .single();

  if (error) {
    console.error('Report content error:', error);

    if (showAlert) {
      Alert.alert('Error', 'Could not submit report. Please try again.');
    }

    return false;
  }

  if (insertedReport?.id) {
    supabase.functions
      .invoke('notify-content-report', {
        body: { report_id: insertedReport.id },
      })
      .then(({ error: notifyError }) => {
        if (notifyError) {
          console.warn('Content report email notification failed:', notifyError.message);
        }
      })
      .catch((notifyError) => {
        console.warn(
          'Content report email notification failed:',
          notifyError?.message || notifyError
        );
      });
  }

  if (showAlert) {
    Alert.alert(
      'Report sent',
      'Report sent. Our team will review it within 24 hours.'
    );
  }

  return true;
}
