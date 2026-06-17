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
    RefreshControl,
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
  InteractionManager,
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
import { Ionicons } from '@expo/vector-icons';
import { Submission } from '../types';
import { supabase, giveXp, XP_VALUES } from '../lib/supabase';
import { useGamification } from '../context/GamificationContext';
import * as Clipboard from 'expo-clipboard';
import { useAuth } from '../context/AuthProvider';
import { useAppRefresh } from '../context/AppRefreshContext';
import { useAppTheme } from '../context/ThemeContext';
import { reportContent, ReportReason } from '../utils/reportContent';
import { blockUser } from '../utils/blockUser';
import { validateMultipleSafeTexts, validateSafeText } from '../utils/moderation';
import { supportUser, unsupportUser } from '../lib/connections';
import ReportContentModal from '../../components/ReportContentModal';
import { useKeyboardLift } from '../utils/useKeyboardLift';


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
  bg: '#050505',
  bg2: '#0D0D0F',
  panel: '#0D0D0F',
  card: '#111114',
  card2: '#16161A',
  outline: 'rgba(255,255,255,0.10)',
  text: '#F4EFE6',
  sub: '#D8D2C8',
  mute: '#8F8578',
  accent: GOLD,
  heroBurgundy1: '#111114',
  heroBurgundy2: '#050505',
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

type SortKey = 'foryou' | 'newest' | 'oldest' | 'mostvoted' | 'leastvoted';
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
    | { id: string; full_name: string; avatar_url?: string | null }
    | { id: string; full_name: string; avatar_url?: string | null }[]
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
    is_removed?: boolean | null;
  removed_reason?: string | null;
  film_category?: string | null;
  mux_upload_id?: string | null;
mux_asset_id?: string | null;
  mux_playback_id?: string | null;
  mux_status?: string | null;
  share_slug?: string | null;
  collaborator_credits?: any[] | null;
  videos?: {
    original_path?: string | null;
    thumbnail_path?: string | null;
    video_variants?: { path: string; label?: string | null }[] | null;
  } | null;
};

type SubmissionCollaborator = {
  id: string;
  submission_id: string;
  user_id: string;
  role?: string | null;
  sort_order?: number | null;
  users?: { id: string; full_name?: string | null; avatar_url?: string | null } | null;
};

type CollaboratorSearchUser = {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
  level?: number | null;
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
    .ovk-video::-webkit-media-controls-overlay-play-button { display: none !important; -webkit-appearance: none !important; }
    .ovk-video::-webkit-media-controls-start-playback-button { display: none !important; -webkit-appearance: none !important; }
    .ovk-video::-webkit-media-controls-volume-slider { display: none !important; }
    .ovk-video::-webkit-media-controls-timeline-container { display: none !important; }
    .ovk-video::-webkit-media-controls-rewind-button { display: none !important; }
    .ovk-video::-webkit-media-controls-return-to-realtime-button { display: none !important; }
  `;
  document.head.appendChild(style);
  CSS_INJECTED = true;
}
injectWebVideoCSS();

const webWarmStore: {
  links: Map<string, HTMLLinkElement>;
  warmVideos: Map<string, HTMLVideoElement>;
} = { links: new Map(), warmVideos: new Map() };

const HLS_JS_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';
let hlsLoadPromise: Promise<any | null> | null = null;

function isHlsUrl(url?: string | null) {
  return !!url && /\.m3u8(?:\?|$)/i.test(url);
}

function loadHlsJs() {
  if (Platform.OS !== 'web') return Promise.resolve(null);
  const existing = (window as any).Hls;
  if (existing) return Promise.resolve(existing);
  if (hlsLoadPromise) return hlsLoadPromise;

  hlsLoadPromise = new Promise((resolve) => {
    const script = document.createElement('script');
    script.src = HLS_JS_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';
    script.onload = () => resolve((window as any).Hls || null);
    script.onerror = () => resolve(null);
    document.head.appendChild(script);
  });

  return hlsLoadPromise;
}

async function setWebVideoSource(el: any, src: string) {
  if (Platform.OS !== 'web') return false;

  const currentSrc = el.getAttribute?.('src') || el.currentSrc || '';
  const existingHls = el.__ovkHls;

  if (!isHlsUrl(src)) {
    if (existingHls) {
      try {
        existingHls.destroy();
      } catch {}
      el.__ovkHls = null;
      el.__ovkHlsSrc = null;
    }

    if (currentSrc !== src) {
      el.src = src;
      try {
        el.load();
      } catch {}
    }

    return false;
  }

  if (el.canPlayType?.('application/vnd.apple.mpegurl')) {
    if (existingHls) {
      try {
        existingHls.destroy();
      } catch {}
      el.__ovkHls = null;
      el.__ovkHlsSrc = null;
    }

    if (currentSrc !== src) {
      el.src = src;
      try {
        el.load();
      } catch {}
    }

    return false;
  }

  const Hls = await loadHlsJs();
  if (!Hls?.isSupported?.()) {
    if (currentSrc !== src) {
      el.src = src;
      try {
        el.load();
      } catch {}
    }
    return false;
  }

  if (el.__ovkHls && el.__ovkHlsSrc === src) return true;

  if (existingHls) {
    try {
      existingHls.destroy();
    } catch {}
  }

  const hls = new Hls({
    enableWorker: true,
    lowLatencyMode: false,
    startLevel: -1,
  });

  el.__ovkHls = hls;
  el.__ovkHlsSrc = src;
  hls.loadSource(src);
  hls.attachMedia(el);

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(null);
    };

    try {
      hls.once(Hls.Events.MANIFEST_PARSED, finish);
      hls.once(Hls.Events.ERROR, finish);
    } catch {
      finish();
    }

    setTimeout(finish, 900);
  });

  return true;
}

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
v.muted = true;
v.playsInline = true;
v.src = href;
try {
  v.load();
} catch {}
webWarmStore.warmVideos.set(href, v);
}

function cleanFilmStoragePath(pathOrUrl: string) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return raw;

  if (/^https?:\/\//i.test(raw)) {
    const storageMatch = raw.match(/\/storage\/v1\/object\/(?:public|sign)\/films\/([^?]+)/i);
    if (storageMatch?.[1]) {
      try {
        return decodeURIComponent(storageMatch[1]);
      } catch {
        return storageMatch[1];
      }
    }

    return raw;
  }

  let path = raw.split('?')[0].trim();
  path = path.replace(/^\/+/, '');
  path = path.replace(/^films\//i, '');
  return path;
}

async function signStoragePath(path: string, expiresInSec = 3600): Promise<string> {
  const cleaned = cleanFilmStoragePath(path);

  if (/^https?:\/\//i.test(cleaned)) {
    webPreloadHref(cleaned);
    webWarmVideo(cleaned);
    return cleaned;
  }

  const now = Date.now();
  const cached = signedUrlCache.get(cleaned);
  if (cached && now < cached.exp - 30_000) return cached.url;
  if (inflight.has(cleaned)) return inflight.get(cleaned)!;

  const p = (async () => {
    const { data, error } = await supabase.storage
      .from('films')
      .createSignedUrl(cleaned, expiresInSec);
    if (error || !data) {
      inflight.delete(cleaned);
      throw error ?? new Error('Failed to sign media URL');
    }
    const url = data.signedUrl;
    signedUrlCache.set(cleaned, { url, exp: now + expiresInSec * 1000 });
    webPreloadHref(url);
    webWarmVideo(url);
    inflight.delete(cleaned);
    return url;
  })();

  inflight.set(cleaned, p);
  return p;
}

/* ---------------- Select smallest / fast-start variants ---------------- */
function pickSmallestVariant(row: any): { path: string | null; thumb: string | null } {
  const variants = row?.videos?.video_variants ?? [];

  if (variants && variants.length > 0) {
    const scored = variants
      .map((v: any) => {
        const m = /(\d{3,4})p/i.exec(v?.label || '');
        return { ...v, h: m ? parseInt(m[1], 10) : 9999 };
      })
      .sort((a: any, b: any) => a.h - b.h);

    const smallest = scored[0] ?? variants[0];

    return {
      path:
        smallest?.path ??
        row?.videos?.original_path ??
        row?.video_path ??
        row?.storage_path ??
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

function pickFastStartVariant(row: any): { path: string | null; thumb: string | null } {
  const variants = row?.videos?.video_variants ?? [];

  if (variants && variants.length > 0) {
    const scored = variants
      .map((v: any) => {
        const label = String(v?.label || '').toLowerCase();
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
      path: best?.path ?? null,
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

/* ---------------- Player registry ---------------- */
type PlayerHandle = { pause: () => Promise<void> | void; id: string };
const playerRegistry = new Map<string, PlayerHandle>();
const PAUSE_NONE_ID = '__NONE__';

async function pauseAllExcept(
  id?: string | null,
  options: { preserveWinner?: boolean } = {}
) {
  const target = id || PAUSE_NONE_ID;
  const preserveWinner =
    options.preserveWinner ?? (target === PAUSE_NONE_ID || target.startsWith('winner-'));
  const ops: Promise<void>[] = [];
  playerRegistry.forEach((h) => {
    if (preserveWinner && Platform.OS === 'web' && h.id.startsWith('winner-') && h.id !== target) {
      return;
    }
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

function formatPlayerTime(seconds?: number | null) {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds || 0) ? seconds || 0 : 0));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function formatWatchDateShort(dateString?: string | null) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (!Number.isFinite(date.getTime())) return null;

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatVoteCount(count?: number | null) {
  const value = Math.max(0, Math.floor(count ?? 0));
  return `${value} vote${value === 1 ? '' : 's'}`;
}

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

function warmPlayableUrl(url?: string | null) {
  if (!url) return;
  if (Platform.OS === 'web') {
    if (isHlsUrl(url)) {
      loadHlsJs().catch(() => {});
    }
    webPreloadHref(url);
    webWarmVideo(url);
  }
}
function isMuxReady(status?: string | null) {
  const s = String(status || '').toLowerCase();
  return s === 'ready' || s === 'asset_ready' || s === 'playable';
}

function getMuxPlaybackUrl(playbackId?: string | null) {
  if (!playbackId) return null;
  return `https://stream.mux.com/${playbackId}.m3u8`;
}

function getWinnerMuxPlaybackUrl(playbackId?: string | null) {
  if (!playbackId) return null;
  return `https://stream.mux.com/${playbackId}.m3u8`;
}

function getMuxFallbackPlaybackUrls(url?: string | null) {
  if (!url || Platform.OS !== 'web') return [];
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
  if (!url || Platform.OS !== 'web') return url ? [{ label: 'Auto', uri: url }] : [];
  const match = String(url).match(/stream\.mux\.com\/([^/.?]+)/);
  if (!match?.[1]) return [{ label: 'Auto', uri: url }];

  const playbackId = match[1];
  return [
    { label: 'Auto', uri: `https://stream.mux.com/${playbackId}.m3u8` },
    { label: 'High', uri: `https://stream.mux.com/${playbackId}/high.mp4` },
    { label: 'Medium', uri: `https://stream.mux.com/${playbackId}/medium.mp4` },
    { label: 'Low', uri: `https://stream.mux.com/${playbackId}/low.mp4` },
  ];
}
function HostedVideoInline({
  playerId,
  storagePath,
  storagePathCandidates,
  directUri,
  width,
  maxHeight,
  autoPlay,
  autoPlayWithSound = false,
  posterUri,
  dimVignette = true,
  showControls = true,
  showProgress = true,
  captureSurfacePress = true,
  surfacePressMode = 'hold',
  fixedAspect,
  fitToVideoFrame = false,
  squareCorners = false,
  playRequestKey,
  preferDirectUriFirst = false,
  transparentUntilReady = false,
  loop = true,
  onPlaybackEnd,
}: {
  playerId: string;
  storagePath?: string | null;
  storagePathCandidates?: Array<string | null | undefined>;
  directUri?: string | null;
  width: number;
  maxHeight: number;
  autoPlay: boolean;
  autoPlayWithSound?: boolean;
  posterUri?: string | null;
  dimVignette?: boolean;
  showControls?: boolean;
  showProgress?: boolean;
  captureSurfacePress?: boolean;
  surfacePressMode?: 'hold' | 'toggle';
  fixedAspect?: number;
  fitToVideoFrame?: boolean;
  squareCorners?: boolean;
  playRequestKey?: number | string;
  preferDirectUriFirst?: boolean;
  transparentUntilReady?: boolean;
  loop?: boolean;
  onPlaybackEnd?: () => void;
}){
  
  const { colors, isLight } = useAppTheme();
  const ref = useRef<Video>(null);
  const htmlRef = useRef<any>(null);
  const playerRootRef = useRef<any>(null);
  const [sourceOptions, setSourceOptions] = useState<VideoSourceOption[]>([]);
  const [sourceIndex, setSourceIndex] = useState(0);
const [videoReady, setVideoReady] = useState(false);
  const [sourcesResolved, setSourcesResolved] = useState(false);
  const [isMediaLoading, setIsMediaLoading] = useState(autoPlay);
  const [mediaUnavailable, setMediaUnavailable] = useState(false);

const opacity = useRef(new Animated.Value(0)).current;
const [aspect, setAspect] = useState<number>(16 / 9);
  const controlsOpacity = useRef(new Animated.Value(0)).current;
  const cueOpacity = useRef(new Animated.Value(0)).current;
  const cueScale = useRef(new Animated.Value(0.92)).current;
  const cueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantsPlayRef = useRef(autoPlay);
  const finishedRef = useRef(false);

  const [muted, setMuted] = useState(!autoPlayWithSound);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackCue, setPlaybackCue] = useState<'play' | 'pause'>('play');
  const [playbackCueActive, setPlaybackCueActive] = useState(false);
  const [playerChromeVisible, setPlayerChromeVisible] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const playerChromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const progressRef = useRef<View>(null);
  const [progressRailWidth, setProgressRailWidth] = useState(1);
  const [seeking, setSeeking] = useState(false);
  const isWinnerPlayer = playerId.startsWith('winner-');
  const storageCandidateKey = [
    storagePath || '',
    ...(storagePathCandidates || []).filter(Boolean).map((candidate) => String(candidate)),
  ].join('|');
  const directFirst = isWinnerPlayer || preferDirectUriFirst;


  useEffect(() => {
    const handle: PlayerHandle = {
      id: playerId,
      pause: async () => {
        wantsPlayRef.current = false;
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
      try {
        htmlRef.current?.__ovkHls?.destroy?.();
      } catch {}
      playerRegistry.delete(playerId);
    };
  }, [playerId]);

  useEffect(() => {
  let alive = true;
  setSourcesResolved(false);
  setMediaUnavailable(false);
  setIsMediaLoading(true);

  (async () => {
    const nextOptions: VideoSourceOption[] = [];
    let hasPublishedInitialSources = false;

    const publishSources = (reset: boolean) => {
      if (!alive) return;

      const deduped = nextOptions.filter(
        (candidate, index, arr) =>
          !!candidate.uri && arr.findIndex((item) => item.uri === candidate.uri) === index
      );

      setSourceOptions(deduped);
      if (deduped.length > 0) {
        setMediaUnavailable(false);
      }
      if (reset) {
        setSourceIndex(0);
        setQualityMenuOpen(false);
        setVideoReady(false);
        opacity.setValue(0);
      }
    };

    if (directUri && directFirst) {
      if (isWinnerPlayer) {
        nextOptions.push({ label: 'Auto', uri: directUri });
      } else {
        nextOptions.push(...getMuxPlaybackOptions(directUri));
      }
      publishSources(true);
      hasPublishedInitialSources = true;
    }

    const rawStorageCandidates = [
      storagePath,
      ...(storagePathCandidates || []),
    ].filter(Boolean) as string[];

    const storageCandidates = rawStorageCandidates.filter(
      (candidate, index, arr) =>
        arr.findIndex((item) => cleanFilmStoragePath(item) === cleanFilmStoragePath(candidate)) === index
    );

    for (const candidate of storageCandidates) {
      try {
        const url = await signStoragePath(candidate, 3600);
        nextOptions.push({
          label: nextOptions.length === 0 ? 'Auto' : `Backup ${nextOptions.length}`,
          uri: url,
        });
        publishSources(!hasPublishedInitialSources);
        hasPublishedInitialSources = true;
      } catch (e) {
        console.warn('[HostedVideoInline] storage source failed', e);
      }
    }

    if (directUri && !directFirst) {
      nextOptions.push(...getMuxPlaybackOptions(directUri));
      publishSources(!hasPublishedInitialSources);
      hasPublishedInitialSources = true;
    }

    if (!hasPublishedInitialSources) {
      publishSources(true);
    }

    if (alive) {
      setSourcesResolved(true);
      if (nextOptions.length === 0) {
        setMediaUnavailable(true);
        setIsMediaLoading(false);
      }
    }
  })();

  return () => {
    alive = false;
  };
}, [storageCandidateKey, directUri, directFirst]);

  const src = sourceOptions[sourceIndex]?.uri ?? null;
  const selectedQualityLabel = sourceOptions[sourceIndex]?.label ?? 'Auto';

  useEffect(() => {
    finishedRef.current = false;
    setMediaUnavailable(false);
    setIsMediaLoading(src ? autoPlay || wantsPlayRef.current : !sourcesResolved);
  }, [src, playRequestKey]);

  const flashPlaybackCue = (nextCue: 'play' | 'pause') => {
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

  const play = async (ensureSound = false): Promise<boolean> => {
    wantsPlayRef.current = true;
    finishedRef.current = false;
    setMediaUnavailable(false);
    setIsMediaLoading(true);
    try {
      await pauseAllExcept(playerId);
      if (Platform.OS === 'web') {
        const el = htmlRef.current;
        if (!el || !src) return false;

        const managedHlsSource = await setWebVideoSource(el, src);

        if (ensureSound) {
          el.muted = false;
          setMuted(false);
        }

        el.controls = false;
        el.autoplay = true;
        el.playsInline = true;
        el.preload = 'auto';

        if (!managedHlsSource && el.readyState === 0) {
          try {
            el.load();
          } catch {}
        }

        const tryPlay = async () => {
          try {
            await el.play();
            return true;
          } catch {
            return false;
          }
        };

        let started = await tryPlay();

        if (!started && ensureSound) {
          el.muted = true;
          setMuted(true);
          await new Promise((resolve) => setTimeout(resolve, 40));
          started = await tryPlay();
        }

        if (!started) {
          await new Promise((resolve) => setTimeout(resolve, 120));
          started = await tryPlay();
        }

        const playing = started && !el.paused;
        setIsPlaying(playing);
        if (playing) {
          setIsMediaLoading(false);
          setVideoReady(true);
          fadeIn();
        }
        return playing;
      } else {
        if (ensureSound) {
          await ref.current?.setIsMutedAsync(false);
          setMuted(false);
        }
        await ref.current?.playAsync();
        setIsPlaying(true);
        setIsMediaLoading(false);
        setVideoReady(true);
        fadeIn();
        return true;
      }
    } catch {
      setIsPlaying(false);
      return false;
    }
  };

  const pause = async () => {
    wantsPlayRef.current = false;
    try {
      if (Platform.OS === 'web') {
        const el = htmlRef.current;
        if (!el) return;
        el.pause();
        setIsPlaying(false);
      } else {
        await ref.current?.pauseAsync();
        setIsPlaying(false);
      }
    } catch {}
    setIsMediaLoading(false);
  };

  useEffect(() => {
    const playTimers: ReturnType<typeof setTimeout>[] = [];

    (async () => {
      if (!src) return;

      const shouldPlayWhenReady = autoPlay || wantsPlayRef.current;

      if (shouldPlayWhenReady) {
        const playWithSound = autoPlay ? autoPlayWithSound : true;
        wantsPlayRef.current = true;
        setIsMediaLoading(true);
        if (Platform.OS === 'web') {
          if (htmlRef.current) {
            htmlRef.current.muted = !playWithSound;
            htmlRef.current.controls = false;
          }
        } else {
          try {
            await ref.current?.setIsMutedAsync(!playWithSound);
          } catch {}
        }
        setMuted(!playWithSound);
        const requestPlay = () => {
          if (!wantsPlayRef.current) return;
          void play(playWithSound);
        };

        if (Platform.OS === 'web' && typeof requestAnimationFrame !== 'undefined') {
          requestAnimationFrame(requestPlay);
        }
        const retryDelays = Platform.OS === 'web' ? [0, 90, 240, 520, 1100] : [0, 180, 500];
        retryDelays.forEach((delay) => {
          playTimers.push(setTimeout(requestPlay, delay));
        });
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
        setIsMediaLoading(false);
      }
    })();
    return () => {
      playTimers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, autoPlay, autoPlayWithSound, playRequestKey]);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const id = window.setInterval(() => {
      const el = htmlRef.current;
      if (el) el.controls = false;
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  const revealPlayerChrome = useCallback(() => {
    setPlayerChromeVisible(true);
    if (playerChromeTimerRef.current) clearTimeout(playerChromeTimerRef.current);
    if (isPlaying) {
      playerChromeTimerRef.current = setTimeout(() => setPlayerChromeVisible(false), 2200);
    }
  }, [isPlaying]);

  useEffect(
    () => () => {
      if (playerChromeTimerRef.current) clearTimeout(playerChromeTimerRef.current);
      if (cueTimerRef.current) clearTimeout(cueTimerRef.current);
    },
    []
  );

  const controlsVisible = (videoReady || isPlaying || seeking) && (playerChromeVisible || !isPlaying || seeking);
  const playerHoverProps =
    Platform.OS === 'web'
      ? {
          onMouseEnter: revealPlayerChrome,
          onMouseMove: revealPlayerChrome,
          onMouseLeave: () => {
            if (!seeking) setPlayerChromeVisible(false);
          },
        }
      : {};

  useEffect(() => {
    Animated.timing(controlsOpacity, {
      toValue: controlsVisible ? 1 : 0,
      duration: controlsVisible ? 130 : 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [controlsOpacity, controlsVisible]);

const onSurfacePressIn = async () => {
  revealPlayerChrome();
  const didPlay = await play(autoPlayWithSound);
  flashPlaybackCue(didPlay ? 'play' : 'pause');
};

const onSurfacePressOut = async () => {
  await pause();
  flashPlaybackCue('pause');
};

const onSurfaceTogglePress = async () => {
  revealPlayerChrome();
  if (isPlaying) {
    await pause();
    flashPlaybackCue('pause');
  } else {
    const didPlay = await play(autoPlayWithSound);
    flashPlaybackCue(didPlay ? 'play' : 'pause');
  }
};

  const maybeUpdateAspectFromStatus = (status?: AVPlaybackStatus) => {
    if (!status || !('isLoaded' in status) || !status.isLoaded) return;

    const ns: any = (status as any).naturalSize;
    updateAspectFromDims(ns?.width, ns?.height);

    setIsPlaying((status as any).isPlaying ?? false);
    if ((status as any).isBuffering && (wantsPlayRef.current || (status as any).isPlaying)) {
      setIsMediaLoading(true);
    } else if ((status as any).isPlaying || videoReady) {
      setIsMediaLoading(false);
    }

    const dur = (status as any).durationMillis ?? 0;
    const pos = (status as any).positionMillis ?? 0;
    setDuration(dur / 1000);

    if (dur > 0) {
      setProgress(Math.max(0, Math.min(1, pos / dur)));
    }

    if (!loop && (status as any).didJustFinish) {
      handlePlaybackEnd();
    }
  };

  const handlePlaybackEnd = () => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    wantsPlayRef.current = false;
    setIsPlaying(false);
    onPlaybackEnd?.();
  };

  const handleLoad = (status?: AVPlaybackStatus) => {
  if (Platform.OS !== 'web') {
    maybeUpdateAspectFromStatus(status);
    setVideoReady(true);
    setIsMediaLoading(false);
    fadeIn();
  }
};

  const handleReadyForDisplay = (evt?: any) => {
  if (Platform.OS !== 'web') {
    const ns = evt?.naturalSize;
    updateAspectFromDims(ns?.width, ns?.height);
  }
  setVideoReady(true);
  setIsMediaLoading(false);
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
  setVideoReady(true);
  setIsMediaLoading(false);
  fadeIn();
  if (wantsPlayRef.current) {
    const playWithSound = autoPlay ? autoPlayWithSound : true;
    setTimeout(() => {
      void play(playWithSound);
    }, 25);
  }
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

  const handleMediaError = () => {
    if (sourceIndex < sourceOptions.length - 1) {
      setVideoReady(false);
      setIsMediaLoading(true);
      opacity.setValue(0);
      setSourceIndex((prev) => Math.min(prev + 1, sourceOptions.length - 1));
      return;
    }

    setVideoReady(true);
    setMediaUnavailable(true);
    setIsMediaLoading(false);
    setIsPlaying(false);
  };

  const selectQuality = (index: number) => {
    if (index === sourceIndex) {
      setQualityMenuOpen(false);
      return;
    }

    let resumeAt = 0;
    const shouldResume = wantsPlayRef.current || isPlaying;
    try {
      if (Platform.OS === 'web') {
        resumeAt = htmlRef.current?.currentTime || 0;
      }
    } catch {}

    setQualityMenuOpen(false);
    setSourceIndex(index);
    setVideoReady(false);
    setIsMediaLoading(true);
    setMediaUnavailable(false);
    opacity.setValue(0);
    wantsPlayRef.current = shouldResume;

    setTimeout(async () => {
      try {
        if (Platform.OS === 'web' && htmlRef.current && resumeAt > 0) {
          htmlRef.current.currentTime = resumeAt;
        } else if (Platform.OS !== 'web' && ref.current && resumeAt > 0) {
          await ref.current.setPositionAsync(resumeAt * 1000);
        }
      } catch {}
      if (shouldResume) void play(autoPlayWithSound);
    }, 80);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = () => {
      const el = htmlRef.current as any;
      const root = playerRootRef.current as any;
      const fs = (document as any).fullscreenElement;
      if (el && (fs === el || fs === root)) {
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
        const root = playerRootRef.current as any;
        const el = htmlRef.current as any;
        if (root?.requestFullscreen) await root.requestFullscreen();
        else if (el?.requestFullscreen) await el.requestFullscreen();
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

  const seekToRatio = (ratio: number) => {
    const next = Math.max(0, Math.min(1, ratio));
    const d = duration || 0;
    setProgress(next);
    if (d <= 0) return;
    if (Platform.OS === 'web' && htmlRef.current) {
      htmlRef.current.currentTime = next * d;
    } else if (ref.current) {
      void ref.current.setPositionAsync(next * d * 1000);
    }
  };

  const setFromRailLocation = (locationX: number) => {
    seekToRatio(locationX / Math.max(1, progressRailWidth));
  };

  const setFromClientX = (clientX: number) => {
    if (!progressRef.current) return;
    const el: any = progressRef.current;
    const rect = el.getBoundingClientRect
      ? el.getBoundingClientRect()
      : { left: 0, width: progressRailWidth || 1 };
    seekToRatio((clientX - rect.left) / Math.max(1, rect.width));
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

  const playerRadius = squareCorners ? 0 : RADIUS_XL;
  const playerAspect = fixedAspect ?? aspect;
  const rawPlayerHeight = width / playerAspect;
  const shouldClampPlayerHeight = fitToVideoFrame && maxHeight > 0 && rawPlayerHeight > maxHeight;
  const playerWidth = shouldClampPlayerHeight ? maxHeight * playerAspect : width;
  const playerHeight = shouldClampPlayerHeight ? maxHeight : rawPlayerHeight;
  const playerBackground =
    transparentUntilReady && !videoReady ? 'transparent' : '#000';
  const progressPct = Math.max(0, Math.min(100, progress * 100));
  const elapsedLabel = formatPlayerTime(duration * progress);
  const durationLabel = duration > 0 ? formatPlayerTime(duration) : '0:00';
  const compactControls = width < 520;
  const showUnavailableOverlay = mediaUnavailable || (!src && sourcesResolved);
  const showLoadingOverlay =
    !showUnavailableOverlay &&
    (isMediaLoading ||
      (!videoReady && (autoPlay || wantsPlayRef.current || !sourcesResolved)));

  return (
    <View
      ref={playerRootRef}
      {...(playerHoverProps as any)}
      style={{
        width: fitToVideoFrame ? playerWidth : width,
        height: fitToVideoFrame ? playerHeight : undefined,
        aspectRatio: fitToVideoFrame ? undefined : (playerAspect as any),
        borderRadius: playerRadius,
        overflow: 'hidden',
        backgroundColor: playerBackground,
        alignSelf: 'center',
        position: 'relative',
      }}
    >
      {posterUri && !videoReady ? (
  <Image
    source={{ uri: posterUri }}
    style={[
      StyleSheet.absoluteFillObject,
      {
        zIndex: 1,
        width: '100%',
        height: '100%',
      },
    ]}
    resizeMode="contain"
  />
) : null}

<Animated.View
  style={[
    StyleSheet.absoluteFillObject,
    {
      opacity,
      zIndex: 2,
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
                background: playerBackground,
              } as any
            }
            loop={loop}
playsInline
autoPlay={autoPlay}
muted={muted}
preload={autoPlay ? 'auto' : 'metadata'}
controls={false}
// @ts-ignore
controlsList="nodownload noplaybackrate noremoteplayback nofullscreen"
disablePictureInPicture
onContextMenu={(e: any) => e.preventDefault()}
onLoadStart={() => {
  setMediaUnavailable(false);
  if (autoPlay || wantsPlayRef.current) setIsMediaLoading(true);
}}
onLoadedMetadata={onWebLoadedMeta}
onCanPlay={() => {
  setVideoReady(true);
  setIsMediaLoading(false);
  fadeIn();
  if (wantsPlayRef.current) {
    void play(autoPlay ? autoPlayWithSound : true);
  }
}}
onLoadedData={() => {
  setVideoReady(true);
  setIsMediaLoading(false);
  fadeIn();
  if (wantsPlayRef.current) {
    void play(autoPlay ? autoPlayWithSound : true);
  }
}}
onTimeUpdate={onWebTimeUpdate}
onWaiting={() => setIsMediaLoading(true)}
onStalled={() => setIsMediaLoading(true)}
onPlay={() => setIsPlaying(true)}
onPlaying={() => {
  setIsPlaying(true);
  setIsMediaLoading(false);
}}
onEnded={handlePlaybackEnd}
onPause={() => setIsPlaying(false)}
onError={handleMediaError}
/>
        ) : (
          <Video
            ref={ref}
            source={src ? { uri: src } : undefined}
            style={{ width: '100%', height: '100%' }}
            resizeMode={ResizeMode.CONTAIN}
            isLooping={loop}
            shouldPlay={autoPlay}
            isMuted={muted}
            useNativeControls={false}
            usePoster
            posterSource={posterUri ? { uri: posterUri } : undefined}
            posterStyle={[StyleSheet.absoluteFillObject, { borderRadius: playerRadius }]}
            onLoad={handleLoad}
            onReadyForDisplay={(evt: any) => {
              handleReadyForDisplay(evt);
              if (wantsPlayRef.current) {
                void play(autoPlay ? autoPlayWithSound : true);
              }
            }}
            onFullscreenUpdate={handleFsUpdate}
            onPlaybackStatusUpdate={maybeUpdateAspectFromStatus}
            onError={handleMediaError as any}
            progressUpdateIntervalMillis={150}
          />
        )}
      </Animated.View>

      {showLoadingOverlay || showUnavailableOverlay ? (
        <View pointerEvents="none" style={styles.playerLoadingOverlay}>
          <View style={styles.playerLoadingBubble}>
            <ActivityIndicator color={GOLD} />
          </View>
          {showUnavailableOverlay && !transparentUntilReady ? (
            <Text style={styles.playerLoadingText} numberOfLines={1}>
              Video is still processing
            </Text>
          ) : null}
        </View>
      ) : null}

      {!isWinnerPlayer && captureSurfacePress ? (
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
        <Ionicons
          name={playbackCueActive ? playbackCue : isPlaying ? 'pause' : 'play'}
          size={34}
          color="#fff"
        />
      </Animated.View>
      ) : null}

      {captureSurfacePress ? (
  <Pressable
    onPress={
      surfacePressMode === 'toggle'
        ? onSurfaceTogglePress
        : () => {}
    }
    onPressIn={
      surfacePressMode === 'hold'
        ? onSurfacePressIn
        : undefined
    }
    onPressOut={
      surfacePressMode === 'hold'
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

      {!showControls && showProgress ? (
        <Animated.View
          ref={progressRef}
          pointerEvents={controlsVisible ? 'auto' : 'none'}
          style={[styles.progressHit, { opacity: controlsOpacity }]}
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
            <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            <View style={[styles.progressThumb, { left: `${progressPct}%` }]} />
          </View>
        </Animated.View>
      ) : null}

      {showControls ? (
        <Animated.View
          pointerEvents={controlsVisible ? 'box-none' : 'none'}
          style={[styles.playerChromeDock, { opacity: controlsOpacity }]}
        >
          {showProgress ? (
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
              {...(Platform.OS === 'web'
                ? {
                    onMouseDown: (e: any) => {
                      setSeeking(true);
                      setFromClientX(e.clientX);
                    },
                  }
                : {})}
            >
              <View style={styles.playerTimelineTrack}>
                <View style={[styles.playerTimelineFill, { width: `${progressPct}%` }]} />
                <View style={[styles.playerTimelineThumb, { left: `${progressPct}%` }]} />
              </View>
            </View>
          ) : null}

          <View style={styles.playerControlRow}>
            <View style={styles.playerControlLeft}>
              <TouchableOpacity
                onPress={onSurfaceTogglePress}
                activeOpacity={0.82}
                style={styles.playerIconButton}
              >
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color="#FFF" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={toggleMute}
                activeOpacity={0.82}
                style={styles.playerIconButton}
              >
                <Ionicons
                  name={muted ? 'volume-mute-outline' : 'volume-high-outline'}
                  size={18}
                  color="#FFF"
                />
              </TouchableOpacity>

              <Text style={styles.playerTimeText} numberOfLines={1}>
                {elapsedLabel}
                {!compactControls ? ` / ${durationLabel}` : ''}
              </Text>
            </View>

            <View style={styles.playerControlRight}>
              <TouchableOpacity
                onPress={enterFullscreen}
                activeOpacity={0.82}
                style={styles.playerIconButton}
              >
                <Ionicons name="scan-outline" size={18} color="#FFF" />
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      ) : null}
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
        const url = await signStoragePath(storagePath, 3600);
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

  const picked = pickFastStartVariant(row);

  return {
    ...(row as any),
    users: user
      ? {
          id: user.id,
          full_name: user.full_name,
          avatar_url: user.avatar_url ?? null,
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

async function attachSubmissionCollaborators<T extends { id: string }>(
  items: T[]
): Promise<(T & { collaborators?: SubmissionCollaborator[] })[]> {
  const ids = Array.from(new Set(items.map((item) => item.id).filter(Boolean)));
  if (ids.length === 0) return items;

  const normalizeSnapshotCredits = (
    raw: any,
    fallbackSubmissionId: string
  ): SubmissionCollaborator[] => {
    const list = Array.isArray(raw) ? raw : [];

    return list
      .map((row, index) => {
        const user = row?.users || row?.user || null;
        const userId = row?.user_id || user?.id || null;
        const role = String(row?.role || '').trim();

        if (!userId || !role) return null;

        return {
          id: row?.id || `${fallbackSubmissionId}-${userId}-${role}-${index}`,
          submission_id: row?.submission_id || fallbackSubmissionId,
          user_id: userId,
          role,
          sort_order: typeof row?.sort_order === 'number' ? row.sort_order : index,
          users: user
            ? {
                id: user.id || userId,
                full_name: user.full_name ?? null,
                avatar_url: user.avatar_url ?? null,
              }
            : null,
        } as SubmissionCollaborator;
      })
      .filter(Boolean) as SubmissionCollaborator[];
  };

  const bySubmission = new Map<string, SubmissionCollaborator[]>();
  const snapshotBySubmission = new Map<string, SubmissionCollaborator[]>();

  try {
    const { data, error } = await supabase
      .from('submission_collaborators')
      .select('id, submission_id, user_id, role, sort_order')
      .in('submission_id', ids)
      .order('sort_order', { ascending: true });

    if (error) throw error;

    const userIds = Array.from(
      new Set(((data || []) as any[]).map((row) => row.user_id).filter(Boolean))
    );
    const usersById = new Map<string, { id: string; full_name?: string | null; avatar_url?: string | null }>();

    if (userIds.length > 0) {
      const { data: userRows, error: userError } = await supabase
        .from('users')
        .select('id, full_name, avatar_url')
        .in('id', userIds);

      if (userError) {
        console.log('Submission collaborator users unavailable:', userError.message);
      } else {
        ((userRows || []) as any[]).forEach((user) => {
          if (user?.id) {
            usersById.set(user.id, {
              id: user.id,
              full_name: user.full_name ?? null,
              avatar_url: user.avatar_url ?? null,
            });
          }
        });
      }
    }

    ((data || []) as any[]).forEach((row) => {
      const submissionId = row.submission_id;
      if (!submissionId) return;

      const current = bySubmission.get(submissionId) || [];
      current.push({
        id: row.id,
        submission_id: submissionId,
        user_id: row.user_id,
        role: row.role ?? null,
        sort_order: row.sort_order ?? null,
        users: usersById.get(row.user_id) ?? null,
      });
      bySubmission.set(submissionId, current);
    });
  } catch (e: any) {
    console.log('Submission collaborators unavailable:', e?.message || e);
  }

  try {
    const { data, error } = await supabase
      .from('submissions')
      .select('id, collaborator_credits')
      .in('id', ids);

    if (error) throw error;

    ((data || []) as any[]).forEach((row) => {
      const credits = normalizeSnapshotCredits(row?.collaborator_credits, row.id);
      if (credits.length > 0) {
        snapshotBySubmission.set(row.id, credits);
      }
    });
  } catch (e: any) {
    console.log('Submission collaborator snapshots unavailable:', e?.message || e);
  }

  items.forEach((item: any) => {
    if (snapshotBySubmission.has(item.id)) return;

    const credits = normalizeSnapshotCredits(item?.collaborator_credits, item.id);
    if (credits.length > 0) {
      snapshotBySubmission.set(item.id, credits);
    }
  });

  return items.map((item) => {
    const tableCredits = bySubmission.get(item.id) || [];
    const snapshotCredits = snapshotBySubmission.get(item.id) || [];

    const snapshotLookup = new Map(
      snapshotCredits.map((credit) => [`${credit.user_id}:${credit.role || ''}`, credit])
    );

    const mergedTableCredits = tableCredits.map((credit) => {
      if (credit.users) return credit;
      return {
        ...credit,
        users: snapshotLookup.get(`${credit.user_id}:${credit.role || ''}`)?.users ?? null,
      };
    });

    const tableKeys = new Set(
      tableCredits.map((credit) => `${credit.user_id}:${credit.role || ''}`)
    );
    const snapshotOnly = snapshotCredits.filter(
      (credit) => !tableKeys.has(`${credit.user_id}:${credit.role || ''}`)
    );

    return {
      ...item,
      collaborators: [...mergedTableCredits, ...snapshotOnly],
    };
  });
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

function getSubmissionTimeMs(item: { submitted_at?: string | null }) {
  const ms = item.submitted_at ? new Date(item.submitted_at).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function buildForYouMix<T extends { user_id?: string | null; submitted_at?: string | null }>(
  items: T[],
  supportedIds: Set<string>
) {
  const newest = items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        getSubmissionTimeMs(b.item) - getSubmissionTimeMs(a.item) ||
        a.index - b.index
    );

  if (supportedIds.size === 0) {
    return newest.map(({ item }) => item);
  }

  const supported = newest.filter(({ item }) => !!item.user_id && supportedIds.has(item.user_id));
  const discovery = newest.filter(({ item }) => !item.user_id || !supportedIds.has(item.user_id));

  if (supported.length === 0 || discovery.length === 0) {
    return newest.map(({ item }) => item);
  }

  const result: T[] = [];
  const pattern: Array<'supported' | 'discovery'> = ['supported', 'discovery', 'supported'];
  let supportedIndex = 0;
  let discoveryIndex = 0;
  let patternIndex = 0;

  const take = (kind: 'supported' | 'discovery') => {
    if (kind === 'supported') {
      const picked = supported[supportedIndex]?.item ?? null;
      if (picked) supportedIndex += 1;
      return picked;
    }

    const picked = discovery[discoveryIndex]?.item ?? null;
    if (picked) discoveryIndex += 1;
    return picked;
  };

  while (result.length < newest.length) {
    const preferred = pattern[patternIndex % pattern.length];
    const fallback = preferred === 'supported' ? 'discovery' : 'supported';
    const picked = take(preferred) || take(fallback);

    if (!picked) break;

    result.push(picked);
    patternIndex += 1;
  }

  return result;
}

type UpNextQueueItem = {
  id: string;
  user_id?: string | null;
  users?: { id?: string | null } | null;
  submitted_at?: string | null;
  votes?: number | null;
  category?: string | null;
  film_category?: string | null;
  word?: string | null;
};

function stableUpNextNoise(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function getUpNextCreatorId(item?: UpNextQueueItem | null) {
  return item?.user_id || item?.users?.id || null;
}

function getUpNextGenre(item?: UpNextQueueItem | null, fallback?: string | null) {
  return String(item?.film_category || item?.category || item?.word || fallback || '')
    .trim()
    .toLowerCase();
}

function buildUpNextQueue<T extends UpNextQueueItem>(
  current: T | null,
  items: T[],
  options: { recentIds?: string[]; fallbackGenre?: string | null; limit?: number } = {}
) {
  if (!current) return [];

  const limit = options.limit ?? 8;
  const recentIds = options.recentIds ?? [];
  const recentRank = new Map(recentIds.map((id, index) => [id, index]));
  const currentCreatorId = getUpNextCreatorId(current);
  const currentGenre = getUpNextGenre(current, options.fallbackGenre);
  const noiseSeed = `${current.id}:${recentIds.slice(0, 8).join('|')}`;

  const pool = items.filter((item) => item.id !== current.id);
  if (pool.length <= 1) return pool.slice(0, limit);

  const hardRecentCount = pool.length >= 8 ? 4 : pool.length >= 5 ? 3 : 1;
  const hardRecent = new Set(
    recentIds.filter((id) => id !== current.id).slice(0, hardRecentCount)
  );
  const primary = pool.filter((item) => !hardRecent.has(item.id));
  const fallbackRecent = pool.filter((item) => hardRecent.has(item.id));
  const source = primary.length >= Math.min(4, pool.length) ? primary : pool;

  const getSignals = (item: T) => {
    const sameCreator = !!currentCreatorId && getUpNextCreatorId(item) === currentCreatorId;
    const sameGenre = !!currentGenre && getUpNextGenre(item) === currentGenre;
    const time = getSubmissionTimeMs(item);
    const ageDays = time ? Math.max(0, (Date.now() - time) / 86_400_000) : 365;
    const freshness = Math.max(0, 16 - Math.min(16, ageDays / 4));
    const popularity = Math.log10(Math.max(0, item.votes ?? 0) + 1) * 7;
    const watchedRank = recentRank.get(item.id);
    const recentPenalty =
      watchedRank === undefined ? 0 : Math.max(8, 42 - watchedRank * 6);
    const noise = stableUpNextNoise(`${noiseSeed}:${item.id}`) * 4;

    return {
      sameCreator,
      sameGenre,
      freshness,
      popularity,
      recentPenalty,
      noise,
    };
  };

  const byScore = (kind: 'similar' | 'fresh' | 'popular' | 'explore' | 'any') => (a: T, b: T) => {
    const signalScore = (item: T) => {
      const s = getSignals(item);
      const relevance = (s.sameCreator ? 26 : 0) + (s.sameGenre ? 18 : 0);
      if (kind === 'fresh') return s.freshness * 2.1 + relevance * 0.35 + s.noise - s.recentPenalty;
      if (kind === 'popular') return s.popularity * 2 + relevance * 0.35 + s.noise - s.recentPenalty;
      if (kind === 'explore') return s.freshness + s.popularity + s.noise - s.recentPenalty;
      if (kind === 'similar') return relevance * 1.6 + s.freshness + s.popularity + s.noise - s.recentPenalty;
      return relevance + s.freshness + s.popularity + s.noise - s.recentPenalty;
    };

    return signalScore(b) - signalScore(a);
  };

  const similar = source
    .filter((item) => {
      const s = getSignals(item);
      return s.sameCreator || s.sameGenre;
    })
    .sort(byScore('similar'));
  const fresh = [...source].sort(byScore('fresh'));
  const popular = [...source].sort(byScore('popular'));
  const explore = source
    .filter((item) => {
      const s = getSignals(item);
      return !s.sameCreator && !s.sameGenre;
    })
    .sort(byScore('explore'));
  const any = [...source].sort(byScore('any'));
  const buckets = { similar, fresh, popular, explore, any };
  const pattern: Array<keyof typeof buckets> = [
    'similar',
    'fresh',
    'explore',
    'similar',
    'popular',
    'fresh',
    'explore',
    'any',
  ];
  const result: T[] = [];
  const used = new Set<string>();
  const takeFrom = (bucket: T[]) => {
    const picked = bucket.find((item) => !used.has(item.id));
    if (!picked) return false;
    used.add(picked.id);
    result.push(picked);
    return true;
  };

  for (let guard = 0; result.length < Math.min(limit, source.length) && guard < limit * 4; guard += 1) {
    const bucketName = pattern[guard % pattern.length];
    if (!takeFrom(buckets[bucketName])) takeFrom(any);
  }

  const fallback = [...fallbackRecent, ...pool]
    .filter((item, index, arr) => arr.findIndex((candidate) => candidate.id === item.id) === index)
    .sort(byScore('any'));

  for (const item of fallback) {
    if (result.length >= limit) break;
    if (used.has(item.id)) continue;
    used.add(item.id);
    result.push(item);
  }

  return result;
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
    const { colors, isLight } = useAppTheme();
    const controlBg = isLight ? 'transparent' : '#000000';
    const searchBg = isLight ? colors.card : '#000000';
    const controlAltBg = isLight ? 'transparent' : '#0B0B0B';
    const activeBg = isLight ? colors.cardAlt : '#111111';
    const controlBorder = isLight ? 'transparent' : 'transparent';
    const textColor = isLight ? colors.textPrimary : '#EDEBE6';
    const labelColor = isLight ? colors.textPrimary : '#F1EEE7';
    const subColor = isLight ? colors.textSecondary : 'rgba(237,235,230,0.50)';
    const placeholderColor = isLight ? colors.textMuted : 'rgba(237,235,230,0.45)';

    const filters: { key: SortKey; label: string; sub?: string }[] = [
      { key: 'foryou', label: 'For You', sub: 'Supported + new' },
      { key: 'newest', label: 'New', sub: 'Latest uploads' },
      { key: 'mostvoted', label: 'Top', sub: 'Most voted' },
      { key: 'leastvoted', label: 'Rising', sub: 'Least voted' },
      { key: 'oldest', label: 'Old', sub: 'Earliest' },
    ];

    const raw = searchText ?? '';
    const q = raw.trim();

    // sizing
    const R = compact ? 8 : 14;
const padH = compact ? 12 : 16;
const padV = compact ? 4 : 8;
const inputSize = compact ? 12 : 14;

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
        backgroundColor: searchBg,
        borderWidth: isLight ? StyleSheet.hairlineWidth : 0,
        borderColor: isLight ? colors.border : controlBorder,
        paddingHorizontal: isSidebar ? padH : compact ? 14 : 16,
        paddingVertical: isSidebar ? padV : 0,
        minHeight: isSidebar ? undefined : compact ? 38 : 44,
height: isSidebar ? undefined : compact ? 38 : 44,
marginBottom: 0,
justifyContent: 'center',
      },
    ]}
  >
    <TextInput
  placeholder="Search film…"
  placeholderTextColor={placeholderColor}
  value={searchText}
  onChangeText={(txt) => setSearchText(txt)}
  onFocus={() => setFocused(true)}
  onBlur={() => setFocused(false)}
  selectionColor={colors.primary}
  cursorColor={colors.primary}
  style={{
    flex: 1,
    color: textColor,
    fontSize: isSidebar ? inputSize : compact ? 12 : 13,
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
  <ActivityIndicator size="small" color={colors.primary} />
  <Text
    style={{
      marginLeft: 10,
      color: isLight ? colors.textSecondary : 'rgba(237,235,230,0.72)',
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
      {
        backgroundColor: controlBg,
        borderWidth: isLight ? 1 : 0,
        borderColor: controlBorder,
      },
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
                {
                  backgroundColor: active ? activeBg : isLight ? 'transparent' : controlBg,
                  borderColor: active ? colors.primary : isLight ? 'transparent' : 'rgba(255,255,255,0.03)',
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.sideSortLabel, { color: active ? colors.primary : labelColor }]}>
                  {f.label}
                </Text>
                {!!f.sub ? <Text style={[styles.sideSortSub, { color: subColor }]}>{f.sub}</Text> : null}
              </View>

              <View
                style={[
                  styles.sideSortDot,
                  { backgroundColor: active ? colors.primary : isLight ? colors.borderStrong : 'rgba(237,235,230,0.24)' },
                  active && { opacity: 1 },
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
                {
                  backgroundColor: active ? activeBg : controlAltBg,
                  borderColor: active ? colors.primary : isLight ? 'transparent' : 'rgba(255,255,255,0.06)',
                },
              ]}
            >
              <Text style={[styles.centerChipText, { color: active ? colors.primary : subColor }]}>
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
    {
      backgroundColor: isSidebar ? controlBg : 'transparent',
    },
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
                {
                  backgroundColor: active ? activeBg : isLight ? 'transparent' : controlBg,
                  borderColor: active ? colors.primary : isLight ? 'transparent' : 'rgba(255,255,255,0.03)',
                },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.sideSortLabel, { color: active ? colors.primary : labelColor }]}>
                  {c}
                </Text>
              </View>

              <View
                style={[
                  styles.sideSortDot,
                  { backgroundColor: active ? colors.primary : isLight ? colors.borderStrong : 'rgba(237,235,230,0.24)' },
                  active && { opacity: 1 },
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
                {
                  backgroundColor: active ? activeBg : controlAltBg,
                  borderColor: active ? colors.primary : isLight ? 'transparent' : 'rgba(255,255,255,0.06)',
                },
              ]}
            >
              <Text style={[styles.centerChipText, { color: active ? colors.primary : subColor }]}>
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
  const { userId, ready: authReady } = useAuth();
  const { colors, isLight } = useAppTheme();
  const GOLD = colors.primary;
  const T = useMemo(
    () => ({
      bg: colors.background,
      bg2: colors.backgroundAlt,
      panel: colors.card,
      card: colors.card,
      card2: colors.cardAlt,
      outline: colors.border,
      text: colors.textPrimary,
      sub: colors.textSecondary,
      mute: colors.textMuted,
      accent: colors.primary,
      heroBurgundy1: colors.background,
      heroBurgundy2: colors.backgroundAlt,
    }),
    [colors]
  );
  const featuredBackground = isLight ? '#FAF7F1' : '#000000';
  const featuredBackgroundAlt = isLight ? '#F3ECDF' : '#050505';
  const featuredSurface = isLight ? '#FFFDF8' : '#090909';
  const featuredSoftSurface = isLight ? '#F4EBDD' : '#0B0B0B';
  const featuredBorder = isLight ? 'rgba(93,72,43,0.16)' : 'rgba(255,255,255,0.08)';
  const featuredText = isLight ? colors.textPrimary : '#F4F1EA';
  const featuredSubText = isLight ? '#62584B' : 'rgba(237,235,230,0.62)';
 const { refreshKey, triggerAppRefresh } = useAppRefresh();
const isGuest = !userId;
const openShareSlug = route.params?.openShareSlug ?? null;
const openSubmissionId = route.params?.openSubmissionId ?? null;
const openSearchNonce = route.params?.openSearchNonce ?? null;
  const { width: winW, height: winH } = useWindowDimensions();
  const isNarrow = winW < 480;

// web should use mobile layout too when the viewport is phone-like
const isPhoneLikeWeb = Platform.OS === 'web' && winW <= 820;

const isMobile = Platform.OS !== 'web' || isPhoneLikeWeb;
const isWideWeb = Platform.OS === 'web' && !isPhoneLikeWeb && winW >= 980;
const useDesktopWatch = isWideWeb;
const watchDesktopPadX = 22;
const watchDesktopRailW = useDesktopWatch
  ? Math.min(520, Math.max(340, Math.floor(winW * 0.26)))
  : 0;
const watchDesktopGap = 20;
const featuredWatchMainW = useDesktopWatch
  ? Math.max(360, winW - watchDesktopPadX * 2 - watchDesktopGap - watchDesktopRailW)
  : Math.min(Platform.OS === 'web' ? winW - 72 : winW, Platform.OS === 'web' ? 792 : 860);

const useTwoColumnMobile = isMobile;
const gridColumns = isWideWeb || useTwoColumnMobile ? 2 : 1;

  const category: Category = 'film';

// Category filter (matches Challenge categories)
const [filmCategory, setFilmCategory] = useState<FilmCategory>('All');
  const [initialLoading, setInitialLoading] = useState(true);
const [refreshing, setRefreshing] = useState(false);
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
  const [sort, setSort] = useState<SortKey>('foryou');

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
  const [supportedUserIds, setSupportedUserIds] = useState<Set<string>>(new Set());
  const [supportBusy, setSupportBusy] = useState<Record<string, boolean>>({});
  const [deleteBusy, setDeleteBusy] = useState<Record<string, boolean>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [featuredFocusPlayKey, setFeaturedFocusPlayKey] = useState(0);

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
  const [reportOpen, setReportOpen] = useState(false);
const [reportTarget, setReportTarget] = useState<{
  contentType: 'submission' | 'profile' | 'comment';
  contentId?: string | null;
  reportedUserId?: string | null;
  title?: string | null;
} | null>(null);
const [reportReason, setReportReason] = useState<ReportReason>('Harassment or bullying');
const [reportDetails, setReportDetails] = useState('');
const [reportSubmitting, setReportSubmitting] = useState(false);
const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());

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
  const [previewPlayKey, setPreviewPlayKey] = useState(0);
  const {
    keyboardVisible: commentsKeyboardVisible,
    keyboardLift: commentsKeyboardLift,
    keyboardLiftStyle: commentsKeyboardLiftStyle,
  } = useKeyboardLift({
    enabled: Platform.OS === 'android' && (commentsOpen || previewOpen),
    extraSpacing: 8,
  });
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
  const [previewCommentsExpanded, setPreviewCommentsExpanded] = useState(false);
  const [previewMediaReady, setPreviewMediaReady] = useState(false);
  const [collaboratorEditorOpen, setCollaboratorEditorOpen] = useState(false);
  const [watchActionsMenuOpen, setWatchActionsMenuOpen] = useState(false);
  const [collaboratorQuery, setCollaboratorQuery] = useState('');
  const [collaboratorRole, setCollaboratorRole] = useState('');
  const [collaboratorResults, setCollaboratorResults] = useState<CollaboratorSearchUser[]>([]);
  const [collaboratorSearching, setCollaboratorSearching] = useState(false);
  const [collaboratorSaving, setCollaboratorSaving] = useState(false);
  const previewMotion = useRef(new Animated.Value(0)).current;
  const previewMediaTimerRef = useRef<any>(null);
  const previewClosingRef = useRef(false);
  const previewOpenRef = useRef(false);
  const previewAnimateInRef = useRef(false);
  const previewWorkSeqRef = useRef(0);
  const [recentPreviewIds, setRecentPreviewIds] = useState<string[]>([]);
  const watchScrollRef = useRef<ScrollView | null>(null);
  const handleCommentInputFocus = useCallback(() => {
    if (Platform.OS !== 'android') return;

    setTimeout(() => {
      watchScrollRef.current?.scrollToEnd({ animated: true });
    }, 90);
  }, []);

  useEffect(() => {
    if (!previewOpen || !previewItem) return;

    previewMotion.stopAnimation();
    if (!previewAnimateInRef.current) {
      previewMotion.setValue(1);
      return;
    }

    previewAnimateInRef.current = false;
    previewMotion.setValue(0);

    Animated.timing(previewMotion, {
      toValue: 1,
      duration: Platform.OS === 'web' ? 240 : 320,
      easing: Easing.bezier(0.22, 1, 0.36, 1),
      useNativeDriver: true,
    }).start();
  }, [previewItem, previewMotion, previewOpen]);

  useEffect(() => {
    previewOpenRef.current = previewOpen;
  }, [previewOpen]);

  useFocusEffect(
    useCallback(() => {
      setFeaturedFocusPlayKey((key) => key + 1);

      if (!previewOpenRef.current && winner?.id) {
        setActiveId(`winner-${winner.id}`);
      }

      return () => {
        pauseAllExcept(PAUSE_NONE_ID, { preserveWinner: false }).catch(() => {});
      };
    }, [winner?.id])
  );

  useEffect(() => {
    return () => {
      if (previewMediaTimerRef.current) {
        clearTimeout(previewMediaTimerRef.current);
      }
    };
  }, []);

  const previewSuggestions = useMemo(() => {
    if (!previewItem) return [];
    return buildUpNextQueue(previewItem, submissions, {
      recentIds: recentPreviewIds,
      fallbackGenre: category,
      limit: 8,
    });
  }, [category, previewItem, recentPreviewIds, submissions]);

  const updateCollaboratorsForSubmission = (
    submissionId: string,
    collaborators: SubmissionCollaborator[]
  ) => {
    setPreviewItem((prev) =>
      prev?.id === submissionId ? ({ ...prev, collaborators } as any) : prev
    );
    setSubmissions((prev) =>
      prev.map((item) =>
        item.id === submissionId ? ({ ...item, collaborators } as any) : item
      )
    );
    setWinner((prev) =>
      prev?.id === submissionId ? ({ ...prev, collaborators } as any) : prev
    );
  };

  useEffect(() => {
    if (!collaboratorEditorOpen) return;

    const q = collaboratorQuery.trim();

    if (q.length < 2) {
      setCollaboratorResults([]);
      setCollaboratorSearching(false);
      return;
    }

    let cancelled = false;
    setCollaboratorSearching(true);

    const timer = setTimeout(async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, level')
        .ilike('full_name', `%${q}%`)
        .order('full_name', { ascending: true })
        .limit(10);

      if (cancelled) return;

      if (error) {
        console.log('Collaborator search error:', error.message);
        setCollaboratorResults([]);
      } else {
        const currentCredits = ((previewItem as any)?.collaborators || []) as SubmissionCollaborator[];
        const existingIds = new Set([
          (previewItem as any)?.user_id,
          ...currentCredits.map((item) => item.user_id),
        ].filter(Boolean));

        setCollaboratorResults(
          ((data || []) as CollaboratorSearchUser[]).filter((item) => !existingIds.has(item.id))
        );
      }

      setCollaboratorSearching(false);
    }, 240);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [collaboratorEditorOpen, collaboratorQuery, previewItem]);

  const addPreviewCollaborator = (user: CollaboratorSearchUser) => {
    if (!previewItem) return;

    const role = collaboratorRole.trim();

    if (!role) {
      Alert.alert('Add their role', 'Write a role first, like DP, Actor, Editor, or Producer.');
      return;
    }

    const currentCredits = ((previewItem as any).collaborators || []) as SubmissionCollaborator[];

    if (currentCredits.some((item) => item.user_id === user.id)) {
      setCollaboratorQuery('');
      setCollaboratorRole('');
      setCollaboratorResults([]);
      return;
    }

    const nextCredits: SubmissionCollaborator[] = [
      ...currentCredits,
      {
        id: `local-${previewItem.id}-${user.id}-${Date.now()}`,
        submission_id: previewItem.id,
        user_id: user.id,
        role,
        sort_order: currentCredits.length,
        users: {
          id: user.id,
          full_name: user.full_name ?? null,
          avatar_url: user.avatar_url ?? null,
        },
      },
    ];

    updateCollaboratorsForSubmission(previewItem.id, nextCredits);
    setCollaboratorQuery('');
    setCollaboratorRole('');
    setCollaboratorResults([]);
  };

  const removePreviewCollaborator = (userIdToRemove: string) => {
    if (!previewItem) return;

    const nextCredits = (((previewItem as any).collaborators || []) as SubmissionCollaborator[])
      .filter((item) => item.user_id !== userIdToRemove)
      .map((item, index) => ({ ...item, sort_order: index }));

    updateCollaboratorsForSubmission(previewItem.id, nextCredits);
  };

  const savePreviewCollaborators = async () => {
    if (!previewItem || !currentUserId || (previewItem as any).user_id !== currentUserId) return;
    if (collaboratorSaving) return;

    const submissionId = previewItem.id;
    const credits = (((previewItem as any).collaborators || []) as SubmissionCollaborator[])
      .map((item, index) => ({
        submission_id: submissionId,
        user_id: item.user_id,
        role: String(item.role || '').trim(),
        sort_order: index,
        users: item.users
          ? {
              id: item.users.id,
              full_name: item.users.full_name ?? null,
              avatar_url: item.users.avatar_url ?? null,
            }
          : null,
      }))
      .filter((item) => item.user_id && item.role);

    const rows = credits.map(({ users, ...row }) => row);

    setCollaboratorSaving(true);

    try {
      let tableSaved = false;
      let snapshotSaved = false;

      const { error: deleteError } = await supabase
        .from('submission_collaborators')
        .delete()
        .eq('submission_id', submissionId);

      if (deleteError) {
        console.log('Collaborator clear failed:', deleteError.message);
      } else if (rows.length === 0) {
        tableSaved = true;
      }

      if (rows.length > 0) {
        const { error: insertError } = await supabase
          .from('submission_collaborators')
          .insert(rows);

        if (insertError) {
          console.log('Collaborator save failed:', insertError.message);
        } else {
          tableSaved = true;
        }
      }

      const { error: snapshotError } = await supabase
        .from('submissions')
        .update({ collaborator_credits: credits })
        .eq('id', submissionId)
        .eq('user_id', currentUserId);

      if (snapshotError) {
        console.log('Collaborator snapshot save failed:', snapshotError.message);
      } else {
        snapshotSaved = true;
      }

      if (!tableSaved && !snapshotSaved) {
        throw new Error('No collaborator store accepted the update.');
      }

      const [enriched] = await attachSubmissionCollaborators([
        { ...(previewItem as any), collaborators: credits, collaborator_credits: credits },
      ]);
      const nextCredits = ((enriched as any)?.collaborators || credits) as SubmissionCollaborator[];

      updateCollaboratorsForSubmission(submissionId, nextCredits);
      setCollaboratorEditorOpen(false);
    } catch (e: any) {
      console.warn('savePreviewCollaborators error:', e?.message || e);
      Alert.alert('Collaborators failed', 'Those credits could not be saved. Please try again.');
    } finally {
      setCollaboratorSaving(false);
    }
  };

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
const hasInitializedChallengesRef = useRef(false);
const hoverIntentRef = useRef<Record<string, any>>({});
const fetchSeqRef = useRef(0);
const inFlightFetchKeyRef = useRef<string | null>(null);
const lastAppliedFetchKeyRef = useRef<string | null>(null);
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

    if (Platform.OS === 'web') {
      loadHlsJs().catch(() => {});
    }
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

  // Fetch content when auth + filters are ready. This avoids a guest fetch
  // followed by a signed-in fetch during post-login navigation.
  useEffect(() => {
    if (!authReady) return;

    (async () => {
      await initChallengesIfNeeded();

      const uid = userId ?? null;
      setCurrentUserId(uid);
      await fetchContent(uid, category, searchQ, { silent: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, userId, sort, searchQ, filmCategory]);

useEffect(() => {
  if (initialLoading) return;

  (async () => {
    try {
      await initChallengesIfNeeded();

      const uid = userId ?? null;

      setCurrentUserId(uid);
      await fetchContent(uid, category, searchQ, { force: true, silent: true });
    } catch (e: any) {
      console.warn('Featured refreshKey refresh error:', e?.message || e);
    }
  })();

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [refreshKey, userId]);


  const baseCols =
  'id, user_id, title, votes, submitted_at, is_winner, share_slug, is_removed, removed_reason, film_category, collaborator_credits, users ( id, full_name, avatar_url ), video_id, storage_path, video_path, thumbnail_url, media_kind, mime_type, duration_seconds, category, mux_upload_id, mux_asset_id, mux_playback_id, mux_status';

  const fetchWinnerSafe = async (id: string, desired: Category) => {
    const sel = `
      ${baseCols},
      videos:video_id ( original_path, thumbnail_path, video_variants ( path, label ) ),
      description
    `;
    let res = await supabase
  .from('submissions')
  .select(sel)
  .eq('id', id)
  .eq('is_removed', false)
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
  .eq('is_removed', false)
  .single();
    }

    if (res.error) return res;

    if (res.data && (res.data as any).category && (res.data as any).category !== desired) {
      return { data: null, error: null } as any;
    }

    if (res.data) {
  const r: any = res.data;
  const picked = pickFastStartVariant(r);
  r.storage_path = picked.path;
  r.thumbnail_url = picked.thumb;
}

    return res;
  };

  const fetchSubsSafe = async (
  orderKey: SortKey,
  searchTextQ: string,
  cat: Category,
  filmCat: FilmCategory,
  blockedIds: Set<string>
) => {
    const sel = `
      ${baseCols},
      videos:video_id ( original_path, thumbnail_path, video_variants ( path, label ) ),
      description
    `;

    const addSort = (q: any) => {
      if (orderKey === 'foryou') return q.order('submitted_at', { ascending: false });
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
query = query.eq('is_removed', false);
if (blockedIds.size > 0) {
  query = query.not('user_id', 'in', `(${Array.from(blockedIds).join(',')})`);
}

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
  q2 = q2.eq('is_removed', false);
  if (blockedIds.size > 0) {
  q2 = q2.not('user_id', 'in', `(${Array.from(blockedIds).join(',')})`);
}

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
  const picked = pickFastStartVariant(r);
  r.storage_path =
    r.media_kind === 'file_audio'
      ? r.storage_path ?? r.video_path ?? r?.videos?.original_path ?? null
      : picked.path;
  r.thumbnail_url = picked.thumb;
}

return res;
};

const initChallengesIfNeeded = async () => {
  if (hasInitializedChallengesRef.current) return;
  hasInitializedChallengesRef.current = true;

  try {
    const { error } = await supabase.rpc('finalize_last_month_winner_if_needed');
    if (error) {
      console.warn('finalize_last_month_winner_if_needed failed:', error.message);
    }
  } catch {}

  try {
    const { error } = await supabase.rpc('insert_monthly_challenge_if_not_exists');
    if (error) {
      console.warn('insert_monthly_challenge_if_not_exists failed:', error.message);
    }
  } catch {}
};

const fetchContent = async (
  uid: string | null,
  cat: Category,
  searchTextQ: string,
  opts?: { force?: boolean; silent?: boolean }
) => {
  const fetchKey = [
    uid || 'guest',
    cat,
    sort,
    filmCategory,
    searchTextQ.trim(),
  ].join('|');

  if (!opts?.force && inFlightFetchKeyRef.current === fetchKey) {
    return;
  }

  if (!opts?.force && lastAppliedFetchKeyRef.current === fetchKey && submissions.length > 0) {
    return;
  }

  const seq = ++fetchSeqRef.current;
  inFlightFetchKeyRef.current = fetchKey;
  const firstLoad = submissions.length === 0 && !winner;

  if (firstLoad) {
    setInitialLoading(true);
  } else if (!opts?.silent) {
    setRefreshing(true);
  }

  try {
    const challenges = await fetchChallengesForFeatured();

    const range = challenges.current
      ? { start: challenges.current.month_start, end: challenges.current.month_end }
      : undefined;

    currentRangeRef.current = range ?? null;

    // ✅ Fetch blocked users ONCE near the top, before winner/feed queries use it.
    const blockedIds = await fetchBlockedUsers(uid);
    const supportedIds = uid ? await fetchSupportedUserIds(uid) : new Set<string>();
    setSupportedUserIds(supportedIds);

    let winnerData: any = null;

    if (challenges.previous?.winner_submission_id) {
      const { data: w } = await fetchWinnerSafe(
        challenges.previous.winner_submission_id,
        cat
      );

      winnerData = w ? normalizeRow(w as RawSubmission) : null;

      // ✅ Hide winner if the current user has blocked that creator.
      if (winnerData && blockedIds.has((winnerData as any).user_id)) {
        winnerData = null;
      }

      if (winnerData && winnerData.category !== cat) {
        winnerData = null;
      }

      const winnerMuxReady = isMuxReady((winnerData as any)?.mux_status);
      const winnerMuxUri = winnerMuxReady
        ? getMuxPlaybackUrl((winnerData as any)?.mux_playback_id)
        : null;

      if ((winnerData as any)?.storage_path) {
        signStoragePath((winnerData as any).storage_path!, 3600).catch(() => {});
      } else if (winnerMuxUri) {
        warmPlayableUrl(winnerMuxUri);
      }
    }

    // ✅ Use the same blockedIds for the submissions query.
    const resp = await fetchSubsSafe(
      sort,
      searchTextQ,
      cat,
      filmCategory,
      blockedIds
    );

    const subs = (resp?.data || []) as RawSubmission[];
    const normalized = subs.map(normalizeRow);

    const playableOnlyBase = normalized.filter((s: any) => {
      const muxReady = isMuxReady(s.mux_status);
      const hasMux = !!s.mux_playback_id;
      const hasDirectFile = !!s.storage_path;

      return (hasMux && muxReady) || (!hasMux && hasDirectFile) || hasDirectFile;
    });

    const playableOnly =
      sort === 'foryou'
        ? (buildForYouMix(playableOnlyBase as any[], supportedIds) as typeof playableOnlyBase)
        : playableOnlyBase;

    const playableWithCollaborators = await attachSubmissionCollaborators(playableOnly as any);

    if (winnerData) {
      const [winnerWithCollaborators] = await attachSubmissionCollaborators([winnerData as any]);
      winnerData = winnerWithCollaborators;
    }

    if (seq !== fetchSeqRef.current) return;

    setWinner(winnerData);
    setSubmissions(playableWithCollaborators as any);
    lastAppliedFetchKeyRef.current = fetchKey;

    setTimeout(() => {
      setTimeout(() => {
  fetchCommentCounts(playableWithCollaborators.slice(0, 8).map((s) => s.id));
}, 300);
    }, 0);

    playableWithCollaborators.slice(0, 24).forEach((s) => {
      const muxReady = isMuxReady((s as any).mux_status);
      const muxUri = muxReady ? getMuxPlaybackUrl((s as any).mux_playback_id) : null;

      if ((s as any).storage_path) {
        signStoragePath((s as any).storage_path, 3600).catch(() => {});
      } else if (muxUri) {
        warmPlayableUrl(muxUri);
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
      if (seq !== fetchSeqRef.current) return;
      setVotedIds(votedSet);
    } else {
      setVotedIds(new Set());
    }

    if (uid && range) {
      const used = await countUserVotesInRange(uid, range);
      if (seq !== fetchSeqRef.current) return;
      setMonthlyVotesUsed(used);
    } else {
      setMonthlyVotesUsed(0);
    }

    const winnerCanPlay = !!(
      winnerData?.storage_path ||
      (isMuxReady((winnerData as any)?.mux_status) && (winnerData as any)?.mux_playback_id)
    );

    const firstPlayable = winnerCanPlay
      ? `winner-${winnerData.id}`
      : playableOnly.find(
          (r) =>
            r.media_kind !== 'file_audio' &&
            (!!r.storage_path ||
              (isMuxReady((r as any)?.mux_status) && !!(r as any)?.mux_playback_id))
        )?.id ?? null;

    if (seq !== fetchSeqRef.current) return;

    setActiveId(firstPlayable as string | null);
    layoutMap.current.clear();
  } catch (e: any) {
    console.warn('fetchContent error:', e?.message || e);
  } finally {
    if (inFlightFetchKeyRef.current === fetchKey) {
      inFlightFetchKeyRef.current = null;
    }

    if (seq === fetchSeqRef.current) {
      setInitialLoading(false);
      if (!opts?.silent) {
        setRefreshing(false);
      }
    }
  }
};

const onRefresh = useCallback(async () => {
  if (refreshing) return;

  setRefreshing(true);

  try {
    triggerAppRefresh();

    await initChallengesIfNeeded();

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id ?? null;

    setCurrentUserId(uid);

    await fetchContent(uid, category, searchQ, { force: true });
  } catch (e: any) {
    console.warn('Featured refresh error:', e?.message || e);
  } finally {
    setRefreshing(false);
  }
}, [refreshing, triggerAppRefresh, category, searchQ, sort, filmCategory]);

const fetchBlockedUsers = async (uid: string | null) => {
  if (!uid) {
    setBlockedUserIds(new Set());
    return new Set<string>();
  }

  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocked_id')
    .eq('blocker_id', uid);

  if (error) {
    console.warn('fetchBlockedUsers error:', error.message);
    return new Set<string>();
  }

  const ids = new Set<string>((data || []).map((row: any) => row.blocked_id));
  setBlockedUserIds(ids);
  return ids;
};

const fetchSupportedUserIds = async (uid: string | null) => {
  if (!uid) return new Set<string>();

  const { data, error } = await supabase
    .from('user_supports')
    .select('supported_id')
    .eq('supporter_id', uid);

  if (error) {
    console.warn('fetchSupportedUserIds error:', error.message);
    return new Set<string>();
  }

  return new Set<string>((data || []).map((row: any) => row.supported_id).filter(Boolean));
};

const removeBlockedContentLocally = (blockedId: string) => {
  setSubmissions((prev) => prev.filter((row: any) => row.user_id !== blockedId));

  if (winner && (winner as any).user_id === blockedId) {
    setWinner(null);
  }

  if (previewItem && (previewItem as any).user_id === blockedId) {
    if (previewMediaTimerRef.current) {
      clearTimeout(previewMediaTimerRef.current);
      previewMediaTimerRef.current = null;
    }
    setWatchActionsMenuOpen(false);
    setPreviewMediaReady(false);
    setPreviewOpen(false);
    setPreviewItem(null);
    setActiveId(null);
  }

  if (commentsFor && (commentsFor as any).user_id === blockedId) {
    closeComments();
  }

  setComments((prev) => prev.filter((comment: any) => comment.user_id !== blockedId));
};

const openReportModal = ({
  contentType,
  contentId,
  reportedUserId,
  title,
}: {
  contentType: 'submission' | 'profile' | 'comment';
  contentId?: string | null;
  reportedUserId?: string | null;
  title?: string | null;
}) => {
  if (isGuest) {
    promptSignIn('Create an account or sign in to report content.');
    return;
  }

  const shouldCloseVideoOverlay =
    contentType === 'submission' && (previewOpen || storyModeOpen);

  setReportTarget({
    contentType,
    contentId: contentId || null,
    reportedUserId: reportedUserId || null,
    title: title || null,
  });
  setReportReason('Harassment or bullying');
  setReportDetails('');

  if (shouldCloseVideoOverlay) {
    if (previewMediaTimerRef.current) {
      clearTimeout(previewMediaTimerRef.current);
      previewMediaTimerRef.current = null;
    }
    setWatchActionsMenuOpen(false);
    setPreviewMediaReady(false);
    setPreviewOpen(false);
    setPreviewItem(null);
    setStoryModeOpen(false);
    setStoryModeItem(null);
    setActiveId(null);

    pauseAllExcept(PAUSE_NONE_ID).catch(() => {});

    setTimeout(() => {
      setReportOpen(true);
    }, Platform.OS === 'web' ? 160 : 90);
    return;
  }

  setReportOpen(true);
};

const closeReportModal = () => {
  if (reportSubmitting) return;
  setReportOpen(false);
  setReportTarget(null);
  setReportReason('Harassment or bullying');
  setReportDetails('');
};

const submitReport = async () => {
  if (!reportTarget) return;

  const detailsError = validateSafeText(reportDetails);
  if (detailsError) {
    Alert.alert('Content Not Allowed', detailsError);
    return;
  }

  setReportSubmitting(true);

  try {
    const ok = await reportContent({
      reportedUserId: reportTarget.reportedUserId || null,
      contentType: reportTarget.contentType,
      contentId: reportTarget.contentId || null,
      reason: reportReason,
      details: reportDetails.trim() || null,
      showAlert: true,
    });

    if (ok) {
      closeReportModal();
    }
  } finally {
    setReportSubmitting(false);
  }
};

const confirmBlockUser = ({
  blockedUserId,
  blockedUserName,
}: {
  blockedUserId?: string | null;
  blockedUserName?: string | null;
}) => {
  if (isGuest) {
    promptSignIn('Create an account or sign in to block users.');
    return;
  }

  if (!blockedUserId) {
    Alert.alert('Unable to Block', 'This user could not be found.');
    return;
  }

  if (currentUserId && blockedUserId === currentUserId) {
    Alert.alert('Not Allowed', 'You cannot block yourself.');
    return;
  }

  const doBlock = async () => {
    const ok = await blockUser({
      blockedUserId,
      reason: 'Blocked from Featured feed',
      showAlert: true,
    });

    if (ok) {
      setBlockedUserIds((prev) => {
        const next = new Set(prev);
        next.add(blockedUserId);
        return next;
      });

      removeBlockedContentLocally(blockedUserId);
      await fetchContent(currentUserId, category, searchQ, { force: true, silent: true });
    }
  };

  if (Platform.OS === 'web') {
    const ok =
      typeof window !== 'undefined' &&
      window.confirm(
        `Block ${blockedUserName || 'this user'}? Their films and comments will be removed from your feed immediately.`
      );

    if (ok) doBlock();
  } else {
    Alert.alert(
      'Block User?',
      `Block ${blockedUserName || 'this user'}? Their films and comments will be removed from your feed immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Block', style: 'destructive', onPress: doBlock },
      ]
    );
  }
};

const toggleCreatorSupport = async ({
  creatorId,
}: {
  creatorId?: string | null;
}) => {
  const uid = currentUserId || gamUserId || null;

  if (isGuest || !uid) {
    promptSignIn('Create an account or sign in to support users.');
    return;
  }

  if (!creatorId || creatorId === uid || supportBusy[creatorId]) return;

  const alreadySupporting = supportedUserIds.has(creatorId);
  setSupportBusy((prev) => ({ ...prev, [creatorId]: true }));

  try {
    const { error } = alreadySupporting
      ? await unsupportUser(creatorId)
      : await supportUser(creatorId);

    if (error) throw error;

    setSupportedUserIds((prev) => {
      const next = new Set(prev);
      if (alreadySupporting) {
        next.delete(creatorId);
      } else {
        next.add(creatorId);
      }
      return next;
    });
  } catch (e: any) {
    Alert.alert('Support failed', e?.message || 'Please try again.');
  } finally {
    setSupportBusy((prev) => ({ ...prev, [creatorId]: false }));
  }
};

const promptSignIn = (message: string) => {
  Alert.alert(
    'Sign in required',
    message,
    [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign In',
        onPress: () => navigation.navigate('Auth', { screen: 'SignIn' }),
      },
      {
        text: 'Create Account',
        onPress: () => navigation.navigate('Auth', { screen: 'SignUp' }),
      },
    ]
  );
};

const goToProfile = (user?: { id: string; full_name: string }) => {
  if (!user) return;

  const hadOpenOverlay =
    commentsOpen || previewOpen || reportOpen || storyModeOpen;

  if (commentsOpen) {
    closeComments();
  }

  if (previewOpen) {
    if (previewMediaTimerRef.current) {
      clearTimeout(previewMediaTimerRef.current);
      previewMediaTimerRef.current = null;
    }
    setWatchActionsMenuOpen(false);
    setPreviewMediaReady(false);
    setPreviewOpen(false);
    setPreviewItem(null);
    setActiveId(null);
  }

  if (reportOpen) {
    setReportOpen(false);
    setReportTarget(null);
    setReportDetails('');
  }

  if (storyModeOpen) {
    setStoryModeOpen(false);
    setStoryModeItem(null);
  }

  pauseAllExcept(PAUSE_NONE_ID).catch(() => {});

  setTimeout(
    () => {
      navigation.navigate('Profile', {
        user: {
          id: user.id,
          full_name: user.full_name,
        },
      });
    },
    hadOpenOverlay ? 190 : 0
  );
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
  setCommentsOpen(false);
  setPreviewCommentsExpanded(false);
  setCommentText('');
  setReplyingTo(null);

  if (Platform.OS === 'ios' && previewOpen) {
    if (previewMediaTimerRef.current) {
      clearTimeout(previewMediaTimerRef.current);
      previewMediaTimerRef.current = null;
    }
    setPreviewMediaReady(false);
    setPreviewOpen(false);
    setPreviewItem(null);
    setActiveId(null);
    pauseAllExcept(PAUSE_NONE_ID).catch(() => {});

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
  if (previewMediaTimerRef.current) {
    clearTimeout(previewMediaTimerRef.current);
    previewMediaTimerRef.current = null;
  }
  setPreviewMediaReady(false);
  setStoryModeOpen(false);
  setStoryModeItem(null);
  setPreviewOpen(false);
  setPreviewItem(null);
  setCommentsOpen(false);
  setCommentsFor(null);
  setComments([]);
  setCommentText('');
  setReplyingTo(null);
  setActiveId(null);
  InteractionManager.runAfterInteractions(() => {
    pauseAllExcept(PAUSE_NONE_ID).catch(() => {});
  });
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
  const wasOpen = previewOpenRef.current;
  const workSeq = ++previewWorkSeqRef.current;

  if (previewMediaTimerRef.current) {
    clearTimeout(previewMediaTimerRef.current);
    previewMediaTimerRef.current = null;
  }

  previewClosingRef.current = false;
  previewAnimateInRef.current = !wasOpen;
  previewMotion.stopAnimation();
  previewMotion.setValue(wasOpen ? 1 : 0);
  setPreviewMediaReady(false);

  if (wasOpen) {
    const scrollToPlayer = () => {
      try {
        watchScrollRef.current?.scrollTo({ y: 0, animated: true });
      } catch {}
    };

    scrollToPlayer();
    setTimeout(scrollToPlayer, Platform.OS === 'web' ? 40 : 70);
  }

  if (s?.storage_path) {
    signStoragePath(s.storage_path, 3600).catch(() => {});
  }

  setPreviewItem(s);
  setPreviewOpen(true);
  if (s?.id) {
    setRecentPreviewIds((prev) => [s.id, ...prev.filter((id) => id !== s.id)].slice(0, 24));
  }
  previewOpenRef.current = true;
  setPreviewCommentsExpanded(false);
  setCommentsFor(s);
  setCommentText('');
  setReplyingTo(null);
  setCommentsOpen(false);
  setWatchActionsMenuOpen(false);
  setCollaboratorEditorOpen(false);
  setCollaboratorQuery('');
  setCollaboratorRole('');
  setCollaboratorResults([]);
  setPreviewMediaReady(true);
  setPreviewPlayKey((key) => key + 1);
  setActiveId(`preview-${s.id}`);

  InteractionManager.runAfterInteractions(() => {
    if (workSeq !== previewWorkSeqRef.current) return;

    void fetchComments(s.id);
    void attachSubmissionCollaborators([s]).then(([enriched]) => {
      if (workSeq !== previewWorkSeqRef.current) return;

      setPreviewItem((prev) =>
        prev?.id === s.id
          ? ({
              ...prev,
              collaborators: (enriched as any)?.collaborators || (prev as any).collaborators || [],
            } as any)
          : prev
      );
    });
  });

  previewMediaTimerRef.current = setTimeout(() => {
    if (previewClosingRef.current) return;
    setPreviewMediaReady(true);
    setActiveId(`preview-${s.id}`);
  }, Platform.OS === 'web' ? 40 : 70);
};

  const closePreview = () => {
    if (previewClosingRef.current) return;
    previewClosingRef.current = true;
    const closeSeq = ++previewWorkSeqRef.current;

    if (previewMediaTimerRef.current) {
      clearTimeout(previewMediaTimerRef.current);
      previewMediaTimerRef.current = null;
    }

    setPreviewMediaReady(false);
    setActiveId(null);
    setCommentsOpen(false);
    setWatchActionsMenuOpen(false);

    Animated.timing(previewMotion, {
      toValue: 0,
      duration: Platform.OS === 'web' ? 150 : 190,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      if (closeSeq !== previewWorkSeqRef.current) return;

      setPreviewOpen(false);
      previewOpenRef.current = false;
      setPreviewItem(null);
      setCommentsFor(null);
      setComments([]);
      setCommentText('');
      setReplyingTo(null);
      setPreviewCommentsExpanded(false);
      setCollaboratorEditorOpen(false);
      setWatchActionsMenuOpen(false);
      setCollaboratorQuery('');
      setCollaboratorRole('');
      setCollaboratorResults([]);
      previewClosingRef.current = false;
    });

    InteractionManager.runAfterInteractions(() => {
      pauseAllExcept(PAUSE_NONE_ID).catch(() => {});
    });
  };

  const openComments = async (s: Submission) => {
  setCommentsFor(s);
  setCommentText('');
  setReplyingTo(null);
  setCommentsOpen(true);
  await fetchComments(s.id);
};

  const openPreviewComments = async () => {
    if (!previewItem) return;

    setCommentsFor(previewItem);
    setCommentText('');
    setComments([]);
    setReplyingTo(null);

    if (useDesktopWatch) {
      setCommentsOpen(false);
      setPreviewCommentsExpanded(true);
    } else {
      setCommentsOpen(true);
    }

    await fetchComments(previewItem.id);
  };

  const closeComments = () => {
  setCommentsOpen(false);
  if (previewOpen && previewItem) {
    setCommentsFor(previewItem);
    setReplyingTo(null);
    return;
  }
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

  if (isGuest || !uid || !commentsFor) {
    promptSignIn('Create an account or sign in to comment on films.');
    return;
  }

    const text = commentText.trim();
    if (!text) return;

    const moderation = validateMultipleSafeTexts([
  { label: 'Comment', value: text },
]);

if (!moderation.safe) {
  Alert.alert('Content Not Allowed', moderation.message || 'Please edit your comment.');
  return;
}

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

  if (isGuest || !uid) {
    promptSignIn('Create an account or sign in to vote for films.');
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

        const { error: notifyError } = await supabase.rpc('notify_submission_vote', {
          target_submission_id: s.id,
        });
        if (notifyError) {
          console.warn('notify_submission_vote unavailable:', notifyError.message);
        }

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
    const fallbackWinnerId =
      winner?.storage_path ||
      (isMuxReady((winner as any)?.mux_status) && (winner as any)?.mux_playback_id)
        ? `winner-${winner.id}`
        : null;
    const targetId = activeId || fallbackWinnerId || PAUSE_NONE_ID;
    await pauseAllExcept(targetId);
  })();
}, [activeId, winner]);
useEffect(() => {
  let cancelled = false;

  if (initialLoading) return;
  if (!submissions.length && !winner) return;

  const deepLinkKey = openSubmissionId
    ? `${openSubmissionId}:${openSearchNonce ?? ''}`
    : openShareSlug || null;
  if (!deepLinkKey) return;

  if (deepLinkHandledRef.current === deepLinkKey) return;

  const openDeepLinkedFilm = async () => {
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

    if (!target && (openSubmissionId || openShareSlug)) {
      try {
        const sel = `
          ${baseCols},
          videos:video_id ( original_path, thumbnail_path, video_variants ( path, label ) ),
          description
        `;
        let query: any = supabase
          .from('submissions')
          .select(sel)
          .eq('category', 'film')
          .eq('is_removed', false);

        query = openSubmissionId
          ? query.eq('id', openSubmissionId)
          : query.eq('share_slug', openShareSlug);

        const { data, error } = await query.maybeSingle();
        if (!cancelled && !error && data) {
          const normalized = normalizeRow(data as RawSubmission);
          const [withCollaborators] = await attachSubmissionCollaborators([normalized as any]);
          if (!cancelled) target = withCollaborators as any;
        }
      } catch (e: any) {
        console.warn('Featured deep link direct fetch error:', e?.message || e);
      }
    }

    if (cancelled || !target) return;

    deepLinkHandledRef.current = deepLinkKey;
    openPreview(target as any);

    navigation.setParams?.({
      openSubmissionId: undefined,
      openShareSlug: undefined,
      openSearchNonce: undefined,
    });
  };

  void openDeepLinkedFilm();

  return () => {
    cancelled = true;
  };
}, [initialLoading, submissions, winner, openSubmissionId, openShareSlug, openSearchNonce, navigation]);

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

const resumeWinnerAfterHover = useCallback((hoveredId: string) => {
  setActiveId((prev) => (prev === hoveredId ? null : prev));

  if (!previewOpenRef.current) {
    setFeaturedFocusPlayKey((key) => key + 1);
  }
}, []);

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
    video_path?: string | null;
    thumbnail_url?: string | null;
    media_kind?: RawSubmission['media_kind'];
    videos?: {
      original_path?: string | null;
      video_variants?: { path: string; label?: string | null }[] | null;
    } | null;
  },
  isActive: boolean,
  isWinnerRow: boolean
) => {
  // ✅ Fix 1: avoid stale `activeId` closure on web hover leave
  const isWinnerPlayer = rowId.startsWith('winner-');

const webHoverProps =
  Platform.OS === 'web'
    ? {
        onHoverIn: () => setActiveId(rowId),
        onHoverOut: () => {
          if (isWinnerPlayer) return;
          resumeWinnerAfterHover(rowId);
        },
        onMouseEnter: () => setActiveId(rowId),
        onMouseLeave: () => {
          // Winner should keep playing when mouse leaves it
          if (isWinnerPlayer) return;
          resumeWinnerAfterHover(rowId);
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

  const muxReady = isMuxReady((s as any).mux_status);
const muxUri = muxReady
  ? isWinnerRow
    ? getWinnerMuxPlaybackUrl((s as any).mux_playback_id)
    : getMuxPlaybackUrl((s as any).mux_playback_id)
  : null;
const playableUri = muxUri || s.storage_path || null;
const isProcessingVideo =
  !playableUri &&
  !!(
    (s as any).mux_upload_id ||
    (s as any).mux_asset_id ||
    (s as any).mux_playback_id ||
    (s as any).mux_status
  );

if (!playableUri) {
  return (
    <View
      {...(webHoverProps as any)}
      style={[
        styles.videoOuter,
        isWinnerRow && styles.videoOuterHeroFlat,
        isWinnerRow && {
          backgroundColor: 'transparent',
          borderColor: 'transparent',
          shadowOpacity: 0,
          shadowRadius: 0,
          shadowOffset: { width: 0, height: 0 },
          elevation: 0,
        },
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
          source={{ uri: s.thumbnail_url || 'https://picsum.photos/1600/900' }}
          style={{ width: '100%', height: '100%', borderRadius: RADIUS_XL }}
          resizeMode="contain"
        />
      </View>
      {isProcessingVideo ? (
        <View pointerEvents="none" style={styles.playerLoadingOverlay}>
          <View style={styles.playerLoadingBubble}>
            <ActivityIndicator color={GOLD} />
          </View>
        </View>
      ) : null}
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
  isWinnerRow && {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
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
  storagePath={s.storage_path ?? null}
  storagePathCandidates={[
    s.storage_path ?? null,
    s.video_path ?? null,
    s.videos?.original_path ?? null,
  ]}
  directUri={muxUri}
  preferDirectUriFirst={!isWinnerRow && isActive}
  width={frameW}
  maxHeight={frameH}
  autoPlay={isWinnerRow ? true : isActive}
  playRequestKey={isWinnerRow ? featuredFocusPlayKey : undefined}
  posterUri={s.thumbnail_url ?? null}
  dimVignette={isWinnerRow}
  showControls={isWinnerRow}
  showProgress
  surfacePressMode={isWinnerRow ? 'toggle' : 'hold'}
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
  <View style={styles.heroBylineBlock}>
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
  </View>
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
const muxReady = isMuxReady((s as any).mux_status);
const muxUri = muxReady ? getMuxPlaybackUrl((s as any).mux_playback_id) : null;
const hasPlayableVideo = !!(muxUri || s.storage_path);

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
  if (Platform.OS !== 'web' && hasPlayableVideo) {
    longPressTriggeredRef.current[s.id] = true;

    if (s.storage_path) {
      signStoragePath(s.storage_path, 3600).catch(() => {});
    }

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
  style={[
    styles.gridCard,
    { width: gridCardW },
    isLight && {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
  ]}
  {...(Platform.OS === 'web'
    ? {
        onHoverIn: () => {
  if (hoverIntentRef.current[playerId]) {
    clearTimeout(hoverIntentRef.current[playerId]);
    delete hoverIntentRef.current[playerId];
  }

  if (muxUri) warmPlayableUrl(muxUri);
  if (s.storage_path) signStoragePath(s.storage_path, 3600).catch(() => {});
  setActiveId(playerId);
},
onHoverOut: () => {
  if (hoverIntentRef.current[playerId]) {
    clearTimeout(hoverIntentRef.current[playerId]);
    delete hoverIntentRef.current[playerId];
  }

  resumeWinnerAfterHover(playerId);
},
        onMouseEnter: () => {
  if (hoverIntentRef.current[playerId]) {
    clearTimeout(hoverIntentRef.current[playerId]);
    delete hoverIntentRef.current[playerId];
  }

  if (muxUri) warmPlayableUrl(muxUri);
  if (s.storage_path) signStoragePath(s.storage_path, 3600).catch(() => {});
  setActiveId(playerId);
},
onMouseLeave: () => {
  if (hoverIntentRef.current[playerId]) {
    clearTimeout(hoverIntentRef.current[playerId]);
    delete hoverIntentRef.current[playerId];
  }

  resumeWinnerAfterHover(playerId);
},
      }
    : {})}
>
        <View style={styles.gridThumbWrap}>
          {/* Base thumbnail always visible */}
          <Image source={{ uri: thumb }} style={styles.gridThumb} resizeMode="cover" />

         {/* Only mount video while hovered / holding */}
{hasPlayableVideo && isActiveCard ? (
  <View pointerEvents="none" style={StyleSheet.absoluteFillObject}>
    <HostedVideoInline
      playerId={playerId}
      storagePath={s.storage_path ?? null}
      storagePathCandidates={[
        s.storage_path ?? null,
        (s as any).video_path ?? null,
        (s as any).videos?.original_path ?? null,
      ]}
      directUri={muxUri}
      preferDirectUriFirst
      width={gridCardW}
      maxHeight={gridCardW / (16 / 9)}
      autoPlay={true}
      posterUri={s.thumbnail_url ?? null}
      dimVignette={false}
      showControls={false}
      showProgress={false}
      captureSurfacePress={false}
      transparentUntilReady
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
  [gridCardW, activeId, isLight, resumeWinnerAfterHover]
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
    if (isGuest) {
      navigation.navigate('Auth', { screen: 'SignIn' });
      return;
    }
    if (!mine) toggleVote(s);
  }}
              style={[styles.mobilePill, (busy || mine) && { opacity: 0.5 }]}
            >
              <Text style={[styles.mobilePillText, voted && { color: GOLD }]}>
  {isGuest ? `Sign In to Vote (${s.votes ?? 0})` : busy ? '…' : `Votes ${s.votes ?? 0}`}
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

<TouchableOpacity
  activeOpacity={0.9}
  onPress={() =>
    openReportModal({
      contentType: 'submission',
      contentId: s.id,
      reportedUserId: (s as any).user_id,
      title: s.title,
    })
  }
  style={styles.mobilePillGhost}
>
  <Text style={styles.mobilePillGhostText}>Report</Text>
</TouchableOpacity>

{currentUserId && (s as any).user_id !== currentUserId ? (
  <TouchableOpacity
    activeOpacity={0.9}
    onPress={() =>
      confirmBlockUser({
        blockedUserId: (s as any).user_id,
        blockedUserName: s.users?.full_name,
      })
    }
    style={styles.mobilePillDanger}
  >
    <Text style={styles.mobilePillDangerText}>Block</Text>
  </TouchableOpacity>
) : null}

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
    const winnerFrame = isWinnerRow
      ? fitContain(
          mediaW,
          isMobile ? Math.max(220, winH * 0.28) : availableHForMedia,
          16 / 9
        )
      : null;

    return (
      <View
        key={rowId}
        onLayout={onItemLayout(rowId, isPlayableVideo)}
        style={[styles.cardWrapper, isWinnerRow && styles.cardWrapperHero]}
      >
        <LinearGradient
          colors={isWinnerRow ? [featuredBackground, featuredBackground] : ['#0D0D0D', '#050505']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.cardBorder,
            { alignSelf: 'center' },
            isWinnerRow && {
              backgroundColor: 'transparent',
              padding: 0,
              borderRadius: RADIUS_XL + 2,
            },
            isWinnerRow && winnerFrame && {
              width: winnerFrame.w,
              maxWidth: cardW,
            },
          ]}
        >
          <View
            style={[
              styles.card,
              isWinnerRow && styles.cardHero,
              isWinnerRow && styles.cardHeroFlat,
              isWinnerRow && {
                backgroundColor: 'transparent',
                borderColor: 'transparent',
                paddingTop: 0,
                paddingBottom: 0,
              },
              isWinnerRow && winnerFrame && {
                width: winnerFrame.w,
                maxWidth: cardW,
              },
            ]}
          >
            {isWinnerRow ? (
              <>
                <View
                  style={[
                    styles.heroRow,
                    {
                      width: winnerFrame?.w ?? cardW,
                      maxWidth: winnerFrame?.w ?? cardW,
                      height: winnerFrame?.h,
                      maxHeight: winnerFrame?.h ?? availableHForMedia,
                      alignSelf: 'center',
                      backgroundColor: 'transparent',
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
<TouchableOpacity
  onPress={() =>
    openReportModal({
      contentType: 'submission',
      contentId: s.id,
      reportedUserId: (s as any).user_id,
      title: s.title,
    })
  }
  activeOpacity={0.9}
  style={styles.feedActionBtnGhost}
>
  <Text style={styles.feedActionGhostText}>Report</Text>
</TouchableOpacity>

{currentUserId && (s as any).user_id !== currentUserId ? (
  <TouchableOpacity
    onPress={() =>
      confirmBlockUser({
        blockedUserId: (s as any).user_id,
        blockedUserName: s.users?.full_name,
      })
    }
    activeOpacity={0.9}
    style={styles.feedActionBtnDanger}
  >
    <Text style={styles.feedActionDangerText}>Block</Text>
  </TouchableOpacity>
) : null}
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
    featuredBackground,
    isMobile,
    winH,
    featuredFocusPlayKey,
    resumeWinnerAfterHover,
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
  [winner, activeId, isNarrow, cardW, availableHForMedia, renderCard, featuredFocusPlayKey]
);

const sidebarElement = useMemo(() => {
  if (!isWideWeb) return null;

  const maxH = winH - (TOP_BAR_OFFSET + BOTTOM_TAB_H + 24);

  return (
    <View
      style={[
        styles.sidebar,
        {
          width: 320,
          maxHeight: maxH,
          overflow: 'hidden' as any,
          backgroundColor: isLight ? 'transparent' : '#000000',
          borderColor: isLight ? 'transparent' : 'rgba(255,255,255,0.06)',
        },
      ]}
    >
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
          showSearch={false}
        />
      </ScrollView>
    </View>
  );
}, [isWideWeb, category, sort, searchText, isSearching, filmCategory, winH, isLight]);

const renderSubmissionItem = ({ item }: any) => {
  if (isWideWeb || isMobile) return renderCompactGridCard(item);
  return renderCard(item.id, item, activeId === item.id, false);
};

const renderCommentsPanel = (
  panelStyle?: any,
  options?: { embedded?: boolean; showClose?: boolean }
) => {
  const showClose = options?.showClose ?? true;

  return (
  <View
    style={[
      styles.commentsModalCard,
      options?.embedded && styles.commentsEmbeddedCard,
      {
        backgroundColor: featuredSurface,
        borderColor: featuredBorder,
      },
      panelStyle,
    ]}
  >
    <View
      style={[
        styles.commentsHeader,
        { borderBottomColor: isLight ? colors.border : 'rgba(255,255,255,0.05)' },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.commentsTitle, { color: featuredText }]}>Comments</Text>
        {commentsFor?.title ? (
          <Text style={[styles.commentsSubtitle, { color: featuredSubText }]} numberOfLines={1}>
            {commentsFor.title}
          </Text>
        ) : null}
      </View>

      {showClose ? (
        <TouchableOpacity
          onPress={closeComments}
          activeOpacity={0.9}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={[
            styles.commentsCloseBtn,
            {
              backgroundColor: isLight ? colors.backgroundAlt : '#0D0D0D',
              borderColor: featuredBorder,
            },
          ]}
        >
          <Text style={[styles.commentsClose, { color: colors.primary }]}>Close</Text>
        </TouchableOpacity>
      ) : null}
    </View>

    <View style={styles.commentsBody}>
      {commentsLoading && rootComments.length === 0 ? (
        <ActivityIndicator color={T.accent} style={{ padding: 20 }} />
      ) : rootComments.length === 0 ? (
        <View style={styles.commentsEmptyState}>
          <Text style={[styles.commentsEmptyTitle, { color: featuredText }]}>No comments yet</Text>
          <Text style={[styles.commentsEmptyText, { color: featuredSubText }]}>Be the first to say something thoughtful.</Text>
        </View>
      ) : (
        <FlatList
          data={rootComments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.commentsListContent}
          showsVerticalScrollIndicator={!!options?.embedded}
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
                    style={[
                      styles.commentAvatarTap,
                      {
                        backgroundColor: isLight ? colors.backgroundAlt : '#000',
                        borderColor: featuredBorder,
                      },
                    ]}
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
                      <Text style={[styles.commentName, { color: featuredText }]}>{u?.full_name || 'Unknown'}</Text>
                    </TouchableOpacity>

                    <Text style={[styles.commentText, { color: featuredSubText }]}>{item.comment}</Text>

                    <View style={styles.commentActionsRow}>
                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => {
                          if (isGuest) {
                            navigation.navigate('Auth', { screen: 'SignIn' });
                            return;
                          }
                          setReplyingTo(item);
                        }}
                        style={styles.replyBtn}
                      >
                        <Text style={styles.replyBtnText}>
                          {isGuest ? 'Sign In to Reply' : 'Reply'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() =>
                          openReportModal({
                            contentType: 'comment',
                            contentId: item.id,
                            reportedUserId: item.user_id,
                            title: item.comment,
                          })
                        }
                        style={styles.replyBtn}
                      >
                        <Text style={styles.replyBtnText}>Report</Text>
                      </TouchableOpacity>

                      {currentUserId && item.user_id !== currentUserId ? (
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onPress={() =>
                            confirmBlockUser({
                              blockedUserId: item.user_id,
                              blockedUserName: item.users?.full_name,
                            })
                          }
                          style={styles.replyDangerBtn}
                        >
                          <Text style={styles.replyDangerBtnText}>Block</Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  </View>
                </View>

                {replies.length > 0 ? (
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
                            style={[
                              styles.replyAvatarTap,
                              {
                                backgroundColor: isLight ? colors.backgroundAlt : '#000',
                                borderColor: featuredBorder,
                              },
                            ]}
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
                              <Text style={[styles.replyName, { color: featuredText }]}>{ru?.full_name || 'Unknown'}</Text>
                            </TouchableOpacity>

                            <Text style={[styles.replyText, { color: featuredSubText }]}>{reply.comment}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                ) : null}
              </View>
            );
          }}
        />
      )}
    </View>

    <View
      style={[
        styles.commentComposerWrap,
        {
          backgroundColor: isLight ? colors.card : '#090909',
          borderTopColor: isLight ? colors.border : 'rgba(255,255,255,0.05)',
        },
      ]}
    >
      {replyingTo ? (
        <View style={styles.replyingBanner}>
          <Text style={[styles.replyingBannerText, { color: featuredText }]} numberOfLines={1}>
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
          onFocus={handleCommentInputFocus}
          onChangeText={(txt) => {
            if (isGuest) {
              promptSignIn('Create an account or sign in to comment on films.');
              return;
            }
            setCommentText(txt);
          }}
          placeholder={isGuest ? 'Sign in to comment...' : replyingTo ? 'Write a reply...' : 'Add a comment...'}
          placeholderTextColor={isLight ? colors.textMuted : '#777'}
          style={[
            styles.commentInput,
            {
              backgroundColor: isLight ? colors.input : '#0B0B0B',
              borderColor: featuredBorder,
              color: featuredText,
            },
          ]}
          multiline
        />
        <TouchableOpacity
          onPress={() => {
            if (isGuest) {
              navigation.navigate('Auth', { screen: 'SignIn' });
              return;
            }
            postComment();
          }}
          disabled={commentPosting || (!isGuest && !commentText.trim())}
          activeOpacity={0.9}
          style={[
            styles.commentSendBtn,
            {
              backgroundColor: colors.primary,
              borderColor: colors.primary,
            },
            (commentPosting || (!isGuest && !commentText.trim())) && { opacity: 0.5 },
          ]}
        >
          <Text style={[styles.commentSendText, { color: colors.textOnPrimary }]}>
            {isGuest ? 'Sign In' : commentPosting ? '...' : 'Post'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  </View>
);
};

const keyForList = isWideWeb
  ? `grid-${searchQ}-${sort}-${filmCategory}`
  : `feed-${searchQ}-${sort}-${filmCategory}`;

return (
  <View style={[styles.container, { backgroundColor: featuredBackground }]}>
    <LinearGradient
      colors={
        isLight
          ? [featuredBackground, featuredBackgroundAlt, featuredBackground]
          : ['#050505', '#000000', '#000000']
      }
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 0.75 }}
      style={StyleSheet.absoluteFillObject}
    />
    {!isLight ? <Grain opacity={0.05} /> : null}

    {initialLoading && submissions.length === 0 ? (
  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
    <ActivityIndicator color={colors.loader} />
  </View>
) : (
      <View
        style={{
          flex: 1,
          paddingHorizontal: Platform.OS === 'web' ? 18 : 0,
          backgroundColor: featuredBackground,
        }}
      >
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
      backgroundColor: featuredBackground,
    },
  ]}
  style={{ backgroundColor: featuredBackground }}
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
  refreshControl={
  Platform.OS !== 'web' ? (
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={GOLD}
      colors={[GOLD]}
      progressBackgroundColor="#000000"
    />
  ) : undefined
}
alwaysBounceVertical={true}
bounces={true}
overScrollMode="always"
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

    {/* SORT ONLY — search now lives in the global top bar */}
    <View
      style={[
        styles.subHeaderWrap,
        {
          width: isMobile ? Math.min(winW - 24, 280) : 240,
          marginTop: -12,
          alignSelf: 'center',
        },
      ]}
    >
      <View style={{ height: 40, justifyContent: 'center' }}>
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
    backgroundColor: featuredBackground,
  },
]}
  style={{ backgroundColor: featuredBackground }}
  showsVerticalScrollIndicator={false}
  keyboardShouldPersistTaps="always"
  keyboardDismissMode="none"
  removeClippedSubviews={Platform.OS !== 'web'}
windowSize={3}
initialNumToRender={2}
maxToRenderPerBatch={2}
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

    {/* ✅ Watch modal: player, creator/actions, inline comments, suggestions */}
{previewOpen && previewItem && (
  <Modal
    visible
    transparent
    animationType="none"
    presentationStyle={Platform.OS === 'web' ? 'overFullScreen' : 'fullScreen'}
    hardwareAccelerated
    statusBarTranslucent={Platform.OS === 'android'}
    onRequestClose={closePreview}
  >
    <Animated.View
      style={[
        styles.previewOverlay,
        {
          backgroundColor: featuredBackground,
          justifyContent: 'flex-start',
          alignItems: 'stretch',
          paddingHorizontal: 0,
          paddingTop: 0,
          paddingBottom: 0,
          transform: [
            {
              translateY: previewMotion.interpolate({
                inputRange: [0, 1],
                outputRange: [winH, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Pressable style={StyleSheet.absoluteFillObject} onPress={closePreview} />

      <Animated.View
        style={[
          styles.previewCard,
          Platform.OS === 'web'
            ? {
                width: winW,
                maxWidth: winW,
                height: winH,
                maxHeight: winH,
                borderRadius: 0,
              }
            : { height: winH, maxHeight: winH, borderRadius: 0 },
          {
            backgroundColor: featuredBackground,
            borderColor: isLight ? 'transparent' : 'transparent',
            shadowOpacity: Platform.OS === 'web' ? 0 : isLight ? 0.08 : 0.3,
          },
        ]}
      >
        <ScrollView
          ref={watchScrollRef}
          style={[styles.watchScroll, { backgroundColor: featuredBackground }]}
          contentContainerStyle={[
            styles.watchContent,
            useDesktopWatch && styles.watchContentDesktop,
            { backgroundColor: featuredBackground },
            commentsKeyboardVisible && !useDesktopWatch
              ? { paddingBottom: commentsKeyboardLift + 36 }
              : null,
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
        >
          <View style={styles.watchTopBar}>
            <View style={{ flex: 1 }} />
            <TouchableOpacity
              onPress={closePreview}
              activeOpacity={0.9}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              style={[
                styles.watchCloseCircle,
                {
                  backgroundColor: isLight ? colors.card : 'rgba(255,255,255,0.10)',
                  borderColor: featuredBorder,
                },
              ]}
            >
              <Text style={[styles.watchCloseIcon, { color: featuredText }]}>×</Text>
            </TouchableOpacity>
          </View>

          <View style={useDesktopWatch ? styles.watchDesktopColumns : undefined}>
            <View
              style={
                useDesktopWatch
                  ? [styles.watchMainColumn, { width: featuredWatchMainW }]
                  : undefined
              }
            >
          <View
            style={[
              styles.watchPlayerWrap,
              {
                backgroundColor: '#000',
                borderColor: isLight ? 'transparent' : 'rgba(255,255,255,0.08)',
              },
            ]}
          >
            {(() => {
              const previewMuxReady = isMuxReady((previewItem as any).mux_status);
              const previewMuxUri = previewMuxReady
                ? getMuxPlaybackUrl((previewItem as any).mux_playback_id)
                : null;
              const previewProcessing =
                !previewItem.storage_path &&
                !previewMuxUri &&
                !!(
                  (previewItem as any).mux_upload_id ||
                  (previewItem as any).mux_asset_id ||
                  (previewItem as any).mux_playback_id ||
                  (previewItem as any).mux_status
                );

              return previewItem.storage_path || previewMuxUri ? (
                <HostedVideoInline
                  playerId={`preview-${previewItem.id}`}
                  storagePath={previewItem.storage_path ?? null}
                  storagePathCandidates={[
                    previewItem.storage_path ?? null,
                    (previewItem as any).video_path ?? null,
                    (previewItem as any).videos?.original_path ?? null,
                  ]}
                  directUri={previewMuxUri}
                  width={featuredWatchMainW}
                  maxHeight={
                    useDesktopWatch ? Math.min(winH * 0.7, 720) : Math.min(winH * 0.34, 340)
                  }
                  autoPlay={previewMediaReady && activeId === `preview-${previewItem.id}`}
                  playRequestKey={previewPlayKey}
                  autoPlayWithSound
                  posterUri={previewItem.thumbnail_url ?? null}
                  dimVignette={false}
                  showControls={true}
                  captureSurfacePress={true}
                  surfacePressMode="toggle"
                  squareCorners
                  loop={false}
                  onPlaybackEnd={() => {
                    const next = previewSuggestions[0];
                    if (next) openPreview(next as any);
                  }}
                />
              ) : (
                <View
                  style={[
                    styles.watchPlayerFallback,
                    { backgroundColor: featuredSoftSurface },
                  ]}
                >
                  {previewProcessing ? (
                    <View pointerEvents="none" style={styles.playerLoadingOverlay}>
                      <View style={styles.playerLoadingBubble}>
                        <ActivityIndicator color={GOLD} />
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })()}
          </View>

          <View style={[styles.watchMetaBlock, { backgroundColor: featuredBackground }]}>
            <Text style={[styles.watchTitle, { color: featuredText }]} numberOfLines={2}>
              {previewItem.title}
            </Text>

            <View style={styles.watchCreatorRow}>
              <TouchableOpacity
                onPress={() => previewItem.users && goToProfile(previewItem.users)}
                activeOpacity={0.85}
                style={styles.watchCreatorTap}
              >
                <View
                  style={[
                    styles.watchCreatorAvatar,
                    {
                      backgroundColor: isLight ? colors.cardAlt : 'rgba(198,166,100,0.16)',
                      borderColor: isLight ? colors.borderStrong : 'rgba(198,166,100,0.28)',
                    },
                  ]}
                >
                  {previewItem.users?.avatar_url ? (
                    <Image
                      source={{ uri: previewItem.users.avatar_url }}
                      style={styles.watchCreatorAvatarImage}
                    />
                  ) : (
                    <Text style={[styles.watchCreatorAvatarText, { color: colors.primary }]}>
                      {(previewItem.users?.full_name || 'O').slice(0, 1).toUpperCase()}
                    </Text>
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.watchCreatorName, { color: featuredText }]} numberOfLines={1}>
                    {previewItem.users?.full_name || 'Unknown creator'}
                  </Text>
                  <Text style={[styles.watchCreatorMeta, { color: featuredSubText }]} numberOfLines={1}>
                    {((previewItem as any).film_category || previewItem.category || 'Film').toString()}
                  </Text>
                </View>
              </TouchableOpacity>

              {(() => {
                const creatorId = (previewItem as any).user_id || previewItem.users?.id || null;
                const isSelf = !!currentUserId && !!creatorId && creatorId === currentUserId;
                const isSupported = !!creatorId && supportedUserIds.has(creatorId);
                const busy = !!creatorId && !!supportBusy[creatorId];

                if (!creatorId || isSelf) return null;

                return (
                  <TouchableOpacity
                    activeOpacity={0.9}
                    onPress={() => {
                      void toggleCreatorSupport({ creatorId });
                    }}
                    disabled={busy}
                    style={[
                      styles.watchSupportButton,
                      {
                        backgroundColor: isSupported
                          ? isLight
                            ? 'rgba(198,166,100,0.12)'
                            : 'rgba(198,166,100,0.10)'
                          : 'transparent',
                        borderColor: isSupported
                          ? 'rgba(198,166,100,0.32)'
                          : isLight
                          ? 'rgba(20,17,13,0.14)'
                          : 'rgba(255,255,255,0.12)',
                        opacity: busy ? 0.62 : 1,
                      },
                    ]}
                  >
                    <Ionicons
                      name={isSupported ? 'checkmark-circle-outline' : 'star-outline'}
                      size={12}
                      color={isSupported ? colors.primary : featuredText}
                    />
                    <Text
                      style={[
                        styles.watchSupportText,
                        { color: isSupported ? colors.primary : featuredText },
                      ]}
                    >
                      {isSupported ? 'Supporting' : 'Support'}
                    </Text>
                  </TouchableOpacity>
                );
              })()}

              {((previewItem as any).collaborators || []).length > 0 ? (
                <View style={styles.watchCreditsInlineWrap}>
                  {((previewItem as any).collaborators as SubmissionCollaborator[]).map((item) => {
                    const collaboratorName =
                      item.users?.full_name ||
                      (item.user_id ? "Collaborator" : "Credit");
                    const canOpenProfile = !!item.users?.id;

                    return (
                      <TouchableOpacity
                        key={`${item.user_id}-${item.role || "role"}`}
                        activeOpacity={0.82}
                        onPress={() =>
                          item.users &&
                          goToProfile({
                            id: item.users.id,
                            full_name: item.users.full_name || "Collaborator",
                          })
                        }
                        disabled={!canOpenProfile}
                        style={styles.watchCreditPerson}
                      >
                        {item.users?.avatar_url ? (
                          <Image
                            source={{ uri: item.users.avatar_url }}
                            style={styles.watchCreditAvatar}
                          />
                        ) : (
                          <View
                            style={[
                              styles.watchCreditAvatarFallback,
                              {
                                backgroundColor: isLight ? colors.cardAlt : 'rgba(198,166,100,0.14)',
                                borderColor: isLight ? colors.borderStrong : 'rgba(198,166,100,0.22)',
                              },
                            ]}
                          >
                            <Text style={[styles.watchCreditAvatarInitial, { color: colors.primary }]}>
                              {collaboratorName.slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                        )}

                        <View style={styles.watchCreditTextWrap}>
                          <Text style={[styles.watchCreditName, { color: featuredText }]} numberOfLines={1}>
                            {collaboratorName}
                          </Text>
                          <Text style={[styles.watchCreditRole, { color: colors.primary }]} numberOfLines={1}>
                            {item.role || "Collaborator"}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : null}
            </View>

            <View style={styles.watchActionsRow}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                  setWatchActionsMenuOpen(false);
                  if (isGuest) {
                    navigation.navigate('Auth', { screen: 'SignIn' });
                    return;
                  }
                  toggleVote(previewItem);
                }}
                disabled={
                  !!voteBusy[previewItem.id] ||
                  (!!currentUserId && (previewItem as any).user_id === currentUserId)
                }
                style={[
                  styles.watchActionChip,
                  {
                    backgroundColor: isLight ? colors.card : '#101010',
                    borderColor: isLight ? colors.border : '#242424',
                  },
                  votedIds.has(previewItem.id) && styles.watchActionChipActive,
                  votedIds.has(previewItem.id) &&
                    {
                      backgroundColor: isLight
                        ? 'rgba(198,166,100,0.13)'
                        : 'rgba(198,166,100,0.12)',
                      borderColor: 'rgba(198,166,100,0.35)',
                    },
                  (voteBusy[previewItem.id] ||
                    (!!currentUserId && (previewItem as any).user_id === currentUserId)) && {
                    opacity: 0.55,
                  },
                ]}
              >
                <Ionicons
                  name={votedIds.has(previewItem.id) ? 'heart' : 'heart-outline'}
                  size={16}
                  color={votedIds.has(previewItem.id) ? colors.primary : featuredText}
                />
                <Text style={[styles.watchActionText, { color: featuredText }]}>
                  {isGuest ? 'Sign In' : votedIds.has(previewItem.id) ? 'Voted' : 'Vote'}
                </Text>
                <Text style={[styles.watchActionMeta, { color: featuredSubText }]}>
                  {voteBusy[previewItem.id] ? '...' : previewItem.votes ?? 0}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                  setWatchActionsMenuOpen(false);
                  void openPreviewComments();
                }}
                style={[
                  styles.watchActionChip,
                  {
                    backgroundColor: isLight ? colors.card : '#101010',
                    borderColor: isLight ? colors.border : '#242424',
                  },
                ]}
              >
                <Ionicons name="chatbubble-ellipses-outline" size={16} color={featuredText} />
                <Text style={[styles.watchActionText, { color: featuredText }]}>Comment</Text>
                <Text style={[styles.watchActionMeta, { color: featuredSubText }]}>
                  {commentCounts[previewItem.id] ?? rootComments.length}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                  setWatchActionsMenuOpen(false);
                  shareSubmissionLink(previewItem as any);
                }}
                style={[
                  styles.watchActionChip,
                  {
                    backgroundColor: isLight ? colors.card : '#101010',
                    borderColor: isLight ? colors.border : '#242424',
                  },
                ]}
              >
                <Ionicons name="arrow-redo-outline" size={16} color={featuredText} />
                <Text style={[styles.watchActionText, { color: featuredText }]}>Share</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                  setWatchActionsMenuOpen(false);
                  if (currentUserId && (previewItem as any).user_id === currentUserId) {
                    setCollaboratorEditorOpen((open) => !open);
                  }
                }}
                style={[
                  styles.watchActionChip,
                  {
                    backgroundColor: isLight ? colors.card : '#101010',
                    borderColor: isLight ? colors.border : '#242424',
                  },
                  collaboratorEditorOpen && styles.watchActionChipActive,
                  collaboratorEditorOpen &&
                    {
                      backgroundColor: isLight
                        ? 'rgba(198,166,100,0.13)'
                        : 'rgba(198,166,100,0.12)',
                      borderColor: 'rgba(198,166,100,0.35)',
                    },
                ]}
              >
                <Ionicons name="people-outline" size={16} color={featuredText} />
                <Text style={[styles.watchActionText, { color: featuredText }]}>Credits</Text>
                <Text style={[styles.watchActionMeta, { color: featuredSubText }]}>
                  {((previewItem as any).collaborators || []).length}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => setWatchActionsMenuOpen((open) => !open)}
                style={[
                  styles.watchActionChip,
                  styles.watchActionChipIconOnly,
                  {
                    backgroundColor: isLight ? colors.card : '#101010',
                    borderColor: isLight ? colors.border : '#242424',
                  },
                ]}
              >
                <Ionicons name="ellipsis-horizontal" size={16} color={featuredText} />
              </TouchableOpacity>
            </View>

            {watchActionsMenuOpen ? (
              <View
                style={[
                  styles.watchMoreMenu,
                  {
                    backgroundColor: isLight ? colors.card : '#101010',
                    borderColor: isLight ? colors.border : '#242424',
                  },
                ]}
              >
                <TouchableOpacity
                  activeOpacity={0.85}
                  onPress={() => {
                    setWatchActionsMenuOpen(false);
                    openReportModal({
                      contentType: 'submission',
                      contentId: previewItem.id,
                      reportedUserId: (previewItem as any).user_id,
                      title: previewItem.title,
                    });
                  }}
                  style={styles.watchMoreMenuItem}
                >
                  <Ionicons name="flag-outline" size={15} color={colors.danger} />
                  <Text style={[styles.watchMoreMenuText, { color: colors.danger }]}>
                    Report film
                  </Text>
                </TouchableOpacity>

                {currentUserId && (previewItem as any).user_id !== currentUserId ? (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      setWatchActionsMenuOpen(false);
                      confirmBlockUser({
                        blockedUserId: (previewItem as any).user_id,
                        blockedUserName: previewItem.users?.full_name,
                      });
                    }}
                    style={styles.watchMoreMenuItem}
                  >
                    <Ionicons name="ban-outline" size={15} color={colors.danger} />
                    <Text style={[styles.watchMoreMenuText, { color: colors.danger }]}>
                      Block creator
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            {currentUserId &&
            (previewItem as any).user_id === currentUserId &&
            collaboratorEditorOpen ? (
              <View
                style={[
                  styles.watchCollaboratorEditor,
                  {
                    backgroundColor: isLight ? colors.card : 'rgba(255,255,255,0.045)',
                    borderColor: featuredBorder,
                  },
                ]}
              >
                <View style={styles.watchCollaboratorEditorHeader}>
                  <Text style={[styles.watchCollaboratorEditorTitle, { color: featuredText }]}>Collaborators</Text>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={savePreviewCollaborators}
                    disabled={collaboratorSaving}
                    style={[
                      styles.watchCollaboratorSaveBtn,
                      collaboratorSaving && { opacity: 0.55 },
                    ]}
                  >
                    <Text style={styles.watchCollaboratorSaveText}>
                      {collaboratorSaving ? 'Saving...' : 'Save'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.watchCollaboratorFormRow}>
                  <TextInput
                    value={collaboratorQuery}
                    onChangeText={setCollaboratorQuery}
                    placeholder="Search user"
                    placeholderTextColor={isLight ? colors.textMuted : 'rgba(244,241,234,0.42)'}
                    style={[
                      styles.watchCollaboratorInput,
                      {
                        flex: 1.25,
                        backgroundColor: isLight ? colors.input : 'rgba(0,0,0,0.36)',
                        borderColor: featuredBorder,
                        color: featuredText,
                      },
                    ]}
                    autoCorrect={false}
                  />
                  <TextInput
                    value={collaboratorRole}
                    onChangeText={setCollaboratorRole}
                    placeholder="Role"
                    placeholderTextColor={isLight ? colors.textMuted : 'rgba(244,241,234,0.42)'}
                    style={[
                      styles.watchCollaboratorInput,
                      {
                        flex: 0.85,
                        backgroundColor: isLight ? colors.input : 'rgba(0,0,0,0.36)',
                        borderColor: featuredBorder,
                        color: featuredText,
                      },
                    ]}
                    autoCorrect={false}
                  />
                </View>

                {collaboratorSearching ? (
                  <View style={styles.watchCollaboratorSearchState}>
                    <ActivityIndicator size="small" color={GOLD} />
                    <Text style={[styles.watchCollaboratorSearchText, { color: featuredSubText }]}>Searching...</Text>
                  </View>
                ) : null}

                {collaboratorResults.length > 0 ? (
                  <View style={styles.watchCollaboratorResults}>
                    {collaboratorResults.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        activeOpacity={0.86}
                        onPress={() => addPreviewCollaborator(item)}
                        style={[
                          styles.watchCollaboratorResultRow,
                          {
                            backgroundColor: isLight ? colors.card : 'rgba(0,0,0,0.24)',
                            borderBottomColor: featuredBorder,
                          },
                        ]}
                      >
                        {item.avatar_url ? (
                          <Image
                            source={{ uri: item.avatar_url }}
                            style={styles.watchCollaboratorResultAvatar}
                          />
                        ) : (
                          <View style={styles.watchCollaboratorResultAvatarFallback}>
                            <Text style={styles.watchCollaboratorInitial}>
                              {(item.full_name || 'C').slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                        )}
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.watchCollaboratorResultName, { color: featuredText }]} numberOfLines={1}>
                            {item.full_name || 'Unnamed creative'}
                          </Text>
                          <Text style={[styles.watchCollaboratorResultMeta, { color: featuredSubText }]} numberOfLines={1}>
                            Add as {collaboratorRole.trim() || 'collaborator'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                ) : null}

                {((previewItem as any).collaborators || []).length > 0 ? (
                  <View style={styles.watchCollaboratorEditorChips}>
                    {(((previewItem as any).collaborators || []) as SubmissionCollaborator[]).map(
                      (item) => (
                        <View
                          key={`edit-${item.user_id}-${item.role || 'role'}`}
                          style={styles.watchCollaboratorEditorChip}
                        >
                          <Text style={styles.watchCollaboratorEditorChipText} numberOfLines={1}>
                            {item.users?.full_name || 'Collaborator'} · {item.role || 'Role'}
                          </Text>
                          <TouchableOpacity
                            activeOpacity={0.8}
                            onPress={() => removePreviewCollaborator(item.user_id)}
                            style={styles.watchCollaboratorRemoveBtn}
                          >
                            <Ionicons name="close" size={14} color={featuredText} />
                          </TouchableOpacity>
                        </View>
                      )
                    )}
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>

          {(() => {
            const watchGenre = String(
              (previewItem as any).film_category || previewItem.category || 'Film'
            );
            const watchDuration = (previewItem as any).duration_seconds
              ? formatPlayerTime((previewItem as any).duration_seconds)
              : null;
            const watchDate = formatWatchDateShort((previewItem as any).submitted_at);
            const watchDescription = String((previewItem as any).description || '').trim();
            const watchMetaParts = [
              formatVoteCount(previewItem.votes),
              watchDuration,
              watchGenre,
              watchDate,
            ].filter(Boolean);

            if (!watchDescription && watchMetaParts.length === 0) return null;

            return (
              <View
                style={[
                  styles.watchDescriptionPanel,
                  {
                    backgroundColor: isLight ? 'rgba(255,253,248,0.86)' : 'rgba(255,255,255,0.035)',
                    borderColor: featuredBorder,
                  },
                ]}
              >
                {watchMetaParts.length > 0 ? (
                  <Text style={[styles.watchDescriptionMeta, { color: featuredText }]} numberOfLines={1}>
                    {watchMetaParts.join(' · ')}
                  </Text>
                ) : null}
                {watchDescription ? (
                  <Text style={[styles.watchDescriptionText, { color: featuredSubText }]} numberOfLines={4}>
                    {watchDescription}
                  </Text>
                ) : null}
              </View>
            );
          })()}

          {useDesktopWatch && previewCommentsExpanded ? (
            renderCommentsPanel(
              {
                width: "100%",
                maxWidth: "100%",
                height: Math.max(260, Math.min(winH * 0.34, 420)),
                borderRadius: 10,
                marginBottom: 12,
                backgroundColor: featuredSurface,
                borderColor: featuredBorder,
              },
              { embedded: true, showClose: false }
            )
          ) : (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => {
              void openPreviewComments();
            }}
            style={[
              styles.watchCommentsPreview,
              {
                backgroundColor: isLight ? colors.card : '#0B0B0B',
                borderColor: featuredBorder,
              },
            ]}
          >
            <View style={styles.watchCommentsPreviewHeader}>
              <Text style={[styles.watchCommentsPreviewTitle, { color: featuredText }]}>Comments</Text>
              <Text style={[styles.watchCommentsPreviewCount, { color: featuredSubText }]}>
                {commentCounts[previewItem.id] ?? rootComments.length}
              </Text>
              {commentsLoading ? <ActivityIndicator color={T.accent} size="small" /> : null}
              <Ionicons
                name="chevron-forward"
                size={16}
                color={featuredSubText}
              />
            </View>

            {rootComments[0] ? (
              <View style={styles.watchCommentsPreviewRow}>
                {rootComments[0].users?.avatar_url ? (
                  <Image
                    source={{ uri: rootComments[0].users.avatar_url }}
                    style={styles.watchCommentsPreviewAvatar}
                  />
                ) : (
                  <View style={styles.watchCommentsPreviewAvatarFallback}>
                    <Text style={styles.watchCommentsPreviewInitial}>
                      {(rootComments[0].users?.full_name || 'U').slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={styles.watchCommentsPreviewBody}>
                  <Text style={[styles.watchCommentsPreviewName, { color: featuredText }]} numberOfLines={1}>
                    {rootComments[0].users?.full_name || 'Unknown'}
                  </Text>
                  <Text style={[styles.watchCommentsPreviewText, { color: featuredSubText }]} numberOfLines={2}>
                    {rootComments[0].comment}
                  </Text>
                </View>
              </View>
            ) : (
              <View
                style={[
                  styles.watchCommentsPreviewInput,
                  {
                    backgroundColor: isLight ? colors.input : 'rgba(0,0,0,0.24)',
                    borderColor: featuredBorder,
                  },
                ]}
              >
                <Text style={[styles.watchCommentsPreviewInputText, { color: colors.textMuted }]}>Add a comment...</Text>
              </View>
            )}
          </TouchableOpacity>
          )}
            </View>

            <View
              style={
                useDesktopWatch
                  ? [styles.watchSideColumn, { width: watchDesktopRailW }]
                  : undefined
              }
            >
          <View
            style={[
              styles.watchSuggestionsSection,
              useDesktopWatch && styles.watchSuggestionsSectionDesktop,
              { backgroundColor: featuredBackground },
            ]}
          >
            <View style={styles.watchSectionCompactHeader}>
              <Text style={[styles.watchSectionTitle, { color: featuredText }]}>Up next</Text>
            </View>

            <ScrollView
              style={
                useDesktopWatch
                  ? [
                      styles.watchSuggestionsScroll,
                      { maxHeight: Math.max(360, Math.min(winH - 150, 760)) },
                    ]
                  : undefined
              }
              contentContainerStyle={styles.watchSuggestionsList}
              nestedScrollEnabled
              scrollEnabled={useDesktopWatch}
              showsVerticalScrollIndicator={useDesktopWatch}
            >
              {previewSuggestions.map((item) => {
                const suggestionGenre = String(
                  (item as any).film_category || item.category || 'Film'
                );
                const suggestionDuration = (item as any).duration_seconds
                  ? formatPlayerTime((item as any).duration_seconds)
                  : null;
                const suggestionMetaParts = [
                  formatVoteCount(item.votes),
                  suggestionDuration,
                  suggestionGenre,
                ].filter(Boolean);

                return (
                  <Pressable
                    key={item.id}
                    onPress={() => openPreview(item as any)}
                    style={(state: any) => [
                      styles.watchSuggestionCard,
                      useDesktopWatch && styles.watchSuggestionCardDesktop,
                      {
                        backgroundColor: state.hovered
                          ? isLight
                            ? 'rgba(20,17,13,0.055)'
                            : 'rgba(255,255,255,0.055)'
                          : 'transparent',
                        opacity: state.pressed ? 0.86 : 1,
                      },
                    ]}
                  >
                    <Image
                      source={{ uri: (item as any).thumbnail_url || 'https://picsum.photos/480/270' }}
                      style={[styles.watchSuggestionThumb, useDesktopWatch && styles.watchSuggestionThumbDesktop]}
                      resizeMode="cover"
                    />
                    <View style={styles.watchSuggestionBody}>
                      <Text style={[styles.watchSuggestionTitle, { color: featuredText }]} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <Text style={[styles.watchSuggestionCreator, { color: featuredSubText }]} numberOfLines={1}>
                        {item.users?.full_name || 'Unknown'}
                      </Text>
                      <Text style={[styles.watchSuggestionMeta, { color: featuredSubText }]} numberOfLines={1}>
                        {suggestionMetaParts.join(' · ')}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
            </View>
          </View>

          {!useDesktopWatch && previewCommentsExpanded ? (
          <View
            style={[
              styles.watchCommentsSection,
              {
                backgroundColor: featuredSurface,
                borderColor: featuredBorder,
              },
            ]}
          >
            <View
              style={[
                styles.watchSectionHeader,
                { borderBottomColor: isLight ? colors.border : 'rgba(255,255,255,0.06)' },
              ]}
            >
              <View>
                <Text style={[styles.watchSectionTitle, { color: featuredText }]}>Comments</Text>
                <Text style={[styles.watchSectionSub, { color: featuredSubText }]}>
                  Shared with this film across Overlooked.
                </Text>
              </View>
              {commentsLoading ? <ActivityIndicator color={T.accent} size="small" /> : null}
            </View>

            <View
              style={[
                styles.watchComposerWrap,
                {
                  backgroundColor: isLight ? colors.card : '#090909',
                  borderBottomColor: isLight ? colors.border : 'rgba(255,255,255,0.06)',
                },
              ]}
            >
              {replyingTo ? (
                <View style={styles.replyingBanner}>
                  <Text style={[styles.replyingBannerText, { color: featuredText }]} numberOfLines={1}>
                    Replying to {replyingTo.users?.full_name || 'comment'}
                  </Text>
                  <TouchableOpacity onPress={() => setReplyingTo(null)} activeOpacity={0.9}>
                    <Text style={[styles.replyingBannerCancel, { color: colors.primary }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <View style={styles.commentComposer}>
                <TextInput
                  value={commentText}
                  onFocus={handleCommentInputFocus}
                  onChangeText={(txt) => {
                    if (isGuest) {
                      promptSignIn('Create an account or sign in to comment on films.');
                      return;
                    }
                    setCommentText(txt);
                  }}
                  placeholder={
                    isGuest
                      ? 'Sign in to comment…'
                      : replyingTo
                      ? 'Write a reply…'
                      : 'Add a comment…'
                  }
                  placeholderTextColor={colors.textMuted}
                  style={[
                    styles.commentInput,
                    {
                      backgroundColor: isLight ? colors.input : '#0B0B0B',
                      borderColor: featuredBorder,
                      color: featuredText,
                    },
                  ]}
                  multiline
                />
                <TouchableOpacity
                  onPress={() => {
                    if (isGuest) {
                      navigation.navigate('Auth', { screen: 'SignIn' });
                      return;
                    }
                    postComment();
                  }}
                  disabled={commentPosting || (!isGuest && !commentText.trim())}
                  activeOpacity={0.9}
                  style={[
                    styles.commentSendBtn,
                    {
                      backgroundColor: colors.primary,
                      borderColor: colors.primary,
                    },
                    (commentPosting || (!isGuest && !commentText.trim())) && {
                      opacity: 0.5,
                    },
                  ]}
                >
                  <Text style={[styles.commentSendText, { color: colors.textOnPrimary }]}>
                    {isGuest ? 'Sign In' : commentPosting ? '…' : 'Post'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {commentsLoading && rootComments.length === 0 ? (
              <ActivityIndicator color={T.accent} style={{ padding: 20 }} />
            ) : rootComments.length === 0 ? (
              <View style={styles.commentsEmptyState}>
                <Text style={[styles.commentsEmptyTitle, { color: featuredText }]}>No comments yet</Text>
                <Text style={[styles.commentsEmptyText, { color: featuredSubText }]}>
                  Be the first to say something thoughtful.
                </Text>
              </View>
            ) : (
              <View style={styles.watchCommentsList}>
                {rootComments.map((item) => {
                  const u = item.users;
                  const replies = repliesByParent[item.id] || [];

                  return (
                    <View key={item.id} style={styles.commentThread}>
                      <View style={styles.commentCard}>
                        <TouchableOpacity
                          onPress={() => u && goToProfile({ id: u.id, full_name: u.full_name })}
                          activeOpacity={0.9}
                          style={[
                            styles.commentAvatarTap,
                            {
                              backgroundColor: isLight ? colors.backgroundAlt : '#000',
                              borderColor: featuredBorder,
                            },
                          ]}
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
                            <Text style={[styles.commentName, { color: featuredText }]}>{u?.full_name || 'Unknown'}</Text>
                          </TouchableOpacity>

                          <Text style={[styles.commentText, { color: featuredSubText }]}>{item.comment}</Text>

                          <View style={styles.commentActionsRow}>
                            <TouchableOpacity
                              activeOpacity={0.9}
                              onPress={() => {
                                if (isGuest) {
                                  navigation.navigate('Auth', { screen: 'SignIn' });
                                  return;
                                }
                                setReplyingTo(item);
                              }}
                              style={styles.replyBtn}
                            >
                              <Text style={styles.replyBtnText}>
                                {isGuest ? 'Sign In to Reply' : 'Reply'}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              activeOpacity={0.9}
                              onPress={() =>
                                openReportModal({
                                  contentType: 'comment',
                                  contentId: item.id,
                                  reportedUserId: item.user_id,
                                  title: item.comment,
                                })
                              }
                              style={styles.replyBtn}
                            >
                              <Text style={styles.replyBtnText}>Report</Text>
                            </TouchableOpacity>

                            {currentUserId && item.user_id !== currentUserId ? (
                              <TouchableOpacity
                                activeOpacity={0.9}
                                onPress={() =>
                                  confirmBlockUser({
                                    blockedUserId: item.user_id,
                                    blockedUserName: item.users?.full_name,
                                  })
                                }
                                style={styles.replyDangerBtn}
                              >
                                <Text style={styles.replyDangerBtnText}>Block</Text>
                              </TouchableOpacity>
                            ) : null}
                          </View>
                        </View>
                      </View>

                      {replies.length > 0 ? (
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
                                  style={[
                                    styles.replyAvatarTap,
                                    {
                                      backgroundColor: isLight ? colors.backgroundAlt : '#000',
                                      borderColor: featuredBorder,
                                    },
                                  ]}
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
                                    <Text style={[styles.replyName, { color: featuredText }]}>{ru?.full_name || 'Unknown'}</Text>
                                  </TouchableOpacity>

                                  <Text style={[styles.replyText, { color: featuredSubText }]}>{reply.comment}</Text>
                                </View>
                              </View>
                            );
                          })}
                        </View>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </View>
          ) : null}
        </ScrollView>
      </Animated.View>

      {commentsOpen && !useDesktopWatch ? (
        <View
          style={[
            styles.commentsOverlay,
            {
              backgroundColor: isLight ? 'rgba(20,17,13,0.24)' : 'rgba(0,0,0,0.64)',
              justifyContent: 'flex-end',
              paddingHorizontal: isMobile ? 0 : 22,
              paddingTop: isMobile ? 80 : 32,
              paddingBottom: 0,
            },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFillObject} onPress={closeComments} />
          <Animated.View style={Platform.OS === 'android' ? commentsKeyboardLiftStyle : null}>
            {renderCommentsPanel(
              isMobile
                ? {
                    width: winW,
                    maxWidth: winW,
                    height: Math.min(winH * 0.72, 620),
                    borderBottomLeftRadius: 0,
                    borderBottomRightRadius: 0,
                  }
                : {
                    width: '100%',
                    maxWidth: 820,
                    height: Math.min(winH * 0.72, 620),
                    borderBottomLeftRadius: 0,
                    borderBottomRightRadius: 0,
                  }
            )}
          </Animated.View>
        </View>
      ) : null}
    </Animated.View>
  </Modal>
)}
    {/* ---------------- Comments Modal (kept) ---------------- */}
    {commentsOpen && !previewOpen && (
  <Modal
    visible
    transparent
    animationType="fade"
    presentationStyle="overFullScreen"
    onRequestClose={closeComments}
  >
    <View
      style={[
        styles.commentsOverlay,
        {
          backgroundColor: isLight ? 'rgba(20,17,13,0.24)' : 'rgba(0,0,0,0.78)',
          ...(isMobile
            ? {
                justifyContent: 'flex-end',
                paddingHorizontal: 0,
                paddingTop: 80,
                paddingBottom: 0,
              }
            : null),
        },
      ]}
    >
      <Pressable style={StyleSheet.absoluteFillObject} onPress={closeComments} />

      <Animated.View
  style={[
    styles.commentsModalCard,
    Platform.OS === 'android' ? commentsKeyboardLiftStyle : null,
    {
      backgroundColor: featuredSurface,
      borderColor: featuredBorder,
      shadowColor: colors.shadow,
    },
    isMobile && {
      width: winW,
      maxWidth: winW,
      height: Math.min(winH * 0.72, 620),
      maxHeight: Math.min(winH * 0.72, 620),
      alignSelf: 'stretch',
      borderBottomLeftRadius: 0,
      borderBottomRightRadius: 0,
    }
  ]}
>
        <View
          style={[
            styles.commentsHeader,
            { borderBottomColor: isLight ? colors.border : 'rgba(255,255,255,0.05)' },
          ]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.commentsTitle, { color: featuredText }]}>Comments</Text>
            {commentsFor?.title ? (
              <Text style={[styles.commentsSubtitle, { color: featuredSubText }]} numberOfLines={1}>
                {commentsFor.title}
              </Text>
            ) : null}
          </View>

          <TouchableOpacity
            onPress={closeComments}
            activeOpacity={0.9}
            style={[
              styles.commentsCloseBtn,
              {
                backgroundColor: isLight ? colors.backgroundAlt : '#0D0D0D',
                borderColor: featuredBorder,
              },
            ]}
          >
            <Text style={[styles.commentsClose, { color: colors.primary }]}>Close</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.commentsBody}>
          {commentsLoading ? (
            <ActivityIndicator color={T.accent} style={{ padding: 20 }} />
          ) : rootComments.length === 0 ? (
            <View style={styles.commentsEmptyState}>
              <Text style={[styles.commentsEmptyTitle, { color: featuredText }]}>No comments yet</Text>
              <Text style={[styles.commentsEmptyText, { color: featuredSubText }]}>Be the first to say something thoughtful.</Text>
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
                        style={[
                          styles.commentAvatarTap,
                          {
                            backgroundColor: isLight ? colors.backgroundAlt : '#000',
                            borderColor: featuredBorder,
                          },
                        ]}
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
                          <Text style={[styles.commentName, { color: featuredText }]}>{u?.full_name || 'Unknown'}</Text>
                        </TouchableOpacity>

                        <Text style={[styles.commentText, { color: featuredSubText }]}>{item.comment}</Text>

                        <View style={styles.commentActionsRow}>
                          <TouchableOpacity
  activeOpacity={0.9}
  onPress={() => {
    if (isGuest) {
      navigation.navigate('Auth', { screen: 'SignIn' });
      return;
    }
    setReplyingTo(item);
  }}
  style={styles.replyBtn}
>
  <Text style={styles.replyBtnText}>{isGuest ? 'Sign In to Reply' : 'Reply'}</Text>
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
                                style={[
                                  styles.replyAvatarTap,
                                  {
                                    backgroundColor: isLight ? colors.backgroundAlt : '#000',
                                    borderColor: featuredBorder,
                                  },
                                ]}
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
                                  <Text style={[styles.replyName, { color: featuredText }]}>{ru?.full_name || 'Unknown'}</Text>
                                </TouchableOpacity>

                                <Text style={[styles.replyText, { color: featuredSubText }]}>{reply.comment}</Text>
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

        <View
          style={[
            styles.commentComposerWrap,
            {
              backgroundColor: isLight ? colors.card : '#090909',
              borderTopColor: isLight ? colors.border : 'rgba(255,255,255,0.05)',
            },
          ]}
        >
          {replyingTo ? (
            <View style={styles.replyingBanner}>
              <Text style={[styles.replyingBannerText, { color: featuredText }]} numberOfLines={1}>
                Replying to {replyingTo.users?.full_name || 'comment'}
              </Text>
              <TouchableOpacity onPress={() => setReplyingTo(null)} activeOpacity={0.9}>
                <Text style={[styles.replyingBannerCancel, { color: colors.primary }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <View style={styles.commentComposer}>
            <TextInput
  value={commentText}
  onFocus={handleCommentInputFocus}
  onChangeText={(txt) => {
    if (isGuest) {
      promptSignIn('Create an account or sign in to comment on films.');
      return;
    }
    setCommentText(txt);
  }}
  placeholder={
    isGuest
      ? 'Sign in to comment…'
      : replyingTo
      ? 'Write a reply…'
      : 'Add a comment…'
  }
              placeholderTextColor={colors.textMuted}
              style={[
                styles.commentInput,
                {
                  backgroundColor: isLight ? colors.input : '#0B0B0B',
                  borderColor: featuredBorder,
                  color: featuredText,
                },
              ]}
              multiline
            />
            <TouchableOpacity
  onPress={() => {
    if (isGuest) {
      navigation.navigate('Auth', { screen: 'SignIn' });
      return;
    }
    postComment();
  }}
  disabled={commentPosting || (!isGuest && !commentText.trim())}
  activeOpacity={0.9}
  style={[
    styles.commentSendBtn,
    {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    (commentPosting || (!isGuest && !commentText.trim())) && { opacity: 0.5 },
  ]}
>
  <Text style={[styles.commentSendText, { color: colors.textOnPrimary }]}>
    {isGuest ? 'Sign In' : commentPosting ? '…' : 'Post'}
  </Text>
</TouchableOpacity>
          </View>
        </View>
      </Animated.View>
    </View>
  </Modal>
)}
<ReportContentModal
  visible={reportOpen && !!reportTarget}
  selectedReason={reportReason}
  details={reportDetails}
  submitting={reportSubmitting}
  onReasonChange={setReportReason}
  onDetailsChange={setReportDetails}
  onClose={closeReportModal}
  onSubmit={submitReport}
/>
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

mobilePillDanger: {
  height: 30,
  paddingHorizontal: 10,
  borderRadius: 999,
  backgroundColor: 'rgba(255,70,70,0.10)',
  borderWidth: 1,
  borderColor: 'rgba(255,90,90,0.26)',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 6,
  marginBottom: 7,
},

mobilePillDangerText: {
  color: '#FF8A8A',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
},

feedActionBtnDanger: {
  paddingVertical: 9,
  paddingHorizontal: 12,
  borderRadius: 12,
  backgroundColor: 'rgba(255,70,70,0.08)',
  borderWidth: 1,
  borderColor: 'rgba(255,90,90,0.24)',
  marginRight: 8,
  marginBottom: 10,
},

feedActionDangerText: {
  color: '#FF8A8A',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
  letterSpacing: 0.9,
  textTransform: 'uppercase',
},

previewActionPillDanger: {
  paddingVertical: 10,
  paddingHorizontal: 14,
  borderRadius: 999,
  backgroundColor: 'rgba(255,70,70,0.08)',
  borderWidth: 1,
  borderColor: 'rgba(255,90,90,0.24)',
  marginRight: 8,
  marginBottom: 8,
},

previewActionTextDanger: {
  color: '#FF8A8A',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
  letterSpacing: 0.7,
  textTransform: 'uppercase',
},

replyDangerBtn: {
  minHeight: 20,
  paddingVertical: 0,
  paddingHorizontal: 4,
  borderRadius: 0,
  backgroundColor: 'transparent',
  borderWidth: 0,
  marginRight: 12,
  marginTop: 0,
  alignItems: 'center',
  justifyContent: 'center',
},

replyDangerBtnText: {
  color: 'rgba(255,138,138,0.72)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 10.5,
  letterSpacing: 0.15,
  textTransform: 'uppercase',
},

reportOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.82)',
  justifyContent: 'center',
  alignItems: 'center',
  padding: 18,
},

reportCard: {
  width: '100%',
  maxWidth: 520,
  maxHeight: '88%',
  borderRadius: 22,
  backgroundColor: '#080808',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
  padding: 16,
},

reportHeader: {
  flexDirection: 'row',
  alignItems: 'flex-start',
  marginBottom: 16,
},

reportTitle: {
  color: '#F8F6F1',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 18,
  letterSpacing: 0.5,
  textTransform: 'uppercase',
},

reportSubtitle: {
  marginTop: 5,
  color: 'rgba(237,235,230,0.62)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 12,
  lineHeight: 17,
},

reportCloseBtn: {
  height: 34,
  paddingHorizontal: 12,
  borderRadius: 999,
  backgroundColor: 'rgba(255,255,255,0.06)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
  alignItems: 'center',
  justifyContent: 'center',
  marginLeft: 12,
},

reportCloseText: {
  color: 'rgba(237,235,230,0.72)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
  textTransform: 'uppercase',
},

reportLabel: {
  color: GOLD,
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
  letterSpacing: 1,
  textTransform: 'uppercase',
  marginBottom: 8,
  marginTop: 8,
},

reportReasonItem: {
  minHeight: 42,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.07)',
  backgroundColor: '#050505',
  paddingHorizontal: 12,
  paddingVertical: 10,
  marginBottom: 8,
  flexDirection: 'row',
  alignItems: 'center',
},

reportReasonItemActive: {
  borderColor: 'rgba(212,180,95,0.38)',
  backgroundColor: 'rgba(212,180,95,0.08)',
},

reportReasonText: {
  flex: 1,
  color: 'rgba(237,235,230,0.78)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '800',
  fontSize: 12,
},

reportReasonDot: {
  width: 8,
  height: 8,
  borderRadius: 999,
  backgroundColor: 'rgba(255,255,255,0.24)',
  opacity: 0.5,
  marginLeft: 10,
},

reportInput: {
  minHeight: 92,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
  backgroundColor: '#050505',
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: '#F8F6F1',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 13,
  textAlignVertical: 'top',
  outlineStyle: 'none',
} as any,

reportSubmitBtn: {
  height: 46,
  borderRadius: 999,
  backgroundColor: GOLD,
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: 14,
},

reportSubmitText: {
  color: '#000000',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 12,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
},

reportFooterText: {
  marginTop: 10,
  color: 'rgba(237,235,230,0.45)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 11,
  lineHeight: 16,
  textAlign: 'center',
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

  heroBylineBlock: {
    alignSelf: 'center',
    marginTop: 8,
    alignItems: 'center',
  },

  heroBylineTap: {
    alignSelf: 'center',
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

  previewCommentsLayer: {
  ...StyleSheet.absoluteFillObject,
  zIndex: 50,
  backgroundColor: 'rgba(0,0,0,0.50)',
  justifyContent: 'center',
  alignItems: 'center',
  paddingHorizontal: Platform.OS === 'web' ? 20 : 10,
  paddingVertical: Platform.OS === 'web' ? 20 : 12,
},

previewCommentsCard: {
  width: Platform.OS === 'web' ? '100%' : '96%',
  maxWidth: Platform.OS === 'web' ? 680 : 760,
  height: Platform.OS === 'web' ? '82%' : '78%',
  maxHeight: Platform.OS === 'web' ? 760 : 640,
  backgroundColor: '#080808',
  borderRadius: 20,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.06)',
  overflow: 'hidden',
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
    bottom: 8,
    height: 18,
    justifyContent: 'center',
    zIndex: 15,
  },

  progressTrack: {
    height: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.22)',
  },

  progressFill: {
    height: 2,
    borderRadius: 999,
    backgroundColor: GOLD,
  },

  progressThumb: {
    position: 'absolute',
    top: -4,
    width: 10,
    height: 10,
    marginLeft: -5,
    borderRadius: 5,
    backgroundColor: GOLD,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },

  playerChromeDock: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 8,
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(5,5,5,0.58)',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 20,
    elevation: 20,
  },

  playerTimeline: {
    height: 12,
    justifyContent: 'center',
    marginBottom: 2,
  },

  playerTimelineTrack: {
    height: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.26)',
  },

  playerTimelineFill: {
    height: 2,
    borderRadius: 999,
    backgroundColor: GOLD,
  },

  playerTimelineThumb: {
    position: 'absolute',
    top: -4,
    width: 10,
    height: 10,
    marginLeft: -5,
    borderRadius: 5,
    backgroundColor: GOLD,
  },

  playerControlRow: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },

  playerControlLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  playerControlRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },

  playerIconButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },

  playerTimeText: {
    flexShrink: 1,
    color: '#F7F2E8',
    fontFamily: SYSTEM_SANS,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.1,
  },

  playerCenterCue: {
    position: 'absolute',
    left: '50%',
    top: '50%',
    width: 76,
    height: 76,
    marginLeft: -38,
    marginTop: -38,
    borderRadius: 38,
    backgroundColor: 'rgba(0,0,0,0.58)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 16,
  },
  playerLoadingOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 14,
    gap: 8,
  },
  playerLoadingBubble: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.62)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  playerLoadingText: {
    maxWidth: '82%',
    color: '#F7F2E8',
    fontFamily: SYSTEM_SANS,
    fontSize: 11,
    fontWeight: '800',
    textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.7)',
    textShadowRadius: 8,
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

qualityBtn: {
  position: 'absolute',
  right: 10,
  top: 10,
  minHeight: 36,
  paddingHorizontal: 10,
  borderRadius: 999,
  backgroundColor: 'rgba(0,0,0,0.58)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.12)',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 5,
},

qualityBtnText: {
  color: '#fff',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 8,
  letterSpacing: 0.3,
  textTransform: 'uppercase',
},

qualityMenu: {
  position: 'absolute',
  right: 10,
  top: 52,
  minWidth: 124,
  borderRadius: 14,
  backgroundColor: 'rgba(0,0,0,0.82)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.16)',
  overflow: 'hidden',
  paddingVertical: 4,
},

qualityMenuItem: {
  minHeight: 34,
  paddingHorizontal: 10,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
},

qualityMenuItemSelected: {
  backgroundColor: 'rgba(198,166,100,0.14)',
},

qualityMenuText: {
  color: '#fff',
  fontFamily: SYSTEM_SANS,
  fontSize: 11,
  fontWeight: '800',
  letterSpacing: 0.3,
  textTransform: 'uppercase',
},

qualityMenuTextSelected: {
  color: GOLD,
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
  justifyContent: Platform.OS === 'web' ? 'center' : 'flex-start',
  alignItems: 'center',
  paddingHorizontal: Platform.OS === 'web' ? 22 : 0,
  paddingTop: Platform.OS === 'web' ? 34 : 0,
  paddingBottom: Platform.OS === 'web' ? 24 : 0,
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

watchScroll: {
  width: '100%',
},

watchContent: {
  paddingHorizontal: Platform.OS === 'web' ? 14 : 10,
  paddingTop: Platform.OS === 'web' ? 8 : 54,
  paddingBottom: 14,
},

watchContentDesktop: {
  paddingHorizontal: 22,
  paddingTop: 8,
  paddingBottom: 18,
},

watchDesktopColumns: {
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: 20,
},

watchMainColumn: {
  flexShrink: 0,
  minWidth: 0,
},

watchSideColumn: {
  flexShrink: 0,
  minWidth: 0,
  paddingTop: 1,
},

watchTopBar: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'flex-end',
  marginBottom: 6,
  zIndex: 30,
  elevation: 30,
},

watchEyebrow: {
  color: 'rgba(237,235,230,0.50)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '800',
  fontSize: 10,
  letterSpacing: 0.9,
  textTransform: 'uppercase',
},

watchTopTitle: {
  marginTop: 2,
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 18,
  lineHeight: 22,
},

watchCloseCircle: {
  width: 36,
  height: 36,
  borderRadius: 18,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(255,255,255,0.10)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.14)',
  zIndex: 31,
  elevation: 31,
},

watchCloseIcon: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '800',
  fontSize: 24,
  lineHeight: 27,
},

watchPlayerWrap: {
  borderRadius: Platform.OS === 'web' ? 10 : 0,
  overflow: 'hidden',
  backgroundColor: '#000',
  borderWidth: Platform.OS === 'web' ? StyleSheet.hairlineWidth : 0,
  borderColor: 'rgba(255,255,255,0.08)',
  marginBottom: 10,
  marginHorizontal: Platform.OS === 'web' ? 0 : -10,
},

watchPlayerFallback: {
  height: 220,
  borderRadius: 0,
  backgroundColor: '#000',
},

watchMetaBlock: {
  backgroundColor: 'transparent',
  borderWidth: 0,
  paddingHorizontal: 0,
  paddingTop: 0,
  paddingBottom: 0,
  marginBottom: 8,
},

watchTitle: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 19,
  lineHeight: 24,
},

watchCreatorRow: {
  marginTop: 7,
  flexDirection: 'row',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 10,
},

watchCreatorTap: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  flexShrink: 0,
  maxWidth: Platform.OS === 'web' ? 250 : 128,
  minWidth: 0,
},

watchSupportButton: {
  minHeight: 24,
  borderRadius: 12,
  borderWidth: 1,
  paddingHorizontal: 9,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 3,
},

watchSupportText: {
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 9,
  letterSpacing: 0.35,
  textTransform: 'uppercase',
},

watchCreatorAvatar: {
  width: 30,
  height: 30,
  borderRadius: 15,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(198,166,100,0.16)',
  borderWidth: 1,
  borderColor: 'rgba(198,166,100,0.28)',
  overflow: 'hidden',
},

watchCreatorAvatarImage: {
  width: '100%',
  height: '100%',
},

watchCreatorAvatarText: {
  color: GOLD,
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 13,
},

watchCreatorName: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 12.5,
  lineHeight: 15,
},

watchCreatorMeta: {
  marginTop: 1,
  color: 'rgba(237,235,230,0.55)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 10.5,
},

watchCreditsInlineWrap: {
  flex: 1,
  minWidth: Platform.OS === 'web' ? 200 : 150,
  maxWidth: '100%',
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 10,
},

watchCreditPerson: {
  maxWidth: Platform.OS === 'web' ? 185 : 178,
  minWidth: 0,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 7,
  paddingRight: 4,
},

watchCreditAvatar: {
  width: 28,
  height: 28,
  borderRadius: 14,
  backgroundColor: '#050505',
},

watchCreditAvatarFallback: {
  width: 28,
  height: 28,
  borderRadius: 14,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(198,166,100,0.14)',
  borderWidth: 1,
  borderColor: 'rgba(198,166,100,0.22)',
},

watchCreditAvatarInitial: {
  color: GOLD,
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 10.5,
},

watchCreditTextWrap: {
  minWidth: 0,
  flexShrink: 1,
},

watchCreditName: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
  lineHeight: 13,
},

watchCreditRole: {
  marginTop: 0,
  color: GOLD,
  fontFamily: SYSTEM_SANS,
  fontWeight: '800',
  fontSize: 10,
  lineHeight: 12,
},

watchCollaboratorsInlineScroll: {
  flex: 1,
  minWidth: 0,
},

watchCollaboratorsInlineList: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  paddingRight: 4,
},

watchCollaboratorInlinePill: {
  maxWidth: 190,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: 'rgba(198,166,100,0.24)',
  backgroundColor: 'rgba(198,166,100,0.09)',
  paddingVertical: 6,
  paddingLeft: 7,
  paddingRight: 11,
},

watchCollaboratorInlineAvatar: {
  width: 26,
  height: 26,
  borderRadius: 13,
  backgroundColor: '#050505',
},

watchCollaboratorInlineAvatarFallback: {
  width: 26,
  height: 26,
  borderRadius: 13,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(198,166,100,0.16)',
},

watchCollaboratorInitial: {
  color: GOLD,
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
},

watchCollaboratorTextWrap: {
  maxWidth: 150,
  minWidth: 0,
},

watchCollaboratorName: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
},

watchCollaboratorRole: {
  marginTop: 1,
  color: GOLD,
  fontFamily: SYSTEM_SANS,
  fontWeight: '800',
  fontSize: 10,
},

watchCollaboratorEditor: {
  marginTop: 12,
  borderRadius: 18,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.10)',
  backgroundColor: 'rgba(255,255,255,0.045)',
  padding: 12,
  gap: 10,
},

watchCollaboratorEditorHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
},

watchCollaboratorEditorTitle: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 13,
  letterSpacing: 0.7,
  textTransform: 'uppercase',
},

watchCollaboratorSaveBtn: {
  minHeight: 34,
  borderRadius: 999,
  paddingHorizontal: 14,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: GOLD,
},

watchCollaboratorSaveText: {
  color: '#050505',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
},

watchCollaboratorFormRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
},

watchCollaboratorInput: {
  minHeight: 42,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.10)',
  backgroundColor: 'rgba(0,0,0,0.36)',
  paddingHorizontal: 12,
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '800',
  fontSize: 13,
},

watchCollaboratorSearchState: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
},

watchCollaboratorSearchText: {
  color: 'rgba(244,241,234,0.58)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 12,
},

watchCollaboratorResults: {
  borderRadius: 16,
  overflow: 'hidden',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
},

watchCollaboratorResultRow: {
  minHeight: 52,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 10,
  paddingHorizontal: 10,
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: 'rgba(255,255,255,0.08)',
  backgroundColor: 'rgba(0,0,0,0.24)',
},

watchCollaboratorResultAvatar: {
  width: 32,
  height: 32,
  borderRadius: 16,
  backgroundColor: '#050505',
},

watchCollaboratorResultAvatarFallback: {
  width: 32,
  height: 32,
  borderRadius: 16,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(198,166,100,0.16)',
},

watchCollaboratorResultName: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 13,
},

watchCollaboratorResultMeta: {
  marginTop: 2,
  color: 'rgba(244,241,234,0.52)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 11,
},

watchCollaboratorEditorChips: {
  flexDirection: 'row',
  flexWrap: 'wrap',
  gap: 8,
},

watchCollaboratorEditorChip: {
  maxWidth: '100%',
  minHeight: 34,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: 'rgba(198,166,100,0.22)',
  backgroundColor: 'rgba(198,166,100,0.09)',
  paddingLeft: 12,
  paddingRight: 5,
},

watchCollaboratorEditorChipText: {
  maxWidth: 230,
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '800',
  fontSize: 12,
},

watchCollaboratorRemoveBtn: {
  width: 26,
  height: 26,
  borderRadius: 13,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(255,255,255,0.08)',
},

watchActionsRow: {
  marginTop: 9,
  flexDirection: 'row',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 6,
},

watchActionChip: {
  minHeight: 28,
  borderRadius: 14,
  paddingHorizontal: 10,
  paddingVertical: 4,
  backgroundColor: 'rgba(255,255,255,0.075)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.10)',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
},

watchActionChipIconOnly: {
  width: 30,
  paddingHorizontal: 0,
},

watchActionChipActive: {
  backgroundColor: 'rgba(198,166,100,0.12)',
  borderColor: 'rgba(198,166,100,0.35)',
},

watchActionText: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
  letterSpacing: 0,
},

watchActionMeta: {
  color: 'rgba(237,235,230,0.50)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '800',
  fontSize: 10.5,
},

watchActionDangerChip: {
  backgroundColor: 'rgba(255,70,70,0.075)',
  borderColor: 'rgba(255,90,90,0.22)',
},

watchActionDangerText: {
  color: '#FF8A8A',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
  letterSpacing: 0,
},

watchMoreMenu: {
  alignSelf: 'flex-start',
  marginTop: 6,
  borderRadius: 10,
  borderWidth: 1,
  paddingVertical: 4,
  minWidth: 158,
},

watchMoreMenuItem: {
  minHeight: 32,
  paddingHorizontal: 10,
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
},

watchMoreMenuText: {
  fontFamily: SYSTEM_SANS,
  fontSize: 11,
  fontWeight: '900',
},

watchDescriptionPanel: {
  borderRadius: 8,
  borderWidth: StyleSheet.hairlineWidth,
  paddingHorizontal: 10,
  paddingVertical: 8,
  marginBottom: 10,
},

watchDescriptionMeta: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11.5,
  lineHeight: 15,
},

watchDescriptionText: {
  marginTop: 4,
  color: 'rgba(237,235,230,0.68)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '600',
  fontSize: 11.5,
  lineHeight: 16,
},

watchCommentsPreview: {
  borderRadius: 8,
  backgroundColor: '#0B0B0B',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.07)',
  paddingHorizontal: 10,
  paddingVertical: 9,
  marginBottom: 10,
},

watchCommentsPreviewHeader: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 7,
},

watchCommentsPreviewTitle: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 13,
},

watchCommentsPreviewCount: {
  color: 'rgba(237,235,230,0.56)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '800',
  fontSize: 12,
  flex: 1,
},

watchCommentsPreviewRow: {
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: 9,
  marginTop: 10,
},

watchCommentsPreviewAvatar: {
  width: 28,
  height: 28,
  borderRadius: 14,
  backgroundColor: '#000',
},

watchCommentsPreviewAvatarFallback: {
  width: 28,
  height: 28,
  borderRadius: 14,
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'rgba(198,166,100,0.16)',
},

watchCommentsPreviewInitial: {
  color: GOLD,
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
},

watchCommentsPreviewBody: {
  flex: 1,
  minWidth: 0,
},

watchCommentsPreviewName: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 11,
},

watchCommentsPreviewText: {
  marginTop: 2,
  color: 'rgba(237,235,230,0.70)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '600',
  fontSize: 12,
  lineHeight: 16,
},

watchCommentsPreviewInput: {
  height: 34,
  borderRadius: 17,
  backgroundColor: '#111',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.07)',
  justifyContent: 'center',
  paddingHorizontal: 12,
  marginTop: 10,
},

watchCommentsPreviewInputText: {
  color: 'rgba(237,235,230,0.42)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 12,
},

watchCommentsSection: {
  borderRadius: 10,
  backgroundColor: '#090909',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.06)',
  overflow: 'hidden',
  marginBottom: 10,
},

watchSectionHeader: {
  paddingHorizontal: 11,
  paddingTop: 10,
  paddingBottom: 8,
  borderBottomWidth: 1,
  borderBottomColor: 'rgba(255,255,255,0.06)',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
},

watchSectionTitle: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 12.5,
  letterSpacing: 0.45,
  textTransform: 'uppercase',
},

watchSectionSub: {
  marginTop: 2,
  color: 'rgba(237,235,230,0.56)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '600',
  fontSize: 11,
  lineHeight: 15,
},

watchSectionCompactHeader: {
  marginBottom: 8,
},

watchComposerWrap: {
  paddingHorizontal: 8,
  paddingVertical: 8,
  borderBottomWidth: 1,
  borderBottomColor: 'rgba(255,255,255,0.06)',
},

watchCommentsList: {
  paddingHorizontal: 10,
  paddingTop: 6,
  paddingBottom: 2,
},

watchSuggestionsSection: {
  borderRadius: 0,
  backgroundColor: 'transparent',
  borderWidth: 0,
  paddingHorizontal: 0,
  paddingTop: 0,
  paddingBottom: 4,
  marginBottom: 10,
},

watchSuggestionsSectionDesktop: {
  paddingTop: 0,
  marginBottom: 0,
},

watchSuggestionsList: {
  gap: 5,
},

watchSuggestionsScroll: {
  paddingRight: 2,
},

watchSuggestionCard: {
  flexDirection: 'row',
  gap: 9,
  borderRadius: 8,
  backgroundColor: 'transparent',
  borderWidth: 0,
  paddingVertical: 4,
  paddingHorizontal: 4,
},

watchSuggestionCardDesktop: {
  gap: 10,
  paddingVertical: 4,
},

watchSuggestionThumb: {
  width: 132,
  aspectRatio: 16 / 9,
  borderRadius: 7,
  backgroundColor: '#000',
},

watchSuggestionThumbDesktop: {
  width: 168,
  borderRadius: 7,
},

watchSuggestionBody: {
  flex: 1,
  minWidth: 0,
  justifyContent: 'center',
},

watchSuggestionTitle: {
  color: '#F4F1EA',
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  fontSize: 13,
  lineHeight: 17,
},

watchSuggestionCreator: {
  marginTop: 4,
  color: 'rgba(237,235,230,0.55)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 11.5,
  lineHeight: 14,
},

watchSuggestionMeta: {
  marginTop: 2,
  color: 'rgba(237,235,230,0.45)',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 10.5,
  lineHeight: 13,
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
  borderRadius: Platform.OS === 'web' ? 14 : 14,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.06)',
  overflow: 'hidden',
  shadowColor: '#000',
  shadowOpacity: 0.30,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 10 },
  elevation: 14,
},

  commentsEmbeddedCard: {
  maxWidth: '100%',
  shadowOpacity: 0,
  shadowRadius: 0,
  shadowOffset: { width: 0, height: 0 },
  elevation: 0,
},

  commentsHeader: {
  paddingHorizontal: 12,
  paddingTop: 11,
  paddingBottom: 9,
  borderBottomWidth: 1,
  borderBottomColor: 'rgba(255,255,255,0.05)',
  flexDirection: 'row',
  alignItems: 'center',
},

  commentsTitle: {
    color: '#fff',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 13,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  commentsSubtitle: {
    marginTop: 2,
    color: 'rgba(237,235,230,0.52)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
    fontSize: 11,
  },

  commentsCloseBtn: {
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
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
    fontSize: 10,
    letterSpacing: 0.35,
    textTransform: 'uppercase',
  },

  commentsBody: {
  flex: 1,
  minHeight: 140,
},

  commentsListContent: {
  paddingHorizontal: 12,
  paddingTop: 8,
  paddingBottom: 8,
},

  commentsEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 28,
  },

  commentsEmptyTitle: {
    color: '#F4F1EA',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 14,
    marginBottom: 4,
  },

  commentsEmptyText: {
    color: 'rgba(237,235,230,0.58)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 18,
  },

  commentThread: {
    marginBottom: 3,
  },

  commentCard: {
    flexDirection: 'row',
    paddingHorizontal: 0,
    paddingVertical: 6,
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
  },

  commentAvatarTap: {
    width: 30,
    height: 30,
    borderRadius: 15,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#000',
    marginRight: 10,
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
    letterSpacing: 0,
  },

  commentText: {
    marginTop: 3,
    color: 'rgba(237,235,230,0.78)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
    fontSize: 12.5,
    lineHeight: 17,
  },

  commentActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 5,
  },

  replyBtn: {
    minHeight: 20,
    paddingHorizontal: 4,
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },

  replyBtnText: {
    color: 'rgba(237,235,230,0.52)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 10.5,
    letterSpacing: 0.15,
    textTransform: 'uppercase',
  },

  repliesWrap: {
    marginTop: 0,
    marginLeft: 40,
  },

  replyCard: {
    flexDirection: 'row',
    paddingVertical: 5,
    paddingHorizontal: 0,
    borderRadius: 0,
    backgroundColor: 'transparent',
    borderWidth: 0,
    marginBottom: 2,
  },

  replyAvatarTap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#000',
    marginRight: 8,
  },

  replyAvatar: {
    width: '100%',
    height: '100%',
  },

  replyName: {
    color: '#F4F1EA',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    fontSize: 10.5,
  },

  replyText: {
    marginTop: 2,
    color: 'rgba(237,235,230,0.72)',
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
    fontSize: 11.5,
    lineHeight: 16,
  },

  commentComposerWrap: {
  borderTopWidth: 1,
  borderTopColor: 'rgba(255,255,255,0.05)',
  backgroundColor: '#090909',
  paddingHorizontal: 8,
  paddingTop: 7,
  paddingBottom: 7,
},

  replyingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 7,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: 'rgba(198,166,100,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.18)',
  },

  replyingBannerText: {
    flex: 1,
    color: '#F1EBDD',
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
    fontSize: 11,
    marginRight: 10,
  },

  replyingBannerCancel: {
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  commentComposer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
  },

  commentInput: {
  flex: 1,
  minHeight: 36,
  maxHeight: 78,
  borderRadius: 10,
  backgroundColor: '#0B0B0B',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.07)',
  paddingHorizontal: 11,
  paddingVertical: 8,
  color: '#EDEBE6',
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  fontSize: 12,
},

  commentSendBtn: {
  height: 36,
  paddingHorizontal: 12,
  borderRadius: 10,
  backgroundColor: '#131313',
  borderWidth: 1,
  borderColor: 'rgba(198,166,100,0.32)',
  alignItems: 'center',
  justifyContent: 'center',
  marginLeft: 7,
},

  commentSendText: {
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 10.5,
    letterSpacing: 0.45,
    textTransform: 'uppercase',
  },
});

export default FeaturedScreen;
