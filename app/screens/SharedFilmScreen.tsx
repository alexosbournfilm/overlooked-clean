import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  Image,
  Platform,
  useWindowDimensions,
  Linking,
  SafeAreaView,
} from "react-native";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { Video, ResizeMode } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import YoutubePlayer from "react-native-youtube-iframe";
import { supabase } from "../lib/supabase";
import type { RootStackParamList } from "../navigation/navigationRef";

const GOLD = "#C6A664";
const BG = "#000000";
const PANEL = "#080808";
const PANEL_ALT = "#0D0D0D";
const LINE = "rgba(255,255,255,0.07)";
const TEXT = "#F8F6F1";
const SUB = "rgba(237,235,230,0.72)";
const MUTE = "rgba(237,235,230,0.52)";

type SharedFilmRoute = RouteProp<RootStackParamList, "SharedFilm">;

type FilmRow = {
  id: string;
  user_id: string;
  title: string | null;
  description?: string | null;
  word?: string | null;
  votes?: number | null;
  submitted_at?: string | null;
  thumbnail_url?: string | null;

  storage_path?: string | null;
  video_path?: string | null;
  video_url?: string | null;
  file_url?: string | null;
  file_path?: string | null;
  mp4_url?: string | null;
  mp4_path?: string | null;
  url?: string | null;
  path?: string | null;

  youtube_url?: string | null;
  mime_type?: string | null;
  media_kind?: "file_audio" | "file_video" | "youtube" | null;
  film_category?: string | null;
  share_slug?: string | null;
  share_enabled?: boolean | null;
  users?: {
    id: string;
    full_name: string;
    public_slug?: string | null;
  } | null;
};

const WebVideo: any = "video";

function formatDate(dateString?: string | null) {
  if (!dateString) return "";
  try {
    return new Date(dateString).toLocaleDateString();
  } catch {
    return "";
  }
}

function buildSharedFilmUrl(shareSlug: string) {
  return `https://overlooked.cloud/f/${shareSlug}`;
}

function extractYoutubeId(url?: string | null) {
  if (!url) return null;

  try {
    const u = new URL(url);

    if (u.hostname.includes("youtu.be")) {
      return u.pathname.replace("/", "") || null;
    }

    const v = u.searchParams.get("v");
    if (v) return v;

    const parts = u.pathname.split("/").filter(Boolean);
    const embedIndex = parts.indexOf("embed");
    if (embedIndex >= 0 && parts[embedIndex + 1]) return parts[embedIndex + 1];

    const shortsIndex = parts.indexOf("shorts");
    if (shortsIndex >= 0 && parts[shortsIndex + 1]) return parts[shortsIndex + 1];

    return null;
  } catch {
    return null;
  }
}

function isAbsoluteUrl(value?: string | null) {
  return !!value && /^https?:\/\//i.test(value);
}

function stripQuery(url: string) {
  return url.split("?")[0];
}

function pathFromPublicUrl(url: string) {
  const clean = stripQuery(url);
  const match = clean.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (!match) return null;

  return {
    bucket: match[1],
    path: match[2],
  };
}

function pickMediaField(row: FilmRow) {
  return (
    row.storage_path ||
    row.video_path ||
    row.video_url ||
    row.file_url ||
    row.file_path ||
    row.mp4_url ||
    row.mp4_path ||
    row.url ||
    row.path ||
    ""
  )
    .toString()
    .trim();
}

async function signFilmMediaPath(pathOrUrl?: string | null) {
  if (!pathOrUrl) return null;

  if (isAbsoluteUrl(pathOrUrl)) {
    return pathOrUrl;
  }

  const cleanPath = stripQuery(pathOrUrl);

  const { data } = supabase.storage.from("films").getPublicUrl(cleanPath);
  if (data?.publicUrl) {
    return data.publicUrl;
  }

  return null;
}

export default function SharedFilmScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<SharedFilmRoute>();
  const { width } = useWindowDimensions();

  const routeShareSlug = route.params?.shareSlug;

  const pathShareSlug =
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.location.pathname.match(/^\/f\/([^/]+)/)?.[1]
      : null;

  const shareSlug = useMemo(() => {
    const raw = routeShareSlug || pathShareSlug || "";
    try {
      return decodeURIComponent(String(raw)).trim();
    } catch {
      return String(raw).trim();
    }
  }, [routeShareSlug, pathShareSlug]);

  const isWide = width >= 900;
  const cardWidth = useMemo(() => {
    if (isWide) return Math.min(960, width - 48);
    return width - 20;
  }, [isWide, width]);

  const mediaHeight = Math.max(220, Math.floor((cardWidth * 9) / 16));

  const [loading, setLoading] = useState(true);
  const [film, setFilm] = useState<FilmRow | null>(null);
  const [playableVideoUrl, setPlayableVideoUrl] = useState<string | null>(null);
  const [errorText, setErrorText] = useState("");
  const [isSignedIn, setIsSignedIn] = useState(false);

  const goToSignIn = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = "/signin";
      return;
    }

    navigation.navigate("Auth", { screen: "SignIn" });
  };

  const goToSignUp = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = "/signup";
      return;
    }

    navigation.navigate("Auth", { screen: "SignUp" });
  };

  const checkSession = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      setIsSignedIn(!!session?.user);
    } catch {
      setIsSignedIn(false);
    }
  }, []);

  const fetchFilm = useCallback(async () => {
    if (!shareSlug) {
      setErrorText("Missing film link.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorText("");
    setPlayableVideoUrl(null);

    try {
      const { data, error } = await supabase
        .from("submissions")
        .select(
          `
          id,
          user_id,
          title,
          description,
          word,
          votes,
          submitted_at,
          thumbnail_url,
          storage_path,
          video_path,
          video_url,
          file_url,
          file_path,
          mp4_url,
          mp4_path,
          url,
          path,
          youtube_url,
          mime_type,
          media_kind,
          film_category,
          share_slug,
          share_enabled,
          users:user_id (
            id,
            full_name,
            public_slug
          )
        `
        )
        .eq("share_slug", shareSlug)
        .maybeSingle();

      if (error) throw error;

      if (!data) {
        setFilm(null);
        setErrorText("This film could not be found.");
        return;
      }

      const row = data as FilmRow;

      if (row.share_enabled === false) {
        setFilm(null);
        setErrorText("This shared film is no longer available.");
        return;
      }

      setFilm(row);

      const youtubeId = extractYoutubeId(row.youtube_url);
      const isYoutube = row.media_kind === "youtube" || (!!row.youtube_url && !!youtubeId);

      if (!isYoutube) {
        const rawMedia = pickMediaField(row);
        const signed = await signFilmMediaPath(rawMedia);
        setPlayableVideoUrl(signed);
      } else {
        setPlayableVideoUrl(null);
      }
    } catch (e: any) {
      console.warn("SharedFilmScreen fetch error:", e?.message || e);
      setFilm(null);
      setErrorText("Could not load this film right now.");
    } finally {
      setLoading(false);
    }
  }, [shareSlug]);

  useEffect(() => {
    checkSession();
    fetchFilm();
  }, [checkSession, fetchFilm]);

  const goToCreator = () => {
    const user = film?.users;
    if (!user) return;

    if (user.public_slug) {
      navigation.navigate("PublicProfile", { slug: user.public_slug });
      return;
    }

    navigation.navigate("Profile", {
      user: {
        id: user.id,
        full_name: user.full_name,
      },
    });
  };

  const openSpecificFilmInApp = async () => {
    if (!shareSlug) return;

    const httpsUrl = buildSharedFilmUrl(shareSlug);
    const appUrl = `overlooked://f/${shareSlug}`;

    try {
      await Linking.openURL(appUrl);
      return;
    } catch {}

    try {
      await Linking.openURL(httpsUrl);
    } catch {}
  };

  const backAction = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }

    navigation.replace("MainTabs", {
      screen: "Featured",
    });
  };

  const youtubeId = extractYoutubeId(film?.youtube_url);
  const shouldShowYoutube =
    !!film && (film.media_kind === "youtube" || (!!film.youtube_url && !!youtubeId));

  const shouldShowFileVideo = !!playableVideoUrl;

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient
        colors={[BG, BG, "#040404"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.wrap, { width: cardWidth }]}>
          <TouchableOpacity
            onPress={backAction}
            activeOpacity={0.9}
            style={styles.backBtn}
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          {loading ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={GOLD} />
              <Text style={styles.stateText}>Loading film…</Text>
            </View>
          ) : errorText ? (
            <View style={styles.centerState}>
              <Text style={styles.errorTitle}>Unavailable</Text>
              <Text style={styles.errorText}>{errorText}</Text>

              <View style={styles.errorActions}>
                <TouchableOpacity
                  onPress={goToSignUp}
                  activeOpacity={0.9}
                  style={styles.primaryBtn}
                >
                  <Text style={styles.primaryBtnText}>Join Overlooked</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={goToSignIn}
                  activeOpacity={0.9}
                  style={styles.secondaryBtn}
                >
                  <Text style={styles.secondaryBtnText}>Sign In</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : film ? (
            <>
              <View style={styles.card}>
                <View style={[styles.mediaWrap, { height: mediaHeight }]}>
                  {shouldShowYoutube && youtubeId ? (
                    <YoutubePlayer
                      height={mediaHeight}
                      width={cardWidth}
                      videoId={youtubeId}
                      play={false}
                      webViewStyle={{ backgroundColor: "#000" }}
                      webViewProps={{
                        allowsInlineMediaPlayback: true,
                        mediaPlaybackRequiresUserAction: false,
                        // @ts-ignore
                        allowsFullscreenVideo: true,
                      }}
                      initialPlayerParams={{ rel: false }}
                    />
                  ) : shouldShowFileVideo && playableVideoUrl ? (
                    Platform.OS === "web" ? (
                      <WebVideo
                        src={playableVideoUrl}
                        controls
                        playsInline
                        preload="metadata"
                        poster={film.thumbnail_url || undefined}
                        style={styles.video}
                      />
                    ) : (
                      <Video
                        source={{ uri: playableVideoUrl }}
                        style={styles.video}
                        resizeMode={ResizeMode.CONTAIN}
                        useNativeControls
                        shouldPlay={false}
                        isLooping={false}
                        posterSource={
                          film.thumbnail_url ? { uri: film.thumbnail_url } : undefined
                        }
                        usePoster={!!film.thumbnail_url}
                      />
                    )
                  ) : film.thumbnail_url ? (
                    <View style={styles.mediaFallback}>
                      <Image
                        source={{ uri: film.thumbnail_url }}
                        style={styles.video}
                        resizeMode="cover"
                      />
                      <View style={styles.noVideoOverlay}>
                        <Text style={styles.noVideoOverlayText}>Film file not available</Text>
                      </View>
                    </View>
                  ) : (
                    <View style={[styles.video, styles.mediaFallback]}>
                      <Text style={styles.mediaFallbackText}>No preview available</Text>
                    </View>
                  )}
                </View>

                <View style={styles.metaBlock}>
                  <Text style={styles.kicker}>Shared on Overlooked</Text>

                  <Text style={styles.title}>
                    {film.title || "Untitled Film"}
                  </Text>

                  {film.users?.full_name ? (
                    <TouchableOpacity onPress={goToCreator} activeOpacity={0.9}>
                      <Text style={styles.byline}>by {film.users.full_name}</Text>
                    </TouchableOpacity>
                  ) : null}

                  <View style={styles.metaRow}>
                    {film.film_category ? (
                      <View style={styles.metaPill}>
                        <Text style={styles.metaPillText}>{film.film_category}</Text>
                      </View>
                    ) : null}

                    {film.submitted_at ? (
                      <View style={styles.metaPillGhost}>
                        <Text style={styles.metaPillGhostText}>
                          {formatDate(film.submitted_at)}
                        </Text>
                      </View>
                    ) : null}

                    <View style={styles.metaPillGhost}>
                      <Text style={styles.metaPillGhostText}>
                        Votes {film.votes ?? 0}
                      </Text>
                    </View>
                  </View>

                  {!!film.word ? (
                    <Text style={styles.wordText}>Word: {film.word}</Text>
                  ) : null}

                  {!!film.description ? (
                    <Text style={styles.description}>{film.description}</Text>
                  ) : null}

                  <View style={styles.actions}>
                    <TouchableOpacity
                      onPress={openSpecificFilmInApp}
                      activeOpacity={0.9}
                      style={styles.primaryBtn}
                    >
                      <Text style={styles.primaryBtnText}>Open in Overlooked</Text>
                    </TouchableOpacity>

                    {film.users?.full_name ? (
                      <TouchableOpacity
                        onPress={goToCreator}
                        activeOpacity={0.9}
                        style={styles.secondaryBtn}
                      >
                        <Text style={styles.secondaryBtnText}>View Creator</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </View>
              </View>

              {!isSignedIn && (
                <View style={styles.ctaCard}>
                  <Text style={styles.ctaTitle}>Want to share your own film?</Text>
                  <Text style={styles.ctaBody}>
                    Join Overlooked to upload films, build your profile, and connect with other creatives.
                  </Text>

                  <View style={styles.ctaActions}>
                    <TouchableOpacity
                      onPress={goToSignUp}
                      activeOpacity={0.9}
                      style={styles.primaryBtn}
                    >
                      <Text style={styles.primaryBtnText}>Join Overlooked</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={goToSignIn}
                      activeOpacity={0.9}
                      style={styles.secondaryBtn}
                    >
                      <Text style={styles.secondaryBtnText}>Sign In</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </>
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  scroll: {
    paddingVertical: 20,
    paddingHorizontal: 10,
    alignItems: "center",
    paddingBottom: 40,
  },
  wrap: {
    alignSelf: "center",
  },
  backBtn: {
    alignSelf: "flex-start",
    minHeight: 40,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: "#0B0B0B",
    borderWidth: 1,
    borderColor: LINE,
    justifyContent: "center",
    marginBottom: 14,
  },
  backText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
  },
  centerState: {
    minHeight: 320,
    borderRadius: 22,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: LINE,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  stateText: {
    marginTop: 12,
    color: SUB,
    fontSize: 14,
    fontWeight: "700",
  },
  errorTitle: {
    color: TEXT,
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 8,
  },
  errorText: {
    color: MUTE,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    maxWidth: 520,
  },
  errorActions: {
    marginTop: 18,
    flexDirection: Platform.OS === "web" ? "row" : "column",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: PANEL,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: LINE,
    overflow: "hidden",
  },
  mediaWrap: {
  width: "100%",
  backgroundColor: "#000",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
},
video: {
  width: "100%",
  height: "100%",
  backgroundColor: "#000",
},
mediaFallback: {
  width: "100%",
  height: "100%",
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "#000",
  position: "relative",
}, 
  mediaFallbackText: {
    color: MUTE,
    fontSize: 14,
    fontWeight: "700",
  },
  noVideoOverlay: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignSelf: "center",
  },
  noVideoOverlayText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  metaBlock: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  kicker: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  title: {
    color: TEXT,
    fontSize: 28,
    fontWeight: "900",
    lineHeight: 34,
  },
  byline: {
    marginTop: 8,
    color: SUB,
    fontSize: 14,
    fontWeight: "800",
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    marginTop: 14,
    marginBottom: 14,
  },
  metaPill: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "rgba(198,166,100,0.12)",
    borderWidth: 1,
    borderColor: "rgba(198,166,100,0.32)",
    justifyContent: "center",
    marginRight: 8,
    marginBottom: 8,
  },
  metaPillText: {
    color: GOLD,
    fontSize: 12,
    fontWeight: "800",
  },
  metaPillGhost: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: LINE,
    justifyContent: "center",
    marginRight: 8,
    marginBottom: 8,
  },
  metaPillGhostText: {
    color: SUB,
    fontSize: 12,
    fontWeight: "800",
  },
  wordText: {
    color: GOLD,
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 10,
  },
  description: {
    color: SUB,
    fontSize: 15,
    lineHeight: 23,
  },
  actions: {
    flexDirection: Platform.OS === "web" ? "row" : "column",
    alignItems: Platform.OS === "web" ? "center" : "stretch",
    marginTop: 18,
  },
  primaryBtn: {
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: GOLD,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Platform.OS === "web" ? 10 : 0,
    marginBottom: Platform.OS === "web" ? 0 : 10,
  },
  primaryBtnText: {
    color: "#111",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  secondaryBtn: {
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: LINE,
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryBtnText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  ctaCard: {
    marginTop: 16,
    backgroundColor: PANEL_ALT,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: LINE,
    paddingHorizontal: 18,
    paddingVertical: 22,
    alignItems: "center",
  },
  ctaTitle: {
    color: TEXT,
    fontSize: 20,
    fontWeight: "900",
    textAlign: "center",
  },
  ctaBody: {
    color: SUB,
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    marginTop: 8,
    maxWidth: 560,
  },
  ctaActions: {
    marginTop: 18,
    flexDirection: Platform.OS === "web" ? "row" : "column",
    alignItems: "center",
    justifyContent: "center",
  },
});