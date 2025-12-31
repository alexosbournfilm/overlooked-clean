// app/screens/FeaturedScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
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
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import {
  Video,
  ResizeMode,
  VideoFullscreenUpdate,
  AVPlaybackStatus,
  Audio,
} from 'expo-av';
import { LinearGradient } from 'expo-linear-gradient';
import { Submission } from '../types';
import { supabase, giveXp, XP_VALUES } from '../lib/supabase'; // ✅ shared client & XP helpers
import { useGamification } from '../context/GamificationContext'; // ✅ gamification context

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});



/* ------------------------------------------------------------------
   CINEMATIC NOIR — Simple • Clean • High Contrast
   ------------------------------------------------------------------ */
const GOLD = '#C6A664';
const T = {
  bg: '#000000',
  bg2: '#050505',
  panel: '#0A0A0A',

  card: '#0A0A0A',
  card2: '#0D0D0D',
  outline: '#1A1A1A',

  text: '#FFFFFF',
  sub: '#DADADA',
  mute: '#9A9A9A',

  accent: '#4FD1FF',

  heroBurgundy1: '#0B0B0B',
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
type Category = 'film' | 'acting' | 'music';

const TOP_BAR_OFFSET = Platform.OS === 'web' ? 76 : 8;
const BOTTOM_TAB_H = Platform.OS === 'web' ? 64 : 64;

/** Bring content higher */
const CONTENT_TOP_PAD = Platform.OS === 'web' ? 22 : 6;

/* 🔥 Gamification constants */
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
async function signStoragePath(
  path: string,
  expiresInSec = 180
): Promise<string> {
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
function pickSmallestVariant(
  row: any
): { path: string | null; thumb: string | null } {
  const variants = row?.videos?.video_variants ?? [];
  if (!variants || variants.length === 0) {
    return {
      path:
        row?.video_path ??
        row?.storage_path ??
        row?.videos?.original_path ??
        null,
      thumb:
        row?.thumbnail_url ??
        row?.videos?.thumbnail_path ??
        null,
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
    thumb:
      row?.thumbnail_url ??
      row?.videos?.thumbnail_path ??
      null,
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
    <View
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: 8,
        height: 2,
        backgroundColor: '#fff',
      }}
    />
    <View
      style={{
        position: 'absolute',
        left: 0,
       top: 0,
        width: 2,
        height: 8,
        backgroundColor: '#fff',
      }}
    />
    <View
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        width: 8,
        height: 2,
        backgroundColor: '#fff',
      }}
    />
    <View
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        width: 2,
        height: 8,
        backgroundColor: '#fff',
      }}
    />
    <View
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        width: 8,
        height: 2,
        backgroundColor: '#fff',
      }}
    />
    <View
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        width: 2,
        height: 8,
        backgroundColor: '#fff',
      }}
    />
    <View
      style={{
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: 8,
        height: 2,
        backgroundColor: '#fff',
      }}
    />
    <View
      style={{
        position: 'absolute',
        right: 0,
        bottom: 0,
        width: 2,
        height: 8,
        backgroundColor: '#fff',
      }}
    />
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

const WebVideo: any = 'video';

/* ---------------- Video with custom progress (no native controls) ---------------- */
function HostedVideoInline({
  playerId,
  storagePath,
  width,
  maxHeight,
  autoPlay,
  posterUri,
  dimVignette = true,
}: {
  playerId: string;
  storagePath: string;
  width: number;
  maxHeight: number;
  autoPlay: boolean;
  posterUri?: string | null;
  dimVignette?: boolean;
}) {
  const ref = useRef<Video>(null);
  const htmlRef = useRef<any>(null);
  const [src, setSrc] = useState<string | null>(null);

  const opacity = useRef(new Animated.Value(0)).current;
  const [aspect, setAspect] = useState<number>(16 / 9);

  const [muted, setMuted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);

  // progress 0..1
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const progressRef = useRef<View>(null);

  const clampedW = Math.min(width, Math.max(280, maxHeight * aspect));

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
        if (alive) setSrc(url);
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
      if (autoPlay) {
        await play(true);
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
  }, [src, autoPlay]);

  // Ensure native controls never appear (Safari quirks)
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const id = window.setInterval(() => {
      const el = htmlRef.current;
      if (el) el.controls = false;
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const onSurfacePress = async () => {
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
    if (Platform.OS !== 'web') maybeUpdateAspectFromStatus(status);
  };

  const handleReadyForDisplay = (evt?: any) => {
    if (Platform.OS !== 'web') {
      const ns = evt?.naturalSize;
      updateAspectFromDims(ns?.width, ns?.height);
    }
    fadeIn();
  };

  const handleFsUpdate = async ({
    fullscreenUpdate,
  }: {
    fullscreenUpdate: number;
  }) => {
    if (Platform.OS === 'web') return;
    try {
      if (
        fullscreenUpdate ===
        VideoFullscreenUpdate.PLAYER_WILL_PRESENT
      ) {
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

  // --- Scrubbing (web) ---
  const [seeking, setSeeking] = useState(false);

  const setFromClientX = (clientX: number) => {
    if (!progressRef.current) return;
    const el: any = progressRef.current;
    const rect = el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : { left: 0, width: 1 };
    const ratio = Math.max(
      0,
      Math.min(1, (clientX - rect.left) / rect.width)
    );
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
        width: clampedW,
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
          { opacity, zIndex: 0 },
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
                objectFit: 'cover',
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
            resizeMode={ResizeMode.COVER}
            isLooping
            shouldPlay={autoPlay}
            isMuted={muted}
            useNativeControls={false}
            usePoster
            posterSource={
              posterUri ? { uri: posterUri } : undefined
            }
            posterStyle={[
              StyleSheet.absoluteFillObject,
              { borderRadius: RADIUS_XL },
            ]}
            onLoad={handleLoad}
            onReadyForDisplay={handleReadyForDisplay}
            onFullscreenUpdate={handleFsUpdate}
            onPlaybackStatusUpdate={maybeUpdateAspectFromStatus}
            progressUpdateIntervalMillis={150}
          />
        )}
      </Animated.View>

      <Pressable
        onPress={onSurfacePress}
        style={[
          StyleSheet.absoluteFillObject,
          {
            zIndex: 6,
            backgroundColor: 'transparent',
          },
        ]}
      />

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
                width: `${Math.max(
                  0,
                  Math.min(100, progress * 100)
                )}%`,
              },
            ]}
          />
        </View>
      </View>

      <TouchableOpacity
        onPress={enterFullscreen}
        activeOpacity={0.9}
        style={[styles.fsButton, { zIndex: 20 }]}
      >
        <IconCorners />
      </TouchableOpacity>

      <TouchableOpacity
        onPress={toggleMute}
        style={[styles.soundBtn, { zIndex: 20 }]}
        activeOpacity={0.9}
      >
        <IconSpeaker muted={muted} />
        <Text style={styles.soundText}>
          {muted ? 'Sound Off' : 'Sound On'}
        </Text>
      </TouchableOpacity>
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
        if (alive) setSrc(url);
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
            const el = document.getElementById(
              `audio-${playerId}`
            ) as HTMLAudioElement | null;
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
        const el = document.getElementById(
          `audio-${playerId}`
        ) as HTMLAudioElement | null;
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
        <audio
          id={`audio-${playerId}`}
          src={src || undefined}
          controls
          style={{ width: '100%' }}
        />
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
    maybe == null
      ? undefined
      : Array.isArray(maybe)
      ? (maybe[0] as any)
      : (maybe as any);

  const desc =
    (row as any).description ??
    (row as any).word ??
    null;

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
    thumbnail_url:
      picked.thumb ?? row.thumbnail_url ?? null,
    media_kind: row.media_kind ?? null,
    mime_type: row.mime_type ?? null,
    category: (row.category as Category | null) ?? null,
  };
}

function normalizeIsoRange(start: string, end: string) {
  const mkStart = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? `${s}T00:00:00.000Z`
      : new Date(s).toISOString();
  const mkEnd = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? `${s}T23:59:59.999Z`
      : new Date(s).toISOString();
  return {
    startIso: mkStart(start),
    endIso: mkEnd(end),
  };
}

async function fetchChallengesForFeatured() {
  // 1) finalize last month if needed
  try {
    const { error: finalizeErr } = await supabase.rpc('finalize_last_month_winner_if_needed');
    if (finalizeErr) {
      console.warn('finalize_last_month_winner_if_needed failed:', finalizeErr.message);
    }
  } catch {}

  // 2) ensure current month challenge exists
  try {
    const { error: insertErr } = await supabase.rpc('insert_monthly_challenge_if_not_exists');
    if (insertErr) {
      console.warn('insert_monthly_challenge_if_not_exists failed:', insertErr.message);
    }
  } catch {}

  const nowIso = new Date().toISOString();

  // CURRENT month row (for range/theme)
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

  // PREVIOUS month row (for last month winner)
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
/* 🔥 Count votes in current month for cap enforcement */
async function countUserVotesInRange(
  uid: string,
  range: { start: string; end: string }
) {
  try {
    const { startIso, endIso } = normalizeIsoRange(
      range.start,
      range.end
    );

    const attempt = async (tsCol: 'created_at' | 'voted_at') =>
      supabase
        .from('user_votes')
        .select('user_id', {
          count: 'exact',
          head: true,
        })
        .eq('user_id', uid)
        .gte(tsCol, startIso)
        .lt(tsCol, endIso);

    let { count, error } = await attempt(
      'created_at'
    );

    if (error) {
      const retry = await attempt('voted_at');
      count = retry.count ?? 0;
      if (retry.error) {
        console.warn(
          'Failed to count monthly votes (Featured):',
          retry.error.message
        );
        return 0;
      }
    }

    return count ?? 0;
  } catch (e: any) {
    console.warn(
      'Failed to count monthly votes (Featured):',
      e?.message || String(e)
    );
    return 0;
  }
}

/* ---------------- Category Tabs ---------------- */
const categoriesOrdered: Category[] = [
  'film',
  'acting',
  'music',
];

const labelFor = (c: Category) =>
  c === 'film'
    ? 'FILMS'
    : c === 'acting'
    ? 'ACTING'
    : 'MUSIC';

function CategoryTabs({
  value,
  onChange,
  width,
}: {
  value: Category;
  onChange: (c: Category) => void;
  width: number;
}) {
  const pageW = Math.min(
    1120,
    Math.max(
      320,
      width - (Platform.OS === 'web' ? 56 : 20)
    )
  );
  return (
    <View
      style={{
        width: pageW,
        alignSelf: 'center',
        paddingTop: 2,
      }}
    >
      <View style={styles.catRow}>
        {categoriesOrdered.map((c) => {
          const active = value === c;
          return (
            <TouchableOpacity
              key={c}
              onPress={() => onChange(c)}
              activeOpacity={0.9}
              style={styles.catTap}
            >
              <Text
                style={[
                  styles.catText,
                  active && styles.catTextActive,
                ]}
              >
                {labelFor(c)}
              </Text>
              {active ? (
                <View style={styles.catUnderline} />
              ) : (
                <View style={{ height: 3 }} />
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/* ---------------- Memoized Header Controls ---------------- */
type HeaderControlsProps = {
  category: Category;
  sort: SortKey;
  setSort: (k: SortKey) => void;
  searchText: string;
  setSearchText: (s: string) => void;
  compact?: boolean;
};

const HeaderControls = React.memo(
  ({
    category,
    sort,
    setSort,
    searchText,
    setSearchText,
    compact = false,
  }: HeaderControlsProps) => {
    const filters: { key: SortKey; label: string }[] = [
      { key: 'newest', label: 'Newest' },
      { key: 'mostvoted', label: 'Top Voted' },
      { key: 'leastvoted', label: 'Least Voted' },
      { key: 'oldest', label: 'Oldest' },
    ];

    return (
      <View style={{ width: '100%', alignItems: 'center' }}>
       {/* --- Search Bar --- */}
<View
  style={{
    width: '100%',
    maxWidth: 620,
    backgroundColor: '#0F0F0F',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#1A1A1A',
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
  }}
>
  <TextInput
    placeholder="Search"
    placeholderTextColor="#777"
    value={searchText}
    onChangeText={setSearchText}
    style={{
      flex: 1,
      color: '#fff',
      fontSize: 15,
      fontWeight: '600',
      fontFamily: SYSTEM_SANS,
      letterSpacing: 0.3,
    }}
  />
</View>

        {/* --- Slick Filter Chips (Horizontal Scroll) --- */}
        <View
          style={{
            flexDirection: 'row',
            maxWidth: 650,
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {filters.map((f) => {
            const active = sort === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                activeOpacity={0.9}
                onPress={() => setSort(f.key)}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 18,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: active ? GOLD : '#2A2A2A',
                  backgroundColor: active ? '#1A1A1A' : '#0C0C0C',
                }}
              >
                <Text
                  style={{
                    color: active ? GOLD : '#DDD',
                    fontSize: 13,
                    fontFamily: SYSTEM_SANS,
                    fontWeight: '800',
                    letterSpacing: 0.6,
                    textTransform: 'uppercase',
                  }}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    );
  }
);

/* ---------------- screen ---------------- */
const FeaturedScreen = () => {
  const navigation = useNavigation<any>();
  const { width: winW, height: winH } =
    useWindowDimensions();
  const isNarrow = winW < 480;

  const [category, setCategory] =
    useState<Category>('film');
  const [loading, setLoading] =
    useState(true);
  const [winner, setWinner] =
    useState<
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
  const [submissions, setSubmissions] =
    useState<
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

  const [searchText, setSearchText] =
    useState('');
  const [searchQ, setSearchQ] =
    useState('');
  const [sort, setSort] =
    useState<SortKey>('newest');

  const [currentUserId, setCurrentUserId] =
    useState<string | null>(null);
  const [votedIds, setVotedIds] =
    useState<Set<string>>(new Set());
  const [voteBusy, setVoteBusy] =
    useState<Record<string, boolean>>(
      {}
    );
  const [deleteBusy, setDeleteBusy] =
    useState<Record<string, boolean>>(
      {}
    );

  const [activeId, setActiveId] =
    useState<string | null>(null);

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

  // 🔥 Gamification context — we only need refresh + userId
  const {
    userId: gamUserId,
    refresh: refreshGamification,
  } = useGamification();

  // Track monthly votes used for cap enforcement
  const [monthlyVotesUsed, setMonthlyVotesUsed] =
    useState(0);
  const currentRangeRef = useRef<
    { start: string; end: string } | null
  >(null);

  useEffect(() => {
    const t = setTimeout(
      () => setSearchQ(searchText),
      500
    );
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

  const cardW = Math.min(
    1120,
    Math.max(
      320,
      winW - (Platform.OS === 'web' ? 40 : 16)
    )
  );
  const availableHForMedia = Math.max(
    300,
    winH - (TOP_BAR_OFFSET + BOTTOM_TAB_H + 78)
  );

  // Fetch content when filters change
  useEffect(() => {
    (async () => {
      const { data: auth } =
        await supabase.auth.getUser();
      const uid = auth?.user?.id ?? null;
      setCurrentUserId(uid);
      await fetchContent(uid, category, searchQ);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, searchQ, category]);

  // Also refresh when screen refocuses (keeps votes / submissions live)
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const { data: auth } =
          await supabase.auth.getUser();
        const uid = auth?.user?.id ?? null;
        await fetchContent(uid, category, searchQ);
      })();
    }, [category, sort, searchQ])
  );

  const baseCols =
    'id, user_id, title, votes, submitted_at, is_winner, users ( id, full_name ), video_id, storage_path, video_path, media_kind, mime_type, duration_seconds, category';

  const fetchWinnerSafe = async (
    id: string,
    desired: Category
  ) => {
    const sel = `
      ${baseCols},
      videos:video_id ( original_path, thumbnail_path, video_variants ( path, label ) ),
      description
    `;
    let res = await supabase
      .from('submissions')
      .select(sel)
      .eq('id', id)
      .single();

    if (res.error) {
      const sel2 = `
        ${baseCols},
        videos:video_id ( original_path, thumbnail_path, video_variants ( path, label ) ),
        word
      `;
      res = await supabase
        .from('submissions')
        .select(sel2)
        .eq('id', id)
        .single();
    }

    if (res.error) return res;

    if (
      res.data &&
      (res.data as any).category &&
      (res.data as any).category !== desired
    ) {
      return {
        data: null,
        error: null,
      } as any;
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
    range:
      | { start: string; end: string }
      | undefined,
    cat: Category
  ) => {
    const sel = `
      ${baseCols},
      videos:video_id ( original_path, thumbnail_path, video_variants ( path, label ) ),
      description
    `;

    const addSort = (q: any) => {
      if (orderKey === 'newest')
        return q.order('submitted_at', {
          ascending: false,
        });
      if (orderKey === 'oldest')
        return q.order('submitted_at', {
          ascending: true,
        });
      if (orderKey === 'mostvoted')
        return q.order('votes', {
          ascending: false,
        });
      if (orderKey === 'leastvoted')
        return q.order('votes', {
          ascending: true,
        });
      return q;
    };

    let query: any = addSort(
      supabase
        .from('submissions')
        .select(sel)
        .eq('category', cat)
    );

    if (range) {
      const { startIso, endIso } =
        normalizeIsoRange(
          range.start,
          range.end
        );
      query = query
        .gte('submitted_at', startIso)
        .lt('submitted_at', endIso);
    }

    if (searchTextQ.trim()) {
      query = query.ilike(
        'title',
        `%${searchTextQ.trim()}%`
      );
    }

    let res = await query;

    if (res.error) {
      const sel2 = `
        ${baseCols},
        videos:video_id ( original_path, thumbnail_path, video_variants ( path, label ) ),
        word
      `;
      let q2: any = addSort(
        supabase
          .from('submissions')
          .select(sel2)
          .eq('category', cat)
      );
      if (range) {
        const { startIso, endIso } =
          normalizeIsoRange(
            range.start,
            range.end
          );
        q2 = q2
          .gte('submitted_at', startIso)
          .lt('submitted_at', endIso);
      }
      if (searchTextQ.trim()) {
        q2 = q2.ilike(
          'title',
          `%${searchTextQ.trim()}%`
        );
      }
      res = await q2;
      if (res.error) {
        return {
          data: [],
          error: res.error,
        } as any;
      }
    }

    const rows = (res.data ?? []) as any[];

    for (const r of rows) {
      const picked = pickSmallestVariant(r);
      r.storage_path =
        r.media_kind === 'file_audio'
          ? r.storage_path ??
            r.video_path ??
            r?.videos?.original_path ??
            null
          : picked.path;
      r.thumbnail_url = picked.thumb;
    }

    return res;
  };

  const fetchContent = async (
    uid: string | null,
    cat: Category,
    searchTextQ: string
  ) => {
    setLoading(true);

    const challenges = await fetchChallengesForFeatured();

const range = challenges.current
  ? {
      start: challenges.current.month_start,
      end: challenges.current.month_end,
    }
  : undefined;

currentRangeRef.current = range ?? null;

    // Winner
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

    // Winner must come from PREVIOUS month (not current month)
if (challenges.previous?.winner_submission_id) {
  const { data: w } = await fetchWinnerSafe(
    challenges.previous.winner_submission_id,
    cat
  );

  winnerData = w ? normalizeRow(w as RawSubmission) : null;

  if (winnerData && winnerData.category !== cat) {
    winnerData = null;
  }

  if ((winnerData as any)?.storage_path) {
    signStoragePath((winnerData as any).storage_path!, 180).catch(() => {});
  }
}

    // Submissions
    const resp = await fetchSubsSafe(
      sort,
      searchTextQ,
      range,
      cat
    );
    const subs = (resp?.data ||
      []) as RawSubmission[];
    const normalized =
      subs.map(normalizeRow);

    // Preload first few
    normalized
      .slice(0, 10)
      .forEach((s) => {
        if (s.storage_path)
          signStoragePath(
            s.storage_path,
            180
          ).catch(() => {});
      });

    // Fetch current user's existing votes for these submissions
    if (uid && normalized.length) {
      const ids = normalized.map(
        (s) => s.id
      );
      const { data: myVotes } =
        await supabase
          .from('user_votes')
          .select('submission_id')
          .eq('user_id', uid)
          .in('submission_id', ids);

      const votedSet =
        new Set<string>(
          (myVotes || []).map(
            (r) =>
              r.submission_id as string
          )
        );
      setVotedIds(votedSet);
    } else {
      setVotedIds(new Set());
    }

    // 🔥 Recompute monthly vote usage for cap
    if (uid && range) {
      const used =
        await countUserVotesInRange(
          uid,
          range
        );
      setMonthlyVotesUsed(used);
    } else {
      setMonthlyVotesUsed(0);
    }

    setWinner(winnerData);
    setSubmissions(normalized);
    setLoading(false);

    // Pick initial active media
    const firstPlayable = winnerData?.storage_path
      ? `winner-${winnerData.id}`
      : normalized.find(
          (r) =>
            !!r.storage_path &&
            r.media_kind !==
              'file_audio'
        )?.id ?? null;

    setActiveId((prev) =>
      prev ?? (firstPlayable as string | null)
    );

    layoutMap.current.clear();
  };

  const goToProfile = (user?: {
    id: string;
    full_name: string;
  }) => {
    if (!user) return;
    navigation.navigate(
      'Profile',
      {
        user: {
          id: user.id,
          full_name: user.full_name,
        },
      }
    );
  };

  const renderVoteArea = (
    s: Submission & {
      description?: string | null;
    }
  ) => {
    const mine =
      currentUserId &&
      (s as any).user_id ===
        currentUserId;
    const voted = votedIds.has(s.id);
    const count = s.votes || 0;

    return (
      <View style={styles.votePremiumRow}>
        {mine ? (
          <Text style={styles.votePremiumNote}>
            Your submission — you can’t vote
          </Text>
        ) : (
          <TouchableOpacity
            onPress={() =>
              toggleVote(s)
            }
            disabled={voteBusy[s.id]}
            activeOpacity={0.9}
            style={[
              styles.votePremiumBtn,
              voted &&
                styles.votePremiumBtnOn,
              voteBusy[s.id] && {
                opacity: 0.8,
              },
            ]}
          >
            <Text
              style={[
                styles.votePremiumBtnText,
                voted &&
                  styles.votePremiumBtnTextOn,
              ]}
            >
              {voteBusy[s.id]
                ? 'Working…'
                : voted
                ? 'Voted'
                : 'Vote'}
            </Text>
          </TouchableOpacity>
        )}

        <View
          style={
            styles.votePremiumCountWrap
          }
        >
          <Text
            style={
              styles.votePremiumCount
            }
          >
            {voteBusy[s.id]
              ? '…'
              : count}
          </Text>
          <Text
            style={
              styles.votePremiumCountLabel
            }
          >
            votes
          </Text>
        </View>
      </View>
    );
  };

  const toggleVote = async (
    s: Submission & {
      description?: string | null;
    }
  ) => {
    const uid =
      currentUserId ||
      gamUserId ||
      null;

    if (!uid) {
      Alert.alert(
        'Please sign in',
        'You need to be signed in to vote.'
      );
      return;
    }

    const creatorId = (s as any)
      .user_id as
      | string
      | undefined;
    if (
      creatorId &&
      creatorId === uid
    ) {
      // No self-voting
      return;
    }
    if (voteBusy[s.id]) return;

    const alreadyVoted =
      votedIds.has(s.id);

    // If casting a NEW vote: enforce monthly cap
    if (!alreadyVoted) {
      const range =
        currentRangeRef.current;
      if (range) {
        if (
          monthlyVotesUsed >=
          VOTES_PER_MONTH
        ) {
          Alert.alert(
            'No votes left',
            'You’ve used all your votes for this month.'
          );
          return;
        }
      }
    }

    setVoteBusy((prev) => ({
      ...prev,
      [s.id]: true,
    }));

    try {
      if (alreadyVoted) {
        // Remove vote
        const { error } =
          await supabase
            .from('user_votes')
            .delete()
            .eq('user_id', uid)
            .eq(
              'submission_id',
              s.id
            );
        if (error) throw error;

        setVotedIds((prev) => {
          const next =
            new Set(prev);
          next.delete(s.id);
          return next;
        });
        setSubmissions((prev) =>
          prev.map((row) =>
            row.id === s.id
              ? {
                  ...row,
                  votes: Math.max(
                    0,
                    (row.votes ||
                      0) - 1
                  ),
                }
              : row
          )
        );
        setMonthlyVotesUsed(
          (n) =>
            Math.max(0, n - 1)
        );
      } else {
        // Add vote
        const {
          error,
        } = await supabase
          .from('user_votes')
          .insert([
            {
              submission_id: s.id,
              user_id: uid,
            },
          ]);
        if (error) throw error;

        setVotedIds((prev) => {
          const next =
            new Set(prev);
          next.add(s.id);
          return next;
        });
        setSubmissions((prev) =>
          prev.map((row) =>
            row.id === s.id
              ? {
                  ...row,
                  votes:
                    (row.votes ||
                      0) + 1,
                }
              : row
          )
        );
        setMonthlyVotesUsed(
          (n) => n + 1
        );
            // 🔥 Award XP for a successful new vote
        try {
          await giveXp(
            uid,
            VOTE_XP,
            'VOTE_SUBMISSION' as any // or as XpReason if you've added it to the union
          );
          await refreshGamification();
        } catch (xpErr) {
          console.warn('giveXp VOTE_SUBMISSION failed:', xpErr);
        }
      }
    } catch (e: any) {
      console.warn('Vote error:', e?.message || e);
      Alert.alert('Vote failed', 'Please try again.');
    } finally {
      setVoteBusy((prev) => ({
        ...prev,
        [s.id]: false,
      }));
    }
  };


  // Ensure only activeId plays
    // Ensure only activeId plays
  useEffect(() => {
    (async () => {
      if (activeId) {
        await pauseAllExcept(activeId);
      } else {
        await pauseAllExcept(PAUSE_NONE_ID);
      }
    })();
  }, [activeId]);

  const onItemLayout =
    (id: string, playable: boolean) =>
    (e: LayoutChangeEvent) => {
      const { y, height } = e.nativeEvent.layout;
      layoutMap.current.set(id, {
        y,
        h: height,
        playable,
      });
    };

  const pickActiveByCenter = (offsetY: number) => {
    const map = layoutMap.current;
    if (map.size === 0) return null;

    const viewportCenter =
      offsetY +
      (winH - (TOP_BAR_OFFSET + BOTTOM_TAB_H)) * 0.5;

    let bestId: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;

    map.forEach((meta, id) => {
      if (!meta.playable) return;
      const mid = meta.y + meta.h * 0.5;
      const d = Math.abs(mid - viewportCenter);
      if (d < bestDist) {
        bestDist = d;
        bestId = id;
      }
    });

    return bestId;
  };

  const ensureActiveByCenter = (offsetY: number) => {
    const next = pickActiveByCenter(offsetY);
    if (next && next !== activeId) setActiveId(next);
    if (!next && activeId) setActiveId(null);
  };

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 80,
    minimumViewTime: 0,
    waitForInteraction: false,
  }).current;

  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const playable = viewableItems.filter((v) => {
        const it =
          v.item as
            | (Submission & {
                media_kind?: RawSubmission['media_kind'];
                storage_path?: string | null;
              })
            | undefined;
        if (!it) return false;
        return (
          !!it.storage_path &&
          it.media_kind !== 'file_audio' &&
          v.isViewable
        );
      });
      if (playable.length) {
        const candidate = playable[playable.length - 1];
        const id = (candidate.item as Submission).id;
        if (!layoutMap.current.size && id !== activeId) {
          setActiveId(id);
        }
      }
    }
  ).current;

  const viewabilityConfigCallbackPairs = useRef([
    {
      viewabilityConfig,
      onViewableItemsChanged,
    },
  ]).current;

  const onScrollImmediate = useRef(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const y = e.nativeEvent.contentOffset.y;
      lastOffsetY.current = y;
      ensureActiveByCenter(y);
    }
  ).current;

  const onMomentumEnd = useRef(() => {
    ensureActiveByCenter(lastOffsetY.current);
  }).current;

  const onRemoveSubmission = async (
    s: Submission & { description?: string | null }
  ) => {
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
    const webHoverProps =
      Platform.OS === 'web'
        ? {
            onMouseEnter: () => setActiveId(rowId),
            onMouseLeave: () => {
              if (activeId === rowId) {
                setActiveId(null);
                pauseAllExcept(PAUSE_NONE_ID);
              }
            },
          }
        : {};

    if (!s.storage_path) {
      return (
        <View
          {...(webHoverProps as any)}
          style={[
            styles.videoOuter,
            {
              maxWidth: cardW,
              maxHeight: availableHForMedia,
            },
          ]}
        >
          <View
            style={{
              width: '100%',
              aspectRatio: 16 / 9,
            }}
          />
          <View style={styles.aspectFill}>
            <Image
              source={{
                uri: 'https://picsum.photos/1600/900',
              }}
              style={{
                width: '100%',
                height: '100%',
                borderRadius: RADIUS_XL,
              }}
              resizeMode="cover"
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
              maxWidth: cardW,
              backgroundColor: T.card,
              maxHeight: availableHForMedia,
            },
          ]}
        >
          <View
            style={{
              width: '100%',
              padding: 12,
            }}
          >
            <HostedAudioInline
              playerId={rowId}
              storagePath={s.storage_path}
              autoPlay={isActive}
            />
          </View>
        </View>
      );
    }

    return (
      <View
        {...(webHoverProps as any)}
        style={[
          styles.videoOuter,
          {
            maxWidth: cardW,
            maxHeight: availableHForMedia,
          },
        ]}
      >
        <HostedVideoInline
          playerId={rowId}
          storagePath={s.storage_path!}
          width={cardW}
          maxHeight={availableHForMedia}
          autoPlay={isActive}
          posterUri={s.thumbnail_url ?? null}
          dimVignette={isWinnerRow}
        />
      </View>
    );
  };

  const renderHeroOverlay = (
    s: Submission & { users?: { id: string; full_name: string } }
  ) => {
    const name = (s as any)?.users?.full_name;
    const userObj = (s as any)?.users;

    return (
      <View
        style={styles.heroOverlay}
        pointerEvents="box-none"
      >
        <View
          style={styles.heroOverlayInner}
          pointerEvents="none"
        >
          <Text style={styles.heroKicker}>
            LAST MONTH’S WINNER
          </Text>
          <Text
            style={styles.heroTitle}
            numberOfLines={2}
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
            <Text style={styles.heroByline}>by {name}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

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
      const isPlayableVideo =
        !!s.storage_path && s.media_kind !== 'file_audio';

      return (
        <View
          key={rowId}
          onLayout={onItemLayout(rowId, isPlayableVideo)}
          style={[
            styles.cardWrapper,
            isWinnerRow && styles.cardWrapperHero,
          ]}
        >
          <LinearGradient
            colors={
              isWinnerRow
                ? [T.heroBurgundy1, T.heroBurgundy2]
                : ['#0D0D0D', '#050505']
            }
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[
              styles.cardBorder,
              { alignSelf: 'center' },
            ]}
          >
            <View
              style={[
                styles.card,
                isWinnerRow && styles.cardHero,
              ]}
            >
              {isWinnerRow ? (
                <>
                  <View
                    style={[
                      styles.heroRow,
                      {
                        maxWidth: cardW,
                        maxHeight: availableHForMedia,
                        alignSelf: 'center',
                      },
                    ]}
                  >
                    {renderMedia(
                      rowId,
                      s,
                      isActive,
                      true
                    )}
                    <LinearGradient
                      colors={[
                        'rgba(0,0,0,0.0)',
                        'rgba(0,0,0,0.35)',
                        'rgba(0,0,0,0.80)',
                      ]}
                      start={{ x: 0.2, y: 0.2 }}
                      end={{ x: 0.8, y: 1 }}
                      style={[
                        StyleSheet.absoluteFillObject,
                        { borderRadius: RADIUS_XL },
                      ]}
                      pointerEvents="none"
                    />
                    <Grain opacity={0.05} />
                    {renderHeroOverlay(s)}
                  </View>
                </>
              ) : (
                <>
                  {renderMedia(
                    rowId,
                    s,
                    isActive,
                    false
                  )}
                  <Grain opacity={0.05} />
                  <View
                    style={[
                      styles.content,
                      { width: cardW },
                    ]}
                  >
                    <View style={styles.titleWrap}>
                      <Text
                        style={styles.title}
                        numberOfLines={2}
                      >
                        {s.title}
                      </Text>
                    </View>

                    {s.users?.full_name ? (
                      <TouchableOpacity
                        onPress={() =>
                          goToProfile(s.users)
                        }
                        activeOpacity={0.9}
                      >
                        <Text style={styles.byline}>
                          by {s.users.full_name}
                        </Text>
                      </TouchableOpacity>
                    ) : null}

                    {!!s.description && (
                      <Text style={styles.description}>
                        {s.description}
                      </Text>
                    )}

                    <View style={styles.actionsRow}>
                      {renderVoteArea(s)}
                    </View>

                    {currentUserId &&
                    (s as any).user_id === currentUserId ? (
                      <View style={{ marginTop: 8 }}>
                        <TouchableOpacity
                          style={[
                            styles.ghostBtn,
                            (deleteBusy[s.id] ||
                              (s as any).is_winner) &&
                              styles.ghostBtnDisabled,
                          ]}
                          disabled={
                            !!deleteBusy[s.id] ||
                            (s as any).is_winner
                          }
                          onPress={() => {
                            const doRemove = () =>
                              onRemoveSubmission(
                                s as any
                              );
                            if (
                              Platform.OS ===
                              'web'
                            ) {
                              const ok =
                                typeof window !==
                                  'undefined' &&
                                window.confirm(
                                  'Remove submission? This will remove it and its votes.'
                                );
                              if (ok)
                                doRemove();
                            } else {
                              Alert.alert(
                                'Remove submission?',
                                'This will remove it and its votes.',
                                [
                                  {
                                    text: 'Cancel',
                                    style: 'cancel',
                                  },
                                  {
                                    text: 'Remove',
                                    style: 'destructive',
                                    onPress:
                                      doRemove,
                                  },
                                ]
                              );
                            }
                          }}
                        >
                          <Text
                            style={
                              styles.ghostText
                            }
                          >
                            {deleteBusy[s.id]
                              ? 'Removing…'
                              : (s as any)
                                  .is_winner
                              ? 'Winner (locked)'
                              : 'Remove'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    ) : null}
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
    ]
  );

  const headerElement = useMemo(
    () => (
      <View style={{ alignItems: 'center' }}>
        <View
          style={[
            styles.subHeaderWrap,
            {
              width: cardW,
              marginBottom: isNarrow ? 6 : 2,
            },
          ]}
          onLayout={() => {
            layoutMap.current.set(
              'category-header',
              {
                y: 0,
                h: 0,
                playable: false,
              }
            );
          }}
        >
          <CategoryTabs
            value={category}
            onChange={(c) => {
              setCategory(c);
              setSearchText('');
              setSearchQ('');
            }}
            width={winW}
          />
        </View>

        {winner
          ? renderCard(
              `winner-${winner.id}`,
              winner,
              activeId === `winner-${winner.id}`,
              true
            )
          : null}

        <View
          style={{
            height: isNarrow ? 12 : 10,
          }}
        />

        <View
          style={[
            styles.subHeaderWrap,
            {
              width: cardW,
              marginTop: 4,
            },
          ]}
          onLayout={() => {
            layoutMap.current.set(
              'submissions-header',
              {
                y: 0,
                h: 0,
                playable: false,
              }
            );
          }}
        >
          <HeaderControls
            compact={isNarrow}
            category={category}
            sort={sort}
            setSort={setSort}
            searchText={searchText}
            setSearchText={setSearchText}
          />
        </View>
      </View>
    ),
    [
      cardW,
      category,
      sort,
      searchText,
      winner,
      activeId,
      winW,
      isNarrow,
    ]
  );

  const renderSubmissionItem = ({
    item,
  }: {
    item: Submission & {
      description?: string | null;
      storage_path?: string | null;
      thumbnail_url?: string | null;
      media_kind?: RawSubmission['media_kind'];
      category?: Category | null;
    };
  }) =>
    renderCard(
      item.id,
      item,
      activeId === item.id,
      false
    );

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[
          T.heroBurgundy1,
          T.heroBurgundy2,
          T.bg,
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 0.75 }}
        style={StyleSheet.absoluteFillObject}
      />
      <Grain opacity={0.05} />

      {loading && submissions.length === 0 ? (
        <ActivityIndicator
          style={{
            marginTop: CONTENT_TOP_PAD + 8,
          }}
          color={T.accent}
        />
      ) : (
        <FlatList
          data={submissions}
          renderItem={renderSubmissionItem}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={headerElement}
          ItemSeparatorComponent={() => (
            <View style={{ height: 14 }} />
          )}
          contentContainerStyle={[
            styles.listContent,
            {
              paddingTop: CONTENT_TOP_PAD,
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
          viewabilityConfigCallbackPairs={
            viewabilityConfigCallbackPairs
          }
          onEndReachedThreshold={0.4}
          onScroll={onScrollImmediate}
          onMomentumScrollEnd={onMomentumEnd}
          scrollEventThrottle={16}
          onContentSizeChange={() =>
            ensureActiveByCenter(
              lastOffsetY.current
            )
          }
          onLayout={() =>
            ensureActiveByCenter(
              lastOffsetY.current
            )
          }
        />
      )}
    </View>
  );
};

const RADIUS_XL = 18;

/* ──────────────────────────────────────────────────────────── */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  listContent: { paddingHorizontal: 16 },

  topControls: {
    alignSelf: 'center',
    width: '100%',
    gap: 4,
    paddingVertical: 0,
    marginBottom: 0,
  },
  controlsBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },

  subHeaderWrap: {
    alignSelf: 'center',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },

  catRow: {
    marginTop: 6,
    flexDirection: 'row',
    alignSelf: 'center',
    gap: 18,
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  catTap: { alignItems: 'center' },
  catText: {
    color: '#FFFFFF',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontSize: 13,
  },
  catTextActive: { color: GOLD },
  catUnderline: {
    marginTop: 6,
    height: 3,
    width: 42,
    backgroundColor: GOLD,
    borderRadius: 2,
  },

  searchWrap: {
    width: '100%',
    maxWidth: 680,
    alignSelf: 'center',
    position: 'relative',
  },
  searchInput: {
    backgroundColor: '#0F0F0F',
    borderRadius: 10,
    paddingLeft: 12,
    paddingRight: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    fontSize: 14,
    color: T.text,
    minWidth: 220,
    fontFamily: SYSTEM_SANS,
    letterSpacing: 0.5,
    fontWeight: '600',
  },

  sortRow: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  sortTextBtn: {
    alignItems: 'center',
    paddingVertical: 0,
  },
  sortText: {
    color: '#FFFFFF',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontSize: 10,
  },
  sortTextActive: { color: '#FFFFFF' },
  sortUnderline: {
    height: 1.5,
    width: 26,
    backgroundColor: '#FFFFFF',
    opacity: 0.22,
    marginTop: 3,
    borderRadius: 2,
  },

  cardWrapper: {
    maxWidth: 1240,
    alignSelf: 'center',
  },
  cardWrapperHero: {
    marginTop: 4,
    marginBottom: 12,
  },
  cardBorder: {
    padding: 1,
    borderRadius: RADIUS_XL + 1,
  },
  card: {
    backgroundColor: T.card,
    borderRadius: RADIUS_XL,
    borderWidth: 1,
    borderColor: '#ffffff12',
    alignItems: 'center',
    overflow: 'hidden',
  },
  cardHero: {
    borderColor: '#ffffff1a',
  },

  videoOuter: {
    position: 'relative',
    borderRadius: RADIUS_XL,
    overflow: 'hidden',
    marginBottom: 0,
    backgroundColor: '#000',
    alignSelf: 'center',
  },
  aspectFill: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: RADIUS_XL,
    overflow: 'hidden',
  },

  heroRow: { position: 'relative' },

  heroOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    zIndex: 10,
  },
  heroOverlayInner: {
    alignItems: 'center',
    justifyContent: 'center',
    pointerEvents: 'none',
  },
  heroKicker: {
    color: '#ffffffdd',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    letterSpacing: 1.0,
    fontSize: 16,
    textTransform: 'uppercase',
    marginBottom: 8,
    textAlign: 'center',
  },
  heroTitle: {
    color: '#fff',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    letterSpacing: 1.4,
    fontSize: 56,
    lineHeight: 62,
    marginBottom: 6,
    textTransform: 'uppercase',
    textAlign: 'center',
  },
  heroBylineTap: { marginTop: 6 },
  heroByline: {
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
    letterSpacing: 0.5,
    fontSize: 18,
    textAlign: 'center',
  },

  content: {
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
  },

  titleWrap: {
    marginBottom: 6,
    width: '100%',
  },
  title: {
    fontSize: 20,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    color: T.text,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    textAlign: 'center',
  },

  byline: {
    fontSize: 14,
    color: GOLD,
    marginBottom: 8,
    letterSpacing: 0.5,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },
  description: {
    fontSize: 15,
    color: '#EDEDED',
    letterSpacing: 0.2,
    marginBottom: 12,
    width: '100%',
    lineHeight: 22,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
    fontWeight: '400',
  },

  actionsRow: {
    width: '100%',
    marginTop: 2,
  },

  progressHit: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 24,
  },
  progressTrack: {
    position: 'absolute',
    left: 10,
    right: 10,
    bottom: 8,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.18)',
    overflow: 'hidden',
    borderRadius: 999,
  },
  progressFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#fff',
    opacity: 0.9,
  },

  votePremiumRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 2,
  },
  votePremiumBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#ffffff22',
    backgroundColor: 'transparent',
  },
  votePremiumBtnOn: {
    borderColor: T.accent,
    backgroundColor: '#00141A',
  },
  votePremiumBtnText: {
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    letterSpacing: 0.5,
    fontSize: 13,
    color: '#FFFFFF',
    textTransform: 'uppercase',
  },
  votePremiumBtnTextOn: {
    color: T.accent,
  },
  votePremiumCountWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 6,
    marginLeft: 'auto',
  },
  votePremiumCount: {
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 18,
    color: '#FFFFFF',
  },
  votePremiumCountLabel: {
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
    fontWeight: '800',
    color: '#E0E0E0',
    textTransform: 'lowercase',
    opacity: 0.92,
  },
  votePremiumNote: {
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
    color: T.mute,
    fontWeight: '800',
  },

  ghostBtn: {
    alignSelf: 'center',
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  ghostBtnDisabled: { opacity: 0.5 },
  ghostText: {
    fontFamily: SYSTEM_SANS,
    color: T.sub,
    fontWeight: '900',
    fontSize: 11,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },

  fsButton: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#ffffff24',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  soundBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#ffffff24',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  soundText: {
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
    color: '#fff',
    fontWeight: '900',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },

  audioWrap: {
    width: '100%',
    borderRadius: 10,
    
    borderWidth: 1,
    borderColor: '#ffffff14',
    backgroundColor: T.card2,
  },
  audioHint: {
    textAlign: 'center',
    paddingVertical: 8,
    color: T.sub,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
  },
});


export default FeaturedScreen;
