import { useEffect, useRef, useState, memo } from "react";
import { View, Text, Image } from "react-native";
import { Video, ResizeMode } from "expo-av";

// Get the globally-initialized Supabase client
function getSupabase() {
  const sb = (globalThis as any).supabaseClient;
  if (!sb) throw new Error("[FeedVideoCard] Supabase not initialized. Ensure App.tsx imports './lib/supabase' once.");
  return sb;
}

/** Sign a path in the *films* bucket (matches uploadFilm) */
async function signVideoPath(path: string, expiresInSec = 180): Promise<string> {
  const supabase = getSupabase();
  const { data, error } = await supabase.storage
    .from("films")
    .createSignedUrl(path, expiresInSec);

  if (error || !data) {
    console.error("[signVideoPath] Failed:", error);
  }
  return data?.signedUrl ?? "";
}

type Props = {
  title: string;
  thumbnailUrl?: string | null; // optional poster
  storagePath: string;          // e.g. "uploads/<videoId>/source.mp4"
  autoPlay?: boolean;
};

function FeedVideoCardBase({ title, thumbnailUrl, storagePath, autoPlay = true }: Props) {
  const ref = useRef<Video>(null);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const url = await signVideoPath(storagePath, 180);
        if (alive) setSrc(url || null);
      } catch (e) {
        console.warn("[FeedVideoCard] signing failed", e);
      }
    })();
    return () => { alive = false; };
  }, [storagePath]);

  return (
    <View style={{ marginBottom: 18, borderRadius: 16, overflow: "hidden", backgroundColor: "#000" }}>
      {src ? (
        <Video
          ref={ref}
          source={{ uri: src }}
          style={{ width: "100%", height: 320 }}
          resizeMode={ResizeMode.COVER}
          isLooping
          isMuted
          shouldPlay={autoPlay}
          useNativeControls={false}
          posterSource={thumbnailUrl ? { uri: thumbnailUrl } : undefined}
          posterStyle={{ width: "100%", height: 320 }}
        />
      ) : (
        <Image
          source={thumbnailUrl ? { uri: thumbnailUrl } : { uri: "https://picsum.photos/800/450" }}
          style={{ width: "100%", height: 320 }}
        />
      )}
      <Text style={{ padding: 12, fontWeight: "700", fontSize: 16, color: "#1E1E1E", backgroundColor: "#fff" }}>
        {title}
      </Text>
    </View>
  );
}

export const FeedVideoCard = memo(FeedVideoCardBase);
