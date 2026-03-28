// FeaturedScreen.tsx — PART 1 / 3
// ✅ Includes: imports, theme/constants, Grain, signed URL helpers, media helpers,
// ✅ HeaderControls updated to match the “Frameup-style” sidebar (vertical sort list)
// ⛔️ Do NOT run yet — wait for PART 2 + PART 3 to complete the file.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Platform,
  ViewToken,
  Image,
  ActivityIndicator,
  Alert,
  Pressable,
  Animated,
  Easing,
  NativeSyntheticEvent,
  NativeScrollEvent,
  useWindowDimensions,
  ImageBackground,
  LayoutChangeEvent,
  Modal,
  Share,
} from 'react-native';
import { useNavigation, useFocusEffect, useRoute } from '@react-navigation/native';
import {
  Video,
  ResizeMode,
  VideoFullscreenUpdate,
  AVPlaybackStatus,
  Audio,
} from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { Submission } from '../types';
import { supabase, giveXp, XP_VALUES } from '../lib/supabase';
import { useGamification } from '../context/GamificationContext';
import * as Clipboard from 'expo-clipboard';


const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

/* ------------------------------------------------------------------
   CINEMATIC NOIR — Simple • Clean • High Contrast (kept)
   ------------------------------------------------------------------ */
const GOLD = '#C6A664';
const T = {
  bg: '#000000',
  bg2: '#000000',
  panel: '#000000',
  card: '#000000',
  card2: '#000000',
  outline: '#1A1A1A',
  text: '#FFFFFF',
  sub: '#DADADA',
  mute: '#9A9A9A',
  accent: '#4FD1FF',
  heroBurgundy1: '#000000',
  heroBurgundy2: '#000000',
};

const FONT_CINEMATIC =
  Platform.select({ ios: 'Cinzel', android: 'Cinzel', default: 'Cinzel' }) ||
  'Cinzel';

const FONT_OBLIVION =
  Platform.select({
    ios: 'Avenir Next',
    android: 'sans-serif-light',
    default: 'Avenir Next',
  }) || 'Avenir Next';

type SortKey = 'newest' | 'oldest' | 'mostvoted' | 'leastvoted';
type Category = 'film' | 'all';

const FILM_CATEGORIES = [
  'All',
  'Drama',
  'Comedy',
  'Thriller',
  'Horror',
  'Sci-Fi',
  'Romance',
  'Action',
  'Mystery',
  'Crime',
  'Fantasy',
  'Coming-of-Age',
  'Experimental',
  'Documentary-Style',
  'No-Dialogue',
  'One-Take',
  'Found Footage',
  'Slow Cinema',
  'Satire',
  'Neo-Noir',
  'Musical',
  'Tragedy',
  'Monologue',
  'Character Study',
  'Dialogue-Driven',
  'Dramedy',
  'Dark Comedy',
  'Psychological',
  'Suspense',
  'Period Piece',
  'Social Realism',
  'Rom-Com',
  'Heist',
  'War',
  'Western',
  'Supernatural',
  'Animation-Style',
  'Silent Film',
  'Improvised',
  'Voiceover',
  'Two-Hander',
  'Single Location',
] as const;

type FilmCategory = (typeof FILM_CATEGORIES)[number];

// Because Challenge stores EXACT strings from the tag list into submissions.film_category,
// the DB values should match 1:1 (no translation needed).
const FILM_CATEGORY_DB_MAP: Record<string, string> = Object.fromEntries(
  FILM_CATEGORIES.filter((c) => c !== 'All').map((c) => [c, c])
);

const TOP_BAR_OFFSET = Platform.OS === 'web' ? 68 : 10;
const BOTTOM_TAB_H = Platform.OS === 'web' ? 64 : 64;
const CONTENT_TOP_PAD = Platform.OS === 'web' ? 5 : 9;

/* 🔥 Gamification constants (kept) */
const VOTES_PER_MONTH = 10;
const VOTE_XP =
  (XP_VALUES &&
    ((XP_VALUES as any).VOTE_SUBMISSION ||
      (XP_VALUES as any).VOTE ||
      (XP_VALUES as any).VOTE_FILM)) ||
  5;

type RawSubmission = Omit<Submission, 'users'> & {
  users?:
    | { id: string; full_name: string }
    | { id: string; full_name: string }[]
    | null;
  description?: string | null;
  word?: string | null;
  video_id?: string | null;
  storage_path?: string | null;
  video_path?: string | null;
  thumbnail_url?: string | null;
  media_kind?: 'file_audio' | 'file_video' | 'youtube' | null;
  mime_type?: string | null;
  duration_seconds?: number | null;
  category?: Category | null;
  share_slug?: string | null;
  videos?: {
    original_path?: string | null;
    thumbnail_path?: string | null;
    video_variants?: { path: string; label?: string | null }[] | null;
  } | null;
};

/* ---------------- Film Grain ---------------- */
const GRAIN_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIElEQVQYV2P8//8/AzGAiYGB4T8mGJgYhBmMCEwMDAwA1wQq1i3gN8QAAAAASUVORK5CYII=';

const Grain = ({
  opacity = 0.06,
  stronger = false,
}: {
  opacity?: number;
  stronger?: boolean;
}) => {
  const o = stronger ? opacity * 1.25 : opacity;
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { opacity: o }]}
    >
      {Platform.OS === 'web' ? (
        <View
          // @ts-ignore web-only CSS props
          style={[
            StyleSheet.absoluteFillObject as any,
            {
              backgroundImage: `url(${GRAIN_PNG})`,
              backgroundRepeat: 'repeat',
              backgroundSize: 'auto',
            },
          ]}
        />
      ) : (
        <ImageBackground
          source={{ uri: GRAIN_PNG }}
          style={StyleSheet.absoluteFillObject}
          resizeMode={'repeat' as any}
        />
      )}
    </View>
  );
};

/* ---------------- Signed URL cache ---------------- */
const signedUrlCache = new Map<string, { url: string; exp: number }>();
const inflight = new Map<string, Promise<string>>();

/* --- WEB: hide native controls completely & warm cache --- */
let CSS_INJECTED = false;
function injectWebVideoCSS() {
  if (Platform.OS !== 'web' || CSS_INJECTED) return;
  const style = document.createElement('style');
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
  `;
  document.head.appendChild(style);
  CSS_INJECTED = true;
}
injectWebVideoCSS();

const webWarmStore: {
  links: Map<string, HTMLLinkElement>;
  warmVideos: Map<string, HTMLVideoElement>;
} = { links: new Map(), warmVideos: new Map() };

function webPreloadHref(href: string) {
  if (Platform.OS !== 'web') return;
  if (webWarmStore.links.has(href)) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'video';
  link.href = href;
  document.head.appendChild(link);
  webWarmStore.links.set(href, link);
}
function webWarmVideo(href: string) {
  if (Platform.OS !== 'web') return;
  if (webWarmStore.warmVideos.has(href)) return;
  const v = document.createElement('video');
  v.preload = 'auto';
  v.src = href;
  try {
    v.load();
  } catch {}
  webWarmStore.warmVideos.set(href, v);
}

async function signStoragePath(path: string, expiresInSec = 180): Promise<string> {
  const now = Date.now();
  const cached = signedUrlCache.get(path);
  if (cached && now < cached.exp - 30_000) return cached.url;
  if (inflight.has(path)) return inflight.get(path)!;

  const p = (async () => {
    const { data, error } = await supabase.storage
      .from('films')
      .createSignedUrl(path, expiresInSec);
    if (error || !data) {
      inflight.delete(path);
      throw error ?? new Error('Failed to sign media URL');
    }
    const url = data.signedUrl;
    signedUrlCache.set(path, { url, exp: now + expiresInSec * 1000 });
    webPreloadHref(url);
    webWarmVideo(url);
    inflight.delete(path);
    return url;
  })();

  inflight.set(path, p);
  return p;
}

/* ---------------- Select smallest variant ---------------- */
function pickSmallestVariant(row: any): { path: string | null; thumb: string | null } {
  const variants = row?.videos?.video_variants ?? [];
  if (!variants || variants.length === 0) {
    return {
      path:
        row?.video_path ??
        row?.storage_path ??
        row?.videos?.original_path ??
        null,
      thumb: row?.thumbnail_url ?? row?.videos?.thumbnail_path ?? null,
    };
  }
  const scored = variants
    .map((v: any) => {
      const m = /(\d{3,4})p/i.exec(v?.label || '');
      return { ...v, h: m ? parseInt(m[1], 10) : 9999 };
    })
    .sort((a: any, b: any) => a.h - b.h);
  const smallest = scored[0] ?? variants[0];
  return {
    path:
      row?.video_path ??
      row?.storage_path ??
      smallest?.path ??
      row?.videos?.original_path ??
      null,
    thumb: row?.thumbnail_url ?? row?.videos?.thumbnail_path ?? null,
  };
}

/* ---------------- Player registry ---------------- */
type PlayerHandle = { pause: () => Promise<void> | void; id: string };
const playerRegistry = new Map<string, PlayerHandle>();
const PAUSE_NONE_ID = '__NONE__';

async function pauseAllExcept(id?: string | null) {
  const target = id || PAUSE_NONE_ID;
  const ops: Promise<void>[] = [];
  playerRegistry.forEach((h) => {
    if (h.id !== target) ops.push(Promise.resolve(h.pause()));
  });
  await Promise.allSettled(ops);
}

/* ---------------- Minimal icons ---------------- */
const IconCorners = () => (
  <View style={{ width: 16, height: 16 }}>
    <View style={{ position: 'absolute', left: 0, top: 0, width: 8, height: 2, backgroundColor: '#fff' }} />
    <View style={{ position: 'absolute', left: 0, top: 0, width: 2, height: 8, backgroundColor: '#fff' }} />
    <View style={{ position: 'absolute', right: 0, top: 0, width: 8, height: 2, backgroundColor: '#fff' }} />
    <View style={{ position: 'absolute', right: 0, top: 0, width: 2, height: 8, backgroundColor: '#fff' }} />
    <View style={{ position: 'absolute', left: 0, bottom: 0, width: 8, height: 2, backgroundColor: '#fff' }} />
    <View style={{ position: 'absolute', left: 0, bottom: 0, width: 2, height: 8, backgroundColor: '#fff' }} />
    <View style={{ position: 'absolute', right: 0, bottom: 0, width: 8, height: 2, backgroundColor: '#fff' }} />
    <View style={{ position: 'absolute', right: 0, bottom: 0, width: 2, height: 8, backgroundColor: '#fff' }} />
  </View>
);

const IconSpeaker = ({ muted = false }: { muted?: boolean }) => (
  <View style={{ width: 16, height: 16, justifyContent: 'center' }}>
    <View
      style={{
        width: 6.7,
        height: 6.7,
        backgroundColor: '#fff',
        transform: [{ skewY: '10deg' }],
        marginLeft: 2,
      }}
    />
    {!muted && (
      <View
        style={{
          position: 'absolute',
          right: 0,
          width: 2,
          height: 6,
          borderRadius: 2,
          backgroundColor: '#fff',
        }}
      />
    )}
    {!muted && (
      <View
        style={{
          position: 'absolute',
          right: -6,
          width: 2,
          height: 8,
          borderRadius: 2,
          backgroundColor: '#fff',
          opacity: 0.6,
        }}
      />
    )}
    {muted && (
      <>
        <View
          style={{
            position: 'absolute',
            left: 2,
            right: 2,
            height: 2,
            backgroundColor: '#fff',
            transform: [{ rotate: '45deg' }],
          }}
        />
        <View
          style={{
            position: 'absolute',
            left: 2,
            right: 2,
            height: 2,
            backgroundColor: '#fff',
            transform: [{ rotate: '-45deg' }],
          }}
        />
      </>
    )}
  </View>
);

/* ---------------- Reddit-style vote arrow ---------------- */
const VoteArrow = ({ up = true, active = false, disabled = false }: { up?: boolean; active?: boolean; disabled?: boolean }) => (
  <View
    style={[
      styles.voteArrow,
      up ? styles.voteArrowUp : styles.voteArrowDown,
      active && styles.voteArrowActive,
      disabled && { opacity: 0.35 },
    ]}
  />
);

const WebVideo: any = 'video';

/* ---------------- Video with custom progress (no native controls) ---------------- */
/* NOTE: Kept exactly as your current implementation. */
function HostedVideoInline({
  playerId,
  storagePath,
  width,
  maxHeight,
  autoPlay,
  posterUri,
  dimVignette = true,
  showControls = true,
  showProgress = true,
  captureSurfacePress = true,
  surfacePressMode = 'hold',
}: {
  playerId: string;
  storagePath: string;
  width: number;
  maxHeight: number;
  autoPlay: boolean;
  posterUri?: string | null;
  dimVignette?: boolean;
  showControls?: boolean;
  showProgress?: boolean;
  captureSurfacePress?: boolean;
  surfacePressMode?: 'hold' | 'toggle';
}){
  const ref = useRef<Video>(null);
  const htmlRef = useRef<any>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [posterReady, setPosterReady] = useState(false);

  const opacity = useRef(new Animated.Value(0)).current;
  const [aspect, setAspect] = useState<number>(16 / 9);

  const [muted, setMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const progressRef = useRef<View>(null);


  useEffect(() => {
    const handle: PlayerHandle = {
      id: playerId,
      pause: async () => {
        try {
          if (Platform.OS === 'web') {
            htmlRef.current?.pause();
          } else {
            await ref.current?.pauseAsync();
          }
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
        const url = await signStoragePath(storagePath, 180);
        if (alive) {
          setPosterReady(false);
          setSrc(url);
        }
      } catch (e) {
        console.warn('[HostedVideoInline] sign failed', e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [storagePath]);

  const fadeIn = () => {
    Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const updateAspectFromDims = (w?: number, h?: number) => {
    if (!w || !h) return;
    const next = w / h;
    if (Number.isFinite(next)) {
      setAspect((prev) => (Math.abs(prev - next) > 0.004 ? next : prev));
    }
  };

  const play = async (ensureSound = false) => {
    try {
      await pauseAllExcept(playerId);
      if (Platform.OS === 'web') {
        const el = htmlRef.current!;
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
          await ref.current?.setIsMutedAsync(false);
          setMuted(false);
        }
        await ref.current?.playAsync();
        setIsPlaying(true);
      }
    } catch {}
  };

  const pause = async () => {
    try {
      if (Platform.OS === 'web') {
        const el = htmlRef.current!;
        el.pause();
        setIsPlaying(false);
      } else {
        await ref.current?.pauseAsync();
        setIsPlaying(false);
      }
    } catch {}
  };

  useEffect(() => {
    (async () => {
      if (!src) return;

      if (autoPlay && (Platform.OS !== 'web' || posterReady)) {
        if (Platform.OS === 'web') {
          if (htmlRef.current) {
            htmlRef.current.muted = true;
            htmlRef.current.controls = false;
          }
        } else {
          try {
            await ref.current?.setIsMutedAsync(true);
          } catch {}
        }
        setMuted(true);
        await play(false);
      } else {
        await pause();

        if (Platform.OS === 'web') {
          if (htmlRef.current) {
            htmlRef.current.muted = true;
            htmlRef.current.controls = false;
          }
        } else {
          try {
            await ref.current?.setIsMutedAsync(true);
          } catch {}
        }
        setMuted(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, autoPlay, posterReady]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const id = window.setInterval(() => {
      const el = htmlRef.current;
      if (el) el.controls = false;
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const onSurfacePressIn = async () => {
  await play(false);
};

const onSurfacePressOut = async () => {
  await pause();
};

const onSurfaceTogglePress = async () => {
  if (isPlaying) await pause();
  else await play(false);
};

  const maybeUpdateAspectFromStatus = (status?: AVPlaybackStatus) => {
    if (!status || !('isLoaded' in status) || !status.isLoaded) return;

    const ns: any = (status as any).naturalSize;
    updateAspectFromDims(ns?.width, ns?.height);

    setIsPlaying((status as any).isPlaying ?? false);

    const dur = (status as any).durationMillis ?? 0;
    const pos = (status as any).positionMillis ?? 0;
    setDuration(dur / 1000);

    if (dur > 0) {
      setProgress(Math.max(0, Math.min(1, pos / dur)));
    }
  };

  const handleLoad = (status?: AVPlaybackStatus) => {
  if (Platform.OS !== 'web') {
    maybeUpdateAspectFromStatus(status);
    fadeIn();
  }
};

  const handleReadyForDisplay = (evt?: any) => {
    if (Platform.OS !== 'web') {
      const ns = evt?.naturalSize;
      updateAspectFromDims(ns?.width, ns?.height);
    }
    fadeIn();
  };

  const handleFsUpdate = async ({ fullscreenUpdate }: { fullscreenUpdate: number }) => {
    if (Platform.OS === 'web') return;
    try {
      if (fullscreenUpdate === VideoFullscreenUpdate.PLAYER_WILL_PRESENT) {
        await pauseAllExcept(playerId);
        await ref.current?.setIsMutedAsync(false);
        setMuted(false);
        await ref.current?.playAsync();
        setIsPlaying(true);
      }
    } catch (e) {
      console.warn('[HostedVideoInline] fullscreen update error', e);
    }
  };

  const onWebLoadedMeta = () => {
    const el = htmlRef.current!;
    updateAspectFromDims(el.videoWidth, el.videoHeight);
    setDuration(el.duration || 0);
    el.controls = false;
    setPosterReady(true);
    fadeIn();
  };

  const onWebTimeUpdate = () => {
    const el = htmlRef.current!;
    const d = el.duration || 0;
    const p = el.currentTime || 0;
    setDuration(d);
    if (d > 0) {
      setProgress(Math.max(0, Math.min(1, p / d)));
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = () => {
      const el = htmlRef.current as any;
      const fs = (document as any).fullscreenElement;
      if (el && fs === el) {
        pauseAllExcept(playerId).then(async () => {
          try {
            el.muted = false;
            setMuted(false);
            el.controls = false;
            await el.play();
            setIsPlaying(true);
          } catch {}
        });
      }
    };
    document.addEventListener('fullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
    };
  }, [playerId]);

  const enterFullscreen = async () => {
    try {
      await pauseAllExcept(playerId);
      await play(true);
      if (Platform.OS === 'web') {
        const el = htmlRef.current as any;
        if (el?.requestFullscreen) await el.requestFullscreen();
      } else {
        (ref.current as any)?.presentFullscreenPlayer?.();
      }
    } catch (e) {
      console.warn('Fullscreen error', e);
    }
  };

  const toggleMute = async () => {
    try {
      if (Platform.OS === 'web') {
        const el = htmlRef.current!;
        const next = !muted;
        el.muted = next;
        setMuted(next);
        if (!el.paused) setIsPlaying(true);
      } else {
        const next = !muted;
        await ref.current?.setIsMutedAsync(next);
        setMuted(next);
      }
    } catch {}
  };

  const [seeking, setSeeking] = useState(false);

  const setFromClientX = (clientX: number) => {
    if (!progressRef.current) return;
    const el: any = progressRef.current;
    const rect = el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : { left: 0, width: 1 };
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const d = duration || 0;
    if (Platform.OS === 'web' && htmlRef.current) {
      htmlRef.current.currentTime = ratio * d;
      setProgress(ratio);
    } else if (ref.current) {
      const durMs = d * 1000;
      ref.current.setPositionAsync(ratio * durMs);
      setProgress(ratio);
    }
  };

  useEffect(() => {
    if (Platform.OS !== 'web' || !seeking) return;
    const onMove = (e: MouseEvent) => setFromClientX(e.clientX);
    const onUp = (e: MouseEvent) => {
      setFromClientX(e.clientX);
      setSeeking(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [seeking, duration]);

  return (
    <View
      style={{
        width,
        aspectRatio: aspect as any,
        borderRadius: RADIUS_XL,
        overflow: 'hidden',
        backgroundColor: '#000',
        alignSelf: 'center',
      }}
    >
      <Animated.View
  style={[
    StyleSheet.absoluteFillObject,
    {
      opacity: Platform.OS === 'web' ? opacity : 1,
      zIndex: 0,
    },
  ]}
>
        {Platform.OS === 'web' ? (
          <WebVideo
            ref={htmlRef}
            src={src || undefined}
            poster={posterUri || undefined}
            className="ovk-video"
            style={
              {
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                objectPosition: 'center center',
                display: 'block',
                background: '#000',
              } as any
            }
            loop
            playsInline
            preload="auto"
            controls={false}
            // @ts-ignore
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
            ref={ref}
            source={src ? { uri: src } : undefined}
            style={{ width: '100%', height: '100%' }}
            resizeMode={ResizeMode.CONTAIN}
            isLooping
            shouldPlay={autoPlay}
            isMuted={muted}
            useNativeControls={false}
            usePoster
            posterSource={posterUri ? { uri: posterUri } : undefined}
            posterStyle={[StyleSheet.absoluteFillObject, { borderRadius: RADIUS_XL }]}
            onLoad={handleLoad}
            onReadyForDisplay={handleReadyForDisplay}
            onFullscreenUpdate={handleFsUpdate}
            onPlaybackStatusUpdate={maybeUpdateAspectFromStatus}
            progressUpdateIntervalMillis={150}
          />
        )}
      </Animated.View>

      {captureSurfacePress ? (
  <Pressable
    onPress={
      playerId.startsWith('winner-')
        ? () => {}
        : surfacePressMode === 'toggle'
        ? onSurfaceTogglePress
        : () => {}
    }
    onPressIn={
      playerId.startsWith('winner-')
        ? undefined
        : surfacePressMode === 'hold'
        ? onSurfacePressIn
        : undefined
    }
    onPressOut={
      playerId.startsWith('winner-')
        ? undefined
        : surfacePressMode === 'hold'
        ? onSurfacePressOut
        : undefined
    }
    style={[
      StyleSheet.absoluteFillObject,
      {
        zIndex: 6,
        backgroundColor: 'transparent',
      },
    ]}
  />
) : null}

      {showProgress ? (
  <View
    ref={progressRef}
    style={[styles.progressHit, { zIndex: 15 }]}
    {...(Platform.OS === 'web'
      ? {
          onMouseDown: (e: any) => {
            setSeeking(true);
            setFromClientX(e.clientX);
          },
        }
      : {})}
  >
    <View style={styles.progressTrack}>
      <View
        style={[
          styles.progressFill,
          {
            width: `${Math.max(0, Math.min(100, progress * 100))}%`,
          },
        ]}
      />
    </View>
  </View>
) : null}

      {showControls && (
  <TouchableOpacity
    onPress={enterFullscreen}
    activeOpacity={0.9}
    style={[styles.fsButton, { zIndex: 20 }]}
  >
    <IconCorners />
  </TouchableOpacity>
)}

{showControls && (
  <TouchableOpacity
    onPress={toggleMute}
    style={[styles.soundBtn, { zIndex: 20 }]}
    activeOpacity={0.9}
  >
    <IconSpeaker muted={muted} />
    <Text style={styles.soundText}>{muted ? 'OFF' : 'ON'}</Text>
  </TouchableOpacity>
)}
    </View>
  );
}

/* ---------------- Audio (for Music) ---------------- */
function HostedAudioInline({
  playerId,
  storagePath,
  autoPlay,
}: {
  playerId: string;
  storagePath: string;
  autoPlay: boolean;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const url = await signStoragePath(storagePath, 180);
        if (alive) {
          setSrc(url);
        }
      } catch (e) {
        console.warn('[HostedAudioInline] sign failed', e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [storagePath]);

  useEffect(() => {
    const handle: PlayerHandle = {
      id: playerId,
      pause: async () => {
        try {
          if (Platform.OS === 'web') {
            const el = document.getElementById(`audio-${playerId}`) as
              | HTMLAudioElement
              | null;
            el?.pause();
          } else {
            await soundRef.current?.pauseAsync();
          }
        } catch {}
      },
    };
    playerRegistry.set(playerId, handle);
    return () => {
      playerRegistry.delete(playerId);
    };
  }, [playerId]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    (async () => {
      if (!src) return;
      try {
        await soundRef.current?.unloadAsync();
      } catch {}
      const { sound } = await Audio.Sound.createAsync(
        { uri: src },
        {
          shouldPlay: false,
          isLooping: true,
          volume: 1.0,
        }
      );
      soundRef.current = sound;
      setIsLoaded(true);
    })();

    return () => {
      (async () => {
        try {
          await soundRef.current?.unloadAsync();
        } catch {}
      })();
    };
  }, [src]);

  useEffect(() => {
    (async () => {
      if (!src) return;

      if (Platform.OS === 'web') {
        const el = document.getElementById(`audio-${playerId}`) as
          | HTMLAudioElement
          | null;
        if (!el) return;
        try {
          if (autoPlay) await el.play();
          else el.pause();
        } catch {}
      } else if (isLoaded && soundRef.current) {
        try {
          if (autoPlay) {
            await soundRef.current.setIsLoopingAsync(true);
            await soundRef.current.playAsync();
          } else {
            await soundRef.current.pauseAsync();
          }
        } catch {}
      }
    })();
  }, [src, autoPlay, isLoaded, playerId]);

  return (
    <View style={styles.audioWrap}>
      {Platform.OS === 'web' ? (
        <audio id={`audio-${playerId}`} src={src || undefined} controls style={{ width: '100%' }} />
      ) : (
        <Text style={styles.audioHint}>Playing audio…</Text>
      )}
    </View>
  );
}

/* ---------------- helpers (fetch/normalize etc) ---------------- */
function normalizeRow(
  row: RawSubmission
): Submission & {
  description?: string | null;
  storage_path?: string | null;
  thumbnail_url?: string | null;
  media_kind?: RawSubmission['media_kind'];
  mime_type?: string | null;
  category?: Category | null;
} {
  const maybe = row?.users as any;
  const user =
    maybe == null ? undefined : Array.isArray(maybe) ? (maybe[0] as any) : (maybe as any);

  const desc = (row as any).description ?? (row as any).word ?? null;

  const picked = pickSmallestVariant(row);

  return {
    ...(row as any),
    users: user
      ? {
          id: user.id,
          full_name: user.full_name,
        }
      : undefined,
    description: desc,
    storage_path: picked.path ?? row.storage_path ?? null,
    thumbnail_url: picked.thumb ?? row.thumbnail_url ?? null,
    media_kind: row.media_kind ?? null,
    mime_type: row.mime_type ?? null,
    category: (row.category as Category | null) ?? null,
  };
}

function normalizeIsoRange(start: string, end: string) {
  const mkStart = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00.000Z` : new Date(s).toISOString();
  const mkEnd = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T23:59:59.999Z` : new Date(s).toISOString();
  return {
    startIso: mkStart(start),
    endIso: mkEnd(end),
  };
}

async function fetchChallengesForFeatured() {
  try {
    const { error: finalizeErr } = await supabase.rpc('finalize_last_month_winner_if_needed');
    if (finalizeErr) {
      console.warn('finalize_last_month_winner_if_needed failed:', finalizeErr.message);
    }
  } catch {}

  try {
    const { error: insertErr } = await supabase.rpc('insert_monthly_challenge_if_not_exists');
    if (insertErr) {
      console.warn('insert_monthly_challenge_if_not_exists failed:', insertErr.message);
    }
  } catch {}

  const nowIso = new Date().toISOString();

  const { data: current, error: curErr } = await supabase
    .from('monthly_challenges')
    .select('id, theme_word, month_start, month_end')
    .lte('month_start', nowIso)
    .gt('month_end', nowIso)
    .order('month_start', { ascending: false })
    .limit(1)
    .single();

  if (curErr) {
    console.warn('Failed to fetch CURRENT month challenge:', curErr.message);
  }

  const { data: previous, error: prevErr } = await supabase
    .from('monthly_challenges')
    .select('id, winner_submission_id, month_start, month_end')
    .lte('month_end', nowIso)
    .order('month_end', { ascending: false })
    .limit(1)
    .single();

  if (prevErr) {
    console.warn('Failed to fetch PREVIOUS month challenge:', prevErr.message);
  }

  return {
    current: current ?? null,
    previous: previous ?? null,
  };
}

/* 🔥 Count votes in current month for cap enforcement (kept) */
async function countUserVotesInRange(uid: string, range: { start: string; end: string }) {
  try {
    const { startIso, endIso } = normalizeIsoRange(range.start, range.end);

    const attempt = async (tsCol: 'created_at' | 'voted_at') =>
      supabase
        .from('user_votes')
        .select('user_id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .gte(tsCol, startIso)
        .lt(tsCol, endIso);

    let { count, error } = await attempt('created_at');

    if (error) {
      const retry = await attempt('voted_at');
      count = retry.count ?? 0;
      if (retry.error) {
        console.warn('Failed to count monthly votes (Featured):', retry.error.message);
        return 0;
      }
    }

    return count ?? 0;
  } catch (e: any) {
    console.warn('Failed to count monthly votes (Featured):', e?.message || String(e));
    return 0;
  }
}

function slugifyFilmTitle(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function buildSharedFilmUrl(shareSlug: string) {
  return `https://overlooked.cloud/f/${shareSlug}`;
}

async function ensureSubmissionShareSlug(submission: {
  id: string;
  title?: string | null;
  share_slug?: string | null;
}) {
  if (submission.share_slug) return submission.share_slug;

  const base = slugifyFilmTitle(submission.title || 'film');
  const slug = `${base || 'film'}-${String(submission.id).slice(0, 6)}`;

  const { error } = await supabase
    .from('submissions')
    .update({ share_slug: slug })
    .eq('id', submission.id);

  if (error) throw error;

  return slug;
}

/* ---------------- Memoized Header Controls ---------------- */
type HeaderControlsProps = {
  category: Category;
  filmCategory: FilmCategory;
  setFilmCategory: (c: FilmCategory) => void;
  sort: SortKey;
  setSort: (k: SortKey) => void;
  searchText: string;
  setSearchText: (s: string) => void;
  isSearching?: boolean;
  compact?: boolean;
  layout?: 'center' | 'sidebar';
  showSearch?: boolean;
  showSort?: boolean;
  showCategory?: boolean;
};

/**
 * ✅ Updated to match the reference sidebar:
 * - Search input at top
 * - “SORT BY” title
 * - Vertical list buttons (instead of chips)
 *
 * NOTE: Layout="center" still renders a compact horizontal row for mobile/narrow.
 */
// ✅ REPLACE THE ENTIRE HeaderControls BLOCK WITH THIS


const HeaderControls = React.memo(
  ({
    category,
    filmCategory,
    setFilmCategory,
    sort,
    setSort,
    searchText,
    setSearchText,
    isSearching = false,
    compact = false,
    layout = 'center',
    showSearch = true,
    showSort = true,
    showCategory = true,
  }: HeaderControlsProps) => {
    const [focused, setFocused] = useState(false);

    const filters: { key: SortKey; label: string; sub?: string }[] = [
      { key: 'mostvoted', label: 'Top', sub: 'Most voted' },
      { key: 'newest', label: 'New', sub: 'Latest uploads' },
      { key: 'leastvoted', label: 'Rising', sub: 'Least voted' },
      { key: 'oldest', label: 'Old', sub: 'Earliest' },
    ];

    const raw = searchText ?? '';
    const q = raw.trim();

    // sizing
    const R = compact ? 8 : 14;
const padH = compact ? 8 : 14;
const padV = compact ? 2 : 10;
const inputSize = compact ? 10 : 14;

const hintFont = compact ? 8 : 12;
const hintTrack = compact ? 0.15 : 0.6;

    const isSidebar = layout === 'sidebar';

    return (
  <View
  style={{
    width: '100%',
    alignItems: isSidebar ? 'stretch' : 'center',
  }}
>
  {showSearch ? (
  <View
    style={[
      styles.sideSearchBox,
      {
        width: '100%',
        borderRadius: 999,
        borderColor: 'transparent',
        paddingHorizontal: isSidebar ? padH : 12,
        paddingVertical: isSidebar ? padV : 6,
        minHeight: isSidebar ? undefined : '100%',
height: isSidebar ? undefined : '100%',
marginBottom: 0,
justifyContent: 'center',
      },
    ]}
  >
    <TextInput
  placeholder="Search film…"
  placeholderTextColor="rgba(237,235,230,0.45)"
  value={searchText}
  onChangeText={(txt) => setSearchText(txt)}
  onFocus={() => setFocused(true)}
  onBlur={() => setFocused(false)}
  selectionColor={GOLD}
  cursorColor={GOLD}
  style={{
    flex: 1,
    color: '#EDEBE6',
    fontSize: isSidebar ? inputSize : compact ? 10 : 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: Platform.OS === 'android' ? '700' : '800',
    letterSpacing: 0.2,
    outlineStyle: 'none',
  } as any}
/>
  </View>
) : null}

        {/* Searching hint */}
        {showSearch && category === 'film' && isSearching && q.length > 0 ? (
          <View
  style={{
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: compact ? 6 : 12,
    justifyContent: isSidebar ? 'flex-start' : 'center',
  }}
>
  <ActivityIndicator size="small" color={GOLD} />
  <Text
    style={{
      marginLeft: 10,
      color: 'rgba(237,235,230,0.72)',
      fontSize: hintFont,
      fontFamily: SYSTEM_SANS,
      fontWeight: '800',
      letterSpacing: hintTrack,
      textTransform: 'uppercase',
    }}
  >
    Searching…
  </Text>
</View>
        ) : null}

        {showSort ? (
  <View
    style={[
      styles.sidePanel,
      compact && !isSidebar && { padding: 2 },
      !isSidebar && { alignItems: 'center' },
    ]}
  >

    {isSidebar ? (
      <View style={{ gap: 8 }}>
        {filters.map((f) => {
          const active = sort === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              activeOpacity={0.9}
              onPress={() => setSort(f.key)}
              style={[
                styles.sideSortItem,
                active && styles.sideSortItemActive,
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.sideSortLabel, active && { color: GOLD }]}>
                  {f.label}
                </Text>
                {!!f.sub ? <Text style={styles.sideSortSub}>{f.sub}</Text> : null}
              </View>

              <View
                style={[
                  styles.sideSortDot,
                  active && { backgroundColor: GOLD, opacity: 1 },
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </View>
    ) : (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.mobileChipRow}
      >
        {filters.map((f) => {
          const active = sort === f.key;
          return (
            <TouchableOpacity
              key={f.key}
              activeOpacity={0.9}
              onPress={() => setSort(f.key)}
              style={[
                styles.centerChip,
                styles.mobileChip,
                active && { borderColor: GOLD, backgroundColor: '#111' },
              ]}
            >
              <Text style={[styles.centerChipText, active && { color: GOLD }]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    )}
  </View>
) : null}

        {showCategory ? (
  <View
  style={[
    styles.sidePanelSeamless,
    { marginTop: compact ? 6 : 14 },
    compact && !isSidebar && { padding: 0 },
    !isSidebar && { alignItems: 'center' },
  ]}
> 

    {isSidebar ? (
      <ScrollView
        style={{ maxHeight: 360 }}
        contentContainerStyle={{ gap: 8, paddingBottom: 24 }}
        showsVerticalScrollIndicator
        nestedScrollEnabled
        onStartShouldSetResponderCapture={() => true}
        onMoveShouldSetResponderCapture={() => true}
        {...(Platform.OS === 'web'
          ? ({
              onWheel: (e: any) => e.stopPropagation(),
            } as any)
          : {})}
      >
        {FILM_CATEGORIES.map((c) => {
          const active = filmCategory === c;
          return (
            <TouchableOpacity
              key={c}
              activeOpacity={0.9}
              onPress={() => setFilmCategory(c)}
              style={[
                styles.sideSortItem,
                active && styles.sideSortItemActive,
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.sideSortLabel, active && { color: GOLD }]}>
                  {c}
                </Text>
              </View>

              <View
                style={[
                  styles.sideSortDot,
                  active && { backgroundColor: GOLD, opacity: 1 },
                ]}
              />
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    ) : (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.mobileChipRow}
      >
        {FILM_CATEGORIES.map((c) => {
          const active = filmCategory === c;
          return (
            <TouchableOpacity
              key={c}
              activeOpacity={0.9}
              onPress={() => setFilmCategory(c)}
              style={[
                styles.centerChip,
                styles.mobileChip,
                active && { borderColor: GOLD, backgroundColor: '#111' },
              ]}
            >
              <Text style={[styles.centerChipText, active && { color: GOLD }]}>
                {c}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    )}
  </View>
) : null}
      </View>
    );
  }
);

// ⬇️ PART 2 continues from here (FeaturedScreen component body, fetch logic, render functions, layout)
// FeaturedScreen.tsx — PART 2 / 3
// ✅ Includes: FeaturedScreen component (state, fetch, vote/comment, rendering, layout, preview + comments modals)
// ⛔️ PART 3 will be styles + export (and a couple of new sidebar styles used in PART 1)

const FeaturedScreen = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
const openShareSlug = route.params?.openShareSlug ?? null;
const openSubmissionId = route.params?.openSubmissionId ?? null;
  const { width: winW, height: winH } = useWindowDimensions();
  const isNarrow = winW < 480;

// web should use mobile layout too when the viewport is phone-like
const isPhoneLikeWeb = Platform.OS === 'web' && winW <= 820;

const isMobile = Platform.OS !== 'web' || isPhoneLikeWeb;
const isWideWeb = Platform.OS === 'web' && !isPhoneLikeWeb && winW >= 980;

const useTwoColumnMobile = isMobile;
const gridColumns = isWideWeb || useTwoColumnMobile ? 2 : 1;

  const category: Category = 'film';

// Category filter (matches Challenge categories)
const [filmCategory, setFilmCategory] = useState<FilmCategory>('All');
  const [loading, setLoading] = useState(true);
  const [winner, setWinner] = useState<
    | (Submission & {
        description?: string | null;
        storage_path?: string | null;
        thumbnail_url?: string | null;
        media_kind?: RawSubmission['media_kind'];
        mime_type?: string | null;
        category?: Category | null;
      })
    | null
  >(null);

  // ✅ ALL FILMS OF ALL TIME
  const [submissions, setSubmissions] = useState<
    Array<
      Submission & {
        description?: string | null;
        storage_path?: string | null;
        thumbnail_url?: string | null;
        media_kind?: RawSubmission['media_kind'];
        category?: Category | null;
      }
    >
  >([]);

  const [searchText, setSearchText] = useState('');
  const [searchQ, setSearchQ] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');

  const [isSearching, setIsSearching] = useState(false);
  const searchDebounceRef = useRef<any>(null);

  useEffect(() => {
    if (category !== 'film') return;

    const q = searchText.trim();
    if (!q) {
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => {
      setIsSearching(false);
    }, 450);

    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchText, category]);

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [voteBusy, setVoteBusy] = useState<Record<string, boolean>>({});
  const [deleteBusy, setDeleteBusy] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null);

  type CommentRow = {
  id: string;
  submission_id: string;
  user_id: string;
  comment: string;
  created_at: string;
  parent_comment_id?: string | null;
  users?: {
    id: string;
    full_name: string;
    avatar_url?: string | null;
  } | null;
};

  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentsFor, setCommentsFor] = useState<Submission | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [commentText, setCommentText] = useState('');
  const [commentPosting, setCommentPosting] = useState(false);
  const [commentCounts, setCommentCounts] = useState<Record<string, number>>({});
  const [replyingTo, setReplyingTo] = useState<CommentRow | null>(null);

  const rootComments = useMemo(
  () => comments.filter((c) => !c.parent_comment_id),
  [comments]
);

const repliesByParent = useMemo(() => {
  const map: Record<string, CommentRow[]> = {};
  for (const c of comments) {
    if (!c.parent_comment_id) continue;
    if (!map[c.parent_comment_id]) map[c.parent_comment_id] = [];
    map[c.parent_comment_id].push(c);
  }
  return map;
}, [comments]);

  // ✅ Preview modal for wide web compact cards
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewItem, setPreviewItem] = useState<
    | (Submission & {
        description?: string | null;
        storage_path?: string | null;
        thumbnail_url?: string | null;
        media_kind?: RawSubmission['media_kind'];
        category?: Category | null;
      })
    | null
  >(null);
  const [storyModeOpen, setStoryModeOpen] = useState(false);
const [storyModeItem, setStoryModeItem] = useState<
  | (Submission & {
      description?: string | null;
      storage_path?: string | null;
      thumbnail_url?: string | null;
      media_kind?: RawSubmission['media_kind'];
      category?: Category | null;
      share_slug?: string | null;
    })
  | null
>(null);

  const layoutMap = useRef(
    new Map<
      string,
      {
        y: number;
        h: number;
        playable: boolean;
      }
    >()
  );
  const lastOffsetY = useRef(0);

  const longPressTriggeredRef = useRef<Record<string, boolean>>({});
  const deepLinkHandledRef = useRef<string | null>(null);

  const { userId: gamUserId, refresh: refreshGamification } = useGamification();

  // Track monthly votes used for cap enforcement (kept, even though feed is all-time)
  const [monthlyVotesUsed, setMonthlyVotesUsed] = useState(0);
  const currentRangeRef = useRef<{ start: string; end: string } | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearchQ(searchText), 500);
    return () => clearTimeout(t);
  }, [searchText]);

  useEffect(() => {
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      allowsRecordingIOS: false,
      staysActiveInBackground: false,
      interruptionModeIOS: 1,
      shouldDuckAndroid: false,
      playThroughEarpieceAndroid: false,
    }).catch(() => {});
  }, []);

  // ✅ Page sizing — sidebar + grid on wide web
  const PAGE_PAD = Platform.OS === 'web' ? 18 : 16;
  const SIDEBAR_W = isWideWeb ? 320 : 0;
  const GUTTER = isWideWeb ? 18 : 0;

  const pageInnerW = Math.min(1400, Math.max(320, winW - PAGE_PAD * 2));
  const gridAreaW = isWideWeb ? Math.max(320, pageInnerW - SIDEBAR_W - GUTTER) : pageInnerW;

  // ✅ Hero/winner must fit INSIDE the grid area on wide web (sidebar layout)
const cardW = isWideWeb
  ? Math.min(1120, Math.max(320, gridAreaW))
  : Math.min(1120, Math.max(320, pageInnerW));

  const availableHForMedia = Math.max(280, winH - (TOP_BAR_OFFSET + BOTTOM_TAB_H + 90));

  const FIT_ASPECT = 16 / 9;

const fitContain = (maxW: number, maxH: number, aspect = FIT_ASPECT) => {
  let w = maxW;
  let h = w / aspect;
  if (h > maxH) {
    h = maxH;
    w = h * aspect;
  }
  return { w, h };
};

  // ✅ Feed dimensions (Reddit-style) – used in narrow/mobile view
  const VOTE_COL_W = isNarrow ? 58 : 64;
const FEED_INNER_PAD = isNarrow ? 12 : 14;

const mobileCardW = winW - 20;
const mobileMediaW = mobileCardW;

const contentW = Math.max(
  240,
  (isMobile ? mobileCardW : cardW) - VOTE_COL_W - FEED_INNER_PAD * 2
);

const mediaW = isWideWeb
  ? Math.min(gridAreaW, contentW, 980)
  : isMobile
  ? mobileMediaW
  : Math.min(contentW, 980);

  // ✅ Compact grid sizing (wide web)
  const GRID_GAP = 14;
const MOBILE_GRID_SIDE_PAD = 8;
const MOBILE_CARD_SHRINK = 2;

const gridCardW = isWideWeb
  ? Math.floor((gridAreaW - GRID_GAP) / 2)
  : isMobile
  ? Math.floor((winW - MOBILE_GRID_SIDE_PAD * 2 - GRID_GAP) / 2) - MOBILE_CARD_SHRINK
  : cardW;
const categoryHeaderTopOffset =
  Platform.OS === 'web'
    ? 18
    : Platform.OS === 'ios'
    ? 50
    : 25;

  // Fetch content when filters change
  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      setCurrentUserId(uid);
      await fetchContent(uid, category, searchQ);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, searchQ, filmCategory]);

  useFocusEffect(
  useCallback(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      await fetchContent(uid, category, searchQ);
    })();
  }, [sort, searchQ, filmCategory])
);

  const baseCols =
  'id, user_id, title, votes, submitted_at, is_winner, share_slug, users ( id, full_name ), video_id, storage_path, video_path, thumbnail_url, media_kind, mime_type, duration_seconds, category';

  const fetchWinnerSafe = async (id: string, desired: Category) => {
    const sel = `
      ${baseCols},
      videos:video_id ( original_path, thumbnail_path, video_variants ( path, label ) ),
      description
    `;
    let res = await supabase.from('submissions').select(sel).eq('id', id).single();

    if (res.error) {
      const sel2 = `
        ${baseCols},
        videos:video_id ( original_path, thumbnail_path, video_variants ( path, label ) ),
        word
      `;
      res = await supabase.from('submissions').select(sel2).eq('id', id).single();
    }

    if (res.error) return res;

    if (res.data && (res.data as any).category && (res.data as any).category !== desired) {
      return { data: null, error: null } as any;
    }

    if (res.data) {
      const r: any = res.data;
      const picked = pickSmallestVariant(r);
      r.storage_path = picked.path;
      r.thumbnail_url = picked.thumb;
    }

    return res;
  };

  const fetchSubsSafe = async (
  orderKey: SortKey,
  searchTextQ: string,
  cat: Category,
  filmCat: FilmCategory
) => {
    const sel = `
      ${baseCols},
      videos:video_id ( original_path, thumbnail_path, video_variants ( path, label ) ),
      description
    `;

    const addSort = (q: any) => {
      if (orderKey === 'newest') return q.order('submitted_at', { ascending: false });
      if (orderKey === 'oldest') return q.order('submitted_at', { ascending: true });
      if (orderKey === 'mostvoted') return q.order('votes', { ascending: false });
      if (orderKey === 'leastvoted') return q.order('votes', { ascending: true });
      return q;
    };

   let query: any = addSort(
  supabase.from('submissions').select(sel)
);

// Always restrict to film type
query = query.eq('category', 'film');

// ✅ Apply Film Category filter (genre)
if (filmCat && filmCat !== 'All') {
  const dbVal = (FILM_CATEGORY_DB_MAP[filmCat] ?? filmCat).trim();
query = query.ilike('film_category', `%${dbVal}%`);
}


const trimmed = searchTextQ.trim();
if (trimmed) {
  query = query.ilike('title', `%${trimmed}%`);
}

let res = await query;

if (res.error) {
  const sel2 = `
    ${baseCols},
    videos:video_id ( original_path, thumbnail_path, video_variants ( path, label ) ),
    word
  `;

  let q2: any = addSort(
    supabase.from('submissions').select(sel2)
  );

  // Always restrict to film type
  q2 = q2.eq('category', 'film');

  if (filmCat && filmCat !== 'All') {
  const dbVal = (FILM_CATEGORY_DB_MAP[filmCat] ?? filmCat).trim();
q2 = q2.ilike('film_category', `%${dbVal}%`);
}


  if (searchTextQ.trim()) {
    q2 = q2.ilike('title', `%${searchTextQ.trim()}%`);
  }

  res = await q2;

  if (res.error) {
    return { data: [], error: res.error } as any;
  }
}

const rows = (res.data ?? []) as any[];

for (const r of rows) {
  const picked = pickSmallestVariant(r);
  r.storage_path =
    r.media_kind === 'file_audio'
      ? r.storage_path ?? r.video_path ?? r?.videos?.original_path ?? null
      : picked.path;
  r.thumbnail_url = picked.thumb;
}

return res;
};

const fetchContent = async (uid: string | null, cat: Category, searchTextQ: string) => {
  setLoading(true);

  try {
    const challenges = await fetchChallengesForFeatured();

    const range = challenges.current
      ? { start: challenges.current.month_start, end: challenges.current.month_end }
      : undefined;

    currentRangeRef.current = range ?? null;

    // Winner (previous month only)
    let winnerData:
      | (Submission & {
          description?: string | null;
          storage_path?: string | null;
          thumbnail_url?: string | null;
          media_kind?: RawSubmission['media_kind'];
          mime_type?: string | null;
          category?: Category | null;
        })
      | null = null;

    if (challenges.previous?.winner_submission_id) {
      const { data: w } = await fetchWinnerSafe(challenges.previous.winner_submission_id, cat);
      winnerData = w ? normalizeRow(w as RawSubmission) : null;

      if (winnerData && winnerData.category !== cat) {
        winnerData = null;
      }

      if ((winnerData as any)?.storage_path) {
        signStoragePath((winnerData as any).storage_path!, 180).catch(() => {});
      }
    }

    // ✅ All-time submissions
    const resp = await fetchSubsSafe(sort, searchTextQ, cat, filmCategory);
    const subs = (resp?.data || []) as RawSubmission[];
    const normalized = subs.map(normalizeRow);

    fetchCommentCounts(normalized.map((s) => s.id));

    setWinner(winnerData);
    setSubmissions(normalized);

    normalized.slice(0, 10).forEach((s) => {
      if (s.storage_path) {
        signStoragePath(s.storage_path, 180).catch(() => {});
      }
    });

    if (uid && normalized.length) {
      const ids = normalized.map((s) => s.id);
      const { data: myVotes } = await supabase
        .from('user_votes')
        .select('submission_id')
        .eq('user_id', uid)
        .in('submission_id', ids);

      const votedSet = new Set<string>((myVotes || []).map((r) => r.submission_id as string));
      setVotedIds(votedSet);
    } else {
      setVotedIds(new Set());
    }

    if (uid && range) {
      const used = await countUserVotesInRange(uid, range);
      setMonthlyVotesUsed(used);
    } else {
      setMonthlyVotesUsed(0);
    }

    const firstPlayable = winnerData?.storage_path
  ? `winner-${winnerData.id}`
  : normalized.find((r) => !!r.storage_path && r.media_kind !== 'file_audio')?.id ?? null;

// Always default to last month's winner if it exists
setActiveId(firstPlayable as string | null);

    layoutMap.current.clear();
  } catch (e: any) {
    console.warn('fetchContent error:', e?.message || e);
    setWinner(null);
    setSubmissions([]);
    setVotedIds(new Set());
    setMonthlyVotesUsed(0);
  } finally {
    setLoading(false);
  }
};

const goToProfile = (user?: { id: string; full_name: string }) => {
  if (!user) return;
  navigation.navigate('Profile', {
    user: {
      id: user.id,
      full_name: user.full_name,
    },
  });
};
const openStoryModeSafely = (
  s: Submission & {
    description?: string | null;
    storage_path?: string | null;
    thumbnail_url?: string | null;
    media_kind?: RawSubmission['media_kind'];
    category?: Category | null;
    share_slug?: string | null;
  }
) => {
  if (Platform.OS === 'ios' && previewOpen) {
    setPreviewOpen(false);
    setPreviewItem(null);
    setActiveId(null);

    setTimeout(() => {
      setStoryModeItem(s);
      setStoryModeOpen(true);
    }, 250);
    return;
  }

  setStoryModeItem(s);
  setStoryModeOpen(true);
};
const openStoryMode = (
  s: Submission & {
    description?: string | null;
    storage_path?: string | null;
    thumbnail_url?: string | null;
    media_kind?: RawSubmission['media_kind'];
    category?: Category | null;
    share_slug?: string | null;
  }
) => {
  setStoryModeItem(s);
  setStoryModeOpen(true);
};

const closeStoryMode = () => {
  setStoryModeOpen(false);
  setStoryModeItem(null);
};
const shareSubmissionLink = async (
  s: Submission & {
    description?: string | null;
    storage_path?: string | null;
    thumbnail_url?: string | null;
    media_kind?: RawSubmission['media_kind'];
    category?: Category | null;
    share_slug?: string | null;
  }
) => {
  try {
    const shareSlug = await ensureSubmissionShareSlug({
      id: s.id,
      title: s.title,
      share_slug: (s as any).share_slug ?? null,
    });

    const url = buildSharedFilmUrl(shareSlug);

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
  await navigator.clipboard.writeText(url);
} else {
  await Clipboard.setStringAsync(url);
}

    setSubmissions((prev) =>
      prev.map((row) =>
        row.id === s.id ? ({ ...row, share_slug: shareSlug } as any) : row
      )
    );

    setPreviewItem((prev) =>
      prev && prev.id === s.id
        ? ({ ...prev, share_slug: shareSlug } as any)
        : prev
    );

    if (winner && winner.id === s.id) {
      setWinner((prev) =>
        prev ? ({ ...prev, share_slug: shareSlug } as any) : prev
      );
    }

    if (Platform.OS === 'web') {
      const proceed = window.confirm(
        'Link copied. Screenshot the next screen and post it to your story?'
      );
      if (proceed) {
        openStoryModeSafely({
          ...(s as any),
          share_slug: shareSlug,
        });
      }
    } else {
      Alert.alert(
        'Link ready',
        'Your watch link is ready. Do you want to open story mode for a screenshot?',
        [
          {
            text: 'Not now',
            style: 'cancel',
          },
          {
            text: 'Open story mode',
            onPress: () =>
              openStoryModeSafely({
                ...(s as any),
                share_slug: shareSlug,
              }),
          },
        ]
      );
    }
  } catch (e: any) {
    console.warn('Share failed:', e?.message || e);
    Alert.alert('Share failed', 'Could not create or share the film link.');
  }
};

  // ✅ open/close preview modal for compact cards
  const openPreview = (s: any) => {
    setPreviewItem(s);
    setPreviewOpen(true);
    setActiveId(`preview-${s.id}`);
  };

  const closePreview = async () => {
    setPreviewOpen(false);
    setPreviewItem(null);
    setActiveId(null);
    await pauseAllExcept(PAUSE_NONE_ID);
  };

  const openComments = async (s: Submission) => {
  setCommentsFor(s);
  setCommentsOpen(true);
  setCommentText('');
  setReplyingTo(null);
  await fetchComments(s.id);
};

  const closeComments = () => {
  setCommentsOpen(false);
  setCommentsFor(null);
  setComments([]);
  setCommentText('');
  setReplyingTo(null);
};

  const fetchCommentCounts = async (submissionIds: string[]) => {
    if (!submissionIds.length) return;

    try {
      const results = await Promise.all(
        submissionIds.map(async (id) => {
          const { count, error } = await supabase
            .from('submission_comments')
            .select('id', { count: 'exact', head: true })
            .eq('submission_id', id);

          if (error) return [id, 0] as const;
          return [id, count ?? 0] as const;
        })
      );

      setCommentCounts((prev) => {
        const next = { ...prev };
        for (const [id, c] of results) next[id] = c;
        return next;
      });
    } catch (e) {
      console.warn('fetchCommentCounts error:', e);
    }
  };

  const fetchComments = async (submissionId: string) => {
    setCommentsLoading(true);
    try {
      let { data, error } = await supabase
  .from('submission_comments')
  .select(
    `
    id,
    submission_id,
    user_id,
    comment,
    created_at,
    parent_comment_id,
    users:user_id ( id, full_name, avatar_url )
  `
  )
  .eq('submission_id', submissionId)
  .order('created_at', { ascending: false });

if (error) {
  const fallback = await supabase
    .from('submission_comments')
    .select(
      `
      id,
      submission_id,
      user_id,
      comment,
      created_at,
      users:user_id ( id, full_name, avatar_url )
    `
    )
    .eq('submission_id', submissionId)
    .order('created_at', { ascending: false });

  data = fallback.data as any;
  error = fallback.error;
}

      if (error) throw error;
      setComments((data as any) || []);
      setCommentCounts((prev) => ({
        ...prev,
        [submissionId]: (data as any)?.length ?? 0,
      }));
    } catch (e: any) {
      console.warn('fetchComments error:', e?.message || e);
      setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  };

  const postComment = async () => {
    const uid = currentUserId || gamUserId || null;
    if (!uid || !commentsFor) {
      Alert.alert('Please sign in', 'You need to be signed in to comment.');
      return;
    }

    const text = commentText.trim();
    if (!text) return;

    if (commentPosting) return;
    setCommentPosting(true);

    try {
      let { error } = await supabase.from('submission_comments').insert([
  {
    submission_id: commentsFor.id,
    user_id: uid,
    comment: text,
    parent_comment_id: replyingTo?.id ?? null,
  },
]);

if (error) {
  const fallback = await supabase.from('submission_comments').insert([
    {
      submission_id: commentsFor.id,
      user_id: uid,
      comment: text,
    },
  ]);

  error = fallback.error;
}

      if (error) throw error;

      setCommentCounts((prev) => ({
        ...prev,
        [commentsFor.id]: (prev[commentsFor.id] ?? 0) + 1,
      }));

      setCommentText('');
setReplyingTo(null);
await fetchComments(commentsFor.id);
    } catch (e: any) {
      console.warn('postComment error:', e?.message || e);
      Alert.alert('Comment failed', 'Please try again.');
    } finally {
      setCommentPosting(false);
    }
  };

  const toggleVote = async (s: Submission & { description?: string | null }) => {
    const uid = currentUserId || gamUserId || null;

    if (!uid) {
      Alert.alert('Please sign in', 'You need to be signed in to vote.');
      return;
    }

    const creatorId = (s as any).user_id as string | undefined;
    if (creatorId && creatorId === uid) {
      return;
    }
    if (voteBusy[s.id]) return;

    const alreadyVoted = votedIds.has(s.id);

    if (!alreadyVoted) {
      const range = currentRangeRef.current;
      if (range) {
        if (monthlyVotesUsed >= VOTES_PER_MONTH) {
          Alert.alert('No votes left', 'You’ve used all your votes for this month.');
          return;
        }
      }
    }

    setVoteBusy((prev) => ({ ...prev, [s.id]: true }));

    try {
      if (alreadyVoted) {
        const { error } = await supabase
          .from('user_votes')
          .delete()
          .eq('user_id', uid)
          .eq('submission_id', s.id);
        if (error) throw error;

        setVotedIds((prev) => {
          const next = new Set(prev);
          next.delete(s.id);
          return next;
        });

        setSubmissions((prev) =>
  prev.map((row) =>
    row.id === s.id ? { ...row, votes: Math.max(0, (row.votes || 0) - 1) } : row
  )
);

setPreviewItem((prev) =>
  prev && prev.id === s.id
    ? { ...prev, votes: Math.max(0, (prev.votes || 0) - 1) }
    : prev
);

        setMonthlyVotesUsed((n) => Math.max(0, n - 1));
      } else {
        const { error } = await supabase.from('user_votes').insert([
          {
            submission_id: s.id,
            user_id: uid,
          },
        ]);
        if (error) throw error;

        setVotedIds((prev) => {
          const next = new Set(prev);
          next.add(s.id);
          return next;
        });

        setSubmissions((prev) =>
  prev.map((row) => (row.id === s.id ? { ...row, votes: (row.votes || 0) + 1 } : row))
);

setPreviewItem((prev) =>
  prev && prev.id === s.id
    ? { ...prev, votes: (prev.votes || 0) + 1 }
    : prev
);

        setMonthlyVotesUsed((n) => n + 1);

        try {
          await giveXp(uid, VOTE_XP, 'VOTE_SUBMISSION' as any);
          await refreshGamification();
        } catch (xpErr) {
          console.warn('giveXp VOTE_SUBMISSION failed:', xpErr);
        }
      }
    } catch (e: any) {
      console.warn('Vote error:', e?.message || e);
      Alert.alert('Vote failed', 'Please try again.');
    } finally {
      setVoteBusy((prev) => ({ ...prev, [s.id]: false }));
    }
  };

  // Ensure only the chosen activeId plays.
// If nothing is active, immediately resume last month's winner if it exists.
useEffect(() => {
  (async () => {
    const fallbackWinnerId = winner?.storage_path ? `winner-${winner.id}` : null;
    const targetId = activeId || fallbackWinnerId || PAUSE_NONE_ID;
    await pauseAllExcept(targetId);
  })();
}, [activeId, winner]);
useEffect(() => {
  if (loading) return;
  if (!submissions.length && !winner) return;

  const deepLinkKey = openSubmissionId || openShareSlug || null;
  if (!deepLinkKey) return;

  if (deepLinkHandledRef.current === deepLinkKey) return;

  let target:
    | (Submission & {
        description?: string | null;
        storage_path?: string | null;
        thumbnail_url?: string | null;
        media_kind?: RawSubmission['media_kind'];
        category?: Category | null;
      })
    | null = null;

  if (openSubmissionId) {
    if (winner?.id === openSubmissionId) {
      target = winner as any;
    } else {
      target = submissions.find((s) => s.id === openSubmissionId) || null;
    }
  } else if (openShareSlug) {
    if ((winner as any)?.share_slug === openShareSlug) {
      target = winner as any;
    } else {
      target =
        submissions.find((s: any) => (s as any).share_slug === openShareSlug) || null;
    }
  }

  if (target) {
    deepLinkHandledRef.current = deepLinkKey;

    openPreview(target as any);

    navigation.setParams?.({
      openSubmissionId: undefined,
      openShareSlug: undefined,
    });
  }
}, [loading, submissions, winner, openSubmissionId, openShareSlug, navigation]);

  const onItemLayout = (id: string, playable: boolean) => (e: LayoutChangeEvent) => {
  const { y, height } = e.nativeEvent.layout;
  layoutMap.current.set(id, { y, h: height, playable });
};

// Keep scroll handlers passive.
// Scrolling should never change which video is active.
const onScrollImmediate = useRef((e: NativeSyntheticEvent<NativeScrollEvent>) => {
  lastOffsetY.current = e.nativeEvent.contentOffset.y;
}).current;

const onMomentumEnd = useRef(() => {}).current;

const onRemoveSubmission = async (s: Submission & { description?: string | null }) => {
  const prevSubs = submissions;
  setSubmissions((p) => p.filter((row) => row.id !== s.id));
  if (winner && winner.id === s.id) {
    setWinner(null);
  }

  try {
    await supabase.from('user_votes').delete().eq('submission_id', s.id);

    const { error } = await supabase
      .from('submissions')
      .delete()
      .eq('id', s.id)
      .eq('user_id', currentUserId as string);

    if (error) throw error;

    if (Platform.OS !== 'web') {
      Alert.alert('Removed', 'Your submission has been removed.');
    }
  } catch (e: any) {
    console.warn('Remove error:', e?.message || e);
    setSubmissions(prevSubs);
    Alert.alert('Remove failed', 'Please try again.');
  }
};

const renderMedia = (
  rowId: string,
  s: Submission & {
    description?: string | null;
    storage_path?: string | null;
    thumbnail_url?: string | null;
    media_kind?: RawSubmission['media_kind'];
  },
  isActive: boolean,
  isWinnerRow: boolean
) => {
  // ✅ Fix 1: avoid stale `activeId` closure on web hover leave
  const isWinnerPlayer = rowId.startsWith('winner-');

const webHoverProps =
  Platform.OS === 'web'
    ? {
        onMouseEnter: () => setActiveId(rowId),
        onMouseLeave: () => {
          // Winner should keep playing when mouse leaves it
          if (isWinnerPlayer) return;

          setActiveId((prev) => {
            if (prev === rowId) {
              pauseAllExcept(PAUSE_NONE_ID);
              return null;
            }
            return prev;
          });
        },
      }
    : {};

  // ✅ Fix 2: contain 16:9 inside the available box (prevents web stretch/crop)
  const mobileWinnerMaxH = winH * 0.28;
const mobileFeedMaxH = winH * 0.24;

const effectiveMaxH = isMobile
  ? isWinnerRow
    ? Math.max(220, mobileWinnerMaxH)
    : Math.max(190, mobileFeedMaxH)
  : availableHForMedia;

const fitted = fitContain(mediaW, effectiveMaxH, 16 / 9);
const frameW = fitted.w;
const frameH = fitted.h;

  if (!s.storage_path) {
    return (
      <View
        {...(webHoverProps as any)}
        style={[
  styles.videoOuter,
  isWinnerRow && styles.videoOuterHeroFlat,
  {
    width: frameW,
    maxWidth: mediaW,
    height: frameH,
    maxHeight: availableHForMedia,
  },
]}
      >
        <View style={styles.aspectFill}>
          <Image
            source={{ uri: 'https://picsum.photos/1600/900' }}
            style={{ width: '100%', height: '100%', borderRadius: RADIUS_XL }}
            resizeMode="contain"
          />
        </View>
      </View>
    );
  }

  if (s.media_kind === 'file_audio') {
    return (
      <View
        {...(webHoverProps as any)}
        style={[
          styles.videoOuter,
          {
            width: mediaW,
            maxWidth: mediaW,
            backgroundColor: T.card,
            maxHeight: availableHForMedia,
          },
        ]}
      >
        <View style={{ width: '100%', padding: 12 }}>
          <HostedAudioInline playerId={rowId} storagePath={s.storage_path} autoPlay={isActive} />
        </View>
      </View>
    );
  }

  return (
    <View
      {...(webHoverProps as any)}
      style={[
  styles.videoOuter,
  isWinnerRow && styles.videoOuterHeroFlat,
  {
    width: frameW,
    maxWidth: mediaW,
    height: frameH,
    maxHeight: availableHForMedia,
  },
]}
    >
      <HostedVideoInline
  playerId={rowId}
  storagePath={s.storage_path!}
  width={frameW}
  maxHeight={frameH}
  autoPlay={isActive}
  posterUri={s.thumbnail_url ?? null}
  dimVignette={isWinnerRow}
  showControls={false}
  showProgress={!isWinnerRow}
/>
    </View>
  );
};

const renderHeroOverlay = (s: Submission & { users?: { id: string; full_name: string } }) => {
  const name = (s as any)?.users?.full_name;
  const userObj = (s as any)?.users;

    const isCompactHero = winW < 520;
  const isTinyHero = winW < 380;

  const heroKickerSize = isCompactHero ? 9 : 14;
const heroTitleSize = isTinyHero ? 18 : isCompactHero ? 22 : isWideWeb ? 40 : 52;
const heroTitleLine = isTinyHero ? 22 : isCompactHero ? 26 : isWideWeb ? 44 : 58;
const heroBylineSize = isTinyHero ? 10 : isCompactHero ? 11 : 16;

  return (
    <View style={styles.heroOverlay} pointerEvents="box-none">
      <View style={styles.heroOverlayInner} pointerEvents="none">
        <Text
  style={[
    styles.heroKicker,
    {
      fontSize: heroKickerSize,
      marginBottom: isCompactHero ? 3 : 6,
      letterSpacing: isCompactHero ? 0.45 : 0.8,
    },
  ]}
>
  LAST MONTH’S WINNER
</Text>
                <Text
          style={[
            styles.heroTitle,
            {
              fontSize: heroTitleSize,
              lineHeight: heroTitleLine,
              maxWidth: '100%', // ✅ deterministic, prevents edge clipping
              letterSpacing: isCompactHero ? 0.3 : 0.9,
paddingBottom: 2,
            },
          ]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {s.title}
        </Text>
      </View>
      {name ? (
        <TouchableOpacity
          onPress={() => goToProfile(userObj)}
          activeOpacity={0.9}
          style={styles.heroBylineTap}
        >
          <Text
            style={[
              styles.heroByline,
              {
                fontSize: heroBylineSize,
                marginTop: isCompactHero ? 2 : 4,
              },
            ]}
          >
            by {name}
          </Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
};

// ✅ Reddit-style vote column (kept for narrow/mobile layout)
const renderVoteColumn = (s: Submission & { description?: string | null }) => {
  const mine = !!currentUserId && (s as any).user_id === currentUserId;
  const voted = votedIds.has(s.id);
  const count = s.votes ?? 0;
  const busy = !!voteBusy?.[s.id];
  const disabled = busy || mine;

  return (
    <View style={[styles.voteCol, { width: VOTE_COL_W }]}>
      <TouchableOpacity
        activeOpacity={0.9}
        disabled={disabled}
        onPress={() => {
          if (!mine) toggleVote(s);
        }}
        style={styles.voteTap}
      >
        <VoteArrow up active={voted} disabled={disabled} />
      </TouchableOpacity>

      <Text style={[styles.voteCountText, voted && { color: T.accent }]}>{busy ? '…' : count}</Text>

      <TouchableOpacity activeOpacity={0.9} onPress={() => openComments(s)} style={styles.voteTap}>
        <View style={styles.commentDot} />
        <Text style={styles.commentMini}>{commentCounts?.[s.id] ?? 0}</Text>
      </TouchableOpacity>

      {mine ? <Text style={styles.mineMini}>Yours</Text> : null}
    </View>
  );
};

// ✅ compact grid card (wide-web / mobile grid)
const renderCompactGridCard = useCallback(
  (
    s: Submission & {
      description?: string | null;
      storage_path?: string | null;
      thumbnail_url?: string | null;
      media_kind?: RawSubmission['media_kind'];
      category?: Category | null;
    }
  ) => {
    const thumb = s.thumbnail_url || 'https://picsum.photos/600/340';
    const playerId = `grid-${s.id}`;
    const isActiveCard = activeId === playerId;

    return (
      <Pressable
  onPress={() => {
    if (longPressTriggeredRef.current[s.id]) {
      longPressTriggeredRef.current[s.id] = false;
      return;
    }

    if (Platform.OS !== 'web' && activeId === playerId) {
      setActiveId(null);
      return;
    }

    openPreview(s);
  }}
  onLongPress={() => {
    if (Platform.OS !== 'web' && s.storage_path) {
      longPressTriggeredRef.current[s.id] = true;
      setActiveId(playerId);
    }
  }}
  delayLongPress={140}
  onPressOut={() => {
    if (Platform.OS !== 'web') {
      setTimeout(() => {
        longPressTriggeredRef.current[s.id] = false;
      }, 120);
    }
  }}
  style={[styles.gridCard, { width: gridCardW }]}
  {...(Platform.OS === 'web'
    ? {
        onHoverIn: () => {
          if (s.storage_path) setActiveId(playerId);
        },
        onHoverOut: () => {
          setActiveId((prev) => (prev === playerId ? null : prev));
        },
      }
    : {})}
>
        <View style={styles.gridThumbWrap}>
          {/* Base thumbnail always visible */}
          <Image source={{ uri: thumb }} style={styles.gridThumb} resizeMode="cover" />

          {/* Only mount video while hovered / holding */}
          {s.storage_path && isActiveCard ? (
            <View style={StyleSheet.absoluteFillObject}>
              <HostedVideoInline
                playerId={playerId}
                storagePath={s.storage_path}
                width={gridCardW}
                maxHeight={gridCardW / (16 / 9)}
                autoPlay={true}
                posterUri={s.thumbnail_url ?? null}
                dimVignette={false}
                showControls={false}
                captureSurfacePress={false}
              />
            </View>
          ) : null}

          <View style={styles.gridThumbOverlay} pointerEvents="none" />

          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.28)', 'rgba(0,0,0,0.88)']}
            start={{ x: 0.5, y: 0.1 }}
            end={{ x: 0.5, y: 1 }}
            style={styles.gridOverlay}
            pointerEvents="none"
          />

          <View style={styles.gridOverlayTextWrap}>
            <Text style={styles.gridOverlayTitle} numberOfLines={2}>
              {s.title}
            </Text>

            {s.users?.full_name ? (
              <Text style={styles.gridOverlayByline} numberOfLines={1}>
                {s.users.full_name}
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  },
  [gridCardW, activeId]
);
const renderMobileYouTubeCard = useCallback(
  (
    s: Submission & {
      description?: string | null;
      storage_path?: string | null;
      thumbnail_url?: string | null;
      media_kind?: RawSubmission['media_kind'];
      category?: Category | null;
    }
  ) => {
    const mine = !!currentUserId && (s as any).user_id === currentUserId;
    const voted = votedIds.has(s.id);
    const busy = !!voteBusy?.[s.id];
    const rowId = s.id;

    return (
      <View key={rowId} style={[styles.mobileFeedCard, { width: mobileCardW }]}>
        <View style={styles.mobileMediaWrap}>
          {renderMedia(rowId, s, activeId === rowId, false)}
        </View>

        <View style={styles.mobileMetaWrap}>
          <Text style={styles.mobileTitle} numberOfLines={2}>
            {s.title}
          </Text>

          {s.users?.full_name ? (
            <TouchableOpacity onPress={() => goToProfile(s.users)} activeOpacity={0.9}>
              <Text style={styles.mobileByline} numberOfLines={1}>
                {s.users.full_name}
              </Text>
            </TouchableOpacity>
          ) : null}

          {!!s.description ? (
            <Text style={styles.mobileDescription} numberOfLines={2}>
              {s.description}
            </Text>
          ) : null}

          <View style={styles.mobileActionRow}>
            <TouchableOpacity
              activeOpacity={0.9}
              disabled={busy || mine}
              onPress={() => {
                if (!mine) toggleVote(s);
              }}
              style={[styles.mobilePill, (busy || mine) && { opacity: 0.5 }]}
            >
              <Text style={[styles.mobilePillText, voted && { color: GOLD }]}>
                {busy ? '…' : `Votes ${s.votes ?? 0}`}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => openComments(s)}
              style={styles.mobilePillGhost}
            >
              <Text style={styles.mobilePillGhostText}>
                Comments {commentCounts[s.id] ?? 0}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
  activeOpacity={0.9}
  onPress={() => {
    shareSubmissionLink(s as any);
  }}
  style={styles.mobilePillGhost}
>
  <Text style={styles.mobilePillGhostText}>Share</Text>
</TouchableOpacity>

            {mine ? (
              <TouchableOpacity
                style={[
                  styles.mobilePillGhost,
                  (deleteBusy[s.id] || (s as any).is_winner) && { opacity: 0.5 },
                ]}
                disabled={!!deleteBusy[s.id] || (s as any).is_winner}
                onPress={() => {
                  const doRemove = () => onRemoveSubmission(s as any);
                  if (Platform.OS === 'web') {
                    const ok =
                      typeof window !== 'undefined' &&
                      window.confirm('Remove submission? This will remove it and its votes.');
                    if (ok) doRemove();
                  } else {
                    Alert.alert('Remove submission?', 'This will remove it and its votes.', [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Remove', style: 'destructive', onPress: doRemove },
                    ]);
                  }
                }}
                activeOpacity={0.9}
              >
                <Text style={styles.mobilePillGhostText}>
                  {(s as any).is_winner ? 'Winner locked' : deleteBusy[s.id] ? 'Removing…' : 'Remove'}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    );
  },
  [activeId, currentUserId, votedIds, voteBusy, deleteBusy, commentCounts, mobileCardW]
);

// ✅ Existing full card (kept)
const renderCard = useCallback(
  (
    rowId: string,
    s: Submission & {
      description?: string | null;
      storage_path?: string | null;
      thumbnail_url?: string | null;
      media_kind?: RawSubmission['media_kind'];
      category?: Category | null;
    },
    isActive: boolean,
    isWinnerRow: boolean = false
  ) => {
    const isPlayableVideo = !!s.storage_path && s.media_kind !== 'file_audio';

    return (
      <View
        key={rowId}
        onLayout={onItemLayout(rowId, isPlayableVideo)}
        style={[styles.cardWrapper, isWinnerRow && styles.cardWrapperHero]}
      >
        <LinearGradient
          colors={isWinnerRow ? [T.heroBurgundy1, T.heroBurgundy2] : ['#0D0D0D', '#050505']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.cardBorder, { alignSelf: 'center' }]}
        >
          <View style={[styles.card, isWinnerRow && styles.cardHero, isWinnerRow && styles.cardHeroFlat]}>
            {isWinnerRow ? (
              <>
                <View
                  style={[
                    styles.heroRow,
                    {
                      width: cardW,
                      maxWidth: cardW,
                      maxHeight: availableHForMedia,
                      alignSelf: 'center',
                    },
                  ]}
                >
                  {renderMedia(rowId, s, isActive, true)}
                  <LinearGradient
                    colors={['rgba(0,0,0,0.0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.80)']}
                    start={{ x: 0.2, y: 0.2 }}
                    end={{ x: 0.8, y: 1 }}
                    style={[StyleSheet.absoluteFillObject, { borderRadius: RADIUS_XL }]}
                    pointerEvents="none"
                  />
                  <Grain opacity={0.05} />
                  {renderHeroOverlay(s)}
                </View>

                
              </>
            ) : (
              <>
                <View style={[styles.feedRow, { width: cardW, paddingHorizontal: FEED_INNER_PAD }]}>
                  {renderVoteColumn(s)}

                  <View style={[styles.feedBody, { width: cardW - VOTE_COL_W - FEED_INNER_PAD * 2 }]}>
                    <View style={styles.feedHeader}>
                      <Text style={styles.feedTitle} numberOfLines={2}>
                        {s.title}
                      </Text>

                      {s.users?.full_name ? (
                        <TouchableOpacity onPress={() => goToProfile(s.users)} activeOpacity={0.9}>
                          <Text style={styles.feedByline}>by {s.users.full_name}</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>

                    <View style={{ marginTop: 10 }}>
                      {renderMedia(rowId, s, isActive, false)}
                      <Grain opacity={0.05} />
                    </View>

                    {!!s.description && <Text style={styles.feedDescription}>{s.description}</Text>}

                    <View style={styles.feedActionsRow}>
                      <TouchableOpacity
                        onPress={() => openComments(s)}
                        activeOpacity={0.9}
                        style={styles.feedActionBtn}
                      >
                        <Text style={styles.feedActionText}>COMMENTS ({commentCounts[s.id] ?? 0})</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
  onPress={() => {
  shareSubmissionLink(s as any);
}}
  activeOpacity={0.9}
  style={styles.feedActionBtnGhost}
>
  <Text style={styles.feedActionGhostText}>Share</Text>
</TouchableOpacity>

                      {currentUserId && (s as any).user_id === currentUserId ? (
                        <TouchableOpacity
                          style={[
                            styles.feedActionBtnGhost,
                            (deleteBusy[s.id] || (s as any).is_winner) && { opacity: 0.5 },
                          ]}
                          disabled={!!deleteBusy[s.id] || (s as any).is_winner}
                          onPress={() => {
                            const doRemove = () => onRemoveSubmission(s as any);
                            if (Platform.OS === 'web') {
                              const ok =
                                typeof window !== 'undefined' &&
                                window.confirm('Remove submission? This will remove it and its votes.');
                              if (ok) doRemove();
                            } else {
                              Alert.alert('Remove submission?', 'This will remove it and its votes.', [
                                { text: 'Cancel', style: 'cancel' },
                                { text: 'Remove', style: 'destructive', onPress: doRemove },
                              ]);
                            }
                          }}
                          activeOpacity={0.9}
                        >
                          <Text style={styles.feedActionGhostText}>
                            {(s as any).is_winner
                              ? 'Winner (locked)'
                              : deleteBusy[s.id]
                              ? 'Removing…'
                              : 'Remove'}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                </View>
              </>
            )}
          </View>
        </LinearGradient>
      </View>
    );
  },
  [
    cardW,
    votedIds,
    voteBusy,
    deleteBusy,
    currentUserId,
    availableHForMedia,
    commentCounts,
    activeId,
    isNarrow,
    mediaW,
  ]
);

const headerElement = useMemo(
  () => (
    <View style={{ alignItems: 'center' }}>
      {winner
  ? renderCard(
      `winner-${winner.id}`,
      winner,
      activeId === `winner-${winner.id}` || !activeId,
      true
    )
  : null}
      <View style={{ height: isNarrow ? 12 : 12 }} />
    </View>
  ),
  [winner, activeId, isNarrow, cardW, availableHForMedia]
);

const sidebarElement = useMemo(() => {
  if (!isWideWeb) return null;

  const maxH = winH - (TOP_BAR_OFFSET + BOTTOM_TAB_H + 24);

  return (
    <View style={[styles.sidebar, { width: 320, maxHeight: maxH, overflow: 'hidden' as any }]}>
      <ScrollView
        showsVerticalScrollIndicator
        contentContainerStyle={{ paddingBottom: 18 }}
        nestedScrollEnabled
        onStartShouldSetResponderCapture={() => true}
        onMoveShouldSetResponderCapture={() => true}
        {...(Platform.OS === 'web'
          ? ({
              // keep wheel scrolling INSIDE sidebar
              onWheel: (e: any) => e.stopPropagation(),
            } as any)
          : {})}
      >
        <HeaderControls
          compact={false}
          category={category}
          filmCategory={filmCategory}
          setFilmCategory={setFilmCategory}
          sort={sort}
          setSort={setSort}
          searchText={searchText}
          setSearchText={setSearchText}
          isSearching={isSearching}
          layout="sidebar"
        />
      </ScrollView>
    </View>
  );
}, [isWideWeb, category, sort, searchText, isSearching, filmCategory, winH]);

const renderSubmissionItem = ({ item }: any) => {
  if (isWideWeb || isMobile) return renderCompactGridCard(item);
  return renderCard(item.id, item, activeId === item.id, false);
};

const keyForList = isWideWeb
  ? `grid-${searchQ}-${sort}-${filmCategory}`
  : `feed-${searchQ}-${sort}-${filmCategory}`;

return (
  <View style={styles.container}>
    <LinearGradient
      colors={[T.heroBurgundy1, T.heroBurgundy2, T.bg]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 0.75 }}
      style={StyleSheet.absoluteFillObject}
    />
    <Grain opacity={0.05} />

    {loading && submissions.length === 0 ? (
      <ActivityIndicator style={{ marginTop: CONTENT_TOP_PAD + 8 }} color={T.accent} />
    ) : (
      <View style={{ flex: 1, paddingHorizontal: Platform.OS === 'web' ? 18 : 0 }}>
        {isWideWeb ? (
          <View style={[styles.wideLayout, { maxWidth: 1400, alignSelf: 'center' }]}>
            {sidebarElement}

            <View style={[styles.gridArea, { flex: 1 }]}>
              <FlatList
  key={keyForList}
  data={submissions}
  renderItem={renderSubmissionItem}
  keyExtractor={(item: any) => item.id}
  ListHeaderComponent={headerElement}
  numColumns={2}
  columnWrapperStyle={{ justifyContent: 'space-between' }}
  contentContainerStyle={[
    styles.listContentWide,
    {
      paddingTop: CONTENT_TOP_PAD,
      paddingBottom: BOTTOM_TAB_H + 18,
    },
  ]}
  showsVerticalScrollIndicator={false}
  keyboardShouldPersistTaps="always"
  onScroll={onScrollImmediate}
  onMomentumScrollEnd={onMomentumEnd}
  scrollEventThrottle={16}
/>
            </View>
          </View>
        ) : (
          <FlatList
  key={keyForList}
  data={submissions}
  renderItem={renderSubmissionItem}
  keyExtractor={(item: any) => item.id}
  ListHeaderComponent={
  <View style={{ alignItems: 'center' }}>
    {/* CATEGORY ONLY — above winner */}
    <View
  style={[
    styles.subHeaderWrap,
    {
      width: isMobile ? winW - 20 : cardW,
      marginTop: categoryHeaderTopOffset,
      alignSelf: 'center',
    },
  ]}
>
      <HeaderControls
        compact={isNarrow}
        category={category}
        filmCategory={filmCategory}
        setFilmCategory={setFilmCategory}
        sort={sort}
        setSort={setSort}
        searchText={searchText}
        setSearchText={setSearchText}
        isSearching={isSearching}
        layout="center"
        showCategory={true}
        showSearch={false}
        showSort={false}
      />
    </View>

    <View style={{ height: 2 }} />

    {/* WINNER */}
    {headerElement}

    {/* SEARCH + SORT ONLY — below winner */}
    <View
      style={[
        styles.subHeaderWrap,
        {
          width: isMobile ? winW - 24 : 360,
          marginTop: -25,
          alignSelf: 'center',
        },
      ]}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          width: '100%',
          gap: 6,
        }}
      >
        <View style={{ flex: 1, height: 52 }}>
          <HeaderControls
            compact={true}
            category={category}
            filmCategory={filmCategory}
            setFilmCategory={setFilmCategory}
            sort={sort}
            setSort={setSort}
            searchText={searchText}
            setSearchText={setSearchText}
            isSearching={isSearching}
            layout="center"
            showCategory={false}
            showSearch={true}
            showSort={false}
          />
        </View>

        <View style={{ flex: 1, height: 52 }}>
          <HeaderControls
            compact={true}
            category={category}
            filmCategory={filmCategory}
            setFilmCategory={setFilmCategory}
            sort={sort}
            setSort={setSort}
            searchText={searchText}
            setSearchText={setSearchText}
            isSearching={isSearching}
            layout="center"
            showCategory={false}
            showSearch={false}
            showSort={true}
          />
        </View>
      </View>
    </View>

    <View style={{ height: 2 }} />
  </View>
}
  numColumns={gridColumns}
  columnWrapperStyle={
  gridColumns > 1
    ? {
        justifyContent: 'space-between',
        paddingHorizontal: 8,
        marginBottom: 18,
      }
    : undefined
}
  contentContainerStyle={[
  styles.listContent,
  {
    paddingTop: CONTENT_TOP_PAD + 10,
    paddingBottom: BOTTOM_TAB_H + 8,
  },
]}
  showsVerticalScrollIndicator={false}
  keyboardShouldPersistTaps="always"
  keyboardDismissMode="none"
  removeClippedSubviews={Platform.OS !== 'web'}
  windowSize={5}
  initialNumToRender={3}
  maxToRenderPerBatch={4}
    onEndReachedThreshold={0.4}
  onScroll={onScrollImmediate}
  onMomentumScrollEnd={onMomentumEnd}
  scrollEventThrottle={16}
/>
        )}
      </View>
    )}

    {storyModeOpen && storyModeItem && (
  <Modal
  visible
  transparent
  animationType="fade"
  presentationStyle="overFullScreen"
  onRequestClose={closeStoryMode}
>
    <View style={styles.storyOverlay}>
      <View style={styles.storyCard}>
  <View style={styles.storyPoster}>
    <TouchableOpacity
      onPress={closeStoryMode}
      activeOpacity={0.9}
      style={styles.storyCloseBtnFloating}
    >
      <Text style={styles.storyCloseText}>×</Text>
    </TouchableOpacity>
  <Image
    source={{
      uri:
        storyModeItem.thumbnail_url || 'https://picsum.photos/900/1600',
    }}
    style={styles.storyPosterImage}
    resizeMode="contain"
  />

  <View style={styles.storyCenterPanel} />

  <LinearGradient
  colors={['rgba(0,0,0,0.04)', 'rgba(0,0,0,0.10)', 'rgba(0,0,0,0.28)']}
  start={{ x: 0.5, y: 0 }}
  end={{ x: 0.5, y: 1 }}
  style={StyleSheet.absoluteFillObject}
/>
<LinearGradient
  colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.0)', 'rgba(0,0,0,0.72)']}
  start={{ x: 0.5, y: 0.45 }}
  end={{ x: 0.5, y: 1 }}
  style={styles.storyBottomFade}
/>

          <View style={styles.storyBrandTop}>
            <Text style={styles.storyBrandText}>OVERLOOKED</Text>
          </View>

          <View style={styles.storyContent}>
            <Text style={styles.storyTitle} numberOfLines={3}>
              {storyModeItem.title || 'Untitled Film'}
            </Text>

            {storyModeItem.users?.full_name ? (
              <Text style={styles.storyByline} numberOfLines={1}>
                by {storyModeItem.users.full_name}
              </Text>
            ) : null}

            {!!(storyModeItem as any).film_category ? (
              <Text style={styles.storyMeta}>
                {(storyModeItem as any).film_category}
              </Text>
            ) : null}

            {!!(storyModeItem as any).share_slug ? (
              <Text style={styles.storyLink} numberOfLines={1}>
                {buildSharedFilmUrl((storyModeItem as any).share_slug)}
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  </Modal>
)}

    {/* ✅ Preview modal (wide web): full player + actions */}
    {previewOpen && previewItem && (
  <Modal visible transparent animationType="fade" onRequestClose={closePreview}>
    <View style={styles.previewOverlay}>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={closePreview} />

      <View style={styles.previewCard}>
        <View style={styles.previewHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.previewTitle} numberOfLines={2}>
              {previewItem.title}
            </Text>

            {previewItem.users?.full_name ? (
              <TouchableOpacity
                onPress={() => goToProfile(previewItem.users)}
                activeOpacity={0.85}
              >
                <Text style={styles.previewByline}>{previewItem.users.full_name}</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <TouchableOpacity
            onPress={closePreview}
            activeOpacity={0.9}
            style={styles.previewCloseBtn}
          >
            <Text style={styles.previewCloseText}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14 }}>
          {previewItem.storage_path ? (
            <HostedVideoInline
  playerId={`preview-${previewItem.id}`}
  storagePath={previewItem.storage_path}
  width={Math.min(winW - 40, 760)}
  maxHeight={Math.min(winH * 0.34, 300)}
  autoPlay={activeId === `preview-${previewItem.id}`}
  posterUri={previewItem.thumbnail_url ?? null}
  dimVignette={false}
  showControls={true}
  captureSurfacePress={true}
  surfacePressMode="toggle"
/>
          ) : (
            <View style={{ height: 220, borderRadius: 14, backgroundColor: '#000' }} />
          )}

          <View style={styles.previewActions}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => toggleVote(previewItem)}
              disabled={
                !!voteBusy[previewItem.id] ||
                (!!currentUserId && (previewItem as any).user_id === currentUserId)
              }
              style={[
                styles.previewActionPill,
                (voteBusy[previewItem.id] ||
                  (!!currentUserId && (previewItem as any).user_id === currentUserId)) && {
                  opacity: 0.55,
                },
              ]}
            >
              <Text style={styles.previewActionText}>
                {votedIds.has(previewItem.id) ? 'Voted' : 'Vote'} ({previewItem.votes ?? 0})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
  activeOpacity={0.9}
  onPress={() => {
    shareSubmissionLink(previewItem as any);
  }}
  style={styles.previewActionPillGhost}
>
  <Text style={styles.previewActionTextGhost}>Share</Text>
</TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => openComments(previewItem)}
              style={styles.previewActionPillGhost}
            >
              <Text style={styles.previewActionTextGhost}>
                Comments ({commentCounts[previewItem.id] ?? 0})
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  </Modal>
)}
    {/* ---------------- Comments Modal (kept) ---------------- */}
    {commentsOpen && (
  <Modal visible transparent animationType="fade" onRequestClose={closeComments}>
    <View style={styles.commentsOverlay}>
      <Pressable style={StyleSheet.absoluteFillObject} onPress={closeComments} />

      <View
  style={[
    styles.commentsModalCard,
    isMobile && {
  width: winW - 24,
  maxWidth: winW - 24,
  maxHeight: Math.min(winH * 0.68, 460),
  alignSelf: 'center',
}
  ]}
>
        <View style={styles.commentsHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.commentsTitle}>Comments</Text>
            {commentsFor?.title ? (
              <Text style={styles.commentsSubtitle} numberOfLines={1}>
                {commentsFor.title}
              </Text>
            ) : null}
          </View>

          <TouchableOpacity onPress={closeComments} activeOpacity={0.9} style={styles.commentsCloseBtn}>
            <Text style={styles.commentsClose}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.commentsBody}>
          {commentsLoading ? (
            <ActivityIndicator color={T.accent} style={{ padding: 20 }} />
          ) : rootComments.length === 0 ? (
            <View style={styles.commentsEmptyState}>
              <Text style={styles.commentsEmptyTitle}>No comments yet</Text>
              <Text style={styles.commentsEmptyText}>Be the first to say something thoughtful.</Text>
            </View>
          ) : (
            <FlatList
              data={rootComments}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.commentsListContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="always"
              renderItem={({ item }) => {
                const u = item.users;
                const replies = repliesByParent[item.id] || [];

                return (
                  <View style={styles.commentThread}>
                    <View style={styles.commentCard}>
                      <TouchableOpacity
                        onPress={() => u && goToProfile({ id: u.id, full_name: u.full_name })}
                        activeOpacity={0.9}
                        style={styles.commentAvatarTap}
                      >
                        <Image
                          source={{ uri: u?.avatar_url || 'https://picsum.photos/80/80' }}
                          style={styles.commentAvatar}
                        />
                      </TouchableOpacity>

                      <View style={{ flex: 1 }}>
                        <TouchableOpacity
                          onPress={() => u && goToProfile({ id: u.id, full_name: u.full_name })}
                          activeOpacity={0.9}
                        >
                          <Text style={styles.commentName}>{u?.full_name || 'Unknown'}</Text>
                        </TouchableOpacity>

                        <Text style={styles.commentText}>{item.comment}</Text>

                        <View style={styles.commentActionsRow}>
                          <TouchableOpacity
                            activeOpacity={0.9}
                            onPress={() => setReplyingTo(item)}
                            style={styles.replyBtn}
                          >
                            <Text style={styles.replyBtnText}>Reply</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>

                    {replies.length > 0 && (
                      <View style={styles.repliesWrap}>
                        {replies.map((reply) => {
                          const ru = reply.users;
                          return (
                            <View key={reply.id} style={styles.replyCard}>
                              <TouchableOpacity
                                onPress={() =>
                                  ru && goToProfile({ id: ru.id, full_name: ru.full_name })
                                }
                                activeOpacity={0.9}
                                style={styles.replyAvatarTap}
                              >
                                <Image
                                  source={{ uri: ru?.avatar_url || 'https://picsum.photos/80/80' }}
                                  style={styles.replyAvatar}
                                />
                              </TouchableOpacity>

                              <View style={{ flex: 1 }}>
                                <TouchableOpacity
                                  onPress={() =>
                                    ru && goToProfile({ id: ru.id, full_name: ru.full_name })
                                  }
                                  activeOpacity={0.9}
                                >
                                  <Text style={styles.replyName}>{ru?.full_name || 'Unknown'}</Text>
                                </TouchableOpacity>

                                <Text style={styles.replyText}>{reply.comment}</Text>
                              </View>
                            </View>
                          );
                        })}
                      </View>
                    )}
                  </View>
                );
              }}
            />
          )}
        </View>

        <View style={styles.commentComposerWrap}>
          {replyingTo ? (
            <View style={styles.replyingBanner}>
              <Text style={styles.replyingBannerText} numberOfLines={1}>
                Replying to {replyingTo.users?.full_name || 'comment'}
              </Text>
              <TouchableOpacity onPress={() => setReplyingTo(null)} activeOpacity={0.9}>
                <Text style={styles.replyingBannerCancel}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.commentComposer}>
            <TextInput
              value={commentText}
              onChangeText={setCommentText}
              placeholder={replyingTo ? 'Write a reply…' : 'Add a comment…'}
              placeholderTextColor="#777"
              style={styles.commentInput}
              multiline
            />
            <TouchableOpacity
              onPress={postComment}
              disabled={commentPosting || !commentText.trim()}
              activeOpacity={0.9}
              style={[
                styles.commentSendBtn,
                (commentPosting || !commentText.trim()) && { opacity: 0.5 },
              ]}
            >
              <Text style={styles.commentSendText}>{commentPosting ? '…' : 'Post'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  </Modal>
)}
  </View>
);
};

// ⬇️ PART 3 is styles + export (includes the NEW sidebar styles used in PART 1)
// FeaturedScreen.tsx — PART 3 / 3
// ✅ Styles + export (includes the sidebar/grid/preview/comment styles used above)

const RADIUS_XL = 18;

/* ---------------- styles ---------------- */
const styles = StyleSheet.create({
  container: {
  flex: 1,
  backgroundColor: '#000000',
},

storyOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.94)',
  justifyContent: 'center',
  alignItems: 'center',
  padding: 20,
},

storyCard: {
  width: '100%',
  maxWidth: 420,
  alignItems: 'center',
},
storyCloseBtnFloating: {
  position: 'absolute',
  top: 16,
  right: 16,
  width: 40,
  height: 40,
  borderRadius: 999,
  backgroundColor: 'rgba(0,0,0,0.55)',
  borderWidth: 0,
  borderColor: 'transparent',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 20,
},
storyCloseBtn: {
  alignSelf: 'flex-end',
  width: 40,
  height: 40,
  borderRadius: 999,
  backgroundColor: 'rgba(255,255,255,0.06)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 12,
},

storyCloseText: {
  color: '#FFFFFF',
  fontSize: 22,
  fontWeight: '900',
  lineHeight: 22,
  textAlign: 'center',
},

storyPoster: {
  width: '100%',
  aspectRatio: 9 / 16,
  borderRadius: 28,
  overflow: 'hidden',
  backgroundColor: '#050505',
  borderWidth: 0,
  borderColor: 'transparent',
  position: 'relative',
},

storyPosterImage: {
  width: '100%',
  height: '100%',
  position: 'absolute',
  opacity: 1,
},
storyCenterPanel: {
  position: 'absolute',
  top: '14%',
  bottom: '14%',
  left: '8%',
  right: '8%',
  borderRadius: 24,
  backgroundColor: 'transparent',
  borderWidth: 0,
  borderColor: 'transparent',
},

storyBrandTop: {
  position: 'absolute',
  top: 28,
  left: 24,
  right: 24,
  alignItems: 'center',
},
storyBottomFade: {
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: 0,
  height: '34%',
},

storyBrandText: {
  color: '#FFFFFF',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 18,
  letterSpacing: 3,
  textTransform: 'uppercase',
},

storyContent: {
  position: 'absolute',
  left: 26,
  right: 26,
  bottom: 36,
  alignItems: 'center',
},

storyTitle: {
  color: '#FFFFFF',
  fontFamily: FONT_CINEMATIC,
  fontWeight: '900',
  fontSize: 24,
  lineHeight: 28,
  textAlign: 'center',
  textTransform: 'uppercase',
  letterSpacing: 0.8,
  textShadowColor: 'rgba(0,0,0,0.45)',
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 8,
},

storyByline: {
  marginTop: 12,
  color: GOLD,
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 12,
  letterSpacing: 1.2,
  textTransform: 'uppercase',
  textAlign: 'center',
},

storyMeta: {
  marginTop: 8,
  color: 'rgba(255,255,255,0.70)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 11,
  letterSpacing: 1,
  textTransform: 'uppercase',
  textAlign: 'center',
},

storyLink: {
  marginTop: 18,
  color: 'rgba(255,255,255,0.46)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 10,
  textAlign: 'center',
},

  wideLayout: {
    flex: 1,
    flexDirection: 'row',
    paddingTop: CONTENT_TOP_PAD,
    paddingHorizontal: 12,
  },

  sidebar: {
  width: '100%',
  borderRadius: 22,
  borderWidth: 0,
  borderColor: 'transparent',
  backgroundColor: '#000000',
  padding: 16,
  alignSelf: 'flex-start',
  shadowColor: '#000',
  shadowOpacity: 0,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 0 },
  elevation: 0,
},

  gridArea: {
    flex: 1,
  },

  listContent: {
    alignItems: 'center',
    paddingHorizontal: 0,
    paddingBottom: 40,
  },

  listContentWide: {
    paddingHorizontal: 0,
    paddingBottom: 36,
  },

  subHeaderWrap: {
    width: '100%',
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 6,
    alignItems: 'center',
  },

  /* ---------------- Cards (full feed) ---------------- */
  cardWrapper: {
    width: '100%',
    alignItems: 'center',
  },

  cardWrapperHero: {
    marginBottom: 14,
  },

  cardBorder: {
    borderRadius: RADIUS_XL + 4,
    padding: 1,
    width: '100%',
    alignItems: 'center',
    backgroundColor: 'rgba(212,180,95,0.10)',
  },

  card: {
    width: '100%',
    borderRadius: RADIUS_XL + 2,
    backgroundColor: '#070707',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 12,
  },

  cardHero: {
  backgroundColor: '#030303',
  borderColor: 'transparent',
  paddingTop: 16,
  paddingBottom: 16,
},
cardHeroFlat: {
  borderWidth: 0,
  shadowOpacity: 0,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 0 },
  elevation: 0,
},
  heroRow: {
  alignSelf: 'center',
  borderRadius: RADIUS_XL + 2,
  overflow: 'hidden',
  backgroundColor: '#000',
  marginTop: 0,
  borderWidth: 0,
  borderColor: 'transparent',
},

  winnerFooter: {
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },

  winnerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },

  winnerMetaLabel: {
    color: 'rgba(237,235,230,0.44)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontSize: 10,
    marginRight: 12,
  },

  winnerMetaValue: {
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    letterSpacing: 0.4,
    fontSize: 12,
  },

  /* ---------------- Hero overlay ---------------- */
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Platform.OS === 'web' ? 24 : 12,
    paddingVertical: Platform.OS === 'web' ? 24 : 12,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },

  mobileChipRow: {
  paddingRight: 0,
  paddingLeft: 0,
  alignItems: 'center',
  justifyContent: 'center',
  flexWrap: 'nowrap',
},

mobileChip: {
  marginRight: 4,
  height: 20,
  paddingHorizontal: 6,
},


  mobileFeedCard: {
  alignSelf: 'center',
  backgroundColor: '#040404',
  marginBottom: 18,
  width: '94%', // add this
},


  
mobileMediaWrap: {
  width: '100%',
  borderRadius: 0,
  overflow: 'hidden',
  backgroundColor: '#000',
  minHeight: 300, // optional
},
  mobileMetaWrap: {
  paddingHorizontal: 12, // was 10
  paddingTop: 20,        // was 8
  paddingBottom: 4,      // was 2
},

  mobileTitle: {
  color: '#F8F6F1',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 17,   // was 16
  lineHeight: 22, // was 21
  textAlign: 'center',
},
  mobileByline: {
    marginTop: 3,
    color: 'rgba(237,235,230,0.58)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
    fontSize: 12,
    textAlign: 'center',
  },

  mobileDescription: {
    marginTop: 5,
    color: 'rgba(237,235,230,0.68)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '500',
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
  },

  mobileActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 9,
  },

  mobilePill: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: 'rgba(212,180,95,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
    marginBottom: 7,
  },

  mobilePillText: {
    color: '#F3EFE7',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    fontSize: 11,
  },

  mobilePillGhost: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 7,
    marginBottom: 7,
  },

  mobilePillGhostText: {
    color: 'rgba(237,235,230,0.72)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    fontSize: 11,
  },

  heroOverlayInner: {
    maxWidth: '100%',
    alignItems: 'center',
  },

  heroKicker: {
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    textTransform: 'uppercase',
    textAlign: 'center',
    fontSize: 13,
    letterSpacing: 1.6,
    marginBottom: 10,
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },

  heroTitle: {
    color: '#F8F6F1',
    fontFamily: FONT_CINEMATIC,
    fontWeight: '800',
    textTransform: 'uppercase',
    textAlign: 'center',
    letterSpacing: 1,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 4 },
    textShadowRadius: 14,
  },

  heroBylineTap: {
    alignSelf: 'center',
    marginTop: 8,
  },

  heroByline: {
    color: 'rgba(255,255,255,0.82)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.45)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },

  /* ---------------- Feed layout ---------------- */
  feedRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    paddingTop: 16,
    paddingBottom: 16,
  },

  voteCol: {
    alignItems: 'center',
    paddingTop: 10,
    paddingLeft: 2,
  },

  voteTap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#0A0A0A',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },

  voteArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 9,
    borderRightWidth: 9,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },

  voteArrowUp: {
    borderBottomWidth: 12,
    borderBottomColor: '#D6D6D6',
    marginTop: -2,
  },

  voteArrowDown: {
    borderTopWidth: 12,
    borderTopColor: '#D6D6D6',
    marginBottom: -2,
  },

  voteArrowActive: {
    borderBottomColor: GOLD,
    borderTopColor: GOLD,
  },

  voteCountText: {
    color: '#F2EFE8',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 0.4,
    marginBottom: 10,
  },

  commentDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: GOLD,
    marginBottom: 4,
  },

  commentMini: {
    color: 'rgba(237,235,230,0.58)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.3,
  },

  mineMini: {
    marginTop: 8,
    color: 'rgba(237,235,230,0.32)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },

  feedBody: {
    flex: 1,
    paddingBottom: 6,
  },

  feedHeader: {
    paddingRight: 8,
  },

  feedTitle: {
    color: '#F8F6F1',
    fontFamily: FONT_CINEMATIC,
    fontWeight: '800',
    fontSize: 23,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  feedByline: {
    marginTop: 7,
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },

  feedDescription: {
    marginTop: 12,
    color: 'rgba(237,235,230,0.72)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 20,
  },

  feedActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    marginTop: 14,
  },

  feedActionBtn: {
    paddingVertical: 11,
    paddingHorizontal: 15,
    borderRadius: 14,
    backgroundColor: '#0B0B0B',
    borderWidth: 1,
    borderColor: 'rgba(212,180,95,0.20)',
    marginRight: 10,
    marginBottom: 10,
  },

  feedActionText: {
    color: '#F3EFE7',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },

  feedActionBtnGhost: {
    paddingVertical: 11,
    paddingHorizontal: 15,
    borderRadius: 14,
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginRight: 10,
    marginBottom: 10,
  },

  feedActionGhostText: {
    color: 'rgba(237,235,230,0.66)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.9,
    textTransform: 'uppercase',
  },

  /* ---------------- Video wrapper ---------------- */
  videoOuter: {
    alignSelf: 'center',
    borderRadius: RADIUS_XL + 2,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  videoOuterHeroFlat: {
  borderWidth: 0,
  borderColor: 'transparent',
  shadowOpacity: 0,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 0 },
  elevation: 0,
},

  aspectFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADIUS_XL + 2,
    overflow: 'hidden',
  },

  progressHit: {
    position: 'absolute',
    left: 14,
    right: 14,
    bottom: 10,
    height: 24,
    justifyContent: 'center',
  },

  progressTrack: {
    height: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    overflow: 'hidden',
  },

  progressFill: {
    height: 3,
    borderRadius: 999,
    backgroundColor: GOLD,
  },

  fsButton: {
  position: 'absolute',
  left: 10,
  top: 10,
  width: 36,
  height: 36,
  borderRadius: 12,
  backgroundColor: 'rgba(0,0,0,0.55)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.10)',
  alignItems: 'center',
  justifyContent: 'center',
},

  soundBtn: {
  position: 'absolute',
  right: 10,
  top: 10,
  minHeight: 36,
  paddingHorizontal: 10,
  borderRadius: 999,
  backgroundColor: 'rgba(0,0,0,0.55)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.10)',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
},

soundText: {
  color: '#fff',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 5,
  letterSpacing: 0.2,
  textTransform: 'uppercase',
  marginLeft: 3,
},

  /* ---------------- Audio wrapper ---------------- */
  audioWrap: {
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: '#060606',
    padding: 12,
  },

  audioHint: {
    color: 'rgba(237,235,230,0.72)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

    /* ---------------- Compact grid cards ---------------- */
  gridCard: {
  borderRadius: 18,
  overflow: 'hidden',
  backgroundColor: '#080808',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.04)',
  marginHorizontal: 6,
  marginBottom: 0,
  shadowColor: '#000',
  shadowOpacity: 0.16,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 4 },
  elevation: 5,
},

  gridThumbWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000',
    position: 'relative',
    overflow: 'hidden',
  },

  gridThumb: {
    width: '100%',
    height: '100%',
  },

  gridThumbOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },

  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'flex-end',
  },

  gridOverlayTextWrap: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
  },
  gridOverlayBylineTap: {
  alignSelf: 'flex-start',
  marginTop: 2,
},

  gridOverlayTitle: {
    color: '#F8F6F1',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 11,
    lineHeight: 13,
    textAlign: 'left',
  },

  gridOverlayByline: {
  marginTop: 2,
  color: GOLD,
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 8,
  lineHeight: 10,
  textAlign: 'left',
},

  gridBody: {
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 8,
    alignItems: 'center',
  },

  gridTitle: {
    color: '#F7F4ED',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.1,
    textAlign: 'center',
  },

  gridByline: {
    marginTop: 2,
    color: 'rgba(237,235,230,0.46)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
    fontSize: 9,
    letterSpacing: 0.1,
    textAlign: 'center',
  },

  gridMetaRow: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'flex-start',
  paddingHorizontal: 6,
  paddingTop: 4,
  paddingBottom: 5,
},

gridVotePill: {
  height: 16,
  minWidth: 20,
  paddingHorizontal: 6,
  borderRadius: 999,
  backgroundColor: '#0B0B0B',
  borderWidth: 1,
  borderColor: 'rgba(212,180,95,0.12)',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 4,
},

gridVoteText: {
  color: '#F3EFE7',
  fontFamily: SYSTEM_SANS,
  fontWeight: '800',
  fontSize: 7,
  letterSpacing: 0,
  textTransform: 'uppercase',
},

gridCommentPill: {
  height: 16,
  minWidth: 20,
  paddingHorizontal: 6,
  borderRadius: 999,
  backgroundColor: 'transparent',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.06)',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 4,
},

gridCommentText: {
  color: 'rgba(237,235,230,0.62)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '800',
  fontSize: 7,
  letterSpacing: 0,
},

gridMine: {
  color: 'rgba(237,235,230,0.24)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '800',
  fontSize: 6,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
  marginLeft: 'auto',
},

  /* ---------------- Preview modal ---------------- */
  previewOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.88)',
  justifyContent: 'center',
  alignItems: 'center',
  padding: 20,
},

  previewCard: {
  width: '100%',
  maxWidth: 820,
  borderRadius: 20,
  overflow: 'hidden',
  backgroundColor: '#000000',
  borderWidth: 0,
  borderColor: 'transparent',
  shadowColor: '#000',
  shadowOpacity: 0.30,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
  elevation: 12,
},

  previewHeader: {
  paddingHorizontal: 16,
  paddingTop: 14,
  paddingBottom: 12,
  borderBottomWidth: 0,
  borderBottomColor: 'transparent',
  backgroundColor: '#000000',
  flexDirection: 'row',
  alignItems: 'center',
},

  previewTitle: {
    color: '#fff',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 14,
    letterSpacing: 0.25,
  },

  previewByline: {
    marginTop: 4,
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  previewCloseBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#0B0B0B',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },

  previewCloseText: {
    color: '#EDEBE6',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  previewActions: {
  flexDirection: 'row',
  alignItems: 'center',
  flexWrap: 'wrap',
  justifyContent: 'center',
  marginTop: 10,
  marginBottom: 4,
},

  previewActionPill: {
  height: 38,
  paddingHorizontal: 15,
  borderRadius: 999,
  backgroundColor: '#000000',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.06)',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 10,
  marginBottom: 10,
},

  previewActionText: {
    color: '#EDEBE6',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  previewActionPillGhost: {
  height: 38,
  paddingHorizontal: 15,
  borderRadius: 999,
  backgroundColor: '#000000',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.06)',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 10,
  marginBottom: 10,
},

  previewActionTextGhost: {
    color: 'rgba(237,235,230,0.70)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },

  previewDesc: {
  marginTop: 8,
  color: 'rgba(237,235,230,0.70)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '600',
  fontSize: 12,
  lineHeight: 18,
  textAlign: 'center',
},

  /* ---------------- HeaderControls ---------------- */
  sideSearchBox: {
  width: '100%',
  height: '100%',
  backgroundColor: '#000000',
  borderWidth: 0,
  borderColor: 'transparent',
  borderRadius: 999,
  justifyContent: 'center',
},

sidePanel: {
  width: '100%',
  height: '100%',
  borderRadius: 999,
  borderWidth: 0,
  borderColor: 'transparent',
  backgroundColor: '#000000',
  paddingHorizontal: 0,
  paddingVertical: 0,
  justifyContent: 'center',
},

sidePanelSeamless: {
  width: '100%',
  backgroundColor: '#000000',
  borderWidth: 0,
  borderColor: 'transparent',
  paddingHorizontal: 0,
  paddingVertical: 0,
},
  sidePanelTitle: {
  color: 'rgba(237,235,230,0.68)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 8,
  letterSpacing: 0.9,
  textTransform: 'uppercase',
  marginBottom: 4,
  textAlign: 'center',
  lineHeight: 20,
},

  sideSortItem: {
  width: '100%',
  borderRadius: 14,
  paddingHorizontal: 13,
  paddingVertical: 11,
  backgroundColor: '#000000',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.03)',
  flexDirection: 'row',
  alignItems: 'center',
},

  sideSortItemActive: {
  borderWidth: 1,
  borderColor: 'rgba(212,180,95,0.55)',
  backgroundColor: '#000000',
  shadowColor: GOLD,
  shadowOpacity: 0,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 0 },
  elevation: 0,
},

  sideSortLabel: {
    color: '#F1EEE7',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  sideSortSub: {
    marginTop: 3,
    color: 'rgba(237,235,230,0.50)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
    fontSize: 11,
    letterSpacing: 0.2,
  },

  sideSortDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
    backgroundColor: 'rgba(237,235,230,0.24)',
    opacity: 0.9,
    marginLeft: 10,
  },

  /* ---------------- HeaderControls (center compact row) ---------------- */
  centerSortRow: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },

  centerChip: {
  paddingHorizontal: 8,
  height: 24,
  borderRadius: 999,
  backgroundColor: '#0B0B0B',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.06)',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 6,
},

  centerChipText: {
  color: 'rgba(237,235,230,0.80)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 8,
  letterSpacing: 0.35,
  textTransform: 'uppercase',
},

  /* ---------------- Comments modal ---------------- */
  commentsOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    backgroundColor: 'rgba(0,0,0,0.78)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: Platform.OS === 'web' ? 24 : 10,
    paddingVertical: Platform.OS === 'web' ? 32 : 20,
  },

  commentsModalCard: {
  width: '100%',
  maxWidth: 720,
  backgroundColor: '#080808',
  borderRadius: Platform.OS === 'web' ? 22 : 18,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.06)',
  overflow: 'hidden',
  shadowColor: '#000',
  shadowOpacity: 0.30,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
  elevation: 14,
},

  commentsHeader: {
  paddingHorizontal: 16,
  paddingTop: 14,
  paddingBottom: 12,
  borderBottomWidth: 1,
  borderBottomColor: 'rgba(255,255,255,0.05)',
  flexDirection: 'row',
  alignItems: 'center',
},

  commentsTitle: {
    color: '#fff',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 15,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  commentsSubtitle: {
    marginTop: 4,
    color: 'rgba(237,235,230,0.52)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
    fontSize: 12,
  },

  commentsCloseBtn: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 12,
  },

  commentsClose: {
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  commentsBody: {
  flexGrow: 0,
  minHeight: 120,
  maxHeight: 250,
},

  commentsListContent: {
  paddingHorizontal: 14,
  paddingTop: 12,
  paddingBottom: 12,
},

  commentsEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 40,
  },

  commentsEmptyTitle: {
    color: '#F4F1EA',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 16,
    marginBottom: 6,
  },

  commentsEmptyText: {
    color: 'rgba(237,235,230,0.58)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },

  commentThread: {
    marginBottom: 14,
  },

  commentCard: {
    flexDirection: 'row',
    padding: 14,
    borderRadius: 18,
    backgroundColor: '#0B0B0B',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },

  commentAvatarTap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#000',
    marginRight: 12,
  },

  commentAvatar: {
    width: '100%',
    height: '100%',
  },

  commentName: {
    color: '#fff',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.2,
  },

  commentText: {
    marginTop: 5,
    color: 'rgba(237,235,230,0.78)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
    fontSize: 13,
    lineHeight: 19,
  },

  commentActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },

  replyBtn: {
    height: 30,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(198,166,100,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.24)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  replyBtnText: {
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  repliesWrap: {
    marginTop: 10,
    marginLeft: 22,
  },

  replyCard: {
    flexDirection: 'row',
    padding: 12,
    borderRadius: 16,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
    marginBottom: 8,
  },

  replyAvatarTap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#000',
    marginRight: 10,
  },

  replyAvatar: {
    width: '100%',
    height: '100%',
  },

  replyName: {
    color: '#F4F1EA',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    fontSize: 11,
  },

  replyText: {
    marginTop: 4,
    color: 'rgba(237,235,230,0.72)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
    fontSize: 12,
    lineHeight: 17,
  },

  commentComposerWrap: {
  borderTopWidth: 1,
  borderTopColor: 'rgba(255,255,255,0.05)',
  backgroundColor: '#090909',
  paddingHorizontal: 10,
  paddingTop: 8,
  paddingBottom: 8,
},

  replyingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(198,166,100,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.18)',
  },

  replyingBannerText: {
    flex: 1,
    color: '#F1EBDD',
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
    fontSize: 12,
    marginRight: 10,
  },

  replyingBannerCancel: {
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  commentComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },

  commentInput: {
  flex: 1,
  minHeight: 40,
  maxHeight: 86,
  borderRadius: 14,
  backgroundColor: '#0B0B0B',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.07)',
  paddingHorizontal: 12,
  paddingVertical: 9,
  color: '#EDEBE6',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 12,
},

  commentSendBtn: {
  height: 42,
  paddingHorizontal: 14,
  borderRadius: 14,
  backgroundColor: '#131313',
  borderWidth: 1,
  borderColor: 'rgba(198,166,100,0.32)',
  alignItems: 'center',
  justifyContent: 'center',
  marginLeft: 8,
},

  commentSendText: {
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
});

export default FeaturedScreen;