// app/utils/videoUrls.ts
import { supabase } from "../lib/supabase";

/**
 * Create a signed URL to play a private video from the 'films' bucket.
 * Matches what uploadFilm() uses.
 */
export async function signVideoPath(path: string, expiresInSec = 180): Promise<string> {
  const { data, error } = await supabase.storage
    .from("films")
    .createSignedUrl(path, expiresInSec);

  if (error || !data) {
    console.error("[signVideoPath] Failed to sign URL:", error);
    throw error ?? new Error("Failed to sign storage URL");
  }

  return data.signedUrl;
}
