// app/utils/fetchVideos.ts

// Use the globally initialized client (set in /lib/supabase and imported once in App.tsx)
function getSupabase() {
  const sb = (globalThis as any).supabaseClient;
  if (!sb) throw new Error("[fetchVideos] Supabase not initialized. Ensure App.tsx imports './lib/supabase' once.");
  return sb;
}

export type SubmissionWithVideo = {
  id: string;
  title: string;
  word: string | null;
  youtube_url: string | null;
  // self-hosted:
  storage_path: string | null;   // prefer variant path else videos.original_path
  thumbnail_url: string | null;  // if you saved one
  votes: number;
  created_at: string;
};

export async function fetchSubmissionsForFeatured(
  limit = 20
): Promise<SubmissionWithVideo[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("submissions")
    .select(`
      id, title, word, youtube_url, votes, created_at,
      videos:video_id (
        original_path,
        thumbnail_path,
        video_variants ( path, label )
      )
    `)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data ?? []).map((row: any) => {
    const variants = row?.videos?.video_variants ?? [];
    const preferred = variants.find((v: any) => v.label === "720p") ?? variants[0];
    const storage_path = preferred?.path ?? row?.videos?.original_path ?? null;

    return {
      id: row.id,
      title: row.title,
      word: row.word ?? null,
      youtube_url: row.youtube_url ?? null,
      storage_path,
      thumbnail_url: row?.videos?.thumbnail_path ?? null,
      votes: row.votes ?? 0,
      created_at: row.created_at,
    } as SubmissionWithVideo;
  });
}
