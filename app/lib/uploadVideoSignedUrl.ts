// app/lib/uploadVideoSignedUrl.ts
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from './supabase'; // or '@/lib/supabase' if you added the alias

export async function uploadVideoSignedUrl(userId: string) {
  const pick = await DocumentPicker.getDocumentAsync({
    type: ['video/*'],
    copyToCacheDirectory: true,
  });
  if (pick.canceled) return null;

  const asset = pick.assets[0];
  const fileUri = asset.uri;
  const fileName = asset.name || `video-${Date.now()}.mp4`;
  const path = `videos/${userId}/${Date.now()}-${fileName}`;

  const resp = await fetch(fileUri);
  const blob = await resp.blob();

  const { data, error } = await supabase.storage
    .from('films')
    .createSignedUploadUrl(path);
  if (error || !data?.token) throw error ?? new Error('No signed token');

  const up = await supabase.storage
    .from('films')
    .uploadToSignedUrl(path, data.token, blob, {
      contentType: blob.type || 'video/mp4',
      upsert: true,
    });
  if (up.error) throw up.error;

  return { path };
}
