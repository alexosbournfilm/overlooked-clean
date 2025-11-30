import { memo } from "react";
import { View } from "react-native";
import { FeedVideoCard } from "./FeedVideoCard";

type Props = {
  title: string;
  // self-hosted (preferred)
  storagePath?: string | null;  // e.g. "user/<uid>/<videoId>/source.mp4" or a variant path
  thumbnailUrl?: string | null; // optional
  autoPlay?: boolean;

  // fallback
  youtubeUrl?: string | null;
};

// super-light YouTube webview fallback (keeps your old content viewable)
function YouTubeEmbed({ url }: { url: string }) {
  // You already had a YouTube embed before — keep yours if you prefer.
  // Minimal version with react-native-webview:
  // npm i react-native-webview
  // import { WebView } from "react-native-webview";
  // return <WebView source={{ uri: url }} style={{ height: 320 }} allowsInlineMediaPlayback />;
  return <View style={{ height: 320, backgroundColor: "#000" }} />;
}

function Base({
  title,
  storagePath,
  thumbnailUrl,
  youtubeUrl,
  autoPlay = true,
}: Props) {
  if (storagePath) {
    return (
      <FeedVideoCard
        title={title}
        storagePath={storagePath}
        thumbnailUrl={thumbnailUrl ?? null}
        autoPlay={autoPlay}
      />
    );
  }
  if (youtubeUrl) {
    return <YouTubeEmbed url={youtubeUrl} />;
  }
  // nothing to show
  return <View style={{ height: 320, backgroundColor: "#eee" }} />;
}

export const VideoOrYouTube = memo(Base);
