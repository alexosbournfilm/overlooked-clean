import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  ActivityIndicator,
  useWindowDimensions,
  Pressable,
  Modal,
  Platform,
  SafeAreaView,
  Linking,
  TouchableOpacity,
  ImageBackground,
  Animated,
  Easing,
} from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import { supabase } from "../lib/supabase";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import {
  Audio,
  Video,
  ResizeMode,
  VideoFullscreenUpdate,
  AVPlaybackStatus,
} from "expo-av";
import YoutubePlayer from "react-native-youtube-iframe";

/* ---------- Noir palette ---------- */
const GOLD = "#C6A664";
const COLORS = {
  background: "#000000",
  card: "#0A0A0A",
  cardAlt: "#0E0E0E",
  border: "#FFFFFF1A",
  textPrimary: "#FFFFFF",
  textSecondary: "#D0D0D0",
  primary: GOLD,
};

const FONT_CINZEL =
  Platform.select({ ios: "Cinzel", android: "Cinzel", default: "Cinzel" }) || "Cinzel";
const FONT_OBLIVION =
  Platform.select({
    ios: "Avenir Next",
    android: "sans-serif-light",
    default: "Avenir Next",
  }) || "Avenir Next";

const PAGE_MAX = 1160;
const SIDE_PAD_DESKTOP = 20;
const SIDE_PAD_MOBILE = 16;
const GRID_GAP = 14;
const SHOWREEL_MAX_W = 760;
const SHOWREEL_MAX_W_MOBILE = 600;
const SHOWREEL_BUCKET = "portfolios";

type PortfolioType = "image" | "pdf" | "audio" | "video";

type ShowreelCategory =
  | "Acting"
  | "Editing"
  | "Directing"
  | "Sound"
  | "Cinematography"
  | "All-in-one Filmmaker";

type PublicProfile = {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  portfolio_url?: string | null;
  main_role_id?: number | null;
  side_roles?: string[] | null;
  city_id?: number | null;
  bio?: string | null;
  xp?: number | null;
  level?: number | null;
  banner_color?: string | null;
  public_slug?: string | null;
  is_profile_public?: boolean | null;
};

type PortfolioItem = {
  id: string;
  user_id: string;
  title?: string | null;
  type: PortfolioType;
  url: string;
  mime_type?: string | null;
  created_at: string;
};

type SubmissionRow = {
  id: string;
  user_id: string;
  title: string | null;
  word: string | null;
  youtube_url: string | null;
  video_url?: string | null;
  video_path?: string | null;
  thumbnail_url?: string | null;
  submitted_at: string;
};

type ShowreelRow = {
  id: string;
  user_id: string;
  file_path: string;
  title: string | null;
  category: ShowreelCategory | null;
  thumbnail_url: string | null;
  is_primary: boolean | null;
  sort_order?: number | null;
  created_at: string;
  url: string;
};

const addBuster = (url?: string | null) =>
  url ? `${url}${/\?/.test(url) ? "&" : "?"}t=${Date.now()}` : null;

const extractYoutubeId = (url: string) => {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "");

    const v = u.searchParams.get("v");
    if (v) return v;

    const parts = u.pathname.split("/").filter(Boolean);
    const embedIdx = parts.indexOf("embed");
    if (embedIdx >= 0 && parts[embedIdx + 1]) return parts[embedIdx + 1];
    const shortsIdx = parts.indexOf("shorts");
    if (shortsIdx >= 0 && parts[shortsIdx + 1]) return parts[shortsIdx + 1];

    return null;
  } catch {
    return null;
  }
};

const ytThumb = (url: string) => {
  const id = extractYoutubeId(url);
  if (!id) return null;
  return `https://img.youtube.com/vi/${id}/hqdefault.jpg`;
};

/* ---------- film grain ---------- */
const GRAIN_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIElEQVQYV2P8//8/AzGAiYGB4T8mGJgYhBmMCEwMDAwA1wQq1i3gN8QAAAAASUVORK5CYII=";

const Grain = ({ opacity = 0.06 }: { opacity?: number }) => {
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { opacity }]}>
      {Platform.OS === "web" ? (
        <View
          // @ts-ignore
          style={[
            StyleSheet.absoluteFillObject as any,
            {
              backgroundImage: `url(${GRAIN_PNG})`,
              backgroundRepeat: "repeat",
              backgroundSize: "auto",
            },
          ]}
        />
      ) : (
        <ImageBackground
          source={{ uri: GRAIN_PNG }}
          style={StyleSheet.absoluteFillObject}
          resizeMode={"repeat" as any}
        />
      )}
    </View>
  );
};

/* ---------- web video css ---------- */
let PROFILE_VIDEO_CSS_INJECTED = false;
function injectWebVideoCSS() {
  if (Platform.OS !== "web" || typeof document === "undefined" || PROFILE_VIDEO_CSS_INJECTED)
    return;
  const style = document.createElement("style");
  style.innerHTML = `
    .ovk-video { outline: none !important; }
    .ovk-video::-webkit-media-controls { display: none !important; }
    .ovk-video::-webkit-media-controls-enclosure { display: none !important; }
    .ovk-video::-webkit-media-controls-panel { display: none !important; }
    .ovk-video::-webkit-media-controls-play-button { display: none !important; }
    .ovk-video::-webkit-media-controls-timeline { display: none !important; }
    .ovk-video::-webkit-media-controls-current-time-display { display: none !important; }
    .ovk-video::-webkit-media-controls-time-remaining-display { display: none !important; }
    .ovk-video::-webkit-media-controls-seek-back-button { display: none !important; }
    .ovk-video::-webkit-media-controls-seek-forward-button { display: none !important; }
    .ovk-video::-webkit-media-controls-fullscreen-button { display: none !important; }
    .ovk-video::-webkit-media-controls-mute-button { display: none !important; }
  `;
  document.head.appendChild(style);
  PROFILE_VIDEO_CSS_INJECTED = true;
}
injectWebVideoCSS();

/* ---------- signed url cache ---------- */
const showreelSignedUrlCache = new Map<string, { url: string; exp: number }>();
const showreelInflight = new Map<string, Promise<string>>();

async function signShowreelPath(pathOrUrl: string, expiresInSec = 300): Promise<string> {
  if (!pathOrUrl) throw new Error("Missing showreel path");
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;

  const now = Date.now();
  const cached = showreelSignedUrlCache.get(pathOrUrl);
  if (cached && now < cached.exp - 30_000) return cached.url;
  if (showreelInflight.has(pathOrUrl)) return showreelInflight.get(pathOrUrl)!;

  const p = (async () => {
    const { data, error } = await supabase.storage
      .from(SHOWREEL_BUCKET)
      .createSignedUrl(pathOrUrl, expiresInSec);
    if (error || !data) {
      showreelInflight.delete(pathOrUrl);
      throw error ?? new Error("Failed to sign showreel URL");
    }
    const url = data.signedUrl;
    showreelSignedUrlCache.set(pathOrUrl, { url, exp: now + expiresInSec * 1000 });
    showreelInflight.delete(pathOrUrl);
    return url;
  })();

  showreelInflight.set(pathOrUrl, p);
  return p;
}

/* ---------- player registry ---------- */
type PlayerHandle = { id: string; pause: () => Promise<void> | void };
const playerRegistry = new Map<string, PlayerHandle>();
const PAUSE_NONE_ID = "__NONE__";

async function pauseAllExcept(id?: string | null) {
  const target = id || PAUSE_NONE_ID;
  const ops: Promise<void>[] = [];
  playerRegistry.forEach((h) => {
    if (h.id !== target) ops.push(Promise.resolve(h.pause()));
  });
  await Promise.allSettled(ops);
}

const WebVideo: any = "video";

/* ---------- inline showreel player ---------- */
function ShowreelVideoInline({
  playerId,
  filePathOrUrl,
  width,
  autoPlay,
}: {
  playerId: string;
  filePathOrUrl: string;
  width: number;
  autoPlay: boolean;
}) {
  const expoRef = useRef<Video>(null);
  const htmlRef = useRef<any>(null);

  const [src, setSrc] = useState<string | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const [muted, setMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const progressRef = useRef<View>(null);
  const opacity = useRef(new Animated.Value(0)).current;

  const clampedW = Math.min(width, SHOWREEL_MAX_W);
  const heightFromAspect = clampedW / aspect;

  useEffect(() => {
    const handle: PlayerHandle = {
      id: playerId,
      pause: async () => {
        try {
          if (Platform.OS === "web") htmlRef.current?.pause();
          else await expoRef.current?.pauseAsync();
          setIsPlaying(false);
        } catch {}
      },
    };
    playerRegistry.set(playerId, handle);
    return () => {
      playerRegistry.delete(playerId);
    };
  }, [playerId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const url = await signShowreelPath(filePathOrUrl);
        if (alive) setSrc(url);
      } catch (e) {
        console.warn("[PublicProfile showreel sign failed]", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [filePathOrUrl]);

  const fadeIn = () => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const updateAspect = (w?: number, h?: number) => {
    if (!w || !h) return;
    const next = w / h;
    if (Number.isFinite(next) && Math.abs(next - aspect) > 0.004) setAspect(next);
  };

  const syncFromStatus = (status?: AVPlaybackStatus) => {
    if (!status || !("isLoaded" in status) || !status.isLoaded) return;
    const s: any = status;
    const ns = s.naturalSize;
    if (ns?.width && ns?.height) updateAspect(ns.width, ns.height);

    setIsPlaying(!!s.isPlaying);

    const d = s.durationMillis || 0;
    const p = s.positionMillis || 0;
    if (d > 0) {
      setDuration(d / 1000);
      setProgress(Math.max(0, Math.min(1, p / d)));
    }
  };

  const play = async (ensureSound = false) => {
    try {
      await pauseAllExcept(playerId);
      if (Platform.OS === "web") {
        const el = htmlRef.current;
        if (!el) return;
        if (ensureSound) {
          el.muted = false;
          setMuted(false);
        }
        el.controls = false;
        await el.play().catch(async () => {
          el.muted = true;
          setMuted(true);
          try {
            await el.play();
          } catch {}
        });
        setIsPlaying(!el.paused);
      } else {
        if (ensureSound) {
          await expoRef.current?.setIsMutedAsync(false);
          setMuted(false);
        }
        await expoRef.current?.playAsync();
        setIsPlaying(true);
      }
    } catch {}
  };

  const pause = async () => {
    try {
      if (Platform.OS === "web") htmlRef.current?.pause();
      else await expoRef.current?.pauseAsync();
    } catch {}
    setIsPlaying(false);
  };

  useEffect(() => {
    (async () => {
      if (!src) return;
      if (autoPlay) {
        await play(true);
      } else {
        await pause();
        if (Platform.OS === "web") {
          if (htmlRef.current) {
            htmlRef.current.muted = true;
            htmlRef.current.controls = false;
          }
        } else {
          try {
            await expoRef.current?.setIsMutedAsync(true);
          } catch {}
        }
        setMuted(true);
      }
    })();
  }, [src, autoPlay]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const id = window.setInterval(() => {
      const el = htmlRef.current;
      if (el) el.controls = false;
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const handler = () => {
      const el = htmlRef.current as any;
      const fs = (document as any).fullscreenElement;
      if (el && fs === el) {
        setIsFullscreen(true);
      } else {
        setIsFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const onSurfacePress = async () => {
    if (isPlaying) await pause();
    else await play(false);
  };

  const onExpoReady = (e: any) => {
    const ns = e?.naturalSize;
    if (ns?.width && ns?.height) updateAspect(ns.width, ns.height);
    fadeIn();
  };

  const onExpoFullscreen = ({ fullscreenUpdate }: { fullscreenUpdate: number }) => {
    if (fullscreenUpdate === VideoFullscreenUpdate.PLAYER_WILL_PRESENT) setIsFullscreen(true);
    if (fullscreenUpdate === VideoFullscreenUpdate.PLAYER_DID_DISMISS) setIsFullscreen(false);
  };

  const onWebLoadedMeta = () => {
    const el = htmlRef.current;
    if (!el) return;
    updateAspect(el.videoWidth, el.videoHeight);
    setDuration(el.duration || 0);
    el.controls = false;
    fadeIn();
  };

  const onWebTimeUpdate = () => {
    const el = htmlRef.current;
    if (!el) return;
    const d = el.duration || 0;
    const p = el.currentTime || 0;
    if (d > 0) {
      setDuration(d);
      setProgress(Math.max(0, Math.min(1, p / d)));
    }
  };

  const enterFullscreen = async () => {
    try {
      await pauseAllExcept(playerId);
      await play(true);
      if (Platform.OS === "web") {
        const el = htmlRef.current as any;
        if (el?.requestFullscreen) {
          await el.requestFullscreen();
          setIsFullscreen(true);
        }
      } else {
        (expoRef.current as any)?.presentFullscreenPlayer?.();
      }
    } catch {}
  };

  const toggleMute = async () => {
    try {
      if (Platform.OS === "web") {
        const el = htmlRef.current;
        if (!el) return;
        const next = !muted;
        el.muted = next;
        setMuted(next);
      } else {
        const next = !muted;
        await expoRef.current?.setIsMutedAsync(next);
        setMuted(next);
      }
    } catch {}
  };

  const onProgressPress = async (evt: any) => {
    try {
      if (!progressRef.current || !duration) return;
      const node: any = progressRef.current;
      const rect = node.getBoundingClientRect
        ? node.getBoundingClientRect()
        : { left: 0, width: 1 };
      const clientX =
        evt.nativeEvent?.locationX != null
          ? rect.left + evt.nativeEvent.locationX
          : evt.nativeEvent?.pageX ?? 0;
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const target = ratio * duration;

      if (Platform.OS === "web" && htmlRef.current) {
        htmlRef.current.currentTime = target;
      } else if (expoRef.current) {
        await expoRef.current.setPositionAsync(target * 1000);
      }
      setProgress(ratio);
    } catch {}
  };

  return (
    <View
      style={{
        width: clampedW,
        height: heightFromAspect,
        borderRadius: 12,
        overflow: "hidden",
        backgroundColor: "#000",
        alignSelf: "center",
        position: "relative",
      }}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, { opacity }]}>
        {Platform.OS === "web" ? (
          <WebVideo
            ref={htmlRef}
            src={src || undefined}
            className="ovk-video"
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              objectPosition: "center center",
              display: "block",
              background: "#000",
            }}
            loop
            playsInline
            preload="auto"
            controls={false}
            controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
            disablePictureInPicture
            onContextMenu={(e: any) => e.preventDefault()}
            onLoadedMetadata={onWebLoadedMeta}
            onTimeUpdate={onWebTimeUpdate}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
          />
        ) : (
          <Video
            ref={expoRef}
            source={src ? { uri: src } : undefined}
            style={StyleSheet.absoluteFillObject}
            resizeMode={ResizeMode.CONTAIN}
            isLooping
            shouldPlay={autoPlay}
            isMuted={muted}
            useNativeControls={false}
            onReadyForDisplay={onExpoReady}
            onPlaybackStatusUpdate={syncFromStatus}
            onFullscreenUpdate={onExpoFullscreen}
            progressUpdateIntervalMillis={150}
          />
        )}
      </Animated.View>

      <Grain opacity={0.05} />

      <Pressable style={StyleSheet.absoluteFillObject} onPress={onSurfacePress} />

      <Pressable ref={progressRef} onPress={onProgressPress} style={stylesShowreel.progressHit}>
        <View style={stylesShowreel.progressTrack}>
          <View
            style={[
              stylesShowreel.progressFill,
              { width: `${Math.max(0, Math.min(100, progress * 100))}%` },
            ]}
          />
        </View>
      </Pressable>

      <TouchableOpacity
        onPress={enterFullscreen}
        style={stylesShowreel.fsButton}
        activeOpacity={0.9}
      >
        <View style={stylesShowreel.cornerBox} />
      </TouchableOpacity>

      <TouchableOpacity onPress={toggleMute} style={stylesShowreel.soundBtn} activeOpacity={0.9}>
        <Ionicons
          name={muted ? "volume-mute-outline" : "volume-high-outline"}
          size={14}
          color="#fff"
        />
        <Text style={stylesShowreel.soundText}>{muted ? "Sound Off" : "Sound On"}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function PublicProfileScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();

  const isMobile = width < 768;
  const isMobileLike = isMobile || (Platform.OS === "web" && width < 520);
  const isCompact = width < 380;
  const horizontalPad = isMobileLike ? (isCompact ? 12 : SIDE_PAD_MOBILE) : SIDE_PAD_DESKTOP;

  const routeSlug = route.params?.slug;
  const pathSlug =
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.location.pathname.match(/^\/creative\/([^/]+)/)?.[1]
      : null;

  const slug = useMemo(() => {
    const raw = routeSlug || pathSlug || "";
    try {
      return decodeURIComponent(String(raw)).trim();
    } catch {
      return String(raw).trim();
    }
  }, [routeSlug, pathSlug]);

  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [mainRoleName, setMainRoleName] = useState("");
  const [cityName, setCityName] = useState("");
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [showreels, setShowreels] = useState<ShowreelRow[]>([]);
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [supportersCount, setSupportersCount] = useState(0);
  const [supportingCount, setSupportingCount] = useState(0);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [errorText, setErrorText] = useState("");

  const [imageViewerUrls, setImageViewerUrls] = useState<string[]>([]);
  const [imageViewerIndex, setImageViewerIndex] = useState<number | null>(null);

  const [showreelModalOpen, setShowreelModalOpen] = useState(false);
  const [activeShowreel, setActiveShowreel] = useState<ShowreelRow | null>(null);

  const [submissionModalOpen, setSubmissionModalOpen] = useState(false);
  const [activeSubmission, setActiveSubmission] = useState<SubmissionRow | null>(null);

  const soundRef = useRef<Audio.Sound | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const displayBannerColor = profile?.banner_color || "#FFEDE4";

  const goToSignIn = () => {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.location.href = "/signin";
    return;
  }

  navigation.navigate("Auth" as never, { screen: "SignIn" } as never);
};

const goToSignUp = () => {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.location.href = "/signup";
    return;
  }

  navigation.navigate("Auth" as never, { screen: "SignUp" } as never);
};
  const closeShowreelModal = async () => {
    setShowreelModalOpen(false);
    setActiveShowreel(null);
    await pauseAllExcept(PAUSE_NONE_ID);
  };

  const fetchPortfolioItems = async (userId: string) => {
    setLoadingPortfolio(true);
    const { data, error } = await supabase
      .from("portfolio_items")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Public portfolio load error:", error.message);
      setPortfolioItems([]);
      setLoadingPortfolio(false);
      return;
    }

    setPortfolioItems((data || []) as PortfolioItem[]);
    setLoadingPortfolio(false);
  };

  const fetchShowreelList = async (userId: string) => {
    const { data, error } = await supabase
      .from("user_showreels")
      .select(
        "id, user_id, file_path, title, category, thumbnail_url, is_primary, sort_order, created_at"
      )
      .eq("user_id", userId)
      .order("is_primary", { ascending: false })
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Public showreel load error:", error.message);
      setShowreels([]);
      return;
    }

    const rows: ShowreelRow[] = (data || []).map((row: any) => {
      const { data: pub } = supabase.storage.from(SHOWREEL_BUCKET).getPublicUrl(row.file_path);
      return {
        id: row.id,
        user_id: row.user_id,
        file_path: row.file_path,
        title: row.title ?? null,
        category: row.category ?? null,
        thumbnail_url: row.thumbnail_url ?? null,
        is_primary: row.is_primary ?? false,
        sort_order: row.sort_order ?? 0,
        created_at: row.created_at,
        url: pub.publicUrl,
      };
    });

    setShowreels(rows.slice(0, 3));
  };

  const fetchUserSubmissions = async (userId: string) => {
    try {
      setLoadingSubmissions(true);

      const { data, error } = await supabase
        .from("submissions")
        .select("*")
        .eq("user_id", userId)
        .order("submitted_at", { ascending: false });

      if (error) {
        console.warn("Public submissions load error:", error.message);
        setSubmissions([]);
        return;
      }

      const rows = (data || []) as any[];

      const stripQuery = (u: string) => (u ? u.split("?")[0] : u);

      const pathFromPublicUrl = (u: string) => {
        const clean = stripQuery(u);
        const m = clean.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
        if (!m) return null;
        return { bucket: m[1], path: m[2] };
      };

      const pickVideoField = (s: any) => {
        return (
          s.video_url ||
          s.video_path ||
          s.file_url ||
          s.file_path ||
          s.mp4_url ||
          s.mp4_path ||
          s.storage_url ||
          s.storage_path ||
          s.url ||
          s.path ||
          ""
        )
          .toString()
          .trim();
      };

      const withPlayableUrls: SubmissionRow[] = await Promise.all(
        rows.map(async (s) => {
          const raw = pickVideoField(s);
          if (!raw) return s as SubmissionRow;

          if (/^https?:\/\//i.test(raw)) {
            const pub = pathFromPublicUrl(raw);
            if (!pub) {
              return { ...(s as SubmissionRow), video_url: stripQuery(raw) };
            }

            const { data: signed, error: signErr } = await supabase.storage
              .from(pub.bucket)
              .createSignedUrl(pub.path, 60 * 60);

            if (!signErr && signed?.signedUrl) {
              return { ...(s as SubmissionRow), video_url: signed.signedUrl };
            }

            return { ...(s as SubmissionRow), video_url: stripQuery(raw) };
          }

          const cleanPath = stripQuery(raw);

          const { data: signedFilms, error: signErrFilms } = await supabase.storage
            .from("films")
            .createSignedUrl(cleanPath, 60 * 60);

          if (!signErrFilms && signedFilms?.signedUrl) {
            return { ...(s as SubmissionRow), video_url: signedFilms.signedUrl };
          }

          const { data: signedPort, error: signErrPort } = await supabase.storage
            .from("portfolios")
            .createSignedUrl(cleanPath, 60 * 60);

          if (!signErrPort && signedPort?.signedUrl) {
            return { ...(s as SubmissionRow), video_url: signedPort.signedUrl };
          }

          return s as SubmissionRow;
        })
      );

      setSubmissions(withPlayableUrls);
    } finally {
      setLoadingSubmissions(false);
    }
  };

  useEffect(() => {
    let cancelled = false;

    const loadProfile = async () => {
      try {
        setLoading(true);
        setErrorText("");
        setProfile(null);
        setMainRoleName("");
        setCityName("");

        if (!slug) {
          if (!cancelled) setErrorText("Missing public profile slug.");
          return;
        }

        const { data, error } = await supabase
          .from("users")
          .select(
            "id, full_name, avatar_url, portfolio_url, main_role_id, side_roles, city_id, bio, xp, level, banner_color, public_slug, is_profile_public"
          )
          .eq("public_slug", slug)
          .eq("is_profile_public", true)
          .maybeSingle();

        if (error) {
          if (!cancelled) setErrorText(error.message || "Could not load public profile.");
          return;
        }

        if (!data) {
          if (!cancelled) setErrorText("Public profile not found.");
          return;
        }

        const pd = data as PublicProfile;
        if (cancelled) return;

        setProfile(pd);

        if (pd.main_role_id != null) {
          const { data: roleData } = await supabase
  .from("creative_roles")
  .select("name")
  .eq("id", Number(pd.main_role_id))
  .maybeSingle();

if (!cancelled) setMainRoleName((roleData as { name?: string } | null)?.name ?? "");
        }

        if (pd.city_id != null) {
          const { data: cityData } = await supabase
  .from("cities")
  .select("name, country_code")
  .eq("id", Number(pd.city_id))
  .maybeSingle();

const city = cityData as { name?: string; country_code?: string } | null;
const label = city?.name ?? "";

if (!cancelled) {
  setCityName(label ? (city?.country_code ? `${label}, ${city.country_code}` : label) : "");
}
        }

        try {
          const { count: supportersRaw } = await supabase
            .from("user_supports")
            .select("supported_id", { count: "exact", head: true })
            .eq("supported_id", pd.id);

          const { count: supportingRaw } = await supabase
            .from("user_supports")
            .select("supporter_id", { count: "exact", head: true })
            .eq("supporter_id", pd.id);

          if (!cancelled) {
            setSupportersCount(supportersRaw ?? 0);
            setSupportingCount(supportingRaw ?? 0);
          }
        } catch {
          if (!cancelled) {
            setSupportersCount(0);
            setSupportingCount(0);
          }
        }

        await Promise.all([
          fetchPortfolioItems(pd.id),
          fetchShowreelList(pd.id),
          fetchUserSubmissions(pd.id),
        ]);
      } catch (e: any) {
        if (!cancelled) setErrorText(e?.message || "Could not load public profile.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadProfile();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const togglePlayAudio = async (item: PortfolioItem) => {
    if (playingId === item.id) {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      setPlayingId(null);
      return;
    }

    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
      const { sound } = await Audio.Sound.createAsync({ uri: item.url });
      soundRef.current = sound;
      await sound.playAsync();
      setPlayingId(item.id);
      sound.setOnPlaybackStatusUpdate((status) => {
        if ((status as any).didJustFinish) setPlayingId(null);
      });
    } catch (e: any) {
      console.warn("Audio playback failed:", e?.message ?? e);
    }
  };

  const renderAboutCard = () => {
    const shouldShow = !!profile?.bio?.trim()?.length || (profile?.side_roles?.length || 0) > 0;
    if (!shouldShow) return null;

    return (
      <View style={[styles.aboutCard, { marginTop: 12 }]}>
        <Text style={styles.aboutTitle}>About</Text>

        <Text style={[styles.aboutBody, isMobileLike ? { lineHeight: 18 } : null]}>
          {profile?.bio || "—"}
        </Text>

        {!!profile?.side_roles?.length && (
          <Text style={[styles.aboutBody, { marginTop: 8, fontStyle: "italic" }]}>
            <Text style={{ fontWeight: "900" }}>Side roles: </Text>
            {profile.side_roles.join(", ")}
          </Text>
        )}
      </View>
    );
  };

  const renderHero = () => {
    const avatarUrl = profile?.avatar_url || null;
    const heroBg = avatarUrl || null;
    const bannerColor = displayBannerColor || GOLD;
    const heroPad = isMobileLike ? 14 : 20;
    const heroMaxW = isMobileLike ? 720 : PAGE_MAX;

    return (
      <View
        style={[
          styles.heroWrap,
          {
            paddingTop: isMobileLike ? 8 : 18,
            paddingHorizontal: heroPad,
            alignSelf: "center",
            width: "100%",
            maxWidth: heroMaxW,
          },
        ]}
      >
        <View
          style={[
            styles.heroGrid,
            {
              flexDirection: isMobileLike ? "column" : "row",
              gap: isMobileLike ? 8 : 18,
              alignItems: "stretch",
            },
          ]}
        >
          <View
            style={[
              styles.heroLeft,
              isMobileLike ? styles.heroLeftMobile : styles.heroLeftDesktop,
              isMobileLike ? { width: "100%", flex: 0 } : null,
            ]}
          >
            <ImageBackground
  source={heroBg ? { uri: heroBg } : undefined}
  style={[
    styles.heroImage,
    isMobileLike ? styles.heroImageMobile : styles.heroImageDesktop,
    isMobileLike ? { width: "100%", alignSelf: "center" } : null,
    { paddingBottom: isMobileLike ? 12 : 16 },
  ]}
  imageStyle={[
  styles.heroImageInner,
  {
    backgroundColor: bannerColor,
    transform: [{ translateY: Platform.OS === "android" ? 20 : 0 }],
  },
]}
>
              <LinearGradient
                colors={["rgba(0,0,0,0.2)", "rgba(0,0,0,0.65)", "rgba(0,0,0,0.95)"]}
                style={styles.heroGradient}
              />

              {!!mainRoleName && (
                <View
                  style={[
                    styles.roleWrap,
                    isMobileLike
                      ? { paddingHorizontal: 14, paddingBottom: 96 }
                      : { paddingBottom: 98 },
                  ]}
                >
                  <Text
                    style={[
                      styles.heroMeta,
                      isMobileLike
                        ? { fontSize: 12, marginTop: 8, letterSpacing: 1.2, lineHeight: 16 }
                        : { fontSize: 16, letterSpacing: 3, marginBottom: 6, opacity: 0.95 },
                    ]}
                    numberOfLines={1}
                  >
                    {mainRoleName.toUpperCase()}
                  </Text>

                  <Text
                    style={[
                      styles.heroMeta,
                      isMobileLike
                        ? { fontSize: 16, marginTop: 8, letterSpacing: 1.2, lineHeight: 16 }
                        : null,
                    ]}
                    numberOfLines={2}
                  >
                    {profile?.full_name || "—"}
                    {cityName ? `  •  ${cityName}` : ""}
                  </Text>

                  <View style={{ marginTop: 14, alignItems: "center" }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: isMobileLike ? 14 : 18,
                      }}
                    >
                      <View style={{ alignItems: "center", minWidth: 92, paddingVertical: 4 }}>
                        <Text
                          style={{
                            color: COLORS.textPrimary,
                            fontWeight: "900",
                            fontFamily: FONT_OBLIVION,
                            letterSpacing: 1,
                            fontSize: 14,
                          }}
                        >
                          {supportersCount}
                        </Text>
                        <Text
                          style={{
                            color: COLORS.textSecondary,
                            fontSize: 12,
                            fontFamily: FONT_OBLIVION,
                          }}
                        >
                          Supporters
                        </Text>
                      </View>

                      <View style={{ alignItems: "center", minWidth: 92, paddingVertical: 4 }}>
                        <Text
                          style={{
                            color: COLORS.textPrimary,
                            fontWeight: "900",
                            fontFamily: FONT_OBLIVION,
                            letterSpacing: 1,
                            fontSize: 14,
                          }}
                        >
                          {supportingCount}
                        </Text>
                        <Text
                          style={{
                            color: COLORS.textSecondary,
                            fontSize: 12,
                            fontFamily: FONT_OBLIVION,
                          }}
                        >
                          Supporting
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              )}

              <View
                style={[
                  styles.heroBottomBar,
                  {
                    position: "relative",
                    width: "100%",
                    paddingHorizontal: isMobileLike ? 14 : 18,
                    paddingTop: 6,
                    flexDirection: "row",
                    alignItems: "flex-end",
                    justifyContent: "flex-start",
                    gap: 16,
                  },
                ]}
              >
                <View style={{ alignItems: "center" }}>
                  <LinearGradient
                    colors={[GOLD, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.9)"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.avatarRing, { borderColor: GOLD }]}
                  >
                    <View style={[styles.avatarInner, isCompact && styles.avatarInnerCompact]}>
                      {avatarUrl ? (
                        <Image
  source={{ uri: avatarUrl }}
  style={styles.avatarImage}
  resizeMode="cover"
/>
                      ) : (
                        <View style={styles.avatarFallback}>
                          <Ionicons name="person-outline" size={26} color={COLORS.textSecondary} />
                        </View>
                      )}
                    </View>
                  </LinearGradient>
                </View>
              </View>
            </ImageBackground>
          </View>

          
        </View>

        
      </View>
    );
  };

  const renderFeaturedFilm = () => {
    const primaryRow = showreels.find((r) => r.is_primary) || showreels[0] || null;
    if (!primaryRow) return null;

    const secondaryRows = showreels.filter((r) => r.id !== primaryRow.id).slice(0, 2);

    const maxW = isMobileLike
  ? Math.min(width - horizontalPad * 2, 680)
  : SHOWREEL_MAX_W;
    const secondaryGap = isMobileLike ? 10 : 12;
const availableWidth = Math.min(width - horizontalPad * 2, maxW);
const secondaryTileW = isMobileLike
  ? availableWidth
  : Math.floor((availableWidth - secondaryGap) / 2);
const secondaryTileH = isMobileLike
  ? Math.floor(secondaryTileW * 0.64)
  : Math.floor(secondaryTileW * (9 / 16));

    return (
      <View style={[block.section, { alignItems: "center" }]}>
        <Text style={block.sectionTitleCentered}>
          {primaryRow.category ? `${primaryRow.category} Showreel` : "Showreel"}
        </Text>

        <TouchableOpacity
  activeOpacity={0.92}
  onPress={() => {
    setActiveShowreel(primaryRow);
    setShowreelModalOpen(true);
  }}
  style={[
    block.mediaCard,
    {
      width: "100%",
      maxWidth: maxW,
      alignSelf: "center",
      padding: 0,
      overflow: "hidden",
    },
  ]}
>
  <View
    style={{
      paddingTop: isMobileLike ? 10 : 14,
      paddingBottom: isMobileLike ? 8 : 10,
      paddingHorizontal: isMobileLike ? 8 : 10,
      alignItems: "center",
      justifyContent: "center",
      borderBottomWidth: 1,
      borderBottomColor: COLORS.border,
      backgroundColor: COLORS.card,
      minHeight: isMobileLike ? 40 : 48,
    }}
  >
    <Text
      style={{
        color: COLORS.primary,
        fontSize: isMobileLike ? 10 : 14,
        fontFamily: FONT_OBLIVION,
        fontWeight: "900",
        letterSpacing: isMobileLike ? 0.3 : 1,
        textAlign: "center",
        textTransform: "uppercase",
      }}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.8}
    >
      {primaryRow.category || "Showreel"}
    </Text>
  </View>

  <View
    style={{
      width: "100%",
      aspectRatio: 16 / 9,
      backgroundColor: "#000",
      alignItems: "center",
      justifyContent: "center",
      position: "relative",
    }}
  >
    {primaryRow.thumbnail_url ? (
      <Image
        source={{ uri: primaryRow.thumbnail_url }}
        style={{ width: "100%", height: "100%" }}
        resizeMode="cover"
      />
    ) : (
      <>
        <Ionicons name="videocam" size={28} color={COLORS.textSecondary} />
        <Text
          style={{
            marginTop: 6,
            color: COLORS.textSecondary,
            fontFamily: FONT_OBLIVION,
            fontSize: 11,
          }}
        >
          Tap to play showreel
        </Text>
      </>
    )}

    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: isMobileLike ? 6 : 10,
        right: isMobileLike ? 6 : 10,
        backgroundColor: "rgba(0,0,0,0.55)",
        borderRadius: 999,
        paddingHorizontal: isMobileLike ? 8 : 10,
        paddingVertical: isMobileLike ? 4 : 6,
      }}
    >
      <Text
        style={{
          color: "#fff",
          fontSize: isMobileLike ? 9 : 11,
          fontFamily: FONT_OBLIVION,
          fontWeight: "800",
        }}
      >
        ▶ Play
      </Text>
    </View>
  </View>
</TouchableOpacity>

        {secondaryRows.length > 0 && (
          <View
            style={{
              width: "100%",
              maxWidth: maxW,
              alignSelf: "center",
              marginTop: 14,
            }}
          >
            <Text style={block.h3Centered}>More Showreels</Text>

            <View
              style={{
                flexDirection: isMobileLike ? "column" : "row",
                gap: secondaryGap,
                marginTop: 8,
              }}
            >
              {secondaryRows.map((r) => {
                const thumb = r.thumbnail_url || null;

                return (
                  <View
                    key={r.id}
                    style={{
                      width: isMobileLike ? "100%" : secondaryTileW,
                    }}
                  >
                    <TouchableOpacity
                      activeOpacity={0.92}
                      onPress={() => {
                        setActiveShowreel(r);
                        setShowreelModalOpen(true);
                      }}
                    >
                      <View
                        style={[
                          block.mediaCard,
                          {
                            padding: 0,
                            overflow: "hidden",
                          },
                        ]}
                      >
                        <View
                          style={{
                            paddingTop: 14,
                            paddingBottom: 10,
                            paddingHorizontal: 10,
                            alignItems: "center",
                            justifyContent: "center",
                            borderBottomWidth: 1,
                            borderBottomColor: COLORS.border,
                            backgroundColor: COLORS.card,
                          }}
                        >
                          <Text
                            style={{
                              color: COLORS.primary,
                              fontSize: 14,
                              fontFamily: FONT_OBLIVION,
                              fontWeight: "900",
                              letterSpacing: 1,
                              textAlign: "center",
                              textTransform: "uppercase",
                            }}
                          >
                            {r.category || "Showreel"}
                          </Text>
                        </View>

                        <View
                          style={{
                            width: "100%",
                            height: secondaryTileH,
                            backgroundColor: "#000",
                            alignItems: "center",
                            justifyContent: "center",
                            position: "relative",
                          }}
                        >
                          {thumb ? (
                            <Image
                              source={{ uri: thumb }}
                              style={{ width: "100%", height: "100%" }}
                              resizeMode="cover"
                            />
                          ) : (
                            <>
                              <Ionicons name="videocam" size={28} color={COLORS.textSecondary} />
                              <Text
                                style={{
                                  marginTop: 6,
                                  color: COLORS.textSecondary,
                                  fontFamily: FONT_OBLIVION,
                                  fontSize: 11,
                                }}
                              >
                                No thumbnail yet
                              </Text>
                            </>
                          )}

                          <View
                            pointerEvents="none"
                            style={{
                              position: "absolute",
                              top: 10,
                              right: 10,
                              backgroundColor: "rgba(0,0,0,0.55)",
                              borderRadius: 999,
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                            }}
                          >
                            <Text
                              style={{
                                color: "#fff",
                                fontSize: 11,
                                fontFamily: FONT_OBLIVION,
                                fontWeight: "800",
                              }}
                            >
                              ▶ Play
                            </Text>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </View>
    );
  };

  const AudioTile = ({ item }: { item: PortfolioItem }) => (
    <View style={block.mediaRowCard}>
      <View style={block.mediaIcon}>
        <Ionicons name="musical-notes-outline" size={20} color={COLORS.textSecondary} />
      </View>

      <View style={{ flex: 1 }}>
        <Text style={block.mediaRowTitle} numberOfLines={1}>
          {item.title ?? "Audio"}
        </Text>
        <View style={block.progressRail}>
          <View style={[block.progressFill, { width: playingId === item.id ? "35%" : "0%" }]} />
        </View>
      </View>

      <TouchableOpacity onPress={() => togglePlayAudio(item)} style={block.rowBtn}>
        <Text style={block.rowBtnText}>{playingId === item.id ? "Pause" : "Play"}</Text>
      </TouchableOpacity>
    </View>
  );

  const PdfTile = ({ item }: { item: PortfolioItem }) => (
    <View style={block.mediaRowCard}>
      <View style={block.mediaIcon}>
        <Ionicons name="document-text-outline" size={20} color={COLORS.textSecondary} />
      </View>

      <Text style={[block.mediaRowTitle, { flex: 1 }]} numberOfLines={1}>
        {item.title ?? "PDF"}
      </Text>

      <TouchableOpacity onPress={() => Linking.openURL(item.url)} style={block.rowBtn}>
        <Text style={block.rowBtnText}>Open</Text>
      </TouchableOpacity>
    </View>
  );

  const renderEditorialPortfolio = () => {
    if (loadingPortfolio) {
      return (
        <View style={block.section}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      );
    }

    if (!portfolioItems.length) return null;

    const dedupMap = new Map<string, PortfolioItem>();
    portfolioItems.forEach((p) => {
      const key = `${p.type}:${p.url}`;
      if (!dedupMap.has(key)) dedupMap.set(key, p);
    });
    const unique = Array.from(dedupMap.values());

    const imgs = unique.filter((p) => p.type === "image");
    const auds = unique.filter((p) => p.type === "audio");
    const pdfs = unique.filter((p) => p.type === "pdf");

    const cols = isMobile ? 2 : 3;
    const usable = Math.min(width, PAGE_MAX) - horizontalPad * 2;
    const tileW = Math.floor((usable - GRID_GAP * (cols - 1)) / cols);

    const imgUrls = imgs.map((i) => i.url);

    const openImageViewer = (url: string) => {
      const startIndex = imgUrls.indexOf(url);
      setImageViewerUrls(imgUrls);
      setImageViewerIndex(startIndex >= 0 ? startIndex : 0);
    };

    return (
      <>
        {imgs.length > 0 && (
          <View style={block.section}>
            <Text style={block.sectionTitleCentered}>Portfolio</Text>
            <View style={[block.grid, { marginHorizontal: -4 }]}>
              {imgs.map((item) => (
                <View key={item.id} style={[block.tile, { width: tileW, margin: 4 }]}>
                  <View style={block.tileFrame}>
                    <Pressable onPress={() => openImageViewer(item.url)} style={{ flex: 1 }}>
                      <Image
                        source={{ uri: item.url }}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode="cover"
                      />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}

        {auds.length > 0 && (
          <View style={block.section}>
            <Text style={block.h3Centered}>Audio</Text>
            <View style={{ gap: 10 }}>
              {auds.map((item) => (
                <AudioTile key={item.id} item={item} />
              ))}
            </View>
          </View>
        )}

        {pdfs.length > 0 && (
          <View style={block.section}>
            <Text style={block.h3Centered}>PDF</Text>
            <View style={{ gap: 10 }}>
              {pdfs.map((item) => (
                <PdfTile key={item.id} item={item} />
              ))}
            </View>
          </View>
        )}
      </>
    );
  };

  const renderSubmissionsSection = () => {
    if (loadingSubmissions) {
      return (
        <View style={block.section}>
          <Text style={block.sectionTitleCentered}>Submissions</Text>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      );
    }

    if (!submissions.length) return null;

    const cols = isCompact ? 2 : isMobileLike ? 2 : width < 1100 ? 3 : 4;
    const usable = Math.min(width, PAGE_MAX) - horizontalPad * 2;
    const tileW = Math.floor((usable - GRID_GAP * (cols - 1)) / cols);
    const tileH = Math.floor(tileW * (9 / 16));

    const modalMaxW = Math.min(Math.min(width, PAGE_MAX) - horizontalPad * 2, 760);
    const modalMediaW = Math.max(280, Math.floor(modalMaxW));
    const modalMediaH = Math.floor(modalMediaW * (9 / 16));

    return (
      <View style={block.section}>
        <Text style={block.sectionTitleCentered}>Submissions</Text>

        <View style={[block.grid, { gap: GRID_GAP }]}>
          {submissions.map((s) => {
            const yt = s.youtube_url ? ytThumb(s.youtube_url) : null;
            const mp4Thumb = s.thumbnail_url || null;

            return (
              <Pressable
                key={s.id}
                onPress={() => {
                  setActiveSubmission(s);
                  setSubmissionModalOpen(true);
                }}
                style={{ width: tileW }}
              >
                <View
                  style={{
                    height: tileH,
                    borderRadius: 12,
                    overflow: "hidden",
                    borderWidth: 1,
                    borderColor: COLORS.border,
                    backgroundColor: "#000",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {yt ? (
                    <Image
                      source={{ uri: yt }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                    />
                  ) : mp4Thumb ? (
                    <Image
                      source={{ uri: mp4Thumb }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                    />
                  ) : (
                    <>
                      <Ionicons name="videocam" size={28} color={COLORS.textSecondary} />
                      <Text
                        style={{
                          marginTop: 6,
                          color: COLORS.textSecondary,
                          fontFamily: FONT_OBLIVION,
                          fontSize: 11,
                        }}
                      >
                        MP4 submission
                      </Text>
                    </>
                  )}

                  <View
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      bottom: 0,
                      padding: 10,
                      backgroundColor: "rgba(0,0,0,0.55)",
                    }}
                  >
                    <Text
                      style={{
                        color: COLORS.textPrimary,
                        fontFamily: FONT_OBLIVION,
                        fontWeight: "800",
                      }}
                      numberOfLines={1}
                    >
                      {s.title || "Untitled"}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>

        <Modal
          visible={submissionModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => {
            setSubmissionModalOpen(false);
            setActiveSubmission(null);
          }}
        >
          <View
            style={{
              flex: 1,
              backgroundColor: "#000000EE",
              justifyContent: "center",
              padding: 14,
            }}
          >
            <Pressable
              style={StyleSheet.absoluteFillObject}
              onPress={() => {
                setSubmissionModalOpen(false);
                setActiveSubmission(null);
              }}
            />

            <View
              style={{
                backgroundColor: COLORS.cardAlt,
                borderRadius: 16,
                borderWidth: 1,
                borderColor: COLORS.border,
                overflow: "hidden",
                padding: 12,
              }}
            >
              <Text
                style={{
                  color: COLORS.textPrimary,
                  fontFamily: FONT_OBLIVION,
                  fontWeight: "900",
                  marginBottom: 8,
                }}
              >
                {activeSubmission?.title || "Untitled"}
              </Text>

              <View style={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
                <View
                  style={{
                    width: modalMediaW,
                    height: modalMediaH,
                    backgroundColor: "#000",
                    borderRadius: 14,
                    overflow: "hidden",
                  }}
                >
                  {activeSubmission ? (
                    activeSubmission.youtube_url ? (
                      <YoutubePlayer
                        height={modalMediaH}
                        width={modalMediaW}
                        videoId={extractYoutubeId(activeSubmission.youtube_url) || undefined}
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
                    ) : activeSubmission.video_url || activeSubmission.video_path ? (
                      <ShowreelVideoInline
                        playerId={`public_submission_${activeSubmission.id}`}
                        filePathOrUrl={activeSubmission.video_url || activeSubmission.video_path!}
                        width={modalMediaW}
                        autoPlay={false}
                      />
                    ) : (
                      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                        <Text style={[block.muted, { textAlign: "center" }]}>
                          No video found for this submission.
                        </Text>
                      </View>
                    )
                  ) : null}
                </View>
              </View>

              {!!activeSubmission?.word && (
                <Text
                  style={{
                    color: COLORS.textSecondary,
                    fontFamily: FONT_OBLIVION,
                    fontSize: 13,
                    lineHeight: 20,
                    marginTop: 10,
                    textAlign: "center",
                  }}
                >
                  Word: {activeSubmission.word}
                </Text>
              )}

              <TouchableOpacity
                onPress={() => {
                  setSubmissionModalOpen(false);
                  setActiveSubmission(null);
                }}
                style={[styles.ghostBtn, { marginTop: 12 }]}
              >
                <Text style={styles.ghostBtnText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    );
  };

  const renderBottomCTA = () => {
  return (
    <View style={block.section}>
      <View style={styles.bottomCtaCard}>
        <Text style={styles.bottomCtaTitle}>Want to showcase your own work?</Text>
        <Text style={styles.bottomCtaBody}>
          Join Overlooked to upload your showreels, portfolio, and submissions.
        </Text>

        <View style={styles.bottomCtaButtons}>
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={goToSignUp}
            style={styles.bottomCtaPrimary}
          >
            <Text style={styles.bottomCtaPrimaryText}>Join Overlooked</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.9}
            onPress={goToSignIn}
            style={styles.bottomCtaSecondary}
          >
            <Text style={styles.bottomCtaSecondaryText}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: COLORS.background,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (errorText || !profile) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: COLORS.background,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 20,
        }}
      >
        <Text style={{ color: COLORS.textSecondary, textAlign: "center" }}>
          {errorText || "Profile not found."}
        </Text>
      </View>
    );
  }
    return (
    <>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
        <ScrollView
          style={{ flex: 1, backgroundColor: COLORS.background }}
          contentContainerStyle={{
            alignItems: "center",
            paddingBottom: 48,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: PAGE_MAX,
              paddingHorizontal: horizontalPad,
            }}
          >
            {renderHero()}
{renderFeaturedFilm()}
{renderEditorialPortfolio()}
{renderSubmissionsSection()}
{renderAboutCard()}
{renderBottomCTA()}
          </View>
        </ScrollView>
      </SafeAreaView>

      <Modal
  visible={imageViewerIndex !== null}

        transparent
        animationType="fade"
        onRequestClose={() => setImageViewerIndex(null)}
      >
        <View style={block.viewerOverlay}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={() => setImageViewerIndex(null)}
          />
          {imageViewerIndex !== null && (
            <>
              <Image
                source={{ uri: imageViewerUrls[imageViewerIndex] }}
                style={block.viewerImage}
                resizeMode="contain"
              />
              <View style={block.viewerCloseHint}>
                <Text style={block.viewerHintText}>Tap outside to close</Text>
              </View>

              {imageViewerIndex > 0 && (
                <TouchableOpacity
                  style={[navStyles.arrow, navStyles.left]}
                  onPress={() => setImageViewerIndex((i) => (i! > 0 ? i! - 1 : i))}
                >
                  <Ionicons name="chevron-back" size={28} color="#FFF" />
                </TouchableOpacity>
              )}

              {imageViewerIndex < imageViewerUrls.length - 1 && (
                <TouchableOpacity
                  style={[navStyles.arrow, navStyles.right]}
                  onPress={() =>
                    setImageViewerIndex((i) =>
                      i! < imageViewerUrls.length - 1 ? i! + 1 : i
                    )
                  }
                >
                  <Ionicons name="chevron-forward" size={28} color="#FFF" />
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      </Modal>

      <Modal
        visible={showreelModalOpen}
        transparent
        animationType="fade"
        onRequestClose={closeShowreelModal}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.9)",
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
          }}
        >
          <TouchableOpacity
            activeOpacity={1}
            onPress={closeShowreelModal}
            style={StyleSheet.absoluteFillObject}
          />

          <View
            style={{
              width: "100%",
              maxWidth: 800,
              backgroundColor: COLORS.cardAlt,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: COLORS.border,
              padding: 12,
            }}
          >
            <Text
              style={{
                color: COLORS.textPrimary,
                fontFamily: FONT_OBLIVION,
                fontWeight: "900",
                marginBottom: 10,
                textAlign: "center",
                textTransform: "uppercase",
              }}
            >
              {activeShowreel?.category || "Showreel"}
            </Text>

            {activeShowreel ? (
  <View style={{ width: "100%", alignItems: "center", justifyContent: "center" }}>
    <ShowreelVideoInline
      playerId={`public_secondary_showreel_${activeShowreel.id}`}
      filePathOrUrl={activeShowreel.file_path || activeShowreel.url}
      width={Math.max(280, Math.min(width - horizontalPad * 2 - 24, 760))}
      autoPlay={false}
    />
  </View>
) : null}

            <TouchableOpacity
              onPress={closeShowreelModal}
              style={[styles.ghostBtn, { marginTop: 12 }]}
            >
              <Text style={styles.ghostBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  heroWrap: { paddingTop: 14, paddingBottom: 12 },
  heroGrid: { flexDirection: "row", gap: GRID_GAP },
  heroLeft: { flex: 2 },
  heroLeftMobile: { width: "100%" },
  heroLeftDesktop: { minHeight: 420 },
  heroRight: { flex: 1, gap: GRID_GAP },

  heroImage: {
  borderRadius: 14,
  overflow: "hidden",
  justifyContent: "flex-end",
  backgroundColor: "#000",
},
  heroImageMobile: {
  width: "100%",
  height: 230,
  alignSelf: "center",
},
  heroImageDesktop: {
    width: "100%",
    height: "100%",
    minHeight: 420,
  },
  heroImageInner: {
  resizeMode: "cover",
  opacity: 0.98,
  backgroundColor: "#000",
},
  heroGradient: { ...StyleSheet.absoluteFillObject },

  roleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },

  heroMeta: {
    marginTop: 12,
    color: COLORS.textSecondary,
    fontFamily: FONT_CINZEL,
    letterSpacing: 2.6,
    fontSize: 12,
    textAlign: "center",
    textTransform: "uppercase",
  },

  heroBottomBar: {
    position: "relative",
    paddingHorizontal: 14,
    paddingTop: 6,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },

  infoCard: {
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 16,
  },

  protocolTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_CINZEL,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
    textAlign: "center",
    marginBottom: 8,
  },
  protocolBody: {
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 12,
  },

  authPrimaryButton: {
    backgroundColor: COLORS.primary,
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  authPrimaryButtonText: {
    color: "#000",
    fontWeight: "900",
    fontFamily: FONT_OBLIVION,
    letterSpacing: 1,
    textTransform: "uppercase",
    fontSize: 13,
  },
  authSecondaryButton: {
    backgroundColor: "transparent",
    borderRadius: 12,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  authSecondaryButtonText: {
    color: COLORS.textPrimary,
    fontWeight: "800",
    fontFamily: FONT_OBLIVION,
    letterSpacing: 1,
    textTransform: "uppercase",
    fontSize: 13,
  },
  brandTitle: {
  color: COLORS.primary,
  fontFamily: FONT_CINZEL,
  fontSize: 18,
  fontWeight: "700",
  letterSpacing: 2.8,
  textTransform: "uppercase",
  textAlign: "center",
},

  aboutCard: {
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 16,
  },
  aboutTitle: {
    color: COLORS.textPrimary,
    fontWeight: "700",
    letterSpacing: 4,
    marginBottom: 10,
    fontFamily: FONT_CINZEL,
    fontSize: 16,
    textTransform: "uppercase",
  },
  aboutBody: {
    color: COLORS.textSecondary,
    lineHeight: 22,
    fontFamily: FONT_OBLIVION,
    fontSize: 14,
    letterSpacing: 0.2,
  },

  avatarRing: {
    padding: 3,
    borderRadius: 999,
    borderWidth: 2,
  },
  avatarInner: {
    width: 80,
    height: 80,
    borderRadius: 999,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarInnerCompact: {
    width: 64,
    height: 64,
  },
  avatarImage: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
  },
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  levelPill: {
    marginTop: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    alignSelf: "center",
  },
  levelPillText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#000",
    letterSpacing: 0.8,
    fontFamily: FONT_OBLIVION,
    textTransform: "uppercase",
  },

  gamifyWrap: {
    marginTop: 12,
    alignItems: "center",
  },
  gamifyTitle: {
    fontSize: 18,
    fontWeight: "700",
    letterSpacing: 2.8,
    textTransform: "uppercase",
    fontFamily: FONT_CINZEL,
  },
  gamifyRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 6,
  },
  gamifyLevel: {
    color: COLORS.textPrimary,
    fontWeight: "700",
    fontSize: 13,
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  gamifyDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.textSecondary,
  },
  gamifyXp: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  
    bottomCtaCard: {
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 18,
    alignItems: "center",
    maxWidth: 760,
    alignSelf: "center",
  },

  bottomCtaTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_CINZEL,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 1.6,
    textAlign: "center",
    textTransform: "uppercase",
  },

  bottomCtaBody: {
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 8,
    maxWidth: 520,
  },

  bottomCtaButtons: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
    flexWrap: "wrap",
    justifyContent: "center",
  },

  bottomCtaPrimary: {
    backgroundColor: COLORS.primary,
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },

  bottomCtaPrimaryText: {
    color: "#000",
    fontWeight: "900",
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontSize: 12,
  },

  bottomCtaSecondary: {
    backgroundColor: "transparent",
    borderRadius: 10,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  bottomCtaSecondaryText: {
    color: COLORS.textPrimary,
    fontWeight: "800",
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontSize: 12,
  },
  ghostBtn: {
    backgroundColor: "transparent",
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  ghostBtnText: {
    color: COLORS.textPrimary,
    fontWeight: "700",
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontSize: 13,
  },
});

const block = StyleSheet.create({
  section: { marginTop: 24 },

  h3Centered: {
    color: COLORS.textSecondary,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 12,
    letterSpacing: 1.4,
    textAlign: "center",
    fontFamily: FONT_OBLIVION,
    textTransform: "uppercase",
  },
  muted: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.2,
  },

  sectionTitleCentered: {
    color: COLORS.textPrimary,
    fontSize: 17,
    fontWeight: "800",
    letterSpacing: 1.8,
    marginBottom: 16,
    textAlign: "center",
    fontFamily: FONT_OBLIVION,
    textTransform: "uppercase",
  },

  mediaCard: {
    backgroundColor: "#000",
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  grid: { flexDirection: "row", flexWrap: "wrap" },
  tile: { paddingBottom: 6 },
  tileFrame: {
    width: "100%",
    aspectRatio: 4 / 5,
    backgroundColor: "#000",
    borderRadius: 10,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.border,
    position: "relative",
  },

  mediaRowCard: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  mediaIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: "#0C0C0C",
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: "center",
    justifyContent: "center",
  },
  mediaRowTitle: {
    color: COLORS.textPrimary,
    fontWeight: "700",
    fontFamily: FONT_CINZEL,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    fontSize: 13,
  },

  progressRail: {
    height: 4,
    backgroundColor: "#0F0F0F",
    borderRadius: 999,
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#ffffff10",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: COLORS.primary,
  },

  rowBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  rowBtnText: {
    color: "#000",
    fontWeight: "800",
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontSize: 12,
  },

  viewerOverlay: {
    flex: 1,
    backgroundColor: "#000000EE",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  viewerImage: { width: "100%", height: "85%" },
  viewerCloseHint: {
    position: "absolute",
    bottom: 24,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#ffffff22",
    borderRadius: 999,
  },
  viewerHintText: {
    color: "#fff",
    fontWeight: "700",
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontSize: 11,
  },
});

const navStyles = StyleSheet.create({
  arrow: {
    position: "absolute",
    top: "48%",
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  left: { left: 8 },
  right: { right: 8 },
});

const stylesShowreel = StyleSheet.create({
  progressHit: {
    position: "absolute",
    left: 10,
    right: 60,
    bottom: 10,
    height: 16,
    justifyContent: "center",
  },
  progressTrack: {
    height: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    overflow: "hidden",
  },

  progressFill: {
    height: "100%",
    borderRadius: 999,
    backgroundColor: GOLD,
  },
  fsButton: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "#ffffffaa",
    alignItems: "center",
    justifyContent: "center",
  },
  cornerBox: {
    width: 10,
    height: 10,
    borderTopWidth: 1,
    borderRightWidth: 1,
    borderColor: "#ffffffaa",
  },
  soundBtn: {
    position: "absolute",
    left: 10,
    top: 10,
    paddingHorizontal: 8,
    paddingVertical: 4,
    backgroundColor: "#00000088",
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  soundText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontFamily: FONT_OBLIVION,
  },
});