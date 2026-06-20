import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Image,
  Platform,
  useWindowDimensions,
  Linking,
  SafeAreaView,
  Animated,
  Easing,
} from "react-native";
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { Video, ResizeMode } from "expo-av";
import { LinearGradient } from "expo-linear-gradient";
import YoutubePlayer from "react-native-youtube-iframe";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabase";
import type { RootStackParamList } from "../navigation/navigationRef";
import { useAppTheme } from "../context/ThemeContext";
import { usesNativeMobileLayoutOnWeb } from "../utils/responsive";

const GOLD = "#C6A664";
const BG = "#050505";
const PANEL = "#0D0D0F";
const PANEL_ALT = "#111114";
const LINE = "rgba(255,255,255,0.10)";
const TEXT = "#F4EFE6";
const SUB = "rgba(255,255,255,0.72)";
const MUTE = "rgba(237,235,230,0.52)";

function formatPlayerTime(seconds?: number | null) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds || 0) ? seconds || 0 : 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

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
  youtube_url?: string | null;

  mime_type?: string | null;
  media_kind?: "file_audio" | "file_video" | "youtube" | null;
  category?: string | null;
  film_category?: string | null;
  share_slug?: string | null;

  mux_upload_id?: string | null;
  mux_asset_id?: string | null;
  mux_playback_id?: string | null;
  mux_status?: string | null;

  video_id?: string | null;
  videos?: {
    original_path?: string | null;
    thumbnail_path?: string | null;
    video_variants?: { path: string; label?: string | null }[] | null;
  } | null;

  users?: {
    id: string;
    full_name: string;
    public_slug?: string | null;
  } | null;
};

const WebVideo: any = "video";

let SHARED_VIDEO_CSS_INJECTED = false;
function injectWebVideoCSS() {
  if (Platform.OS !== "web" || typeof document === "undefined" || SHARED_VIDEO_CSS_INJECTED) return;
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
    .ovk-video::-webkit-media-controls-toggle-closed-captions-button { display: none !important; }
    .ovk-video::-webkit-media-controls-overlay-play-button { display: none !important; -webkit-appearance: none !important; }
    .ovk-video::-webkit-media-controls-start-playback-button { display: none !important; -webkit-appearance: none !important; }
    .ovk-video::-webkit-media-controls-volume-slider { display: none !important; }
    .ovk-video::-webkit-media-controls-timeline-container { display: none !important; }
    .ovk-video::-webkit-media-controls-rewind-button { display: none !important; }
    .ovk-video::-webkit-media-controls-return-to-realtime-button { display: none !important; }
  `;
  document.head.appendChild(style);
  SHARED_VIDEO_CSS_INJECTED = true;
}
injectWebVideoCSS();

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
    if (embedIndex >= 0 && parts[embedIndex + 1]) {
      return parts[embedIndex + 1];
    }

    const shortsIndex = parts.indexOf("shorts");
    if (shortsIndex >= 0 && parts[shortsIndex + 1]) {
      return parts[shortsIndex + 1];
    }

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

function cleanStoragePath(pathOrUrl?: string | null) {
  if (!pathOrUrl) return null;

  const raw = String(pathOrUrl).trim();
  if (!raw) return null;

  if (isAbsoluteUrl(raw)) {
    const parsed = pathFromPublicUrl(raw);
    if (parsed?.bucket === "films" && parsed.path) {
      return parsed.path;
    }

    return raw;
  }

  let path = stripQuery(raw);

  if (path.startsWith("/")) {
    path = path.slice(1);
  }

  if (path.startsWith("films/")) {
    path = path.replace(/^films\//, "");
  }

  return path;
}

function pickFastStartVariant(row: FilmRow): { path: string | null; thumb: string | null } {
  const variants = row?.videos?.video_variants ?? [];

  if (variants && variants.length > 0) {
    const scored = variants
      .map((v: any) => {
        const label = String(v?.label || "").toLowerCase();
        const m = /(\d{3,4})p/i.exec(label);
        const h = m ? parseInt(m[1], 10) : 9999;

        let priority = 1000 + h;
        if (h <= 360) priority = 1 + h;
        else if (h <= 480) priority = 10 + h;
        else if (h <= 720) priority = 100 + h;

        return { ...v, h, priority };
      })
      .sort((a: any, b: any) => a.priority - b.priority);

    const best = scored[0] ?? variants[0];

    return {
      path:
        best?.path ??
        row?.video_path ??
        row?.storage_path ??
        row?.videos?.original_path ??
        null,
      thumb: row?.thumbnail_url ?? row?.videos?.thumbnail_path ?? null,
    };
  }

  return {
    path:
      row?.video_path ??
      row?.storage_path ??
      row?.videos?.original_path ??
      null,
    thumb: row?.thumbnail_url ?? row?.videos?.thumbnail_path ?? null,
  };
}

function isMuxReady(status?: string | null) {
  const s = String(status || "").toLowerCase();
  return s === "ready" || s === "asset_ready" || s === "playable";
}

function getMuxPlaybackUrl(playbackId?: string | null) {
  if (!playbackId) return null;
  return Platform.OS === "web"
    ? `https://stream.mux.com/${playbackId}/high.mp4`
    : `https://stream.mux.com/${playbackId}.m3u8`;
}

function getMuxFallbackPlaybackUrls(url?: string | null) {
  if (!url || Platform.OS !== "web") return [];
  const match = String(url).match(/stream\.mux\.com\/([^/.?]+)/);
  if (!match?.[1]) return [];
  const playbackId = match[1];
  return [
    `https://stream.mux.com/${playbackId}/medium.mp4`,
    `https://stream.mux.com/${playbackId}/low.mp4`,
    `https://stream.mux.com/${playbackId}.m3u8`,
  ];
}

type VideoSourceOption = {
  label: string;
  uri: string;
};

function getMuxPlaybackOptions(url?: string | null): VideoSourceOption[] {
  if (!url || Platform.OS !== "web") return url ? [{ label: "Auto", uri: url }] : [];
  const match = String(url).match(/stream\.mux\.com\/([^/.?]+)/);
  if (!match?.[1]) return [{ label: "Auto", uri: url }];

  const playbackId = match[1];
  return [
    { label: "High", uri: `https://stream.mux.com/${playbackId}/high.mp4` },
    { label: "Medium", uri: `https://stream.mux.com/${playbackId}/medium.mp4` },
    { label: "Low", uri: `https://stream.mux.com/${playbackId}/low.mp4` },
  ];
}

async function signFilmMediaPath(pathOrUrl?: string | null) {
  if (!pathOrUrl) return null;

  const cleaned = cleanStoragePath(pathOrUrl);
  if (!cleaned) return null;

  if (isAbsoluteUrl(cleaned)) {
    return cleaned;
  }

  try {
    const { data, error } = await supabase.storage
      .from("films")
      .createSignedUrl(cleaned, 3600);

    if (!error && data?.signedUrl) {
      return data.signedUrl;
    }
  } catch {}

  try {
    const { data } = supabase.storage.from("films").getPublicUrl(cleaned);

    if (data?.publicUrl) {
      return data.publicUrl;
    }
  } catch {}

  return null;
}

function normalizeFilmRow(row: any): FilmRow {
  const maybeUser = row?.users;
  const user = Array.isArray(maybeUser) ? maybeUser[0] : maybeUser;

  const picked = pickFastStartVariant(row as FilmRow);

  return {
    ...(row as FilmRow),
    users: user
      ? {
          id: user.id,
          full_name: user.full_name,
          public_slug: user.public_slug ?? null,
        }
      : null,
    description: row?.description ?? row?.word ?? null,
    storage_path: picked.path ?? row?.storage_path ?? row?.video_path ?? null,
    thumbnail_url: picked.thumb ?? row?.thumbnail_url ?? null,
    film_category: row?.film_category ?? row?.category ?? null,
  };
}

function SharedFilmFilePlayer({
  sources,
  posterUri,
  width,
  height,
}: {
  sources: VideoSourceOption[];
  posterUri?: string | null;
  width: number;
  height: number;
}) {
  const videoRef = useRef<Video>(null);
  const webVideoRef = useRef<any>(null);
  const playerRootRef = useRef<any>(null);
  const cueOpacity = useRef(new Animated.Value(0)).current;
  const cueScale = useRef(new Animated.Value(0.92)).current;
  const controlsOpacity = useRef(new Animated.Value(0)).current;
  const cueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantsPlayRef = useRef(true);
  const progressRef = useRef<View>(null);

  const [sourceIndex, setSourceIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [playbackCue, setPlaybackCue] = useState<"play" | "pause">("play");
  const [playbackCueActive, setPlaybackCueActive] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const [playerChromeVisible, setPlayerChromeVisible] = useState(false);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [progressRailWidth, setProgressRailWidth] = useState(1);
  const [seeking, setSeeking] = useState(false);

  const src = sources[sourceIndex]?.uri || null;
  const selectedQualityLabel = sources[sourceIndex]?.label || "Auto";
  const controlsVisible = videoReady && (playerChromeVisible || !isPlaying || seeking);
  const progressPct = Math.max(0, Math.min(100, progress * 100));
  const elapsedLabel = formatPlayerTime(duration * progress);
  const durationLabel = duration > 0 ? formatPlayerTime(duration) : "0:00";
  const compactControls = width < 520;

  useEffect(() => {
    setSourceIndex(0);
    setVideoReady(false);
    setQualityMenuOpen(false);
    wantsPlayRef.current = true;
  }, [sources.map((source) => source.uri).join("|")]);

  useEffect(
    () => () => {
      if (cueTimerRef.current) clearTimeout(cueTimerRef.current);
      if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    },
    []
  );

  const revealPlayerChrome = useCallback(() => {
    setPlayerChromeVisible(true);
    if (chromeTimerRef.current) clearTimeout(chromeTimerRef.current);
    if (isPlaying) {
      chromeTimerRef.current = setTimeout(() => setPlayerChromeVisible(false), 2200);
    }
  }, [isPlaying]);

  useEffect(() => {
    Animated.timing(controlsOpacity, {
      toValue: controlsVisible ? 1 : 0,
      duration: controlsVisible ? 130 : 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [controlsOpacity, controlsVisible]);

  const flashPlaybackCue = (nextCue: "play" | "pause") => {
    setPlaybackCue(nextCue);
    setPlaybackCueActive(true);
    if (cueTimerRef.current) clearTimeout(cueTimerRef.current);
    cueOpacity.stopAnimation();
    cueScale.stopAnimation();
    cueOpacity.setValue(0);
    cueScale.setValue(0.92);

    Animated.parallel([
      Animated.timing(cueOpacity, {
        toValue: 1,
        duration: 110,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(cueScale, {
        toValue: 1,
        friction: 6,
        tension: 140,
        useNativeDriver: true,
      }),
    ]).start();

    cueTimerRef.current = setTimeout(() => {
      Animated.timing(cueOpacity, {
        toValue: 0,
        duration: 260,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setPlaybackCueActive(false));
    }, 420);
  };

  const play = async (ensureSound = true) => {
    wantsPlayRef.current = true;

    try {
      if (Platform.OS === "web") {
        const el = webVideoRef.current;
        if (!el) return;
        if (!el.src && src) {
          el.src = src;
        }
        if (ensureSound) {
          el.muted = false;
          setIsMuted(false);
        }
        if (el.readyState === 0) {
          try {
            el.load();
          } catch {}
        }
        await el.play().catch(async () => {
          el.muted = true;
          setIsMuted(true);
          await new Promise((resolve) => setTimeout(resolve, 40));
          try {
            await el.play();
          } catch {
            await new Promise((resolve) => setTimeout(resolve, 120));
            try {
              await el.play();
            } catch {}
          }
        });
        setIsPlaying(!el.paused);
        return;
      }

      if (ensureSound) {
        await videoRef.current?.setIsMutedAsync(false);
        setIsMuted(false);
      }
      await videoRef.current?.playAsync();
      setIsPlaying(true);
    } catch {}
  };

  const pause = async () => {
    wantsPlayRef.current = false;
    try {
      if (Platform.OS === "web") {
        webVideoRef.current?.pause();
      } else {
        await videoRef.current?.pauseAsync();
      }
    } catch {}
    setIsPlaying(false);
  };

  const togglePlayback = async () => {
    if (isPlaying) {
      await pause();
      flashPlaybackCue("pause");
    } else {
      await play(true);
      flashPlaybackCue("play");
    }
  };

  const toggleMute = async () => {
    const next = !isMuted;
    try {
      if (Platform.OS === "web") {
        const el = webVideoRef.current;
        if (!el) return;
        el.muted = next;
      } else {
        await videoRef.current?.setIsMutedAsync(next);
      }
      setIsMuted(next);
    } catch {}
  };

  const seekToRatio = (ratio: number) => {
    const next = Math.max(0, Math.min(1, ratio));
    const d = duration || 0;
    setProgress(next);
    if (d <= 0) return;

    if (Platform.OS === "web" && webVideoRef.current) {
      webVideoRef.current.currentTime = next * d;
    } else if (videoRef.current) {
      void videoRef.current.setPositionAsync(next * d * 1000);
    }
  };

  const setFromRailLocation = (locationX: number) => {
    seekToRatio(locationX / Math.max(1, progressRailWidth));
  };

  const setFromClientX = (clientX: number) => {
    if (!progressRef.current) return;
    const node: any = progressRef.current;
    const rect = node.getBoundingClientRect
      ? node.getBoundingClientRect()
      : { left: 0, width: progressRailWidth || 1 };
    seekToRatio((clientX - rect.left) / Math.max(1, rect.width));
  };

  useEffect(() => {
    if (Platform.OS !== "web" || !seeking) return;
    const onMove = (evt: MouseEvent) => setFromClientX(evt.clientX);
    const onUp = (evt: MouseEvent) => {
      setFromClientX(evt.clientX);
      setSeeking(false);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [seeking, duration, progressRailWidth]);

  const enterFullscreen = async () => {
    try {
      await play(true);
      if (Platform.OS === "web") {
        const root = playerRootRef.current as any;
        const el = webVideoRef.current as any;
        if (root?.requestFullscreen) await root.requestFullscreen();
        else if (el?.requestFullscreen) await el.requestFullscreen();
      } else {
        (videoRef.current as any)?.presentFullscreenPlayer?.();
      }
    } catch {}
  };

  const updateWebProgress = () => {
    const el = webVideoRef.current;
    if (!el) return;
    const d = el.duration || 0;
    const p = el.currentTime || 0;
    setDuration(d);
    if (d > 0) {
      setProgress(Math.max(0, Math.min(1, p / d)));
    }
  };

  const handleReady = () => {
    setVideoReady(true);
    updateWebProgress();
    if (wantsPlayRef.current) {
      setTimeout(() => {
        void play(true);
      }, Platform.OS === "web" ? 25 : 0);
    }
  };

  const handleError = () => {
    if (sourceIndex < sources.length - 1) {
      setVideoReady(false);
      setSourceIndex((prev) => Math.min(prev + 1, sources.length - 1));
      return;
    }
    setIsPlaying(false);
    setVideoReady(true);
  };

  const selectQuality = (index: number) => {
    if (index === sourceIndex) {
      setQualityMenuOpen(false);
      return;
    }

    let resumeAt = 0;
    const shouldResume = wantsPlayRef.current || isPlaying;
    try {
      if (Platform.OS === "web") resumeAt = webVideoRef.current?.currentTime || 0;
    } catch {}

    setQualityMenuOpen(false);
    setSourceIndex(index);
    setVideoReady(false);
    wantsPlayRef.current = shouldResume;

    setTimeout(async () => {
      try {
        if (Platform.OS === "web" && webVideoRef.current && resumeAt > 0) {
          webVideoRef.current.currentTime = resumeAt;
        } else if (Platform.OS !== "web" && videoRef.current && resumeAt > 0) {
          await videoRef.current.setPositionAsync(resumeAt * 1000);
        }
      } catch {}
      if (shouldResume) void play(true);
    }, 80);
  };

  useEffect(() => {
    if (!src) return;
    setVideoReady(false);
    const timer = setTimeout(() => {
      void play(true);
    }, Platform.OS === "web" ? 80 : 40);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  return (
    <View
      ref={playerRootRef}
      style={[styles.sharedPlayer, { width, height }]}
      {...(Platform.OS === "web"
        ? {
            onMouseEnter: revealPlayerChrome,
            onMouseMove: revealPlayerChrome,
            onMouseLeave: () => {
              if (!seeking) setPlayerChromeVisible(false);
            },
          }
        : {})}
    >
      {posterUri && !videoReady ? (
        <Image source={{ uri: posterUri }} style={styles.video} resizeMode="cover" />
      ) : null}

      {Platform.OS === "web" ? (
        <WebVideo
          ref={webVideoRef}
          src={src || undefined}
          poster={posterUri || undefined}
          className="ovk-video"
          playsInline
          autoPlay
          muted={isMuted}
          preload="auto"
          controls={false}
          // @ts-ignore
          controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
          disablePictureInPicture
          style={styles.video}
          onLoadedMetadata={handleReady}
          onLoadedData={handleReady}
          onCanPlay={handleReady}
          onTimeUpdate={updateWebProgress}
          onPlay={() => setIsPlaying(true)}
          onPlaying={() => setIsPlaying(true)}
          onPause={() => setIsPlaying(false)}
          onError={handleError}
        />
      ) : (
        <Video
          ref={videoRef}
          source={src ? { uri: src } : undefined}
          style={styles.video}
          resizeMode={ResizeMode.CONTAIN}
          shouldPlay
          isLooping={false}
          isMuted={isMuted}
          useNativeControls={false}
          usePoster={!!posterUri && !videoReady}
          posterSource={posterUri ? { uri: posterUri } : undefined}
          onLoad={handleReady as any}
          onReadyForDisplay={handleReady}
          onPlaybackStatusUpdate={(status: any) => {
            if (!status?.isLoaded) return;
            setIsPlaying(!!status.isPlaying);
            const d = status.durationMillis || 0;
            const p = status.positionMillis || 0;
            setDuration(d / 1000);
            if (d > 0) setProgress(Math.max(0, Math.min(1, p / d)));
          }}
          onError={handleError as any}
        />
      )}

      <Pressable
        style={[StyleSheet.absoluteFillObject, { zIndex: 6 }]}
        onPress={() => {
          revealPlayerChrome();
          void togglePlayback();
        }}
      />

      <Animated.View
        pointerEvents="none"
        style={[
          styles.playerCenterCue,
          {
            opacity: playbackCueActive ? cueOpacity : 0,
            transform: [{ scale: playbackCueActive ? cueScale : 1 }],
          },
        ]}
      >
        <Ionicons name={playbackCueActive ? playbackCue : "play"} size={34} color="#fff" />
      </Animated.View>

      <Animated.View
        pointerEvents={controlsVisible ? "box-none" : "none"}
        style={[styles.playerChromeDock, { opacity: controlsOpacity }]}
      >
        <View
          ref={progressRef}
          style={styles.playerTimeline}
          onLayout={(evt) => setProgressRailWidth(Math.max(1, evt.nativeEvent.layout.width))}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={(evt: any) => {
            setSeeking(true);
            setFromRailLocation(evt.nativeEvent.locationX ?? 0);
          }}
          onResponderMove={(evt: any) => setFromRailLocation(evt.nativeEvent.locationX ?? 0)}
          onResponderRelease={(evt: any) => {
            setFromRailLocation(evt.nativeEvent.locationX ?? 0);
            setSeeking(false);
          }}
          onResponderTerminate={() => setSeeking(false)}
          {...(Platform.OS === "web"
            ? {
                onMouseDown: (evt: any) => {
                  setSeeking(true);
                  setFromClientX(evt.clientX);
                },
              }
            : {})}
        >
          <View style={styles.playerTimelineTrack}>
            <View style={[styles.playerTimelineFill, { width: `${progressPct}%` }]} />
            <View style={[styles.playerTimelineThumb, { left: `${progressPct}%` }]} />
          </View>
        </View>

        <View style={styles.playerControlRow}>
          <View style={styles.playerControlLeft}>
            <TouchableOpacity
              onPress={togglePlayback}
              activeOpacity={0.82}
              style={styles.playerIconButton}
            >
              <Ionicons name={isPlaying ? "pause" : "play"} size={18} color="#FFF" />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={toggleMute}
              activeOpacity={0.82}
              style={styles.playerIconButton}
            >
              <Ionicons
                name={isMuted ? "volume-mute-outline" : "volume-high-outline"}
                size={18}
                color="#FFF"
              />
            </TouchableOpacity>

            <Text style={styles.playerTimeText} numberOfLines={1}>
              {elapsedLabel}
              {!compactControls ? ` / ${durationLabel}` : ""}
            </Text>
          </View>

          <TouchableOpacity
            onPress={enterFullscreen}
            activeOpacity={0.82}
            style={styles.playerIconButton}
          >
            <Ionicons name="scan-outline" size={18} color="#FFF" />
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
}

export default function SharedFilmScreen() {
  const { colors, isLight } = useAppTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<SharedFilmRoute>();
  const { width } = useWindowDimensions();
  const GOLD = colors.primary;
  const BG = colors.background;
  const PANEL = colors.card;
  const PANEL_ALT = colors.mutedCard;
  const LINE = colors.border;
  const TEXT = colors.textPrimary;
  const SUB = colors.textSecondary;
  const MUTE = colors.textMuted;
  const goldSoft = isLight ? 'rgba(168,121,34,0.06)' : 'rgba(198,166,100,0.12)';

  const routeShareSlug =
    route.params?.shareSlug ||
    (route.params as any)?.openShareSlug ||
    null;

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
  const nativeMobileLayout = usesNativeMobileLayoutOnWeb(width);

  const isWide = width >= 900;

  const cardWidth = useMemo(() => {
    if (isWide) return Math.min(960, width - 48);
    return width - 20;
  }, [isWide, width]);

  const mediaHeight = Math.max(220, Math.floor((cardWidth * 9) / 16));

  const [loading, setLoading] = useState(true);
  const [film, setFilm] = useState<FilmRow | null>(null);
  const [playableVideoUrls, setPlayableVideoUrls] = useState<VideoSourceOption[]>([]);
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
    setPlayableVideoUrls([]);

    try {
      const selectWithDescription = `
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
        youtube_url,
        mime_type,
        media_kind,
        category,
        film_category,
        share_slug,
        mux_upload_id,
        mux_asset_id,
        mux_playback_id,
        mux_status,
        video_id,
        users:user_id (
          id,
          full_name,
          public_slug
        ),
        videos:video_id (
          original_path,
          thumbnail_path,
          video_variants (
            path,
            label
          )
        )
      `;

      const selectWithoutDescription = `
        id,
        user_id,
        title,
        word,
        votes,
        submitted_at,
        thumbnail_url,
        storage_path,
        video_path,
        youtube_url,
        mime_type,
        media_kind,
        category,
        film_category,
        share_slug,
        mux_upload_id,
        mux_asset_id,
        mux_playback_id,
        mux_status,
        video_id,
        users:user_id (
          id,
          full_name,
          public_slug
        ),
        videos:video_id (
          original_path,
          thumbnail_path,
          video_variants (
            path,
            label
          )
        )
      `;

      const selectMinimal = `
        id,
        user_id,
        title,
        word,
        votes,
        submitted_at,
        thumbnail_url,
        storage_path,
        video_path,
        youtube_url,
        mime_type,
        media_kind,
        category,
        share_slug,
        mux_upload_id,
        mux_asset_id,
        mux_playback_id,
        mux_status,
        video_id,
        users:user_id (
          id,
          full_name,
          public_slug
        ),
        videos:video_id (
          original_path,
          thumbnail_path,
          video_variants (
            path,
            label
          )
        )
      `;

      let result = await supabase
        .from("submissions")
        .select(selectWithDescription)
        .eq("share_slug", shareSlug)
        .maybeSingle();

      if (result.error) {
        result = await supabase
          .from("submissions")
          .select(selectWithoutDescription)
          .eq("share_slug", shareSlug)
          .maybeSingle();
      }

      if (result.error) {
        result = await supabase
          .from("submissions")
          .select(selectMinimal)
          .eq("share_slug", shareSlug)
          .maybeSingle();
      }

      if (result.error) throw result.error;

      if (!result.data) {
        setFilm(null);
        setErrorText("This film could not be found.");
        return;
      }

      const row = normalizeFilmRow(result.data);

      setFilm(row);

      const youtubeId = extractYoutubeId(row.youtube_url);
      const isYoutube =
        row.media_kind === "youtube" || (!!row.youtube_url && !!youtubeId);

      if (isYoutube) {
        setPlayableVideoUrls([]);
        return;
      }

      const muxReady = isMuxReady(row.mux_status);
      const muxUri = muxReady ? getMuxPlaybackUrl(row.mux_playback_id) : null;
      const nextSources: VideoSourceOption[] = [];

      const picked = pickFastStartVariant(row);
      const rawMedia = picked.path || row.storage_path || row.video_path || null;
      const signed = await signFilmMediaPath(rawMedia);

      if (signed) nextSources.push({ label: "Auto", uri: signed });
      if (muxUri) {
        nextSources.push(...getMuxPlaybackOptions(muxUri));
      }
      setPlayableVideoUrls(
        nextSources.filter(
          (candidate, index, arr) =>
            !!candidate.uri && arr.findIndex((item) => item.uri === candidate.uri) === index
        )
      );
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

  const shouldShowFileVideo = playableVideoUrls.length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: BG }]}>
      <LinearGradient
        colors={[BG, BG, colors.backgroundAlt]}
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
            style={[styles.backBtn, { backgroundColor: PANEL_ALT, borderColor: LINE }]}
          >
            <Text style={[styles.backText, { color: TEXT }]}>← Back</Text>
          </TouchableOpacity>

          {loading ? (
            <View style={[styles.centerState, { backgroundColor: PANEL, borderColor: LINE }]}>
              <ActivityIndicator size="large" color={GOLD} />
              <Text style={[styles.stateText, { color: SUB }]}>Loading film…</Text>
            </View>
          ) : errorText ? (
            <View style={[styles.centerState, { backgroundColor: PANEL, borderColor: LINE }]}>
              <Text style={[styles.errorTitle, { color: TEXT }]}>Unavailable</Text>
              <Text style={[styles.errorText, { color: SUB }]}>{errorText}</Text>

              <View style={[styles.errorActions, nativeMobileLayout ? styles.actionsStacked : styles.actionsRow]}>
                <TouchableOpacity
                  onPress={goToSignUp}
                  activeOpacity={0.9}
                  style={[styles.primaryBtn, nativeMobileLayout && styles.actionBtnStacked, { backgroundColor: GOLD }]}
                >
                  <Text style={[styles.primaryBtnText, { color: colors.textOnPrimary }]}>Join Overlooked</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={goToSignIn}
                  activeOpacity={0.9}
                  style={[styles.secondaryBtn, nativeMobileLayout && styles.actionBtnStacked, { backgroundColor: PANEL_ALT, borderColor: LINE }]}
                >
                  <Text style={[styles.secondaryBtnText, { color: TEXT }]}>Sign In</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : film ? (
            <>
              <View style={[styles.card, { backgroundColor: PANEL, borderColor: LINE }]}>
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
                  ) : shouldShowFileVideo ? (
                    <SharedFilmFilePlayer
                      sources={playableVideoUrls}
                      posterUri={film.thumbnail_url || null}
                      width={cardWidth}
                      height={mediaHeight}
                    />
                  ) : film.thumbnail_url ? (
                    <View style={styles.mediaFallback}>
                      <Image
                        source={{ uri: film.thumbnail_url }}
                        style={styles.video}
                        resizeMode="cover"
                      />
                      <View style={styles.noVideoOverlay}>
                        <Text style={styles.noVideoOverlayText}>
                          Film file not available
                        </Text>
                      </View>
                    </View>
                  ) : (
                    <View style={[styles.video, styles.mediaFallback]}>
                      <Text style={styles.mediaFallbackText}>No preview available</Text>
                    </View>
                  )}
                </View>

                <View style={styles.metaBlock}>
                  <Text style={[styles.kicker, { color: GOLD }]}>Shared on Overlooked</Text>

                  <Text style={[styles.title, { color: TEXT }]}>{film.title || "Untitled Film"}</Text>

                  {film.users?.full_name ? (
                    <TouchableOpacity onPress={goToCreator} activeOpacity={0.9}>
                      <Text style={[styles.byline, { color: SUB }]}>by {film.users.full_name}</Text>
                    </TouchableOpacity>
                  ) : null}

                  <View style={styles.metaRow}>
                    {film.film_category || film.category ? (
                      <View style={[styles.metaPill, { backgroundColor: goldSoft, borderColor: isLight ? 'rgba(168,121,34,0.18)' : 'rgba(198,166,100,0.26)' }]}>
                        <Text style={[styles.metaPillText, { color: GOLD }]}>
                          {film.film_category || film.category}
                        </Text>
                      </View>
                    ) : null}

                    {film.submitted_at ? (
                      <View style={[styles.metaPillGhost, { backgroundColor: PANEL_ALT, borderColor: LINE }]}>
                        <Text style={[styles.metaPillGhostText, { color: MUTE }]}>
                          {formatDate(film.submitted_at)}
                        </Text>
                      </View>
                    ) : null}

                    <View style={[styles.metaPillGhost, { backgroundColor: PANEL_ALT, borderColor: LINE }]}>
                      <Text style={[styles.metaPillGhostText, { color: MUTE }]}>
                        Votes {film.votes ?? 0}
                      </Text>
                    </View>
                  </View>

                  {!!film.word ? (
                    <Text style={[styles.wordText, { color: GOLD }]}>Word: {film.word}</Text>
                  ) : null}

                  {!!film.description ? (
                    <Text style={[styles.description, { color: SUB }]}>{film.description}</Text>
                  ) : null}

                  {film.users?.full_name ? (
                    <View style={[styles.actions, nativeMobileLayout ? styles.actionsStacked : styles.actionsRow]}>
                      <TouchableOpacity
                        onPress={goToCreator}
                        activeOpacity={0.9}
                        style={[styles.secondaryBtn, nativeMobileLayout && styles.actionBtnStacked, { backgroundColor: PANEL_ALT, borderColor: LINE }]}
                      >
                        <Text style={[styles.secondaryBtnText, { color: TEXT }]}>View Creator</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </View>
              </View>

              {!isSignedIn && (
                <View style={[styles.ctaCard, { backgroundColor: PANEL, borderColor: LINE }]}>
                  <Text style={[styles.ctaTitle, { color: TEXT }]}>Want to share your own film?</Text>
                  <Text style={[styles.ctaBody, { color: SUB }]}>
                    Join Overlooked to upload films, build your profile, and connect with other creatives.
                  </Text>

                  <View style={[styles.ctaActions, nativeMobileLayout ? styles.actionsStacked : styles.actionsRow]}>
                    <TouchableOpacity
                      onPress={goToSignUp}
                      activeOpacity={0.9}
                      style={[styles.primaryBtn, nativeMobileLayout && styles.actionBtnStacked, { backgroundColor: GOLD }]}
                    >
                      <Text style={[styles.primaryBtnText, { color: colors.textOnPrimary }]}>Join Overlooked</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={goToSignIn}
                      activeOpacity={0.9}
                      style={[styles.secondaryBtn, nativeMobileLayout && styles.actionBtnStacked, { backgroundColor: PANEL_ALT, borderColor: LINE }]}
                    >
                      <Text style={[styles.secondaryBtnText, { color: TEXT }]}>Sign In</Text>
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
    borderRadius: 9,
    backgroundColor: "#0B0B0B",
    borderWidth: 1,
    borderColor: LINE,
    justifyContent: "center",
    marginBottom: 14,
  },
  backText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "700",
  },
  centerState: {
    minHeight: 320,
    borderRadius: 12,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: LINE,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  redirectState: {
    flex: 1,
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
    fontWeight: "800",
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
    alignItems: "center",
    justifyContent: "center",
  },
  actionsRow: {
    flexDirection: "row",
  },
  actionsStacked: {
    width: "100%",
    alignSelf: "stretch",
    flexDirection: "column",
    alignItems: "stretch",
  },
  card: {
    backgroundColor: PANEL,
    borderRadius: 12,
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
  sharedPlayer: {
    backgroundColor: "#000",
    position: "relative",
    overflow: "hidden",
  },
  playerCenterCue: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 64,
    height: 64,
    marginLeft: -32,
    marginTop: -32,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 8,
  },
  playerChromeDock: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 8,
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 7,
    borderRadius: 8,
    backgroundColor: "rgba(5,5,5,0.58)",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 20,
    elevation: 20,
  },
  playerTimeline: {
    height: 12,
    justifyContent: "center",
    marginBottom: 2,
  },
  playerTimelineTrack: {
    height: 2,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.26)",
  },
  playerTimelineFill: {
    height: 2,
    borderRadius: 999,
    backgroundColor: GOLD,
  },
  playerTimelineThumb: {
    position: "absolute",
    top: -4,
    width: 10,
    height: 10,
    marginLeft: -5,
    borderRadius: 5,
    backgroundColor: GOLD,
  },
  playerControlRow: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 6,
  },
  playerControlLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  playerIconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  playerTimeText: {
    flexShrink: 1,
    color: "#F7F2E8",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  sharedFullscreenButton: {
    position: "absolute",
    left: 12,
    top: 12,
    width: 40,
    height: 40,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  sharedMuteButton: {
    position: "absolute",
    right: 12,
    top: 12,
    width: 40,
    height: 40,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  sharedQualityButton: {
    position: "absolute",
    right: 12,
    top: 12,
    minHeight: 40,
    paddingHorizontal: 11,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    zIndex: 12,
  },
  sharedQualityButtonText: {
    color: "#fff",
    fontSize: 9,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  sharedQualityMenu: {
    position: "absolute",
    right: 12,
    top: 56,
    minWidth: 128,
    borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.84)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    overflow: "hidden",
    paddingVertical: 4,
    zIndex: 14,
  },
  sharedQualityMenuItem: {
    minHeight: 34,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sharedQualityMenuItemSelected: {
    backgroundColor: "rgba(198,166,100,0.14)",
  },
  sharedQualityMenuText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  sharedQualityMenuTextSelected: {
    color: GOLD,
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
    borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignSelf: "center",
  },
  noVideoOverlayText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  metaBlock: {
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  kicker: {
    color: GOLD,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  title: {
    color: TEXT,
    fontSize: 28,
    fontWeight: "800",
    lineHeight: 34,
  },
  byline: {
    marginTop: 8,
    color: SUB,
    fontSize: 14,
    fontWeight: "700",
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
    borderRadius: 8,
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
    fontWeight: "700",
  },
  metaPillGhost: {
    minHeight: 32,
    paddingHorizontal: 12,
    borderRadius: 8,
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
    fontWeight: "700",
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
    alignItems: "center",
    justifyContent: "flex-start",
    alignSelf: "flex-start",
    marginTop: 20,
  },
  primaryBtn: {
    minHeight: 46,
    paddingHorizontal: 18,
    borderRadius: 9,
    backgroundColor: GOLD,
    justifyContent: "center",
    alignItems: "center",
    marginRight: Platform.OS === "web" ? 10 : 0,
    marginBottom: Platform.OS === "web" ? 0 : 10,
  },
  actionBtnStacked: {
    width: "100%",
    marginRight: 0,
    marginBottom: 10,
  },
  primaryBtnText: {
    color: "#111",
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  secondaryBtn: {
    minHeight: 46,
    paddingHorizontal: 20,
    borderRadius: 9,
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: LINE,
    justifyContent: "center",
    alignItems: "center",
  },
  secondaryBtnText: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  ctaCard: {
    marginTop: 16,
    backgroundColor: PANEL_ALT,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: LINE,
    paddingHorizontal: 18,
    paddingVertical: 22,
    alignItems: "center",
  },
  ctaTitle: {
    color: TEXT,
    fontSize: 20,
    fontWeight: "800",
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
    alignItems: "center",
    justifyContent: "center",
  },
});
