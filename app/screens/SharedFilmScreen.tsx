import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "react-native";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { Video, ResizeMode } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import { supabase } from "../lib/supabase";
import type { RootStackParamList } from "../navigation/navigationRef";

const GOLD = "#C6A664";
const BG = "#000000";
const PANEL = "#080808";
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
  votes?: number | null;
  submitted_at?: string | null;
  thumbnail_url?: string | null;
  storage_path?: string | null;
  video_path?: string | null;
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

export default function SharedFilmScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<SharedFilmRoute>();
  const { width } = useWindowDimensions();

  const shareSlug = route.params?.shareSlug;
  const isWide = width >= 900;

  const [loading, setLoading] = useState(true);
  const [film, setFilm] = useState<FilmRow | null>(null);
  const [signedVideoUrl, setSignedVideoUrl] = useState<string | null>(null);
  const [errorText, setErrorText] = useState("");
  const [redirecting, setRedirecting] = useState(false);

  const hasRedirectedRef = useRef(false);

  const cardWidth = useMemo(() => {
    if (isWide) return Math.min(960, width - 48);
    return width - 20;
  }, [isWide, width]);

  const redirectToFeaturedModal = useCallback(
    (row: FilmRow) => {
      if (hasRedirectedRef.current) return;
      hasRedirectedRef.current = true;
      setRedirecting(true);

      try {
        navigation.replace("MainTabs", {
          screen: "Featured",
          params: {
            openSubmissionId: row.id,
            openShareSlug: row.share_slug ?? shareSlug ?? null,
          },
        });
      } catch (e) {
        console.warn("SharedFilmScreen redirect error:", e);
        hasRedirectedRef.current = false;
        setRedirecting(false);
      }
    },
    [navigation, shareSlug]
  );

  const fetchFilm = useCallback(async () => {
    if (!shareSlug) {
      setErrorText("Missing film link.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setErrorText("");
    setSignedVideoUrl(null);

    try {
      const { data, error } = await supabase
        .from("submissions")
        .select(
          `
          id,
          user_id,
          title,
          description,
          votes,
          submitted_at,
          thumbnail_url,
          storage_path,
          video_path,
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

      if (error) {
        throw error;
      }

      if (!data) {
        setFilm(null);
        setErrorText("This film could not be found.");
        setLoading(false);
        return;
      }

      const row = data as FilmRow;

      if (row.share_enabled === false) {
        setFilm(null);
        setErrorText("This shared film is no longer available.");
        setLoading(false);
        return;
      }

      setFilm(row);

      const mediaPath = row.storage_path || row.video_path;

      if (mediaPath && row.media_kind !== "youtube") {
        const { data: signed, error: signError } = await supabase.storage
          .from("films")
          .createSignedUrl(mediaPath, 3600);

        if (!signError && signed?.signedUrl) {
          setSignedVideoUrl(signed.signedUrl);
        } else {
          setSignedVideoUrl(null);
        }
      } else {
        setSignedVideoUrl(null);
      }

      if (Platform.OS !== "web") {
        redirectToFeaturedModal(row);
      }
    } catch (e: any) {
      console.warn("SharedFilmScreen fetch error:", e?.message || e);
      setFilm(null);
      setErrorText("Could not load this film right now.");
    } finally {
      setLoading(false);
    }
  }, [shareSlug, redirectToFeaturedModal]);

  useEffect(() => {
    fetchFilm();
  }, [fetchFilm]);

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

  return (
    <View style={styles.container}>
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

          {loading || redirecting ? (
            <View style={styles.centerState}>
              <ActivityIndicator size="large" color={GOLD} />
              <Text style={styles.stateText}>
                {redirecting ? "Opening film…" : "Loading film…"}
              </Text>
            </View>
          ) : errorText ? (
            <View style={styles.centerState}>
              <Text style={styles.errorTitle}>Unavailable</Text>
              <Text style={styles.errorText}>{errorText}</Text>
            </View>
          ) : film ? (
            <View style={styles.card}>
              <View style={styles.mediaWrap}>
                {signedVideoUrl ? (
                  <Video
                    source={{ uri: signedVideoUrl }}
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
                ) : film.thumbnail_url ? (
                  <Image
                    source={{ uri: film.thumbnail_url }}
                    style={styles.video}
                    resizeMode="cover"
                  />
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
          ) : null}
        </View>
      </ScrollView>
    </View>
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
    aspectRatio: 16 / 9,
  },
  video: {
    width: "100%",
    height: "100%",
    backgroundColor: "#000",
  },
  mediaFallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  mediaFallbackText: {
    color: MUTE,
    fontSize: 14,
    fontWeight: "700",
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
});