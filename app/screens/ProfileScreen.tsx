// TODO: Apply full LinkedIn-style connections transformation
// UPDATED PROFILESCREEN WITH LINKEDIN-STYLE CONNECTIONS (placeholder)
// app/screens/ProfileScreen.tsx — Noir portfolio refit + Showreels manager

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ImageBackground,
  Animated,
  Easing,
  RefreshControl,
  InteractionManager,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { openChat } from '../navigation/navigationRef';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio, Video, ResizeMode, VideoFullscreenUpdate, AVPlaybackStatus } from 'expo-av';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useHeaderHeight } from '@react-navigation/elements';
import { supabase } from '../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import AvatarCropper from '../../components/AvatarCropper';
import ConnectionsModal from '../../components/ConnectionsModal';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthProvider';
import { Upload } from 'tus-js-client';
import { supportUser, unsupportUser } from "../lib/connections";
import * as FileSystem from 'expo-file-system/legacy';
import { Buffer } from "buffer";
import { useMonthlyStreak } from "../lib/useMonthlyStreak";
import YoutubePlayer from "react-native-youtube-iframe";
import * as Clipboard from 'expo-clipboard';
import { useAppRefresh } from '../context/AppRefreshContext';
import { useAppTheme } from '../context/ThemeContext';
import { useAppLanguage } from '../context/LanguageContext';
import { translateTrustedText } from '../i18n/translations';
import { reportContent, ReportReason } from '../utils/reportContent';
import { blockUser } from '../utils/blockUser';
import { validateMultipleSafeTexts, validateSafeText } from '../utils/moderation';
import ReportContentModal from '../../components/ReportContentModal';
import SmoothModal from '../../components/SmoothModal';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useKeyboardLift } from '../utils/useKeyboardLift';
import { isCurrentUserPro } from '../lib/membership';
import { getFlag, parseCityQuery, searchCities } from '../lib/citySearch';

/* ---------- Noir palette ---------- */
const GOLD = '#C6A664';
const COLORS = {
  background: '#050505',
  card: '#111114',
  cardAlt: '#16161A',
  border: 'rgba(255,255,255,0.10)',
  textPrimary: '#F4EFE6',
  textSecondary: '#D8D2C8',
  primary: GOLD,
  danger: '#FF6B6B',
};

/* ---------- Fonts ---------- */
const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});
const FONT_DISPLAY = SYSTEM_SANS;
const FONT_OBLIVION =
  Platform.select({
    ios: 'Avenir Next',
    android: 'sans-serif-light',
    default: 'Avenir Next',
  }) || 'Avenir Next';
const WEB_NO_OUTLINE =
  Platform.OS === 'web'
    ? ({ outlineStyle: 'none', outlineWidth: 0 } as any)
    : null;

function slugifyProfileFilmTitle(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function buildProfileSharedFilmUrl(shareSlug: string) {
  return `https://overlooked.cloud/f/${shareSlug}`;
}

async function ensureProfileSubmissionShareSlug(submission: {
  id: string;
  title?: string | null;
  share_slug?: string | null;
}) {
  if (submission.share_slug) return submission.share_slug;

  const base = slugifyProfileFilmTitle(submission.title || 'film');
  const slug = `${base || 'film'}-${String(submission.id).slice(0, 6)}`;

  const { error } = await supabase
    .from('submissions')
    .update({ share_slug: slug })
    .eq('id', submission.id);

  if (error) throw error;

  return slug;
}

type InlineSelectorOverlayProps = {
  visible: boolean;
  children: React.ReactNode;
  style?: any;
};

function InlineSelectorOverlay({ visible, children, style }: InlineSelectorOverlayProps) {
  const progress = useRef(new Animated.Value(0)).current;
  const lastChildrenRef = useRef<React.ReactNode>(children);
  const [rendered, setRendered] = useState(visible);

  if (visible) {
    lastChildrenRef.current = children;
  }

  useEffect(() => {
    progress.stopAnimation();

    if (visible) {
      setRendered(true);
      progress.setValue(0);
      Animated.timing(progress, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    if (!rendered) return;

    Animated.timing(progress, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setRendered(false);
    });
  }, [progress, rendered, visible]);

  if (!rendered) return null;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.editSelectorOverlay,
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [18, 0],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.985, 1],
              }),
            },
          ],
        },
      ]}
    >
      {visible ? children : lastChildrenRef.current}
    </Animated.View>
  );
}
/* ---------- layout constants ---------- */
const PAGE_MAX = 1160;

// ✅ Slightly roomier on phones + “mobile web” (better breathing room)
const SIDE_PAD_DESKTOP = 20;
const SIDE_PAD_MOBILE = 16;

// ✅ Mobile spacing was feeling tight; 14 reads cleaner while still premium
const GRID_GAP = 14;

// ✅ Cap widths remain the same (but you’ll use responsive maxW later)
const SHOWREEL_MAX_W = 760;
const SHOWREEL_MAX_W_MOBILE = 600;

const SHOWREEL_CATEGORIES = [
  'Acting',
  'Editing',
  'Directing',
  'Sound',
  'Cinematography',
  'All-in-one Filmmaker',
] as const;

type ShowreelCategory = typeof SHOWREEL_CATEGORIES[number];

const SHOWREEL_CATEGORY_META: Record<ShowreelCategory, { icon: string; detail: string }> = {
  Acting: { icon: 'videocam-outline', detail: 'Performance reel' },
  Editing: { icon: 'cut-outline', detail: 'Cuts and pacing' },
  Directing: { icon: 'megaphone-outline', detail: 'Scene command' },
  Sound: { icon: 'mic-outline', detail: 'Audio craft' },
  Cinematography: { icon: 'aperture-outline', detail: 'Camera and light' },
  'All-in-one Filmmaker': { icon: 'sparkles-outline', detail: 'Full authorship' },
};

/* ---------- helpers ---------- */
const sanitizeFileName = (name: string) => name.replace(/[^\w.\-]+/g, '_').slice(-120);
const ts = () => `?t=${Date.now()}`;
const addBuster = (url?: string | null) =>
  url ? `${url}${/\?/.test(url) ? '&' : '?'}t=${Date.now()}` : null;
const stripBuster = (url?: string | null) => (url ? url.replace(/[?&]t=\d+$/, '') : url);

const ONE_GB = 1024 * 1024 * 1024;

async function pickWebShowreelFile(): Promise<File | null> {
  if (Platform.OS !== 'web') return null;

  return new Promise((resolve) => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.mp4,video/mp4';
      input.style.display = 'none';

      input.onchange = () => {
        const file = input.files?.[0] ?? null;

        try {
          document.body.removeChild(input);
        } catch {}

        resolve(file);
      };

      input.oncancel = () => {
        try {
          document.body.removeChild(input);
        } catch {}

        resolve(null);
      };

      document.body.appendChild(input);
      input.click();
    } catch (err) {
      console.warn('pickWebShowreelFile failed:', err);
      resolve(null);
    }
  });
}

async function pickWebImageFile(): Promise<File | null> {
  if (Platform.OS !== 'web') return null;

  return new Promise((resolve) => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.style.display = 'none';

      input.onchange = () => {
        const file = input.files?.[0] ?? null;

        try {
          document.body.removeChild(input);
        } catch {}

        resolve(file);
      };

      input.oncancel = () => {
        try {
          document.body.removeChild(input);
        } catch {}

        resolve(null);
      };

      document.body.appendChild(input);
      input.click();
    } catch (err) {
      console.warn('pickWebImageFile failed:', err);
      resolve(null);
    }
  });
}

const looksLikeVideo = (u: string) => {
  const s = (u || "").toLowerCase();
  return (
    s.endsWith(".mp4") ||
    s.includes(".mp4?") ||
    s.endsWith(".m3u8") ||
    s.includes(".m3u8?") ||
    s.includes("stream.mux.com/")
  );
};

// Keep this ONLY if any part of the file still references it
const looksLikeYouTube = (u: string) => {
  const s = (u || "").toLowerCase().trim();
  return s.includes("youtube.com") || s.includes("youtu.be");
};

const extractYoutubeId = (url: string) => {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.replace("/", "");

    const v = u.searchParams.get("v");
    if (v) return v;

    // handle /embed/<id> or /shorts/<id>
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

const submissionHiddenOnProfile = (submission: Pick<SubmissionRow, 'hidden_on_profile' | 'profile_hidden' | 'is_hidden_from_profile'>) =>
  Boolean(
    submission.hidden_on_profile ??
      submission.profile_hidden ??
      submission.is_hidden_from_profile ??
      false
  );


/* Flag emoji from country code */
const codeToFlag = (cc?: string) => {
  if (!cc) return '';
  const up = cc.trim().toUpperCase();
  if (up.length !== 2) return '';
  const base = 127397;
  return String.fromCodePoint(up.charCodeAt(0) + base, up.charCodeAt(1) + base);
};

/* ---------- resumable upload helpers (use "portfolios" bucket) ---------- */
const SHOWREEL_BUCKET = 'portfolios';
const THUMB_BUCKET = "thumbnails";

async function getResumableEndpoint(bucket = SHOWREEL_BUCKET) {
  const { data } = supabase.storage.from(bucket).getPublicUrl('__probe__');
  const url = new URL(data.publicUrl);
  return `${url.protocol}//${url.host}/storage/v1/upload/resumable`;
}

async function uploadResumableToBucket(opts: {
  userId: string;
  fileBlob?: Blob | File | null;
  localUri?: string | null;
  onProgress?: (pct: number) => void;
  onPhase?: (label: string) => void;
  objectName?: string;
  bucket?: string;
  contentType?: string;
}): Promise<{ path: string; contentType: string }> {
  const {
    userId,
    fileBlob,
    localUri,
    onProgress,
    onPhase,
    objectName = `user_${userId}/${Date.now()}_showreel`,
    bucket = SHOWREEL_BUCKET,
    contentType,
  } = opts;

  onPhase?.('Preparing file…');

  let file: Blob;
  let type = contentType || 'video/mp4';
  let uploadSize: number | undefined;

  if (fileBlob) {
    file = fileBlob as Blob;
    // @ts-ignore
    if ((fileBlob as any)?.type) type = (fileBlob as any).type as string;
    if (typeof (fileBlob as any)?.size === 'number') uploadSize = (fileBlob as any).size;
  } else if (localUri) {
    const resp = await fetch(localUri);
    file = await resp.blob();
    // @ts-ignore
    if ((file as any)?.type) type = (file as any).type as string;
    if (typeof (file as any)?.size === 'number') uploadSize = (file as any).size;
  } else {
    throw new Error('No file to upload');
  }

  const ext = '.mp4';
  type = 'video/mp4';

  const finalObjectName = `${objectName}${ext}`;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in');

  const endpoint = await getResumableEndpoint(bucket);

  return new Promise<{ path: string; contentType: string }>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint,
      retryDelays: [0, 2000, 5000, 10000, 20000],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${session.access_token}`,
        'x-upsert': 'true',
      },
      metadata: {
        bucketName: bucket,
        objectName: finalObjectName,
        contentType: type,
        cacheControl: '3600',
      },
      uploadSize,
      onProgress: (sent, total) => {
        if (!total) return;
        const pct = Math.max(0, Math.min(100, Math.round((sent / total) * 100)));
        onProgress?.(pct);
      },
      onError: (err: any) => {
        try {
          const res = err?.originalResponse;
          const status =
            res?.getStatus?.() ??
            res?.getStatusCode?.() ??
            res?.status ??
            err?.originalResponse?.status;
          const body =
            res?.getBody?.() ??
            res?.responseText ??
            err?.originalResponse?.responseText ??
            '';
          const detail = String(body || '').slice(0, 350);
          reject(new Error(`Upload failed (${status || 'unknown'}): ${detail || err?.message || 'Unknown error'}`));
        } catch {
          reject(err);
        }
      },
      onSuccess: () => resolve({ path: finalObjectName, contentType: type }),
    });

    onPhase?.('Uploading file…');
    upload.findPreviousUploads().then((prev) => {
      if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    });
  });
}

/* ---------- showreel inline player helpers (mirroring Featured) ---------- */

/* Film grain */
const GRAIN_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIElEQVQYV2P8//8/AzGAiYGB4T8mGJgYhBmMCEwMDAwA1wQq1i3gN8QAAAAASUVORK5CYII=';

const Grain = ({ opacity = 0.06 }: { opacity?: number }) => {
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFillObject, { opacity }]}
    >
      {Platform.OS === 'web' ? (
        <View
          // @ts-ignore web-only CSS
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

/* Web: hide native controls (align with FeaturedScreen) */
let PROFILE_VIDEO_CSS_INJECTED = false;
function injectWebVideoCSS() {
  if (Platform.OS !== 'web' || typeof document === 'undefined' || PROFILE_VIDEO_CSS_INJECTED) return;
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
  PROFILE_VIDEO_CSS_INJECTED = true;
}
injectWebVideoCSS();


/* Signed URL cache just for showreels */
const showreelSignedUrlCache = new Map<string, { url: string; exp: number }>();
const showreelInflight = new Map<string, Promise<string>>();

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

/** Sign a storage path from portfolios, or pass through if it's already a URL */
async function signShowreelPath(pathOrUrl: string, expiresInSec = 3600): Promise<string> {
  if (!pathOrUrl) throw new Error("Missing showreel path");

  const now = Date.now();
  const cached = showreelSignedUrlCache.get(pathOrUrl);
  if (cached && now < cached.exp - 30_000) return cached.url;
  if (showreelInflight.has(pathOrUrl)) return showreelInflight.get(pathOrUrl)!;

  const p = (async () => {
    // Case 1: already a playable URL. Keep it direct so playback can start immediately after a tap.
    if (/^https?:\/\//i.test(pathOrUrl)) {
      showreelSignedUrlCache.set(pathOrUrl, {
        url: pathOrUrl,
        exp: now + expiresInSec * 1000,
      });
      showreelInflight.delete(pathOrUrl);
      return pathOrUrl;
    }

    // Case 2: raw storage path -> sign from portfolios bucket
    const { data, error } = await supabase.storage
      .from(SHOWREEL_BUCKET)
      .createSignedUrl(pathOrUrl, expiresInSec);

    if (error || !data?.signedUrl) {
      showreelInflight.delete(pathOrUrl);
      throw error ?? new Error("Failed to sign showreel path");
    }

    showreelSignedUrlCache.set(pathOrUrl, {
      url: data.signedUrl,
      exp: now + expiresInSec * 1000,
    });
    showreelInflight.delete(pathOrUrl);
    return data.signedUrl;
  })();

  showreelInflight.set(pathOrUrl, p);
  return p;
}

function normalizeStorageObjectPath(pathOrUrl: string, bucket: string) {
  const raw = String(pathOrUrl || '').trim();
  if (!raw) return raw;

  if (/^https?:\/\//i.test(raw)) {
    const match = raw.match(new RegExp(`/storage/v1/object/(?:public|sign)/${bucket}/([^?]+)`, 'i'));
    if (!match?.[1]) return raw;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  return raw
    .split('?')[0]
    .replace(/^\/+/, '')
    .replace(new RegExp(`^${bucket}/`, 'i'), '');
}

function resolveShowreelPosterUri(uri?: string | null) {
  const raw = String(uri || '').trim();
  if (!raw) return null;
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;

  const path = normalizeStorageObjectPath(raw, THUMB_BUCKET);
  return supabase.storage.from(THUMB_BUCKET).getPublicUrl(path).data.publicUrl || raw;
}

/* Player registry (unify behavior with Featured) */
type PlayerHandle = { id: string; pause: () => Promise<void> | void };
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

const WebVideo: any = 'video';

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

type VideoSourceOption = {
  label: string;
  uri: string;
};

function getMuxPlaybackOptionsFromUrl(url?: string | null): VideoSourceOption[] {
  if (!url) return [];
  if (Platform.OS !== 'web') return [{ label: 'Auto', uri: url }];

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

/* ---------- Inline showreel video (Featured-style) ---------- */

function ShowreelVideoInline({
  playerId,
  filePathOrUrl,
  width,
  autoPlay,
  posterUri,
  maxWidth = SHOWREEL_MAX_W,
  maxHeight,
  alignSelf = 'center',
  squareCorners = false,
  loop = true,
  onPlaybackEnd,
}: {
  playerId: string;
  filePathOrUrl: string;
  width: number;
  autoPlay: boolean;
  posterUri?: string | null;
  maxWidth?: number;
  maxHeight?: number;
  alignSelf?: 'center' | 'flex-start';
  squareCorners?: boolean;
  loop?: boolean;
  onPlaybackEnd?: () => void;
}) {
  const expoRef = useRef<Video>(null);
  const htmlRef = useRef<any>(null);
  const playerRootRef = useRef<any>(null);

  const [sourceOptions, setSourceOptions] = useState<VideoSourceOption[]>(() =>
    /^https?:\/\//i.test(filePathOrUrl) ? getMuxPlaybackOptionsFromUrl(filePathOrUrl) : []
  );
  const sourceKeyRef = useRef(sourceOptions.map((option) => option.uri).join('|'));
  const [sourceIndex, setSourceIndex] = useState(0);
  const [hasLoadedFrame, setHasLoadedFrame] = useState(false);
  const [sourcesResolved, setSourcesResolved] = useState(() => /^https?:\/\//i.test(filePathOrUrl));
  const [isMediaLoading, setIsMediaLoading] = useState(autoPlay);
  const [mediaUnavailable, setMediaUnavailable] = useState(false);
  const [resolvedPosterUri, setResolvedPosterUri] = useState<string | null>(() =>
    resolveShowreelPosterUri(posterUri)
  );
  const [aspect, setAspect] = useState(16 / 9);
  const [muted, setMuted] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerChromeVisible, setPlayerChromeVisible] = useState(false);
  const [qualityMenuOpen, setQualityMenuOpen] = useState(false);
  const playerChromeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const [progressRailWidth, setProgressRailWidth] = useState(1);
  const opacity = useRef(new Animated.Value(0)).current;
  const controlsOpacity = useRef(new Animated.Value(0)).current;
  const cueOpacity = useRef(new Animated.Value(0)).current;
  const cueScale = useRef(new Animated.Value(0.92)).current;
  const cueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wantsPlayRef = useRef(autoPlay);
  const finishedRef = useRef(false);
  const [playbackCue, setPlaybackCue] = useState<'play' | 'pause'>('play');
  const [playbackCueActive, setPlaybackCueActive] = useState(false);
  const [seeking, setSeeking] = useState(false);

  const progressRef = useRef<View>(null);
  const src = sourceOptions[sourceIndex]?.uri ?? null;
  const selectedQualityLabel = sourceOptions[sourceIndex]?.label ?? 'Auto';
  const posterSourceUri = resolvedPosterUri;

  useEffect(() => {
    finishedRef.current = false;
    setDuration(0);
    setProgress(0);
    setIsPlaying(false);
    setMediaUnavailable(false);
    setIsMediaLoading(src ? autoPlay || wantsPlayRef.current : false);
  }, [src]);

  // ✅ Still keep this for your fullscreen logic + audio behavior
  const [isFullscreen, setIsFullscreen] = useState(false);

  const clampedW = Math.min(width, maxWidth);
  const rawHeightFromAspect = clampedW / aspect;
  const shouldClampHeight = !!maxHeight && rawHeightFromAspect > maxHeight;
  const playerW = shouldClampHeight ? maxHeight! * aspect : clampedW;
  const playerH = shouldClampHeight ? maxHeight! : rawHeightFromAspect;
  const playerRadius = squareCorners ? 0 : 12;
  const progressPct = Math.max(0, Math.min(100, progress * 100));
  const elapsedLabel = formatPlayerTime(duration * progress);
  const durationLabel = duration > 0 ? formatPlayerTime(duration) : '0:00';
  const compactControls = playerW < 520;
  const hasPlaybackIntent = autoPlay || wantsPlayRef.current;
  const showUnavailableOverlay = hasPlaybackIntent && (mediaUnavailable || (!src && sourcesResolved));
  const showLoadingOverlay =
    hasPlaybackIntent &&
    !showUnavailableOverlay &&
    (isMediaLoading || (!hasLoadedFrame && !sourcesResolved));

  // register in player registry
  useEffect(() => {
    const handle: PlayerHandle = {
      id: playerId,
      pause: async () => {
        wantsPlayRef.current = false;
        try {
          if (Platform.OS === 'web') {
            htmlRef.current?.pause();
          } else {
            await expoRef.current?.pauseAsync();
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

  // resolve signed URL / direct URL
  useEffect(() => {
    let alive = true;
    setSourcesResolved(false);
    setMediaUnavailable(false);
    setIsMediaLoading(autoPlay || wantsPlayRef.current);
    (async () => {
      try {
        const url = await signShowreelPath(filePathOrUrl);
        if (alive) {
          const nextOptions = getMuxPlaybackOptionsFromUrl(url);
          const nextKey = nextOptions.map((option) => option.uri).join('|');

          if (sourceKeyRef.current !== nextKey) {
            sourceKeyRef.current = nextKey;
            setSourceOptions(nextOptions);
            setSourceIndex(0);
            setQualityMenuOpen(false);
            setHasLoadedFrame(false);
            setMediaUnavailable(false);
            opacity.setValue(0);
          }
          setSourcesResolved(true);
          if (!autoPlay && !wantsPlayRef.current) {
            setIsMediaLoading(false);
          }
        }
      } catch (e) {
        console.warn('[ShowreelVideoInline] sign failed', e);
        if (alive) {
          setSourcesResolved(true);
          setMediaUnavailable(true);
          setIsMediaLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [filePathOrUrl]);

  useEffect(() => {
    setResolvedPosterUri(resolveShowreelPosterUri(posterUri));
    setHasLoadedFrame(false);
    opacity.setValue(0);
  }, [posterUri, opacity]);

  const fadeIn = () => {
    setHasLoadedFrame(true);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

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

  const updateAspect = (w?: number, h?: number) => {
    if (!w || !h) return;
    const next = w / h;
    if (Number.isFinite(next) && Math.abs(next - aspect) > 0.004) {
      setAspect(next);
    }
  };

  const syncFromStatus = (status?: AVPlaybackStatus) => {
    if (!status || !('isLoaded' in status) || !status.isLoaded) return;
    const s: any = status;

    const ns = s.naturalSize;
    if (ns?.width && ns?.height) updateAspect(ns.width, ns.height);

    setIsPlaying(!!s.isPlaying);
    if (s.isBuffering && (wantsPlayRef.current || s.isPlaying)) {
      setIsMediaLoading(true);
    } else if (s.isPlaying || hasLoadedFrame) {
      setIsMediaLoading(false);
    }

    const d = s.durationMillis || 0;
    const p = s.positionMillis || 0;
    if (d > 0) {
      setDuration(d / 1000);
      setProgress(Math.max(0, Math.min(1, p / d)));
    }

    if (!loop && s.didJustFinish) {
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
          fadeIn();
        }
        return playing;
      } else {
        if (ensureSound) {
          await expoRef.current?.setIsMutedAsync(false);
          setMuted(false);
        }
        await expoRef.current?.playAsync();
        setIsPlaying(true);
        setIsMediaLoading(false);
        fadeIn();
        return true;
      }
    } catch (e) {
      console.warn('[ShowreelVideoInline] play error', e);
      setIsPlaying(false);
      return false;
    }
  };

  const pause = async () => {
    wantsPlayRef.current = false;
    try {
      if (Platform.OS === 'web') {
        const el = htmlRef.current;
        el?.pause();
      } else {
        await expoRef.current?.pauseAsync();
      }
    } catch {}
    setIsPlaying(false);
    setIsMediaLoading(false);
  };

  // initial autoplay / mute behavior once src is ready
  useEffect(() => {
    const playTimers: ReturnType<typeof setTimeout>[] = [];

    (async () => {
      if (!src) return;
      if (autoPlay || wantsPlayRef.current) {
        wantsPlayRef.current = true;
        setIsMediaLoading(true);
        const playWithSound = !autoPlay && wantsPlayRef.current;
        if (Platform.OS === 'web') {
          if (htmlRef.current) {
            htmlRef.current.muted = !playWithSound;
            htmlRef.current.controls = false;
          }
        } else {
          try {
            await expoRef.current?.setIsMutedAsync(!playWithSound);
          } catch {}
        }
        setMuted(!playWithSound);
        const requestPlay = () => {
          if (!wantsPlayRef.current) return;
          void play(playWithSound);
        };
        const retryDelays = Platform.OS === 'web' ? [0, 80, 220, 520, 1100] : [0, 180, 500];
        retryDelays.forEach((delay) => {
          playTimers.push(setTimeout(requestPlay, delay));
        });
      } else {
        await pause();
        setIsMediaLoading(false);
        if (Platform.OS === 'web') {
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
    return () => {
      playTimers.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, autoPlay]);

  // ensure controls hidden (Safari, etc)
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

  const controlsVisible = hasLoadedFrame && (playerChromeVisible || !isPlaying || seeking);
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

  const onSurfacePress = async () => {
    revealPlayerChrome();
    if (isPlaying) {
      await pause();
      flashPlaybackCue('pause');
    } else {
      const didPlay = await play(true);
      flashPlaybackCue(didPlay ? 'play' : 'pause');
    }
  };

  const onExpoStatus = (status: AVPlaybackStatus) => {
    syncFromStatus(status);
  };

  const onExpoReady = (e: any) => {
    const ns = e?.naturalSize;
    if (ns?.width && ns?.height) updateAspect(ns.width, ns.height);
    setIsMediaLoading(false);
  };

  const onExpoFullscreen = async ({ fullscreenUpdate }: { fullscreenUpdate: number }) => {
    if (Platform.OS === 'web') return;

    if (fullscreenUpdate === VideoFullscreenUpdate.PLAYER_WILL_PRESENT) {
      setIsFullscreen(true);
      try {
        await pauseAllExcept(playerId);
        await expoRef.current?.setIsMutedAsync(false);
        setMuted(false);
        await expoRef.current?.playAsync();
        setIsPlaying(true);
        setIsMediaLoading(false);
      } catch (e) {
        console.warn('Fullscreen error', e);
      }
    }

    if (fullscreenUpdate === VideoFullscreenUpdate.PLAYER_DID_DISMISS) {
      setIsFullscreen(false);
    }
  };

  const onWebLoadedMeta = () => {
    const el = htmlRef.current;
    if (!el) return;
    updateAspect(el.videoWidth, el.videoHeight);
    setDuration(el.duration || 0);
    el.controls = false;
    setIsMediaLoading(false);
    if (wantsPlayRef.current) {
      fadeIn();
      setTimeout(() => {
        void play(true);
      }, 25);
    }
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

  const onVideoError = () => {
    setIsPlaying(false);

    if (sourceIndex < sourceOptions.length - 1) {
      setIsMediaLoading(true);
      setSourceIndex((prev) => Math.min(prev + 1, sourceOptions.length - 1));
      if (!wantsPlayRef.current) {
        setHasLoadedFrame(false);
        opacity.setValue(0);
      }
      return;
    }

    setMediaUnavailable(true);
    setIsMediaLoading(false);
    if (!posterSourceUri || wantsPlayRef.current) {
      fadeIn();
    }
  };

  const selectQuality = (index: number) => {
    if (index === sourceIndex) {
      setQualityMenuOpen(false);
      return;
    }

    let resumeAt = 0;
    const shouldResume = wantsPlayRef.current || isPlaying;
    try {
      if (Platform.OS === 'web') resumeAt = htmlRef.current?.currentTime || 0;
    } catch {}

    setQualityMenuOpen(false);
    setSourceIndex(index);
    wantsPlayRef.current = shouldResume;
    setMediaUnavailable(false);
    setIsMediaLoading(true);
    opacity.setValue(0);

    setTimeout(async () => {
      try {
        if (Platform.OS === 'web' && htmlRef.current && resumeAt > 0) {
          htmlRef.current.currentTime = resumeAt;
        } else if (Platform.OS !== 'web' && expoRef.current && resumeAt > 0) {
          await expoRef.current.setPositionAsync(resumeAt * 1000);
        }
      } catch {}
      if (shouldResume) void play(true);
    }, 80);
  };

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handler = () => {
      const el = htmlRef.current as any;
      const root = playerRootRef.current as any;
      const fs = (document as any).fullscreenElement;

      if (el && (fs === el || fs === root)) {
        setIsFullscreen(true);
        pauseAllExcept(playerId).then(async () => {
          try {
            el.muted = false;
            setMuted(false);
            el.controls = false;
            await el.play();
            setIsPlaying(true);
          } catch {}
        });
      } else {
        setIsFullscreen(false);
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
        if (root?.requestFullscreen) {
          await root.requestFullscreen();
          setIsFullscreen(true);
        } else if (el?.requestFullscreen) {
          await el.requestFullscreen();
          setIsFullscreen(true);
        }
      } else {
        (expoRef.current as any)?.presentFullscreenPlayer?.();
      }
    } catch (e) {
      console.warn('enterFullscreen error', e);
    }
  };

  const toggleMute = async () => {
    try {
      if (Platform.OS === 'web') {
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

  const seekToRatio = (ratio: number) => {
    const next = Math.max(0, Math.min(1, ratio));
    const d = duration || 0;
    setProgress(next);
    if (d <= 0) return;

    if (Platform.OS === 'web' && htmlRef.current) {
      htmlRef.current.currentTime = next * d;
    } else if (expoRef.current) {
      void expoRef.current.setPositionAsync(next * d * 1000);
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
    if (Platform.OS !== 'web' || !seeking) return;
    const onMove = (evt: MouseEvent) => setFromClientX(evt.clientX);
    const onUp = (evt: MouseEvent) => {
      setFromClientX(evt.clientX);
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
  }, [seeking, duration, progressRailWidth]);

  return (
    <View
      ref={playerRootRef}
      {...(playerHoverProps as any)}
      style={{
        width: playerW,
        height: playerH,
        borderRadius: playerRadius,
        overflow: 'hidden',
        backgroundColor: '#000',
        alignSelf,
        position: 'relative',
      }}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, { opacity }]}>
        {Platform.OS === 'web' ? (
          // @ts-ignore
          <WebVideo
            ref={htmlRef}
            src={src || undefined}
            poster={posterSourceUri || undefined}
            className="ovk-video"
            style={{
              width: '100%',
              height: '100%',
              // ✅ ALWAYS FIT (no crop), like Submissions
              objectFit: 'contain',
              objectPosition: 'center center',
              display: 'block',
              background: '#000',
            }}
            loop={loop}
            playsInline
            autoPlay={autoPlay}
            muted={muted}
            preload={autoPlay ? "auto" : "metadata"}
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
              setIsMediaLoading(false);
              if (wantsPlayRef.current) {
                fadeIn();
                void play(true);
              }
            }}
            onLoadedData={() => {
              setIsMediaLoading(false);
              if (wantsPlayRef.current) {
                fadeIn();
                void play(true);
              }
            }}
            onTimeUpdate={onWebTimeUpdate}
            onWaiting={() => {
              if (autoPlay || wantsPlayRef.current) setIsMediaLoading(true);
            }}
            onStalled={() => {
              if (autoPlay || wantsPlayRef.current) setIsMediaLoading(true);
            }}
            onPlay={() => setIsPlaying(true)}
            onPlaying={() => {
              setIsPlaying(true);
              setIsMediaLoading(false);
            }}
            onPause={() => setIsPlaying(false)}
            onEnded={handlePlaybackEnd}
            onError={onVideoError}
          />
        ) : (
          <Video
  ref={expoRef}
  source={src ? { uri: src } : undefined}
  style={StyleSheet.absoluteFillObject}
  resizeMode={ResizeMode.CONTAIN}
  isLooping={loop}
  shouldPlay={false}
  isMuted={muted}
  useNativeControls={false}
  usePoster={!!posterSourceUri && !hasLoadedFrame}
  posterSource={posterSourceUri ? { uri: posterSourceUri } : undefined}
  posterStyle={StyleSheet.absoluteFillObject}
  onReadyForDisplay={(evt: any) => {
    onExpoReady(evt);
    if (wantsPlayRef.current) {
      fadeIn();
      void play(true);
    }
  }}
  onPlaybackStatusUpdate={onExpoStatus}
  onFullscreenUpdate={onExpoFullscreen}
  onError={onVideoError}
  progressUpdateIntervalMillis={150}
/>
        )}
      </Animated.View>

      {showLoadingOverlay || showUnavailableOverlay ? (
        <View pointerEvents="none" style={stylesShowreel.loadingOverlay}>
          <View style={stylesShowreel.loadingBubble}>
            <ActivityIndicator color={COLORS.primary} />
          </View>
          {showUnavailableOverlay ? (
            <Text style={stylesShowreel.loadingText} numberOfLines={1}>
              Video is still processing
            </Text>
          ) : null}
        </View>
      ) : null}

      {posterSourceUri && !hasLoadedFrame ? (
        <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { zIndex: 2 }]}>
          <Image
            source={{ uri: posterSourceUri }}
            style={StyleSheet.absoluteFillObject}
            resizeMode="cover"
          />
        </View>
      ) : null}

      <Grain opacity={0.05} />

      <Pressable style={[StyleSheet.absoluteFillObject, { zIndex: 6 }]} onPress={onSurfacePress} />

      <Animated.View
        pointerEvents="none"
        style={[
          stylesShowreel.centerCue,
          {
            opacity: playbackCueActive ? cueOpacity : 0,
            transform: [{ scale: playbackCueActive ? cueScale : 1 }],
          },
        ]}
      >
        <Ionicons name={playbackCueActive ? playbackCue : 'play'} size={34} color="#fff" />
      </Animated.View>

      <Animated.View
        pointerEvents={controlsVisible ? 'box-none' : 'none'}
        style={[stylesShowreel.playerChromeDock, { opacity: controlsOpacity }]}
      >
          <View
            ref={progressRef}
            style={stylesShowreel.playerTimeline}
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
                  onMouseDown: (evt: any) => {
                    setSeeking(true);
                    setFromClientX(evt.clientX);
                  },
                }
              : {})}
          >
            <View style={stylesShowreel.playerTimelineTrack}>
              <View style={[stylesShowreel.playerTimelineFill, { width: `${progressPct}%` }]} />
              <View style={[stylesShowreel.playerTimelineThumb, { left: `${progressPct}%` }]} />
            </View>
          </View>

          <View style={stylesShowreel.playerControlRow}>
            <View style={stylesShowreel.playerControlLeft}>
              <TouchableOpacity
                onPress={onSurfacePress}
                style={stylesShowreel.playerIconButton}
                activeOpacity={0.82}
              >
                <Ionicons name={isPlaying ? 'pause' : 'play'} size={18} color="#FFF" />
              </TouchableOpacity>

              <TouchableOpacity
                onPress={toggleMute}
                style={stylesShowreel.playerIconButton}
                activeOpacity={0.82}
              >
                <Ionicons
                  name={muted ? 'volume-mute-outline' : 'volume-high-outline'}
                  size={18}
                  color="#FFF"
                />
              </TouchableOpacity>

              <Text style={stylesShowreel.playerTimeText} numberOfLines={1}>
                {elapsedLabel}
                {!compactControls ? ` / ${durationLabel}` : ''}
              </Text>
            </View>

            <TouchableOpacity
              onPress={enterFullscreen}
              style={stylesShowreel.playerIconButton}
              activeOpacity={0.82}
            >
              <Ionicons name="scan-outline" size={18} color="#FFF" />
            </TouchableOpacity>
          </View>
      </Animated.View>
    </View>
  );
}
/* ---------- types ---------- */
interface ProfileData {
  id: string;
  full_name: string;
  avatar_url: string | null;
  portfolio_url?: string | null;
  main_role_id?: number | null;
  side_roles?: string[] | null;
  city_id?: number | null;
  country_code?: string | null;
  bio?: string | null;
  is_premium?: boolean | null;
  premium_canceled_at?: string | null;
  premium_access_expires_at?: string | null;
  stripe_customer_id?: string | null;
  xp?: number | null;
  monthly_xp?: number | null;
  level?: number | null;
  title?: string | null;
  banner_color?: string | null;
  public_slug?: string | null;
is_profile_public?: boolean | null;
  is_banned?: boolean | null;
  banned_reason?: string | null;
}

type PortfolioType = 'image' | 'pdf' | 'audio' | 'video';

interface PortfolioItem {
  id: string;
  user_id: string;
  title?: string | null;
  type: PortfolioType;
  url: string;
  mime_type?: string | null;
  size_bytes?: number | null;
  width?: number | null;
  height?: number | null;
  created_at: string;
}

interface SubmissionRow {
  id: string;
  user_id: string;
  title: string | null;
  word: string | null;
  category?: string | null;
  film_category?: string | null;
  youtube_url: string | null;
  video_url?: string | null;
  video_path?: string | null;
  mime_type?: string | null;
  thumbnail_url?: string | null;   // ✅ ADD THIS
  share_slug?: string | null;
  votes?: number | null;
    mux_upload_id?: string | null;
  mux_asset_id?: string | null;
  mux_playback_id?: string | null;
  mux_status?: string | null;
  hidden_on_profile?: boolean | null;
  profile_hidden?: boolean | null;
  is_hidden_from_profile?: boolean | null;
  collaboration_role?: string | null;
  is_collaboration_credit?: boolean | null;
  collaborator_credits?: any[] | null;
  collaborators?: SubmissionCollaborator[];
  users?: {
    id: string;
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
  submitted_at: string;
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

function profileSubmissionTimeMs(item: { submitted_at?: string | null }) {
  const ms = item.submitted_at ? new Date(item.submitted_at).getTime() : 0;
  return Number.isFinite(ms) ? ms : 0;
}

function stableProfileUpNextNoise(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function getProfileUpNextCreatorId(item?: UpNextQueueItem | null) {
  return item?.user_id || item?.users?.id || null;
}

function getProfileUpNextGenre(item?: UpNextQueueItem | null, fallback?: string | null) {
  return String(item?.film_category || item?.category || item?.word || fallback || '')
    .trim()
    .toLowerCase();
}

function buildProfileUpNextQueue<T extends UpNextQueueItem>(
  current: T | null,
  items: T[],
  options: { recentIds?: string[]; fallbackGenre?: string | null; limit?: number } = {}
) {
  if (!current) return [];

  const limit = options.limit ?? 8;
  const recentIds = options.recentIds ?? [];
  const recentRank = new Map(recentIds.map((id, index) => [id, index]));
  const currentCreatorId = getProfileUpNextCreatorId(current);
  const currentGenre = getProfileUpNextGenre(current, options.fallbackGenre);
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
    const sameCreator = !!currentCreatorId && getProfileUpNextCreatorId(item) === currentCreatorId;
    const sameGenre = !!currentGenre && getProfileUpNextGenre(item) === currentGenre;
    const time = profileSubmissionTimeMs(item);
    const ageDays = time ? Math.max(0, (Date.now() - time) / 86_400_000) : 365;
    const freshness = Math.max(0, 16 - Math.min(16, ageDays / 4));
    const popularity = Math.log10(Math.max(0, item.votes ?? 0) + 1) * 7;
    const watchedRank = recentRank.get(item.id);
    const recentPenalty =
      watchedRank === undefined ? 0 : Math.max(8, 42 - watchedRank * 6);
    const noise = stableProfileUpNextNoise(`${noiseSeed}:${item.id}`) * 4;

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

type SubmissionCollaborator = {
  id: string;
  submission_id: string;
  user_id: string;
  role?: string | null;
  sort_order?: number | null;
  users?: { id: string; full_name?: string | null; avatar_url?: string | null } | null;
};

interface SubmissionCommentRow {
  id: string;
  submission_id: string;
  user_id: string;
  comment?: string | null;
  content?: string | null;
  parent_comment_id?: string | null;
  created_at: string;
  users?: {
    id: string;
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
  user?: {
    id: string;
    full_name?: string | null;
    avatar_url?: string | null;
  } | null;
}

interface ShowreelRow {
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
}

async function attachProfileSubmissionCollaborators<T extends { id: string }>(
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
        const role = String(row?.role || "").trim();

        if (!userId || !role) return null;

        return {
          id: row?.id || `${fallbackSubmissionId}-${userId}-${role}-${index}`,
          submission_id: row?.submission_id || fallbackSubmissionId,
          user_id: userId,
          role,
          sort_order: typeof row?.sort_order === "number" ? row.sort_order : index,
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
      .from("submission_collaborators")
      .select("id, submission_id, user_id, role, sort_order")
      .in("submission_id", ids)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    const userIds = Array.from(
      new Set(((data || []) as any[]).map((row) => row.user_id).filter(Boolean))
    );
    const usersById = new Map<string, { id: string; full_name?: string | null; avatar_url?: string | null }>();

    if (userIds.length > 0) {
      const { data: userRows, error: userError } = await supabase
        .from("users")
        .select("id, full_name, avatar_url")
        .in("id", userIds);

      if (userError) {
        console.log("Profile submission collaborator users unavailable:", userError.message);
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
    console.log("Profile submission collaborators unavailable:", e?.message || e);
  }

  try {
    const { data, error } = await supabase
      .from("submissions")
      .select("id, collaborator_credits")
      .in("id", ids);

    if (error) throw error;

    ((data || []) as any[]).forEach((row) => {
      const credits = normalizeSnapshotCredits(row?.collaborator_credits, row.id);
      if (credits.length > 0) {
        snapshotBySubmission.set(row.id, credits);
      }
    });
  } catch (e: any) {
    console.log("Profile submission collaborator snapshots unavailable:", e?.message || e);
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
      snapshotCredits.map((credit) => [`${credit.user_id}:${credit.role || ""}`, credit])
    );

    const mergedTableCredits = tableCredits.map((credit) => {
      if (credit.users) return credit;
      return {
        ...credit,
        users: snapshotLookup.get(`${credit.user_id}:${credit.role || ""}`)?.users ?? null,
      };
    });

    const tableKeys = new Set(
      tableCredits.map((credit) => `${credit.user_id}:${credit.role || ""}`)
    );
    const snapshotOnly = snapshotCredits.filter(
      (credit) => !tableKeys.has(`${credit.user_id}:${credit.role || ""}`)
    );

    return {
      ...item,
      collaborators: [...mergedTableCredits, ...snapshotOnly],
    };
  });
}

interface ApplicantUser {
  id: string;
  full_name?: string;
  avatar_url?: string | null;
  xp?: number | null;
  level?: number | null;
  title?: string | null;
  banner_color?: string | null;
}

interface JobApplicant {
  id: string; // application id
  applied_at: string;
  user: ApplicantUser | null;
}

interface MyJob {
  id: string;
  description: string | null;
  type: string | null;
  currency: string | null;
  amount: string | number | null;
  rate: string | null;
  time: string | null;
  created_at: string;
  role?: { name?: string };
  city?: { name?: string; country_code?: string };
  applicants: JobApplicant[];
  is_closed?: boolean;
  closed_at?: string | null;
}

const defaultTitle = 'Overlooked';

interface LevelRow {
  level: number;
  name: string;
  banner_color: string;
  min_xp: number;
}

type WorkshopPathKey =
  | 'acting'
  | 'selftape'
  | 'editing'
  | 'cinematography'
  | 'directing'
  | 'sound'
  | 'filmmaker';

type ProfileWorkshopAchievement = {
  pathKey: WorkshopPathKey;
  pathLabel: string;
  chapterIndex: number;
  chapterNumber: number;
  chapterTitle: string;
  badgeTitle: string;
  detail: string;
  color: string;
};

const PROFILE_WORKSHOP_PATH_META: Record<WorkshopPathKey, { label: string; color: string }> = {
  acting: { label: 'Acting', color: '#D7B46A' },
  selftape: { label: 'Self Tape', color: '#CDA7F2' },
  editing: { label: 'Editing', color: '#8EC7FF' },
  cinematography: { label: 'Cinematography', color: '#7FD4B0' },
  directing: { label: 'Directing', color: '#F2A36F' },
  sound: { label: 'Sound', color: '#A8D66D' },
  filmmaker: { label: 'Filmmaker', color: '#E6D28A' },
};

const PROFILE_WORKSHOP_CHAPTERS: Record<WorkshopPathKey, string[]> = {
  acting: ['Foundations', 'Emotional Control', 'Conflict & Presence', 'Performance Mastery'],
  selftape: ['Self Tape Foundations', 'Performance for Self Tape', 'Technical Polish', 'Audition Mastery'],
  editing: ['Foundations', 'Rhythm & Tension', 'Story Through the Cut', 'Editorial Mastery'],
  cinematography: ['Framing & Light', 'Mood & Perspective', 'Visual Tension', 'Cinematic Control'],
  directing: ['Blocking & Intention', 'Performance Direction', 'Power & Scene Design', 'Directorial Mastery'],
  sound: ['Atmosphere & Detail', 'Tension & Space', 'Sonic Storytelling', 'Sound Mastery'],
  filmmaker: ['Core Craft', 'Scene Building', 'Voice & Collaboration', 'Complete Filmmaker'],
};

function toWorkshopPathKey(value: unknown): WorkshopPathKey | null {
  const key = String(value || '').trim().toLowerCase() as WorkshopPathKey;
  return key && PROFILE_WORKSHOP_PATH_META[key] ? key : null;
}

function buildWorkshopAchievement(rows: any[]): ProfileWorkshopAchievement | null {
  const byPath = new Map<WorkshopPathKey, Map<number, number>>();

  rows.forEach((row) => {
    const pathKey = toWorkshopPathKey(row?.path_key);
    const step = Number(row?.step);
    if (!pathKey || !Number.isFinite(step) || step < 1) return;

    const completedAt = row?.created_at ? new Date(row.created_at).getTime() : 0;
    if (!byPath.has(pathKey)) byPath.set(pathKey, new Map());
    byPath.get(pathKey)!.set(step, Number.isFinite(completedAt) ? completedAt : 0);
  });

  const completed: Array<ProfileWorkshopAchievement & { score: number }> = [];

  byPath.forEach((steps, pathKey) => {
    for (let chapterIndex = 0; chapterIndex < 4; chapterIndex += 1) {
      const start = chapterIndex * 10 + 1;
      const requiredSteps = Array.from({ length: 10 }, (_, index) => start + index);
      if (!requiredSteps.every((step) => steps.has(step))) continue;

      const meta = PROFILE_WORKSHOP_PATH_META[pathKey];
      const chapterNumber = chapterIndex + 1;
      const chapterTitle = PROFILE_WORKSHOP_CHAPTERS[pathKey][chapterIndex] || `Chapter ${chapterNumber}`;
      const latestStepTime = Math.max(...requiredSteps.map((step) => steps.get(step) || 0));

      completed.push({
        pathKey,
        pathLabel: meta.label,
        chapterIndex,
        chapterNumber,
        chapterTitle,
        badgeTitle: `${meta.label} Chapter ${chapterNumber} Complete`,
        detail: chapterTitle,
        color: meta.color,
        score: latestStepTime || chapterNumber,
      });
    }
  });

  completed.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.chapterIndex !== a.chapterIndex) return b.chapterIndex - a.chapterIndex;
    return a.pathLabel.localeCompare(b.pathLabel);
  });

  return completed[0] ?? null;
}

/* ---------- level-based ring colors ---------- */
const LEVEL_RING_STEPS = [
  { max: 24, color: '#E0E0EA' },
  { max: 49, color: '#C0C0C8' },
  { max: 9999, color: '#C6A664' },
];

const getRingColorForLevel = (level?: number | null) => {
  const lv = typeof level === 'number' && level > 0 ? level : 1;
  const step = LEVEL_RING_STEPS.find((s) => lv <= s.max);
  return step ? step.color : '#C6A664';
};

/* ---------- component ---------- */
const showNotice = (title: string, message?: string) => {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
};
function withTimeout<T>(promise: Promise<T>, ms = 20000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Upload timed out. Please try again."));
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
    });
  });
}

function clearAuthRoutingFlags() {
  const G = globalThis as any;
  G.__OVERLOOKED_EMAIL_CONFIRM__ = false;
  G.__OVERLOOKED_RECOVERY__ = false;
  G.__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
  G.__OVERLOOKED_PASSWORD_RESET_DONE__ = false;
  G.__OVERLOOKED_MANUAL_SIGN_IN__ = false;
  G.__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;
  G.__OVERLOOKED_PROFILE_JUST_COMPLETED__ = false;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.sessionStorage.removeItem("overlooked.allowCreateProfile");
    window.sessionStorage.removeItem("overlooked.manualSignIn");
    window.sessionStorage.removeItem("overlooked.createProfileAllowed");
  }
}

function setSigningOutFlag(active: boolean) {
  const G = globalThis as any;
  G.__OVERLOOKED_SIGNING_OUT__ = active;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    if (active) {
      window.sessionStorage.setItem("overlooked.signingOut", "true");
    } else {
      window.sessionStorage.removeItem("overlooked.signingOut");
    }
  }
}
export default function ProfileScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { width, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { colors: themeColors, isLight } = useAppTheme();
  const { language } = useAppLanguage();
  const GOLD = themeColors.primary;
  const COLORS = useMemo(
    () => ({
      background: themeColors.background,
      backgroundAlt: themeColors.backgroundAlt,
      card: themeColors.card,
      cardAlt: themeColors.cardAlt,
      border: themeColors.border,
      textPrimary: themeColors.textPrimary,
      textSecondary: themeColors.textSecondary,
      primary: themeColors.primary,
      accent: themeColors.accent,
      danger: themeColors.danger,
      input: themeColors.input,
      borderStrong: themeColors.borderStrong,
      textMuted: themeColors.textMuted,
      textOnPrimary: themeColors.textOnPrimary,
      shadow: themeColors.shadow,
    }),
    [themeColors]
  );
  const editModalBackground = isLight ? COLORS.backgroundAlt : COLORS.cardAlt;
  const editModalCard = isLight ? COLORS.card : COLORS.card;
  const editModalInput = isLight ? COLORS.input : COLORS.input;
  const editModalPill = isLight ? COLORS.card : "#0A0A0A";
  const editModalPillSelected = isLight ? "rgba(198,166,100,0.20)" : "rgba(198,166,100,0.18)";
  const showreelUploadTheme = useMemo(
    () =>
      isLight
        ? {
            overlay: "rgba(20,17,13,0.42)",
            panel: COLORS.card,
            panelBorder: COLORS.borderStrong,
            header: COLORS.card,
            footer: COLORS.card,
            divider: COLORS.border,
            title: COLORS.textPrimary,
            subtitle: COLORS.textSecondary,
            label: COLORS.textPrimary,
            muted: COLORS.textMuted,
            helper: COLORS.textMuted,
            dropzoneBg: "#FBF7F0",
            videoDropzoneBg: "#FFFDF8",
            dropzoneBorder: COLORS.borderStrong,
            dropzoneHoverBg: "#F5EBDC",
            dropzoneHoverBorder: COLORS.primary,
            selectedBorder: COLORS.primary,
            selectedBg: "rgba(201,164,92,0.13)",
            categoryBg: "#FBF7F0",
            categoryHoverBg: "#F5EBDC",
            categoryBorder: COLORS.border,
            categoryHoverBorder: COLORS.borderStrong,
            iconBg: COLORS.card,
            iconBorder: COLORS.border,
            iconColor: COLORS.textMuted,
            ghostBg: COLORS.card,
            ghostBorder: COLORS.borderStrong,
            ghostHoverBg: COLORS.backgroundAlt,
            ghostText: COLORS.textPrimary,
            primaryBg: COLORS.primary,
            primaryHoverBg: "#D5B36F",
            primaryText: COLORS.textOnPrimary,
            error: COLORS.danger,
            ready: COLORS.accent ?? COLORS.primary,
            progressTrack: COLORS.backgroundAlt,
            shadow: COLORS.shadow,
          }
        : {
            overlay: "rgba(0,0,0,0.72)",
            panel: "#090806",
            panelBorder: "rgba(198,166,100,0.22)",
            header: "#0B0907",
            footer: "#0B0907",
            divider: "rgba(198,166,100,0.14)",
            title: "#F7F2E8",
            subtitle: "rgba(247,242,232,0.58)",
            label: "#F7F2E8",
            muted: "rgba(247,242,232,0.44)",
            helper: "rgba(247,242,232,0.46)",
            dropzoneBg: "#11100E",
            videoDropzoneBg: "#020202",
            dropzoneBorder: "rgba(247,242,232,0.12)",
            dropzoneHoverBg: "#15120D",
            dropzoneHoverBorder: "rgba(198,166,100,0.58)",
            selectedBorder: "rgba(198,166,100,0.42)",
            selectedBg: "rgba(198,166,100,0.10)",
            categoryBg: "#11100E",
            categoryHoverBg: "#17140F",
            categoryBorder: "rgba(247,242,232,0.10)",
            categoryHoverBorder: "rgba(247,242,232,0.20)",
            iconBg: "#090806",
            iconBorder: "rgba(247,242,232,0.12)",
            iconColor: "rgba(247,242,232,0.58)",
            ghostBg: "#10100E",
            ghostBorder: "rgba(247,242,232,0.14)",
            ghostHoverBg: "#17140F",
            ghostText: "#F7F2E8",
            primaryBg: "#C6A664",
            primaryHoverBg: "#D3B673",
            primaryText: "#0A0805",
            error: "#FF8A8A",
            ready: "rgba(198,166,100,0.92)",
            progressTrack: "#15130F",
            shadow: "#000",
          },
    [COLORS, isLight]
  );
  const translateRoleLabel = useCallback(
    (value?: string | null) => translateTrustedText(value || '', language),
    [language]
  );
  const editModalDangerBg = isLight ? "rgba(255,107,107,0.10)" : "rgba(255,107,107,0.12)";
  const { triggerAppRefresh } = useAppRefresh();
  const [refreshing, setRefreshing] = useState(false);

  // Responsive flags
const isMobile = width < 768;

// Treat native tablets like mobile for THIS screen
const isTabletNative =
  Platform.OS !== "web" && width >= 768 && width <= 1366;

// Treat narrow web viewports like mobile too
const isMobileLike =
  isMobile ||
  isTabletNative ||
  (Platform.OS === "web" && width < 520);

// Extra-compact phones / very narrow web
const isCompact = width < 380;

  // ✅ Horizontal padding tuned for: phone, small phone, and “mobile web”
  const horizontalPad = isMobileLike
    ? (isCompact ? 12 : SIDE_PAD_MOBILE)
    : SIDE_PAD_DESKTOP;

  // ✅ Use a slightly tighter content max on mobile-web so it feels like a true mobile layout
  const pageMaxEffective = isMobileLike ? Math.min(PAGE_MAX, 760) : PAGE_MAX;

  // ✅ A little extra bottom breathing room on mobile (esp. Safari / notches)
  const bottomPad = (isMobileLike ? 52 : 40) + Math.max(insets.bottom, 10);
  const ipadProfileMaxWidth = Math.min(width - horizontalPad * 2, 860);
const mobileProfileMaxWidth = Math.min(width - horizontalPad * 2, 520);

const contentMaxWidth = isTabletNative
  ? ipadProfileMaxWidth
  : isMobileLike
  ? mobileProfileMaxWidth
  : PAGE_MAX;

  const { refreshProfile, userId: authUserId, ready: authReady } = useAuth();
  const savingRef = useRef(false);
  const promptSignIn = useCallback((message: string) => {
    if (Platform.OS === "web") {
      const goToSignIn = window.confirm(
        `${message}\n\nPress OK for Sign In, or Cancel for Create Account.`
      );

      if (goToSignIn) {
        navigation.navigate("Auth", { screen: "SignIn" });
      } else {
        navigation.navigate("Auth", { screen: "SignUp" });
      }
      return;
    }

    Alert.alert(
      "Sign in required",
      message,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Sign In",
          onPress: () => navigation.navigate("Auth", { screen: "SignIn" }),
        },
        {
          text: "Create Account",
          onPress: () => navigation.navigate("Auth", { screen: "SignUp" }),
        },
      ]
    );
  }, [navigation]);
  // ✅ 1) figure out which profile we're viewing FIRST
  const viewedUserFromObj = route.params?.user;
  const viewedUserId: string | undefined =
    route.params?.userId ?? viewedUserFromObj?.id ?? undefined;

  // ✅ 2) pass viewedUserId into the hook (so streak matches the profile)
  const {
    streak,
    loading: streakLoading,
    errorMsg: streakErrorMsg,
    refreshStreak,
  } = useMonthlyStreak(viewedUserId);

  // ✅ 3) refresh when screen focuses (like Challenge)
  useFocusEffect(
    React.useCallback(() => {
      refreshStreak?.();
    }, [refreshStreak])
  );

  // ✅ single source of truth for which profile should load
  const targetIdParam: string | null =
  route.params?.userId ?? route.params?.user?.id ?? null;

const isViewingExternalProfile = !!targetIdParam;

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const publicProfileUrl = profile?.public_slug
  ? `${Platform.OS === "web" ? window.location.origin : "https://overlooked.cloud"}/creative/${profile.public_slug}`
  : null;
  const [mainRoleName, setMainRoleName] = useState('');
  const [cityName, setCityName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isOwnProfile, setIsOwnProfile] = useState(false);

  // Jobs
  const [myJobs, setMyJobs] = useState<MyJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(false);

  const [userJobs, setUserJobs] = useState<MyJob[]>([]);
  const [loadingUserJobs, setLoadingUserJobs] = useState(false);
  const [applyLoadingJobId, setApplyLoadingJobId] = useState<string | null>(null);
  const [alreadyAppliedJobIds, setAlreadyAppliedJobIds] = useState<string[]>([]);

  // Edit/profile
  const [showEditModal, setShowEditModal] = useState(false);
  const [fullName, setFullName] = useState('');
  const [mainRole, setMainRole] = useState<number | null>(null);
  const [sideRoles, setSideRoles] = useState<string[]>([]);
  const [cityId, setCityId] = useState<number | null>(null);

  // Portfolio & avatar
  const [mp4MainUrl, setMp4MainUrl] = useState('');
  const [mp4MainUploading, setMp4MainUploading] = useState(false);
  const [mp4MainName, setMp4MainName] = useState('');
  const [mp4Progress, setMp4Progress] = useState(0);
  const [mp4Status, setMp4Status] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bio, setBio] = useState('');

  // City/role modals
const [cityOpen, setCityOpen] = useState(false);
const [cityItems, setCityItems] = useState<
  Array<{ label: string; value: number; country_code: string; name: string }>
>([]);
const [citySearch, setCitySearch] = useState('');
const [citySearchFocused, setCitySearchFocused] = useState(false);
const [searchingCities, setSearchingCities] = useState(false);

const cityReqIdRef = useRef<number>(0);
const latestCityTermRef = useRef<string>('');
const citySearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
const [roleSearchFocused, setRoleSearchFocused] = useState(false);
const [sideRoleSearchFocused, setSideRoleSearchFocused] = useState(false);
  const [roleSearchModalVisible, setRoleSearchModalVisible] = useState(false);
  const [sideRoleModalVisible, setSideRoleModalVisible] = useState(false);
  const [roleSearchTerm, setRoleSearchTerm] = useState('');
  const [roleSearchItems, setRoleSearchItems] = useState<Array<{ label: string; value: number }>>(
    []
  );
  const [searchingRoles, setSearchingRoles] = useState(false);

  const [startingChat, setStartingChat] = useState(false);
  const [closingJobId, setClosingJobId] = useState<string | null>(null);

  // Portfolio (extra)
  const [portfolioItems, setPortfolioItems] = useState<PortfolioItem[]>([]);
  const [loadingPortfolio, setLoadingPortfolio] = useState(false);

  // Submissions (monthly films)
  const [submissions, setSubmissions] = useState<SubmissionRow[]>([]);
  const [loadingSubmissions, setLoadingSubmissions] = useState(false);
  const [submissionModalOpen, setSubmissionModalOpen] = useState(false);
  const [thumbUploading, setThumbUploading] = useState(false);
  const [thumbError, setThumbError] = useState<string | null>(null);
  const [activeSubmission, setActiveSubmission] = useState<SubmissionRow | null>(null);
  const [recentSubmissionWatchIds, setRecentSubmissionWatchIds] = useState<string[]>([]);
  const submissionModalCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [comments, setComments] = useState<SubmissionCommentRow[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [submissionCommentsExpanded, setSubmissionCommentsExpanded] = useState(false);
  const [submissionActionsMenuOpen, setSubmissionActionsMenuOpen] = useState(false);
  const submissionWatchScrollRef = useRef<ScrollView | null>(null);
  const submissionCommentInputRef = useRef<TextInput | null>(null);
  const {
    keyboardVisible: submissionKeyboardVisible,
    keyboardLift: submissionKeyboardLift,
    keyboardLiftStyle: submissionKeyboardLiftStyle,
  } = useKeyboardLift({
    enabled: Platform.OS === 'android' && submissionModalOpen && submissionCommentsExpanded,
    extraSpacing: 8,
  });
  const [thumbUploadingId, setThumbUploadingId] = useState<string | null>(null);
  const [showreelThumbUploadingId, setShowreelThumbUploadingId] = useState<string | null>(null);
  const [localHiddenSubmissionIds, setLocalHiddenSubmissionIds] = useState<Set<string>>(new Set());

  const hiddenSubmissionStorageKey = useMemo(
    () => (authUserId ? `overlooked:hidden-profile-submissions:${authUserId}` : null),
    [authUserId]
  );

  useEffect(() => {
    let cancelled = false;

    if (!hiddenSubmissionStorageKey) {
      setLocalHiddenSubmissionIds(new Set());
      return () => {
        cancelled = true;
      };
    }

    AsyncStorage.getItem(hiddenSubmissionStorageKey)
      .then((raw) => {
        if (cancelled) return;

        if (!raw) {
          setLocalHiddenSubmissionIds(new Set());
          return;
        }

        const parsed = JSON.parse(raw);
        setLocalHiddenSubmissionIds(new Set(Array.isArray(parsed) ? parsed.filter(Boolean) : []));
      })
      .catch((e) => {
        console.log('Hidden submissions storage unavailable:', (e as any)?.message ?? e);
        if (!cancelled) setLocalHiddenSubmissionIds(new Set());
      });

    return () => {
      cancelled = true;
    };
  }, [hiddenSubmissionStorageKey]);

  const persistLocalHiddenSubmissionIds = useCallback(
    async (ids: Set<string>) => {
      if (!hiddenSubmissionStorageKey) return;

      try {
        const values = Array.from(ids);
        if (values.length === 0) {
          await AsyncStorage.removeItem(hiddenSubmissionStorageKey);
        } else {
          await AsyncStorage.setItem(hiddenSubmissionStorageKey, JSON.stringify(values));
        }
      } catch (e) {
        console.log('Hidden submissions storage update unavailable:', (e as any)?.message ?? e);
      }
    },
    [hiddenSubmissionStorageKey]
  );

  const isSubmissionHidden = useCallback(
    (submission: SubmissionRow) =>
      submissionHiddenOnProfile(submission) || localHiddenSubmissionIds.has(submission.id),
    [localHiddenSubmissionIds]
  );

  const visibleSubmissions = useMemo(
    () => submissions.filter((submission) => !isSubmissionHidden(submission)),
    [isSubmissionHidden, submissions]
  );

  const visibleOwnedSubmissions = useMemo(
    () => visibleSubmissions.filter((submission) => !submission.is_collaboration_credit),
    [visibleSubmissions]
  );

  const visibleWorkedOnSubmissions = useMemo(
    () => visibleSubmissions.filter((submission) => !!submission.is_collaboration_credit),
    [visibleSubmissions]
  );

  const hiddenProfileSubmissions = useMemo(
    () => submissions.filter((submission) => isSubmissionHidden(submission)),
    [isSubmissionHidden, submissions]
  );

  // audio
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  // image viewer
  const [imageViewerUrls, setImageViewerUrls] = useState<string[]>([]);

  // Connections (followers / following)
  const [supportersCount, setSupportersCount] = useState(0); // people supporting YOU
  const [supportingCount, setSupportingCount] = useState(0); // people YOU support
  const [isSupporting, setIsSupporting] = useState(false);   // whether YOU support THIS profile
  const [connectionsModalVisible, setConnectionsModalVisible] = useState(false);
  const [connectionsTab, setConnectionsTab] = useState<"supporters" | "supporting">("supporters");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [hasBlockedProfile, setHasBlockedProfile] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason>('Harassment or bullying');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportTarget, setReportTarget] = useState<{
    type: 'profile' | 'comment' | 'submission';
    reportedUserId?: string | null;
    contentId?: string | null;
    title?: string | null;
  } | null>(null);
  const [submissionVotedIds, setSubmissionVotedIds] = useState<Set<string>>(new Set());
  const [submissionVoteBusy, setSubmissionVoteBusy] = useState<Record<string, boolean>>({});
  const [watchCreatorSupportUserId, setWatchCreatorSupportUserId] = useState<string | null>(null);
  const [watchCreatorIsSupporting, setWatchCreatorIsSupporting] = useState(false);
  const [watchCreatorSupportBusy, setWatchCreatorSupportBusy] = useState(false);

  const [imageViewerIndex, setImageViewerIndex] = useState<number | null>(null);
  const [imageViewerAspect, setImageViewerAspect] = useState<number | null>(null);
  const activeImageViewerUrl =
    imageViewerIndex !== null ? imageViewerUrls[imageViewerIndex] ?? null : null;

  const closeImageViewer = useCallback(() => {
    setImageViewerIndex(null);
    setImageViewerAspect(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!activeImageViewerUrl) {
      setImageViewerAspect(null);
      return () => {
        cancelled = true;
      };
    }

    setImageViewerAspect(null);

    Image.getSize(
      activeImageViewerUrl,
      (naturalWidth, naturalHeight) => {
        if (cancelled || naturalWidth <= 0 || naturalHeight <= 0) return;
        setImageViewerAspect(naturalWidth / naturalHeight);
      },
      () => {
        if (!cancelled) setImageViewerAspect(null);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [activeImageViewerUrl]);

  const imageViewerFrameStyle = useMemo(() => {
    const maxWidth = Math.max(1, width - 24);
    const maxHeight = Math.max(1, windowHeight - insets.top - insets.bottom - 112);
    const aspect =
      imageViewerAspect && Number.isFinite(imageViewerAspect) && imageViewerAspect > 0
        ? imageViewerAspect
        : 1;
    const frameWidth = Math.min(maxWidth, maxHeight * aspect);

    return {
      width: frameWidth,
      height: Math.min(maxHeight, frameWidth / aspect),
    };
  }, [imageViewerAspect, insets.bottom, insets.top, width, windowHeight]);

  // avatar cropper
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);

  // showreels
  const [showreels, setShowreels] = useState<ShowreelRow[]>([]);
  const [currentUserHasProAccess, setCurrentUserHasProAccess] = useState<boolean | null>(null);
  const [srUploading, setSrUploading] = useState(false);
  const [srProgress, setSrProgress] = useState(0);
  const [srStatus, setSrStatus] = useState('');
  const [showreelCategoryModalVisible, setShowreelCategoryModalVisible] = useState(false);
  const [pendingShowreelAsset, setPendingShowreelAsset] = useState<any | null>(null);
  const [pendingShowreelPreviewUri, setPendingShowreelPreviewUri] = useState<string | null>(null);
  const [pendingShowreelThumbAsset, setPendingShowreelThumbAsset] = useState<any | null>(null);
  const [pendingShowreelThumbPreviewUri, setPendingShowreelThumbPreviewUri] = useState<string | null>(null);
  const [pendingShowreelError, setPendingShowreelError] = useState('');
  const [showreelUploadNotice, setShowreelUploadNotice] = useState('');
  const pendingShowreelObjectUrlRef = useRef<string | null>(null);
  const pendingShowreelThumbObjectUrlRef = useRef<string | null>(null);
  const [selectedShowreelCategory, setSelectedShowreelCategory] =
    useState<ShowreelCategory>('Acting');
  const [pendingShowreelThumbs, setPendingShowreelThumbs] = useState<Record<string, any>>({});
  const [activeShowreel, setActiveShowreel] = useState<ShowreelRow | null>(null);
  const [showreelPlaybackKey, setShowreelPlaybackKey] = useState(0);
  const showreelModalCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showreelModalOpen, setShowreelModalOpen] = useState(false);

  useEffect(() => {
    return () => {
      if (submissionModalCleanupRef.current) clearTimeout(submissionModalCleanupRef.current);
      if (showreelModalCleanupRef.current) clearTimeout(showreelModalCleanupRef.current);
      if (pendingShowreelObjectUrlRef.current) {
        try {
          URL.revokeObjectURL(pendingShowreelObjectUrlRef.current);
        } catch {}
      }
      if (pendingShowreelThumbObjectUrlRef.current) {
        try {
          URL.revokeObjectURL(pendingShowreelThumbObjectUrlRef.current);
        } catch {}
      }
    };
  }, []);

  const [isDirty, setIsDirty] = useState(false);

  // Gamification display
  const [displayLevel, setDisplayLevel] = useState<number>(1);
  const [displayTitle, setDisplayTitle] = useState<string>(defaultTitle);
  const [displayBannerColor, setDisplayBannerColor] = useState<string>('#FFEDE4');
  const [displayXp, setDisplayXp] = useState<number>(0);
  const [workshopAchievement, setWorkshopAchievement] = useState<ProfileWorkshopAchievement | null>(null);

  /* ---------- gamification meta ---------- */
  const loadGamificationMeta = useCallback(async (pd: ProfileData) => {
    try {
      const xp = pd.xp ?? 0;
      let row: LevelRow | null = null;

      if (pd.level != null) {
        const { data } = await supabase
  .from('gamification_levels')
  .select('level,name,banner_color,min_xp')
  .eq('level', pd.level)
  .maybeSingle();

if (data) row = data as LevelRow;
      }

      if (!row) {
        const { data } = await supabase
  .from('gamification_levels')
  .select('level,name,banner_color,min_xp')
  .lte('min_xp', xp)
  .order('min_xp', { ascending: false })
  .limit(1)
  .maybeSingle();

if (data) row = data as LevelRow;
      }

      if (!row) {
        row = {
          level: 1,
          name: defaultTitle,
          banner_color: '#FFEDE4',
          min_xp: 0,
        };
      }

      setDisplayXp(xp);
      setDisplayLevel(row.level);
      setDisplayTitle(row.name);
      setDisplayBannerColor(row.banner_color || '#FFEDE4');
    } catch (err: any) {
      console.warn('loadGamificationMeta failed:', err?.message ?? err);
      setDisplayXp(pd.xp ?? 0);
      setDisplayLevel(pd.level || 1);
      setDisplayTitle(pd.title || defaultTitle);
      setDisplayBannerColor(pd.banner_color || '#FFEDE4');
    }
  }, []);

  const loadWorkshopAchievement = useCallback(async (targetUserId?: string | null) => {
    if (!targetUserId) {
      setWorkshopAchievement(null);
      return;
    }

    try {
      let result = await supabase
        .from('workshop_progress')
        .select('path_key, step, created_at')
        .eq('user_id', targetUserId);

      if (result.error && /created_at/i.test(result.error.message || '')) {
        result = await supabase
          .from('workshop_progress')
          .select('path_key, step')
          .eq('user_id', targetUserId);
      }

      if (result.error) throw result.error;

      setWorkshopAchievement(buildWorkshopAchievement((result.data || []) as any[]));
    } catch (e: any) {
      console.log('Profile workshop achievement unavailable:', e?.message || e);
      setWorkshopAchievement(null);
    }
  }, []);

  /* ---------- warmups ---------- */

  const fetchCreativeRoles = async () => {
    await supabase.from('creative_roles').select('id').limit(1);
  };

  useEffect(() => {
    fetchCreativeRoles();
  }, []);

  /* ---------- profile loader with job wiring ---------- */
  const fetchProfile = useCallback(async () => {
    if (savingRef.current) return;

    setIsLoading(true);
try {
  if (!authReady) return;

  const authUserIdLocal = authUserId ?? null;
  setCurrentUserId(authUserIdLocal);

  const targetId = isViewingExternalProfile ? targetIdParam : authUserIdLocal ?? null;

  if (!targetId) {
    setProfile(null);
    setWorkshopAchievement(null);
    setIsOwnProfile(false);
    setCurrentUserHasProAccess(null);
    setMyJobs([]);
    setUserJobs([]);
    setAlreadyAppliedJobIds([]);
    return;
  }

  const own = !!authUserIdLocal && targetId === authUserIdLocal;
  setIsOwnProfile(own);
  if (own) {
    isCurrentUserPro({ force: true })
      .then(setCurrentUserHasProAccess)
      .catch((e) => {
        console.warn('profile pro status unavailable:', e?.message ?? e);
        setCurrentUserHasProAccess(null);
      });
  } else {
    setCurrentUserHasProAccess(null);
  }
  setHasBlockedProfile(false);
  let blockedByMe = false;

  if (!own && authUserIdLocal) {
    const { data: blockRows } = await supabase
      .from('user_blocks')
      .select('blocked_id')
      .eq('blocker_id', authUserIdLocal)
      .eq('blocked_id', targetId)
      .limit(1);

    if ((blockRows || []).length > 0) {
      blockedByMe = true;
      setHasBlockedProfile(true);
    }
  }

      // 2) LOAD PROFILE DATA
      const { data, error: userError } = await supabase
        .from("users")
        .select("*")
        .eq("id", targetId)
        .maybeSingle();

      if (userError || !data) {
        Alert.alert("Error loading profile");
        return;
      }

      const pd = data as ProfileData;
      setProfile(pd);

      if (!own && pd.is_banned) {
        Alert.alert('Profile unavailable', 'This profile is currently unavailable.');
      }

      // 3) SUPPORT SYSTEM (only run when authUser.id EXISTS)
      try {
        const { count: supportersRaw } = await supabase
          .from("user_supports")
          .select("supported_id", { count: "exact", head: true })
          .eq("supported_id", targetId);

        setSupportersCount(supportersRaw ?? 0);

        const { count: supportingRaw } = await supabase
          .from("user_supports")
          .select("supporter_id", { count: "exact", head: true })
          .eq("supporter_id", targetId);

        setSupportingCount(supportingRaw ?? 0);

        if (!own && authUserIdLocal) {
  const { count: supportCheck } = await supabase
    .from("user_supports")
    .select("supported_id", { count: "exact", head: true })
    .eq("supporter_id", authUserIdLocal)
    .eq("supported_id", targetId);

  setIsSupporting((supportCheck ?? 0) > 0);
} else {
  setIsSupporting(false);
}
      } catch (e) {
        console.log("Support load error:", e);
      }

      // 4) REMAINING PROFILE LOGIC (unchanged)
      setFullName(pd.full_name || "");
      setMainRole(
        typeof pd.main_role_id === "number"
          ? pd.main_role_id
          : pd.main_role_id != null
          ? Number(pd.main_role_id) || null
          : null
      );
      setSideRoles(Array.isArray(pd.side_roles) ? (pd.side_roles as string[]).filter(Boolean) : []);
      setCityId(
        typeof pd.city_id === "number"
          ? pd.city_id
          : pd.city_id != null
          ? Number(pd.city_id) || null
          : null
      );
      setImage(pd.avatar_url || null);
      setBio(pd.bio ?? "");

      const existing = (pd.portfolio_url || "").trim();

const looksLikeMuxPlayback = (u: string) => {
  const s = (u || "").toLowerCase();
  return s.includes("stream.mux.com/") || s.endsWith(".m3u8") || s.includes(".m3u8?");
};

if (existing && (looksLikeVideo(existing) || looksLikeMuxPlayback(existing))) {
  setMp4MainUrl(existing);
  setMp4MainName(existing.split("/").pop() || "Showreel");
} else {
  setMp4MainUrl("");
  setMp4MainName("");
}

      if (pd.main_role_id != null) {
        const { data: roleData } = await supabase
  .from("creative_roles")
  .select("name")
  .eq("id", Number(pd.main_role_id))
  .maybeSingle();

setMainRoleName((roleData as { name?: string } | null)?.name ?? "");
      } else {
        setMainRoleName("");
      }

      if (pd.city_id != null) {
        const { data: cityData } = await supabase
  .from("cities")
  .select("name, country_code")
  .eq("id", Number(pd.city_id))
  .maybeSingle();

const city = cityData as { name?: string; country_code?: string } | null;
const label = city?.name ?? "";

setCityName(label ? (city?.country_code ? `${label}, ${city.country_code}` : label) : "");
      } else {
        setCityName("");
      }

      await loadGamificationMeta(pd);
      await loadWorkshopAchievement(targetId);

      if (blockedByMe || (!own && pd.is_banned)) {
        setPortfolioItems([]);
        setShowreels([]);
        setSubmissions([]);
        setMyJobs([]);
        setUserJobs([]);
        setAlreadyAppliedJobIds([]);
        return;
      }

      if (targetId) {
        await Promise.all([
          fetchPortfolioItems(targetId),
          fetchShowreelList(targetId),
          fetchUserSubmissions(targetId),
        ]);
      }

      if (own && authUserIdLocal) {
  await fetchMyJobsWithApplicants(authUserIdLocal);
  setUserJobs([]);
  setLoadingUserJobs(false);
  setAlreadyAppliedJobIds([]);
} else {
  setMyJobs([]);
  await fetchUserJobs(targetId, authUserIdLocal ?? "");
}
    } catch (e) {
      console.log("fetchProfile fatal:", e);
    } finally {
      setIsLoading(false);
    }
 }, [targetIdParam, loadGamificationMeta, loadWorkshopAchievement, authUserId, authReady]);

  useEffect(() => {
  fetchProfile();
}, [fetchProfile]);

  /* ---------- user_showreels CRUD ---------- */

  const fetchShowreelList = async (userId: string) => {
  const { data, error } = await supabase
    .from('user_showreels')
    .select(`
  id,
  user_id,
  file_path,
  title,
  category,
  thumbnail_url,
  is_primary,
  sort_order,
  created_at
`)
    .eq('user_id', userId)
    .order('is_primary', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });

  console.log('[SHOWREEL] fetchShowreelList result:', { data, error });

  if (error) {
    console.warn('fetchShowreelList error:', error.message);
    setShowreels([]);
    return;
  }

  const rows: ShowreelRow[] = (data || []).map((row: any) => {
  const storageUrl =
    row.file_path
      ? supabase.storage.from(SHOWREEL_BUCKET).getPublicUrl(row.file_path).data.publicUrl
      : null;

  return {
    id: row.id,
    user_id: row.user_id,
    file_path: row.file_path ?? '',
    title: row.title ?? null,
    category: row.category ?? null,
    thumbnail_url: row.thumbnail_url ?? null,
    is_primary: row.is_primary ?? false,
    sort_order: row.sort_order ?? 0,
    created_at: row.created_at,
    url: storageUrl || '',
  };
});

  console.log('[SHOWREEL] mapped showreels:', rows);

  setShowreels(rows.slice(0, 3));
};

  const releasePendingShowreelObjectUrls = () => {
    if (pendingShowreelObjectUrlRef.current) {
      try {
        URL.revokeObjectURL(pendingShowreelObjectUrlRef.current);
      } catch {}
      pendingShowreelObjectUrlRef.current = null;
    }

    if (pendingShowreelThumbObjectUrlRef.current) {
      try {
        URL.revokeObjectURL(pendingShowreelThumbObjectUrlRef.current);
      } catch {}
      pendingShowreelThumbObjectUrlRef.current = null;
    }
  };

  const clearPendingShowreelDraft = () => {
    releasePendingShowreelObjectUrls();
    setPendingShowreelAsset(null);
    setPendingShowreelPreviewUri(null);
    setPendingShowreelThumbAsset(null);
    setPendingShowreelThumbPreviewUri(null);
    setPendingShowreelError('');
  };

  const getShowreelPreviewUri = (asset: any) => {
    if (Platform.OS === 'web' && asset?.file) {
      const objUrl = URL.createObjectURL(asset.file as File);
      pendingShowreelObjectUrlRef.current = objUrl;
      return objUrl;
    }

    return asset?.uri || null;
  };

  const getShowreelAssetError = (asset: any) => {
    const name = String(asset?.name || asset?.fileName || '').toLowerCase();
    const mime =
      String(asset?.mime_type || asset?.mimeType || asset?.file?.type || '').toLowerCase() ||
      'video/mp4';
    const rawSize = asset?.size ?? asset?.fileSize ?? asset?.bytes ?? asset?.file?.size ?? null;
    const size = typeof rawSize === 'number' ? rawSize : rawSize ? Number(rawSize) : null;

    if (!name.endsWith('.mp4') && mime !== 'video/mp4') {
      return 'Please select an .mp4 video.';
    }
    if (size && size > ONE_GB) {
      return 'Please select a video that is 1 GB or less.';
    }
    return null;
  };

  const setPendingShowreelVideoAsset = (asset: any) => {
    if (pendingShowreelObjectUrlRef.current) {
      try {
        URL.revokeObjectURL(pendingShowreelObjectUrlRef.current);
      } catch {}
      pendingShowreelObjectUrlRef.current = null;
    }

    setPendingShowreelAsset(asset);
    setPendingShowreelPreviewUri(getShowreelPreviewUri(asset));
  };

  const setPendingShowreelVideoFile = (file: any) => {
    if (!file) return;

    const asset = {
      file,
      name: file.name || `showreel_${Date.now()}.mp4`,
      mimeType: file.type || 'video/mp4',
      size: file.size,
    };
    const assetError = getShowreelAssetError(asset);
    if (assetError) {
      setPendingShowreelError(assetError);
      return;
    }

    setPendingShowreelVideoAsset(asset);
    setPendingShowreelError('');
    setShowreelUploadNotice('');
  };

  const setPendingShowreelThumbnailFile = (file: any) => {
    if (!file) return;

    const mime = String(file.type || '').toLowerCase();
    if (mime && !mime.startsWith('image/')) {
      setPendingShowreelError('Please select an image thumbnail.');
      return;
    }

    const objUrl = URL.createObjectURL(file);
    if (pendingShowreelThumbObjectUrlRef.current) {
      try {
        URL.revokeObjectURL(pendingShowreelThumbObjectUrlRef.current);
      } catch {}
    }

    pendingShowreelThumbObjectUrlRef.current = objUrl;
    setPendingShowreelThumbAsset({
      file,
      name: file.name || `showreel_thumb_${Date.now()}.jpg`,
      mimeType: file.type || 'image/jpeg',
      uri: objUrl,
    });
    setPendingShowreelThumbPreviewUri(objUrl);
    setPendingShowreelError('');
  };

  const handlePendingShowreelVideoDrop = (evt: any) => {
    if (Platform.OS !== 'web') return;
    evt.preventDefault?.();
    evt.stopPropagation?.();
    setPendingShowreelVideoFile(evt.dataTransfer?.files?.[0]);
  };

  const handlePendingShowreelThumbDrop = (evt: any) => {
    if (Platform.OS !== 'web') return;
    evt.preventDefault?.();
    evt.stopPropagation?.();
    setPendingShowreelThumbnailFile(evt.dataTransfer?.files?.[0]);
  };

  const pickShowreelAsset = async () => {
    if (Platform.OS === 'web') {
      const file = await pickWebShowreelFile();
      if (!file) return null;

      return {
        file,
        name: file.name || `showreel_${Date.now()}.mp4`,
        mimeType: file.type || 'video/mp4',
        size: file.size,
      };
    }

    const pick = await DocumentPicker.getDocumentAsync({
      type: ['video/mp4'],
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (pick.canceled || !pick.assets?.length) return null;
    return pick.assets[0];
  };

  const pickPendingShowreelThumbnail = async () => {
    try {
      let asset: any | null = null;

      if (Platform.OS === 'web') {
        const file = await pickWebImageFile();
        if (!file) return;
        const objUrl = URL.createObjectURL(file);

        if (pendingShowreelThumbObjectUrlRef.current) {
          try {
            URL.revokeObjectURL(pendingShowreelThumbObjectUrlRef.current);
          } catch {}
        }

        pendingShowreelThumbObjectUrlRef.current = objUrl;
        asset = {
          file,
          name: file.name || `showreel_thumb_${Date.now()}.jpg`,
          mimeType: file.type || 'image/jpeg',
          uri: objUrl,
        };
        setPendingShowreelThumbPreviewUri(objUrl);
      } else {
        const pick = await DocumentPicker.getDocumentAsync({
          type: ['image/*'] as any,
          multiple: false,
          copyToCacheDirectory: true,
        });

        if (pick.canceled || !pick.assets?.length) return;
        asset = pick.assets[0];
        setPendingShowreelThumbPreviewUri(asset?.uri || null);
      }

      setPendingShowreelThumbAsset(asset);
      setPendingShowreelError('');
    } catch (e: any) {
      console.warn('pickPendingShowreelThumbnail failed:', e?.message ?? e);
      setPendingShowreelError(e?.message ?? 'Could not pick thumbnail.');
    }
  };

  const getCurrentShowreelCountForUser = async (userId: string) => {
    const { count, error } = await supabase
      .from('user_showreels')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId);

    if (error) {
      console.warn('showreel count unavailable:', error.message);
      return showreels.length;
    }

    return count ?? showreels.length;
  };

  const openShowreelUpgradePaywall = () => {
    setShowreelCategoryModalVisible(false);
    setShowEditModal(false);
    setTimeout(() => {
      navigation.navigate('Paywall', { context: 'showreel' });
    }, 0);
  };

  const canStartShowreelUpload = async () => {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error) {
      Alert.alert('Please try again', 'We could not verify your account right now.');
      return false;
    }

    if (!user?.id) {
      Alert.alert('Sign in required', 'Please sign in to upload a showreel.');
      return false;
    }

    const existingShowreelCount = await getCurrentShowreelCountForUser(user.id);

    if (existingShowreelCount >= 3) {
      Alert.alert('Maximum reached', 'Users can only have up to 3 showreels.');
      return false;
    }

    const hasProAccess = await isCurrentUserPro({ force: true });

    if (!hasProAccess && existingShowreelCount >= 1) {
      openShowreelUpgradePaywall();
      return false;
    }

    return true;
  };

  const uploadAnotherShowreel = async () => {
    try {
      if (showreels.length >= 3) {
        Alert.alert('Maximum reached', 'Users can only have up to 3 showreels.');
        return;
      }

      if (currentUserHasProAccess === false && showreels.length >= 1) {
        openShowreelUpgradePaywall();
        return;
      }

      const asset: any = await pickShowreelAsset();
      if (!asset) return;

      const allowed = await canStartShowreelUpload();
      if (!allowed) {
        return;
      }

      const assetError = getShowreelAssetError(asset);
      if (assetError) {
        Alert.alert(assetError.includes('1 GB') ? 'Too large' : 'MP4 only', assetError);
        return;
      }

      clearPendingShowreelDraft();
      setPendingShowreelVideoAsset(asset);
      setSelectedShowreelCategory('Acting');
      setShowreelUploadNotice('');
      setShowEditModal(true);
      setShowreelCategoryModalVisible(true);
    } catch (e: any) {
      console.warn('uploadAnotherShowreel failed:', e?.message ?? e);
      Alert.alert('Upload failed', e?.message ?? 'Could not prepare showreel upload.');
    }
  };

  const choosePendingShowreelVideo = async () => {
    try {
      const asset: any = await pickShowreelAsset();
      if (!asset) return;

      const assetError = getShowreelAssetError(asset);
      if (assetError) {
        setPendingShowreelError(assetError);
        return;
      }

      setPendingShowreelVideoAsset(asset);
      setPendingShowreelError('');
      setShowreelUploadNotice('');
    } catch (e: any) {
      console.warn('choosePendingShowreelVideo failed:', e?.message ?? e);
      setPendingShowreelError(e?.message ?? 'Could not choose video.');
    }
  };

  const confirmUploadShowreel = async () => {
    let createdShowreelId: string | null = null;
    let uploadedVideoPath: string | null = null;
    let uploadedThumbPath: string | null = null;

    try {
      if (!pendingShowreelAsset) return;
      if (!pendingShowreelThumbAsset) {
        setPendingShowreelError('Add a thumbnail before uploading your showreel.');
        return;
      }

      const asset: any = pendingShowreelAsset;
      const originalName = asset.name || asset.fileName || 'Showreel.mp4';
      const contentType = asset.mime_type || asset.mimeType || asset.file?.type || 'video/mp4';
      const cleanBaseName =
        sanitizeFileName(String(originalName).replace(/\.[^.]+$/, '')) || 'showreel';

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError) throw userError;
      if (!user) throw new Error('Not authenticated');

      const existingShowreelCount = await getCurrentShowreelCountForUser(user.id);

      if (existingShowreelCount >= 3) {
        setPendingShowreelError('Users can only have up to 3 showreels.');
        Alert.alert('Maximum reached', 'Users can only have up to 3 showreels.');
        return;
      }

      const hasProAccess = await isCurrentUserPro({ force: true });

      if (!hasProAccess && existingShowreelCount >= 1) {
        openShowreelUpgradePaywall();
        return;
      }

      setShowEditModal(true);
      setShowreelCategoryModalVisible(false);
      setSrUploading(true);
      setSrProgress(0);
      setSrStatus('Preparing upload…');

      setSrStatus(
        Platform.OS === 'web'
          ? 'Uploading to Overlooked… This can take a while for large files.'
          : 'Uploading to Overlooked… Please keep the app open.'
      );

      const { path } = await uploadResumableToBucket({
        userId: user.id,
        fileBlob:
          Platform.OS === 'web' ? ((asset.file as File | Blob | null) ?? undefined) : undefined,
        localUri: Platform.OS !== 'web' ? (asset.uri as string) : undefined,
        onProgress: (pct) => setSrProgress(pct),
        onPhase: (label) => {
          if (label === 'Uploading file…') {
            setSrStatus(
              Platform.OS === 'web'
                ? 'Uploading to Overlooked… This can take a while for large files.'
                : 'Uploading to Overlooked… Please keep the app open.'
            );
          } else {
            setSrStatus(label);
          }
        },
        objectName: `user_${user.id}/${Date.now()}_${cleanBaseName}`,
        bucket: SHOWREEL_BUCKET,
        contentType,
      });

      uploadedVideoPath = path;

      const currentCount = showreels.length;
      const makePrimary = currentCount === 0;

      setSrProgress(100);
      setSrStatus('Saving showreel…');

      const insertPayload = {
        user_id: user.id,
        file_path: path,
        title: originalName || selectedShowreelCategory,
        category: selectedShowreelCategory,
        thumbnail_url: null,
        is_primary: makePrimary,
        sort_order: currentCount,
      };

      console.log('[SHOWREEL] inserting row into user_showreels:', insertPayload);

      const { data: ins, error: insErr } = await supabase
        .from('user_showreels')
        .insert(insertPayload)
        .select('*')
        .single();

      if (insErr) {
        console.error('[SHOWREEL] insert failed:', insErr);
        throw insErr;
      }

      if (!ins?.id) {
        throw new Error('Showreel was uploaded, but no row ID was returned.');
      }

      createdShowreelId = ins.id;

      setSrStatus('Uploading thumbnail…');

      const thumbRes = await uploadShowreelThumbToStorage({
        userId: user.id,
        showreelId: ins.id,
        asset: pendingShowreelThumbAsset,
        bucket: THUMB_BUCKET,
      });

      uploadedThumbPath = thumbRes.path;

      const { error: thumbUpdateError } = await supabase
        .from('user_showreels')
        .update({ thumbnail_url: thumbRes.publicUrl })
        .eq('id', ins.id)
        .eq('user_id', user.id);

      if (thumbUpdateError) throw thumbUpdateError;

      const publicUrl = supabase.storage.from(SHOWREEL_BUCKET).getPublicUrl(path).data.publicUrl;

      if (makePrimary && publicUrl) {
        await supabase.from('users').update({ portfolio_url: publicUrl }).eq('id', user.id);
        setMp4MainUrl(`${publicUrl}${ts()}`);
        setMp4MainName(originalName || selectedShowreelCategory || 'Showreel.mp4');
      }

      setSrStatus('Refreshing profile…');

      await fetchShowreelList(user.id);
      await fetchProfile();
      setShowEditModal(true);
      clearPendingShowreelDraft();
      setShowreelUploadNotice(
        'Upload complete. It may take a little time before the showreel appears on your profile.'
      );
      setSrStatus('Upload complete.');
    } catch (e: any) {
      console.error('[SHOWREEL] confirmUploadShowreel failed:', e);
      const message = e?.message ?? 'Could not upload video.';
      setSrStatus(`Upload failed: ${message}`);

      if (createdShowreelId) {
        try {
          await supabase.from('user_showreels').delete().eq('id', createdShowreelId);
        } catch {}
      }

      if (uploadedVideoPath) {
        try {
          await supabase.storage.from(SHOWREEL_BUCKET).remove([uploadedVideoPath]);
        } catch {}
      }

      if (uploadedThumbPath) {
        try {
          await supabase.storage.from(THUMB_BUCKET).remove([uploadedThumbPath]);
        } catch {}
      }

      if (pendingShowreelAsset) {
        setPendingShowreelError(message);
        setShowEditModal(true);
        setShowreelCategoryModalVisible(true);
      }

      Alert.alert('Upload failed', message);
    } finally {
      setSrUploading(false);
      setTimeout(() => setSrStatus(''), 1200);
    }
  };

  const setPrimaryShowreel = async (row: ShowreelRow) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const publicUrl = row.file_path
        ? supabase.storage.from(SHOWREEL_BUCKET).getPublicUrl(row.file_path).data.publicUrl
        : null;

if (!publicUrl) {
  throw new Error('No playable URL found for this showreel.');
}

      await supabase.from('user_showreels').update({ is_primary: false }).eq('user_id', user.id);
      await supabase
        .from('user_showreels')
        .update({ is_primary: true })
        .eq('id', row.id)
        .eq('user_id', user.id);

      await supabase.from('users').update({ portfolio_url: publicUrl }).eq('id', user.id);

      setMp4MainUrl(`${publicUrl}${ts()}`);
      setMp4MainName(row.title || row.category || 'Showreel.mp4');

      await Promise.all([fetchShowreelList(user.id), fetchProfile()]);
      Alert.alert('Updated', 'Primary showreel set.');
    } catch (e: any) {
      Alert.alert('Failed', e?.message ?? 'Could not set primary showreel.');
    }
  };

  const updateShowreelCategory = async (row: ShowreelRow, category: ShowreelCategory) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('user_showreels')
        .update({ category })
        .eq('id', row.id)
        .eq('user_id', user.id);

      if (error) throw error;

      setShowreels((prev) =>
        prev.map((item) => (item.id === row.id ? { ...item, category } : item))
      );
    } catch (e: any) {
      Alert.alert('Update failed', e?.message ?? 'Could not update category.');
    }
  };

  const deleteShowreel = async (row: ShowreelRow) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const wasPrimary = !!row.is_primary;

      if (wasPrimary) {
        await supabase.from('users').update({ portfolio_url: null }).eq('id', user.id);
      }

      if (row.thumbnail_url) {
        try {
          const thumbUrl = row.thumbnail_url.split('?')[0];
          const match = thumbUrl.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
          if (match?.[1] && match?.[2]) {
            await supabase.storage.from(match[1]).remove([match[2]]);
          }
        } catch {}
      }

      if (row.file_path) {
        await supabase.storage.from(SHOWREEL_BUCKET).remove([row.file_path]);
      }
      await supabase.from('user_showreels').delete().eq('id', row.id).eq('user_id', user.id);

      const remaining = showreels.filter((s) => s.id !== row.id);

      if (wasPrimary && remaining.length > 0) {
        const fallback = remaining[0];

        await supabase.from('user_showreels').update({ is_primary: false }).eq('user_id', user.id);
        await supabase
          .from('user_showreels')
          .update({ is_primary: true })
          .eq('id', fallback.id)
          .eq('user_id', user.id);

        const fallbackUrl = fallback.file_path
          ? supabase.storage.from(SHOWREEL_BUCKET).getPublicUrl(fallback.file_path).data.publicUrl
          : null;

await supabase.from('users').update({ portfolio_url: fallbackUrl }).eq('id', user.id);

setMp4MainUrl(fallbackUrl ? `${fallbackUrl}${ts()}` : '');
        setMp4MainName(fallback.title || fallback.category || 'Showreel.mp4');
      } else if (remaining.length === 0) {
        setMp4MainUrl('');
        setMp4MainName('');
      }

      await Promise.all([fetchShowreelList(user.id), fetchProfile()]);
    } catch (e: any) {
      Alert.alert('Delete failed', e?.message ?? 'Could not delete showreel.');
    }
  };
  /* ---------- portfolio items ---------- */

  const fetchPortfolioItems = async (userId: string) => {
    setLoadingPortfolio(true);
    const { data } = await supabase
      .from('portfolio_items')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (data) setPortfolioItems(data);
    setLoadingPortfolio(false);
  };

  const fetchUserSubmissions = async (userId: string) => {
    try {
      setLoadingSubmissions(true);

      const targetUserId = userId || viewedUserId;
      if (!targetUserId) {
        setSubmissions([]);
        return;
      }

      const { data, error } = await supabase
        .from("submissions")
        .select("*") // <-- STOP GUESSING. PULL EVERYTHING.
        .eq("user_id", targetUserId)
        .order("submitted_at", { ascending: false });

      if (error) {
        console.warn("fetchUserSubmissions error:", error.message);
        setSubmissions([]);
        return;
      }

      let rows = (data || []) as any[];

      try {
        const { data: collaborationRows, error: collaborationError } = await supabase
          .from("submission_collaborators")
          .select("role, submission_id, submissions:submission_id(*)")
          .eq("user_id", targetUserId)
          .order("created_at", { ascending: false });

        if (collaborationError) {
          console.log("Collaborated submissions unavailable:", collaborationError.message);
        } else if (collaborationRows?.length) {
          const seenIds = new Set(rows.map((row) => row.id));
          const creditedRows = (collaborationRows as any[])
            .map((row) => {
              const submission = Array.isArray(row.submissions)
                ? row.submissions[0]
                : row.submissions;
              return submission
                ? {
                    ...submission,
                    collaboration_role: row.role ?? null,
                    is_collaboration_credit: true,
                  }
                : null;
            })
            .filter((row) => row?.id && !seenIds.has(row.id));

          rows = [...rows, ...creditedRows];
        }
      } catch (collabErr: any) {
        console.log("Collaborated submissions fetch unavailable:", collabErr?.message || collabErr);
      }

      try {
        const creatorIds = Array.from(
          new Set(rows.map((row) => row?.user_id).filter(Boolean))
        );

        if (creatorIds.length > 0) {
          const { data: creatorRows, error: creatorError } = await supabase
            .from("users")
            .select("id, full_name, avatar_url")
            .in("id", creatorIds);

          if (creatorError) {
            console.log("Submission creators unavailable:", creatorError.message);
          } else {
            const creatorsById = new Map(
              ((creatorRows || []) as any[]).map((user) => [
                user.id,
                {
                  id: user.id,
                  full_name: user.full_name ?? null,
                  avatar_url: user.avatar_url ?? null,
                },
              ])
            );

            rows = rows.map((row) => ({
              ...row,
              users:
                creatorsById.get(row.user_id) ||
                (row.user_id === profile?.id
                  ? {
                      id: profile.id,
                      full_name: profile.full_name,
                      avatar_url: profile.avatar_url,
                    }
                  : row.users ?? null),
            }));
          }
        }
      } catch (creatorErr: any) {
        console.log("Submission creators fetch unavailable:", creatorErr?.message || creatorErr);
      }

      function isMuxReady(status?: string | null) {
  const s = String(status || '').toLowerCase();
  return s === 'ready' || s === 'asset_ready' || s === 'playable';
}

function getMuxPlaybackUrl(playbackId?: string | null) {
  if (!playbackId) return null;
  return Platform.OS === 'web'
    ? `https://stream.mux.com/${playbackId}/high.mp4`
    : `https://stream.mux.com/${playbackId}.m3u8`;
}

function getMuxThumbnailUrl(playbackId?: string | null) {
  if (!playbackId) return null;
  return `https://image.mux.com/${playbackId}/thumbnail.jpg`;
}

      // 🔥 PROOF LOG: look at ONE mp4 row in the console and you’ll know instantly what column is used.
      if (rows.length) {
        console.log("[SUBMISSIONS raw sample]", rows[0]);
      }

      const stripQuery = (u: string) => (u ? u.split("?")[0] : u);

      const pathFromPublicUrl = (u: string) => {
        const clean = stripQuery(u);
        const m = clean.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
        if (!m) return null;
        return { bucket: m[1], path: m[2] };
      };

      const pickVideoField = (s: any) => {
        // try ALL common names (because your DB may not match what we think)
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
        ).toString().trim();
      };

      const withPlayableUrls: SubmissionRow[] = await Promise.all(
  rows.map(async (s) => {
    const muxReady = isMuxReady(s.mux_status);
    const muxPlaybackId = s.mux_playback_id || null;

    if (muxPlaybackId && muxReady) {
      return {
        ...s,
        video_url: getMuxPlaybackUrl(muxPlaybackId),
        thumbnail_url: s.thumbnail_url || getMuxThumbnailUrl(muxPlaybackId),
      };
    }

    const raw =
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
      "";

    if (!raw) return s as SubmissionRow;

    if (/^https?:\/\//i.test(raw)) {
      return { ...(s as SubmissionRow), video_url: raw.split("?")[0] };
    }

    const cleanPath = raw.split("?")[0];

    const { data: signedFilms } = await supabase.storage
      .from("films")
      .createSignedUrl(cleanPath, 60 * 60);

    if (signedFilms?.signedUrl) {
      return { ...(s as SubmissionRow), video_url: signedFilms.signedUrl };
    }

    const { data: signedPort } = await supabase.storage
      .from("portfolios")
      .createSignedUrl(cleanPath, 60 * 60);

    if (signedPort?.signedUrl) {
      return { ...(s as SubmissionRow), video_url: signedPort.signedUrl };
    }

    return s as SubmissionRow;
  })
);

      const withCollaborators = await attachProfileSubmissionCollaborators(withPlayableUrls);
      setSubmissions(withCollaborators as SubmissionRow[]);
    } finally {
      setLoadingSubmissions(false);
    }
  };

  /* ---------- My Jobs with applicants (own profile) ---------- */
  const fetchMyJobsWithApplicants = async (ownerId: string) => {
    try {
      setLoadingJobs(true);

      const { data: jobsData, error: jobsErr } = await supabase
        .from('jobs')
        .select(
          `
          id,
          description,
          type,
          currency,
          amount,
          rate,
          time,
          created_at,
          is_closed,
          closed_at,
          creative_roles(name),
          cities(name, country_code)
        `
        )
        .eq('user_id', ownerId)
        .eq('is_closed', false)
        .order('created_at', { ascending: false });

      if (jobsErr) {
        console.error('fetchMyJobsWithApplicants jobsErr', jobsErr);
        setMyJobs([]);
        setLoadingJobs(false);
        return;
      }

      const results: MyJob[] = [];

      for (const j of jobsData || []) {
        const { data: apps, error: appsErr } = await supabase
          .from('applications')
          .select(
            `
            id,
            applied_at,
            user:users!applications_applicant_id_fkey (
              id,
              full_name,
              avatar_url,
              xp,
              level,
              title,
              banner_color
            )
          `
          )
          .eq('job_id', (j as any).id)
          .order('applied_at', { ascending: false });

        if (appsErr) {
          console.error('fetchMyJobsWithApplicants applicationsErr', appsErr);
        }

        const applicants: JobApplicant[] =
          (apps || []).map((a: any) => ({
            id: String(a.id),
            applied_at: a.applied_at,
            user: a.user
              ? {
                  id: a.user.id,
                  full_name: a.user.full_name,
                  avatar_url: a.user.avatar_url,
                  xp: a.user.xp,
                  level: a.user.level,
                  title: a.user.title,
                  banner_color: a.user.banner_color,
                }
              : null,
          })) ?? [];

        const roleJoin = (j as any).creative_roles;
        const cityJoin = (j as any).cities;
        const roleName = Array.isArray(roleJoin) ? roleJoin[0]?.name : roleJoin?.name;
        const cityObj = Array.isArray(cityJoin) ? cityJoin[0] : cityJoin;

        results.push({
          id: String((j as any).id),
          description: (j as any).description ?? null,
          type: (j as any).type ?? null,
          currency: (j as any).currency ?? null,
          amount: (j as any).amount ?? null,
          rate: (j as any).rate ?? null,
          time: (j as any).time ?? null,
          created_at: (j as any).created_at,
          is_closed: (j as any).is_closed,
          closed_at: (j as any).closed_at ?? null,
          role: { name: roleName },
          city: { name: cityObj?.name, country_code: cityObj?.country_code },
          applicants,
        });
      }

      setMyJobs(results);
    } catch (err) {
      console.error('fetchMyJobsWithApplicants fatal', err);
      setMyJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  };

  /* ---------- Public jobs for viewed user + applied markers ---------- */

  const fetchUserJobs = async (ownerId: string, viewerId: string) => {
    setLoadingUserJobs(true);

    const { data: jobsData, error: jobsErr } = await supabase
      .from('jobs')
      .select(
        `
        id,
        description,
        type,
        currency,
        amount,
        rate,
        time,
        created_at,
        is_closed,
        closed_at,
        creative_roles(name),
        cities(name, country_code)
      `
      )
      .eq('user_id', ownerId)
      .eq('is_closed', false)
      .order('created_at', { ascending: false });

    if (jobsErr) {
      console.error('fetchUserJobs jobsErr', jobsErr);
      setUserJobs([]);
      setAlreadyAppliedJobIds([]);
      setLoadingUserJobs(false);
      return;
    }

    const jobs: MyJob[] = (jobsData || []).map((j: any) => ({
      id: String(j.id),
      description: j.description ?? null,
      type: j.type ?? null,
      currency: j.currency ?? null,
      amount: j.amount ?? null,
      rate: j.rate ?? null,
      time: j.time ?? null,
      created_at: j.created_at,
      is_closed: j.is_closed,
      closed_at: j.closed_at ?? null,
      role: {
        name: Array.isArray(j.creative_roles)
          ? j.creative_roles[0]?.name
          : j.creative_roles?.name,
      },
      city: {
        name: Array.isArray(j.cities) ? j.cities[0]?.name : j.cities?.name,
        country_code: Array.isArray(j.cities)
          ? j.cities[0]?.country_code
          : j.cities?.country_code,
      },
      applicants: [],
    }));

    setUserJobs(jobs);

    if (jobs.length) {
      const jobIds = jobs.map((j) => j.id);
      const { data: appsData, error: appsErr } = await supabase
        .from('applications')
        .select('job_id')
        .eq('applicant_id', viewerId)
        .in('job_id', jobIds);

      if (appsErr) {
        console.error('fetchUserJobs applications error', appsErr);
        setAlreadyAppliedJobIds([]);
      } else {
        const ids: string[] = Array.from(
  new Set<string>((appsData || []).map((a: any) => String(a.job_id)))
);
setAlreadyAppliedJobIds(ids);
      }
    } else {
      setAlreadyAppliedJobIds([]);
    }

    setLoadingUserJobs(false);
  };

  /* ---------- City search ---------- */

const fetchCities = async (query: string) => {
  const raw = (query || '').trim();
  const { cityQuery } = parseCityQuery(raw);

  latestCityTermRef.current = raw;

  if (cityQuery.length < 2) {
    setCityItems([]);
    setSearchingCities(false);
    return;
  }

  const myReqId = ++cityReqIdRef.current;
  setSearchingCities(true);

  try {
    const { data: finalData, error: finalError } = await searchCities(raw, { limit: 120 });

    if (myReqId !== cityReqIdRef.current) return;
    if (latestCityTermRef.current !== raw) return;

    if (finalError) {
      console.error('City search failed:', finalError.message);
      setCityItems([]);
      return;
    }

    const formatted = (finalData || []).map((c) => ({
      label: `${getFlag(c.country_code)} ${c.name}, ${c.country_code}`,
      value: Number(c.id),
      country_code: c.country_code,
      name: c.name,
    }));

    setCityItems(formatted);
  } finally {
    if (myReqId === cityReqIdRef.current && latestCityTermRef.current === raw) {
      setSearchingCities(false);
    }
  }
};

const scheduleCitySearch = (text: string) => {
  if (citySearchDebounceRef.current) clearTimeout(citySearchDebounceRef.current);
  citySearchDebounceRef.current = setTimeout(() => {
    fetchCities(text);
  }, 180);
};

useEffect(
  () => () => {
    if (citySearchDebounceRef.current) clearTimeout(citySearchDebounceRef.current);
  },
  []
);

  /* ---------- Role search ---------- */

  const fetchSearchRoles = useCallback(async (search: string) => {
    if (!search || search.length < 1) {
      setRoleSearchItems([]);
      return;
    }
    setSearchingRoles(true);
    const { data, error } = await supabase
      .from('creative_roles')
      .select('id, name')
      .ilike('name', `%${search}%`)
      .order('name')
      .limit(50);
    setSearchingRoles(false);

    if (error) {
      console.error(error);
      setRoleSearchItems([]);
      return;
    }
    setRoleSearchItems((data || []).map((r) => ({ value: Number(r.id), label: r.name })));
  }, []);

  /* ---------- avatar + portfolio uploaders ---------- */

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please allow media access to change your picture.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      base64: false,
      allowsEditing: false,
    });
    if (result.canceled || !result.assets?.length) return;
    setCropSource(result.assets[0].uri);
    setCropperOpen(true);
  };

  const handleAvatarCropped = async (croppedUri: string) => {
  try {
    setUploading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) throw new Error("Not authenticated");

    const fileName = `${Date.now()}_avatar.jpg`;
    const path = `user_${user.id}/${fileName}`;

    let uploadBody: Blob | Uint8Array;
    let contentType = "image/jpeg";

    if (Platform.OS !== "web" && croppedUri.startsWith("file://")) {
      const base64 = await FileSystem.readAsStringAsync(croppedUri, {
        encoding: 'base64' as any,
      });
      const bytes = Buffer.from(base64, "base64");
      uploadBody = new Uint8Array(bytes);
    } else {
      const response = await fetch(croppedUri);
      const blob = await response.blob();
      uploadBody = blob;
      contentType = blob.type || "image/jpeg";
    }

    const { error: uploadErr } = await supabase.storage
      .from("avatars")
      .upload(path, uploadBody, {
        contentType,
        upsert: true,
      });

    if (uploadErr) throw uploadErr;

    const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
    const publicUrl = urlData.publicUrl;

    const { error: updErr } = await supabase
      .from("users")
      .update({ avatar_url: publicUrl })
      .eq("id", user.id);

    if (updErr) throw updErr;

    setImage(`${publicUrl}?t=${Date.now()}`);
    await fetchProfile();
  } catch (err: any) {
    console.warn("Avatar upload failed:", err);
    Alert.alert("Upload failed", err?.message ?? "Unexpected error.");
  } finally {
    setUploading(false);
    setCropperOpen(false);
    setCropSource(null);
  }
};

  const uploadToPortfolios = async ({
    localUri,
    mimeType,
    fileName,
    type,
    width,
    height,
    title,
  }: {
    localUri: string;
    mimeType: string;
    fileName: string;
    type: PortfolioType;
    width?: number;
    height?: number;
    title?: string;
  }) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // ✅ Spacing-friendly: keep object path deterministic and readable
      const path = `user_${user.id}/${Date.now()}_${sanitizeFileName(fileName)}`;

      const response = await fetch(localUri);
      const blob = await response.blob();

      await supabase.storage.from('portfolios').upload(path, blob, { contentType: mimeType });
      const { data: pub } = supabase.storage.from('portfolios').getPublicUrl(path);

      await supabase.from('portfolio_items').insert({
        user_id: user.id,
        url: pub.publicUrl,
        type,
        mime_type: mimeType,
        title: title ?? fileName,
        width: width ?? null,
        height: height ?? null,
      });

      await fetchPortfolioItems(user.id);
    } catch (e: any) {
      Alert.alert('Upload failed', e.message ?? 'Error uploading');
    }
  };

  const uploadPortfolioImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please allow media access to upload an image.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.95,
      allowsMultipleSelection: false,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    await uploadToPortfolios({
      localUri: asset.uri,
      mimeType: asset.mimeType ?? 'image/jpeg',
      fileName: asset.fileName ?? `image_${Date.now()}.jpg`,
      type: 'image',
      width: asset.width,
      height: asset.height,
      title: asset.fileName ?? 'Image',
    });
  };

  const uploadPortfolioPDF = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf'],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const file = result.assets[0];
    await uploadToPortfolios({
      localUri: file.uri,
      mimeType: file.mimeType ?? 'application/pdf',
      fileName: file.name ?? `file_${Date.now()}.pdf`,
      type: 'pdf',
      title: file.name ?? 'PDF',
    });
  };

  const uploadPortfolioMP3 = async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ['audio/mpeg', 'audio/mp3', 'audio/*'],
      multiple: false,
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.length) return;
    const file = result.assets[0];
    await uploadToPortfolios({
      localUri: file.uri,
      mimeType: (file as any).mime_type ?? file.mimeType ?? 'audio/mpeg',
      fileName: (file as any).name ?? `audio_${Date.now()}.mp3`,
      type: 'audio',
      title: (file as any).name ?? 'Audio',
    });
  };

  /* ---------- Main MP4 showreel ---------- */

  const uploadMainMP4 = async () => {
    try {
      await uploadAnotherShowreel();
    } catch (e: any) {
      console.warn('Showreel upload failed:', e?.message ?? e);
      Alert.alert('Upload failed', e?.message ?? 'Could not prepare video.');
      setMp4Status('');
    }
  };

const changeShowreelThumbnail = async (row: ShowreelRow) => {
  try {
    const pick = await DocumentPicker.getDocumentAsync({
      type: ["image/*"] as any,
      copyToCacheDirectory: true,
      multiple: false,
    });

    if (pick.canceled) return;

    const asset: any = pick.assets?.[0];
    if (!asset?.uri && !asset?.file) {
      throw new Error("No image selected");
    }

    setPendingShowreelThumbs((prev) => ({
      ...prev,
      [row.id]: asset,
    }));

    let previewUrl: string | null = null;

    if (Platform.OS === "web" && asset?.file) {
      previewUrl = URL.createObjectURL(asset.file as File);
    } else {
      previewUrl = asset.uri;
    }

    setShowreels((prev) =>
      prev.map((s) => (s.id === row.id ? { ...s, thumbnail_url: previewUrl } : s))
    );

    showNotice("Thumbnail added", "Thumbnail selected. Press Save to upload it.");
  } catch (e: any) {
    console.warn("Showreel thumbnail selection failed:", e?.message ?? e);
    showNotice(
      "Thumbnail failed",
      e?.message ?? "Could not select thumbnail."
    );
  }
};
  /* ---------- audio controls ---------- */

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
    } catch (e) {
      Alert.alert('Playback failed', (e as any).message ?? 'Error');
    }
  };

  const deletePortfolioItem = async (id: string) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('portfolio_items').delete().eq('id', id).eq('user_id', user.id);
      setPortfolioItems((prev) => prev.filter((p) => p.id !== id));
    } catch (e: any) {
      Alert.alert('Delete failed', e.message ?? 'Error');
    }
  };

  /* ---------- save profile ---------- */

  const deleteSubmission = async (submission: SubmissionRow) => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        Alert.alert('Sign in required', 'Please sign in to delete submissions.');
        return;
      }

      const stripQuery = (u: string) => (u ? u.split('?')[0] : u);

      const pathFromPublicUrl = (u: string) => {
        const clean = stripQuery(u);
        const m = clean.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
        if (!m) return null;
        return { bucket: m[1], path: m[2] };
      };

      const pickVideoField = (s: any) => {
        return (
          s.video_path ||
          s.video_url ||
          s.file_path ||
          s.file_url ||
          s.mp4_path ||
          s.mp4_url ||
          s.storage_path ||
          s.storage_url ||
          s.url ||
          s.path ||
          ''
        )
          .toString()
          .trim();
      };

      const performDelete = async () => {
        const prevSubs = submissions;

        // Optimistic UI (instant feedback)
        setSubmissions((p) => p.filter((row) => row.id !== submission.id));
        setSubmissionModalOpen(false);
        setActiveSubmission(null);

        try {
          // 1) Delete on the server (RPC should delete votes/comments + submission)
          const { error: delErr } = await supabase.rpc('delete_submission', {
            p_submission_id: submission.id,
          });

          if (delErr) throw delErr;

          // 2) Storage cleanup AFTER DB delete (never blocks delete if it fails)
          try {
            const raw = pickVideoField(submission as any);

            // only cleanup storage for NON-youtube
            if (!(submission as any).youtube_url && raw) {
              if (/^https?:\/\//i.test(raw)) {
                const pub = pathFromPublicUrl(raw);
                if (pub?.bucket && pub?.path) {
                  await supabase.storage.from(pub.bucket).remove([pub.path]);
                }
              } else {
                const cleanPath = stripQuery(raw);

                // try films first, then portfolios
                const resFilms = await supabase.storage.from('films').remove([cleanPath]);
                if (resFilms?.error) {
                  await supabase.storage.from('portfolios').remove([cleanPath]);
                }
              }
            }
          } catch (e) {
            console.warn('Storage delete failed (continuing):', (e as any)?.message ?? e);
          }

          // 3) Authoritative refresh so it never “reappears”
          await fetchUserSubmissions(user.id);

          if (Platform.OS !== 'web') {
            Alert.alert('Deleted', 'Your submission has been removed.');
          }
        } catch (e: any) {
          console.warn('Delete submission error:', e?.message ?? e);

          // rollback
          setSubmissions(prevSubs);

          const msg = e?.message ?? 'Could not delete submission.';
          if (Platform.OS === 'web') {
            console.warn('Delete failed:', msg);
            if (typeof window !== 'undefined') window.alert(`Delete failed: ${msg}`);
          } else {
            Alert.alert('Delete failed', msg);
          }
        }
      };

      // ✅ WEB CONFIRM (Alert.alert is unreliable on web)
      if (Platform.OS === 'web') {
        const ok =
          typeof window !== 'undefined' &&
          window.confirm('Delete submission? This will remove it from your profile.');
        if (ok) await performDelete();
        return;
      }

      // ✅ NATIVE CONFIRM
      Alert.alert('Delete submission?', 'This will remove it from your profile.', [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            performDelete();
          },
        },
      ]);
    } catch (e: any) {
      Alert.alert('Delete failed', e?.message ?? 'Could not delete submission.');
    }
  };

  const updateSubmissionProfileVisibility = async (
    submission: SubmissionRow,
    hiddenOnProfile: boolean
  ) => {
    const previousHiddenIds = new Set(localHiddenSubmissionIds);
    const nextHiddenIds = new Set(previousHiddenIds);
    if (hiddenOnProfile) {
      nextHiddenIds.add(submission.id);
    } else {
      nextHiddenIds.delete(submission.id);
    }

    const patchedSubmission = { ...submission, hidden_on_profile: hiddenOnProfile };

    setLocalHiddenSubmissionIds(nextHiddenIds);
    void persistLocalHiddenSubmissionIds(nextHiddenIds);

    setSubmissions((prev) =>
      prev.map((row) => (row.id === submission.id ? { ...row, hidden_on_profile: hiddenOnProfile } : row))
    );

    if (activeSubmission?.id === submission.id) {
      setActiveSubmission(patchedSubmission);
    }

    if (hiddenOnProfile) {
      setSubmissionModalOpen(false);
      setActiveSubmission(null);
    }

    const hasRemoteVisibilityColumn =
      Object.prototype.hasOwnProperty.call(submission as any, 'hidden_on_profile') ||
      submissions.some((row) =>
        Object.prototype.hasOwnProperty.call(row as any, 'hidden_on_profile')
      );

    if (!hasRemoteVisibilityColumn) {
      return;
    }

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        return;
      }

      const { error } = await supabase
        .from('submissions')
        .update({ hidden_on_profile: hiddenOnProfile })
        .eq('id', submission.id)
        .eq('user_id', user.id);

      if (error) throw error;
    } catch (e: any) {
      console.log('Submission visibility will remain local for now:', e?.message ?? e);
    }
  };

const uploadPendingShowreelThumbs = async (userId: string) => {
  const entries = Object.entries(pendingShowreelThumbs);

  for (const [showreelId, asset] of entries) {
    const { publicUrl } = await uploadShowreelThumbToStorage({
      userId,
      showreelId,
      asset,
      bucket: THUMB_BUCKET,
    });

    const { error } = await supabase
      .from("user_showreels")
      .update({ thumbnail_url: publicUrl })
      .eq("id", showreelId)
      .eq("user_id", userId);

    if (error) throw error;

    setShowreels((prev) =>
  prev.map((s) =>
    s.id === showreelId
      ? { ...s, thumbnail_url: `${publicUrl}?t=${Date.now()}` }
      : s
  )
);
  }

  setPendingShowreelThumbs({});
};

  const saveProfile = async () => {
  try {
    savingRef.current = true;
    setUploading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const mainRoleId =
      typeof mainRole === 'number' ? mainRole : mainRole != null ? Number(mainRole) : null;
    const cityFk = typeof cityId === 'number' ? cityId : cityId != null ? Number(cityId) : null;

    const sideRolesClean = (sideRoles || []).map((s) => s.trim()).filter(Boolean);

    const primaryShowreel = showreels.find((r) => r.is_primary) || null;

const resolvedPortfolioUrl =
  primaryShowreel?.url
    ? stripBuster(primaryShowreel.url)
    : mp4MainUrl
    ? stripBuster(mp4MainUrl)
    : profile?.portfolio_url ?? null;

    const moderation = validateMultipleSafeTexts([
      { label: 'Name', value: fullName },
      { label: 'About', value: bio },
      { label: 'Portfolio URL', value: resolvedPortfolioUrl },
      { label: 'Side roles', value: sideRolesClean.join(', ') },
    ]);

    if (!moderation.safe) {
      Alert.alert('Content Not Allowed', moderation.message || 'Please edit your profile before saving.');
      return;
    }

    const payload: any = {
      full_name: (fullName || '').trim() || null,
      main_role_id: mainRoleId ?? null,
      side_roles: sideRolesClean.length ? sideRolesClean : null,
      city_id: cityFk ?? null,
      bio: (bio || '').trim() || null,
      portfolio_url: resolvedPortfolioUrl,
    };

    const { data: updated, error: updErr } = await supabase
      .from('users')
      .update(payload)
      .eq('id', user.id)
      .select('*')
      .single();

    if (updErr) throw updErr;

    // upload any newly selected showreel thumbnails
    await uploadPendingShowreelThumbs(user.id);

    const pd = updated as ProfileData;
    setProfile(pd);
    setFullName(pd.full_name || '');
    setMainRole(
      typeof pd.main_role_id === 'number'
        ? pd.main_role_id
        : pd.main_role_id != null
        ? Number(pd.main_role_id) || null
        : null
    );
    setSideRoles(Array.isArray(pd.side_roles) ? pd.side_roles.filter(Boolean) : []);
    setCityId(
      typeof pd.city_id === 'number'
        ? pd.city_id
        : pd.city_id != null
        ? Number(pd.city_id) || null
        : null
    );

    if (pd.main_role_id != null) {
      const { data: roleData } = await supabase
  .from('creative_roles')
  .select('name')
  .eq('id', Number(pd.main_role_id))
  .maybeSingle();

setMainRoleName((roleData as { name?: string } | null)?.name ?? '');
    } else {
      setMainRoleName('');
    }

    if (pd.city_id != null) {
      const { data: cityData } = await supabase
  .from('cities')
  .select('name, country_code')
  .eq('id', Number(pd.city_id))
  .maybeSingle();

const city = cityData as { name?: string; country_code?: string } | null;
const label = city?.name ?? '';
      setCityName(
        label
          ? cityData?.country_code
            ? `${label}, ${cityData.country_code}`
            : label
          : ''
      );
    } else {
      setCityName('');
    }

    await loadGamificationMeta(pd);

    try {
      await refreshProfile?.();
    } catch {
      // ignore
    }

    if (isOwnProfile) {
      const { data: me } = await supabase.auth.getUser();
      if (me?.user?.id) await fetchShowreelList(me.user.id);
    }

    setShowEditModal(false);
    Alert.alert('Saved', 'Your profile has been updated.');
  } catch (e: any) {
    Alert.alert('Save failed', e?.message ?? 'Could not save profile.');
  } finally {
    setUploading(false);
    setTimeout(() => {
      savingRef.current = false;
    }, 250);
  }
};

  const reportProfile = () => {
    if (!profile) return;
    if (!currentUserId) {
      promptSignIn('Create an account or sign in to report users.');
      return;
    }

    setReportReason('Harassment or bullying');
    setReportDetails('');
    setReportTarget({
      type: 'profile',
      reportedUserId: profile.id,
      contentId: profile.id,
      title: profile.full_name || 'Profile',
    });
    setReportOpen(true);
  };

  const fetchSubmissionComments = async (submissionId: string) => {
    setLoadingComments(true);

    try {
      const baseSelect = `
        id,
        submission_id,
        user_id,
        comment,
        parent_comment_id,
        created_at,
        users:user_id(id, full_name, avatar_url)
      `;

      let { data, error } = await supabase
        .from('submission_comments')
        .select(baseSelect)
        .eq('submission_id', submissionId)
        .order('created_at', { ascending: true });

      if (error && /parent_comment_id/i.test(error.message || '')) {
        const fallback = await supabase
          .from('submission_comments')
          .select(`
            id,
            submission_id,
            user_id,
            comment,
            created_at,
            users:user_id(id, full_name, avatar_url)
          `)
          .eq('submission_id', submissionId)
          .order('created_at', { ascending: true });
        data = fallback.data;
        error = fallback.error;
      }

      if (error) throw error;

      setComments((data as any) || []);
    } catch (e: any) {
      console.warn('Profile fetch comments error:', e?.message || e);
      setComments([]);
    } finally {
      setLoadingComments(false);
    }
  };

  const getSubmissionCreatorId = useCallback((submission?: SubmissionRow | null) => {
    return submission?.users?.id || submission?.user_id || null;
  }, []);

  const refreshSubmissionVoteStatus = useCallback(
    async (submissionId: string) => {
      if (!currentUserId) {
        setSubmissionVotedIds((prev) => {
          const next = new Set(prev);
          next.delete(submissionId);
          return next;
        });
        return;
      }

      try {
        const { count, error } = await supabase
          .from('user_votes')
          .select('submission_id', { count: 'exact', head: true })
          .eq('user_id', currentUserId)
          .eq('submission_id', submissionId);

        if (error) throw error;

        setSubmissionVotedIds((prev) => {
          const next = new Set(prev);
          if ((count ?? 0) > 0) {
            next.add(submissionId);
          } else {
            next.delete(submissionId);
          }
          return next;
        });
      } catch (e: any) {
        console.log('Submission vote status unavailable:', e?.message ?? e);
      }
    },
    [currentUserId]
  );

  const refreshWatchCreatorSupportStatus = useCallback(
    async (creatorId?: string | null) => {
      setWatchCreatorSupportUserId(creatorId || null);

      if (!creatorId || !currentUserId || creatorId === currentUserId) {
        setWatchCreatorIsSupporting(false);
        return;
      }

      if (creatorId === profile?.id) {
        setWatchCreatorIsSupporting(isSupporting);
        return;
      }

      try {
        const { count, error } = await supabase
          .from('user_supports')
          .select('id', { count: 'exact', head: true })
          .eq('supporter_id', currentUserId)
          .eq('supported_id', creatorId);

        if (error) throw error;
        setWatchCreatorIsSupporting((count ?? 0) > 0);
      } catch (e: any) {
        console.log('Creator support status unavailable:', e?.message ?? e);
        setWatchCreatorIsSupporting(false);
      }
    },
    [currentUserId, isSupporting, profile?.id]
  );

  const openSubmissionModal = async (submission: SubmissionRow) => {
    if (submissionModalCleanupRef.current) {
      clearTimeout(submissionModalCleanupRef.current);
      submissionModalCleanupRef.current = null;
    }

    setActiveSubmission(submission);
    setRecentSubmissionWatchIds((prev) =>
      [submission.id, ...prev.filter((id) => id !== submission.id)].slice(0, 24)
    );
    setSubmissionModalOpen(true);
    setCommentText('');
    setComments([]);
    setSubmissionCommentsExpanded(false);
    setSubmissionActionsMenuOpen(false);

    const scrollToPlayer = () => {
      submissionWatchScrollRef.current?.scrollTo({ y: 0, animated: true });
    };

    InteractionManager.runAfterInteractions(scrollToPlayer);
    setTimeout(scrollToPlayer, Platform.OS === 'web' ? 40 : 70);

    await Promise.all([
      fetchSubmissionComments(submission.id),
      refreshSubmissionVoteStatus(submission.id),
      refreshWatchCreatorSupportStatus(getSubmissionCreatorId(submission)),
    ]);
  };

  const closeSubmissionModal = async () => {
    try {
      await pauseAllExcept(PAUSE_NONE_ID);
    } catch {}

    setSubmissionModalOpen(false);
    setSubmissionActionsMenuOpen(false);

    if (submissionModalCleanupRef.current) {
      clearTimeout(submissionModalCleanupRef.current);
    }

    submissionModalCleanupRef.current = setTimeout(() => {
      setActiveSubmission(null);
      setComments([]);
      setCommentText('');
      setSubmissionCommentsExpanded(false);
      setSubmissionActionsMenuOpen(false);
      setWatchCreatorSupportUserId(null);
      setWatchCreatorIsSupporting(false);
      submissionModalCleanupRef.current = null;
    }, 260);
  };

  useEffect(() => {
    if (watchCreatorSupportUserId && watchCreatorSupportUserId === profile?.id) {
      setWatchCreatorIsSupporting(isSupporting);
    }
  }, [isSupporting, profile?.id, watchCreatorSupportUserId]);

  const toggleProfileSubmissionVote = async (submission: SubmissionRow) => {
    if (!currentUserId) {
      promptSignIn('Create an account or sign in to vote for films.');
      return;
    }

    if (submission.user_id === currentUserId) return;
    if (submissionVoteBusy[submission.id]) return;

    const alreadyVoted = submissionVotedIds.has(submission.id);
    setSubmissionVoteBusy((prev) => ({ ...prev, [submission.id]: true }));

    try {
      if (alreadyVoted) {
        const { error } = await supabase
          .from('user_votes')
          .delete()
          .eq('user_id', currentUserId)
          .eq('submission_id', submission.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('user_votes').insert([
          {
            submission_id: submission.id,
            user_id: currentUserId,
          },
        ]);
        if (error) throw error;
      }

      const delta = alreadyVoted ? -1 : 1;

      setSubmissionVotedIds((prev) => {
        const next = new Set(prev);
        if (alreadyVoted) {
          next.delete(submission.id);
        } else {
          next.add(submission.id);
        }
        return next;
      });

      setSubmissions((prev) =>
        prev.map((row) =>
          row.id === submission.id
            ? { ...row, votes: Math.max(0, (row.votes || 0) + delta) }
            : row
        )
      );

      setActiveSubmission((prev) =>
        prev && prev.id === submission.id
          ? { ...prev, votes: Math.max(0, (prev.votes || 0) + delta) }
          : prev
      );
    } catch (e: any) {
      console.warn('Profile film vote error:', e?.message || e);
      Alert.alert('Vote failed', 'Please try again.');
    } finally {
      setSubmissionVoteBusy((prev) => ({ ...prev, [submission.id]: false }));
    }
  };

  const shareProfileSubmissionLink = async (submission: SubmissionRow) => {
    try {
      const shareSlug = await ensureProfileSubmissionShareSlug({
        id: submission.id,
        title: submission.title,
        share_slug: submission.share_slug ?? null,
      });
      const url = buildProfileSharedFilmUrl(shareSlug);

      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url);
      } else {
        await Clipboard.setStringAsync(url);
      }

      setSubmissions((prev) =>
        prev.map((row) =>
          row.id === submission.id ? { ...row, share_slug: shareSlug } : row
        )
      );
      setActiveSubmission((prev) =>
        prev && prev.id === submission.id ? { ...prev, share_slug: shareSlug } : prev
      );

      if (Platform.OS === 'web') {
        if (typeof window !== 'undefined') window.alert('Film link copied.');
      } else {
        Alert.alert('Link copied', 'The film link is ready to share.');
      }
    } catch (e: any) {
      console.warn('Profile film share failed:', e?.message || e);
      Alert.alert('Share failed', 'Could not create or copy the film link.');
    }
  };

  const reportProfileSubmission = async (submission: SubmissionRow) => {
    if (!currentUserId) {
      promptSignIn('Create an account or sign in to report films.');
      return;
    }

    try {
      await pauseAllExcept(PAUSE_NONE_ID);
    } catch {}

    setReportReason('Harassment or bullying');
    setReportDetails('');
    setReportTarget({
      type: 'submission',
      reportedUserId: getSubmissionCreatorId(submission),
      contentId: submission.id,
      title: submission.title || 'Film',
    });
    setReportOpen(true);
  };

  const blockProfileSubmissionCreator = async (submission: SubmissionRow) => {
    const blockedUserId = getSubmissionCreatorId(submission);

    if (!currentUserId) {
      promptSignIn('Create an account or sign in to block users.');
      return;
    }

    if (!blockedUserId) {
      Alert.alert('Unable to block', 'This creator could not be found.');
      return;
    }

    if (blockedUserId === currentUserId) {
      Alert.alert('Not Allowed', 'You cannot block yourself.');
      return;
    }

    const blockedUserName =
      submission.users?.full_name ||
      (blockedUserId === profile?.id ? profile?.full_name : null) ||
      'this user';

    const confirmed =
      Platform.OS === 'web'
        ? window.confirm(
            `Block ${blockedUserName}?\n\nTheir films and comments will be removed from your feed immediately.`
          )
        : await new Promise<boolean>((resolve) => {
            Alert.alert(
              'Block User?',
              `Block ${blockedUserName}? Their films and comments will be removed from your feed immediately.`,
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Block', style: 'destructive', onPress: () => resolve(true) },
              ]
            );
          });

    if (!confirmed) return;

    const ok = await blockUser({
      blockedUserId,
      reason: 'Blocked from Profile film viewer',
      showAlert: true,
    });

    if (ok) {
      if (blockedUserId === profile?.id) setHasBlockedProfile(true);
      setSubmissions((prev) =>
        prev.filter((row) => getSubmissionCreatorId(row) !== blockedUserId)
      );
      await closeSubmissionModal();
    }
  };

  const toggleWatchCreatorSupport = async () => {
    const creatorId = getSubmissionCreatorId(activeSubmission);
    if (!creatorId) return;

    if (!currentUserId) {
      promptSignIn('Create an account or sign in to support users.');
      return;
    }

    if (creatorId === currentUserId || watchCreatorSupportBusy) return;

    const alreadySupporting =
      creatorId === profile?.id ? isSupporting : watchCreatorIsSupporting;

    setWatchCreatorSupportBusy(true);
    try {
      const { error } = alreadySupporting
        ? await unsupportUser(creatorId)
        : await supportUser(creatorId);

      if (error) throw error;

      const nextSupporting = !alreadySupporting;
      setWatchCreatorIsSupporting(nextSupporting);

      if (creatorId === profile?.id) {
        setIsSupporting(nextSupporting);
        setSupportersCount((n) =>
          Math.max(0, n + (nextSupporting ? 1 : -1))
        );
      }
    } catch (e: any) {
      Alert.alert('Support failed', e?.message || 'Please try again.');
    } finally {
      setWatchCreatorSupportBusy(false);
    }
  };

  const submitSubmissionComment = async () => {
    if (!activeSubmission) return;

    if (!currentUserId) {
      promptSignIn('Create an account or sign in to comment on films.');
      return;
    }

    const text = commentText.trim();
    if (!text || sendingComment) return;

    const moderation = validateSafeText(text);
    if (moderation) {
      Alert.alert('Content Not Allowed', moderation);
      return;
    }

    setSendingComment(true);

    try {
      let { error } = await supabase.from('submission_comments').insert([
        {
          submission_id: activeSubmission.id,
          user_id: currentUserId,
          comment: text,
        },
      ]);

      if (error && /parent_comment_id/i.test(error.message || '')) {
        const fallback = await supabase.from('submission_comments').insert([
          {
            submission_id: activeSubmission.id,
            user_id: currentUserId,
            comment: text,
          },
        ]);
        error = fallback.error;
      }

      if (error) throw error;

      setCommentText('');
      await fetchSubmissionComments(activeSubmission.id);
    } catch (e: any) {
      Alert.alert('Could not post comment', e?.message || 'Please try again.');
    } finally {
      setSendingComment(false);
    }
  };

  const reportSubmissionComment = async (comment: SubmissionCommentRow) => {
    if (!currentUserId) {
      promptSignIn('Create an account or sign in to report comments.');
      return;
    }

    try {
      await pauseAllExcept(PAUSE_NONE_ID);
    } catch {}

    setReportReason('Harassment or bullying');
    setReportDetails('');
    setReportTarget({
      type: 'comment',
      reportedUserId: comment.user_id,
      contentId: comment.id,
      title: comment.comment || comment.content || 'Comment',
    });
    setReportOpen(true);
  };

  const goToCommentUserProfile = async (userId?: string | null) => {
    if (!userId) return;

    await closeSubmissionModal();
    navigation.navigate("Profile", { userId });
  };

  const submitProfileReport = async () => {
    if (!reportTarget && !profile) return;

    const detailsError = validateSafeText(reportDetails);
    if (detailsError) {
      Alert.alert('Content Not Allowed', detailsError);
      return;
    }

    setReportSubmitting(true);
    try {
      const ok = await reportContent({
        reportedUserId: reportTarget?.reportedUserId || profile?.id || null,
        contentType: reportTarget?.type || 'profile',
        contentId: reportTarget?.contentId || profile?.id || null,
        reason: reportReason,
        details: reportDetails.trim() || null,
      });

      if (ok) {
        setReportOpen(false);
        setReportDetails('');
        setReportTarget(null);
      }
    } finally {
      setReportSubmitting(false);
    }
  };

  const blockProfileUser = async () => {
    if (!profile) return;
    if (!currentUserId) {
      promptSignIn('Create an account or sign in to block users.');
      return;
    }

    if (profile.id === currentUserId) {
      Alert.alert('Not Allowed', 'You cannot block yourself.');
      return;
    }

    const confirmed =
      Platform.OS === 'web'
        ? window.confirm(
            'Block this user?\n\nThey won’t be able to interact with you, and their content will be removed from your feed.'
          )
        : await new Promise<boolean>((resolve) => {
            Alert.alert(
              'Block this user?',
              'They won’t be able to interact with you, and their content will be removed from your feed.',
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Block', style: 'destructive', onPress: () => resolve(true) },
              ]
            );
          });

    if (!confirmed) return;

    const ok = await blockUser({
      blockedUserId: profile.id,
      reason: 'Blocked from Profile',
      showAlert: true,
    });

    if (ok) {
      setHasBlockedProfile(true);
      setUserJobs([]);
      setSubmissions([]);
      setPortfolioItems([]);
    }
  };

  const toggleProfileSupport = async () => {
    if (!currentUserId) {
      promptSignIn("Create an account or sign in to support users.");
      return;
    }

    const targetIdToSupport = profile?.id;
    if (!targetIdToSupport) return;

    if (isSupporting) {
      const { error } = await unsupportUser(targetIdToSupport);
      if (!error) {
        setIsSupporting(false);
        setSupportersCount((n) => Math.max(0, n - 1));
      }
    } else {
      const { error } = await supportUser(targetIdToSupport);
      if (!error) {
        setIsSupporting(true);
        setSupportersCount((n) => n + 1);
      }
    }
  };
  /* ---------- dirty state ---------- */

  useEffect(() => {
    if (!profile) return;
    const roleId = typeof mainRole === 'number' ? mainRole : mainRole != null ? Number(mainRole) : null;
    const cityFk = typeof cityId === 'number' ? cityId : cityId != null ? Number(cityId) : null;
    const sideA = (sideRoles || []).map((s) => s.trim()).filter(Boolean);
    const sideB = (profile.side_roles || []).map((s) => s.trim()).filter(Boolean);
    const sameSide = sideA.length === sideB.length && sideA.every((v, i) => v === sideB[i]);

    const primaryShowreel = showreels.find((r) => r.is_primary) || null;
    const resolvedPortfolioUrl = primaryShowreel
      ? stripBuster(primaryShowreel.url || mp4MainUrl || profile.portfolio_url || '')
      : stripBuster(mp4MainUrl || '');

    setIsDirty(
  (fullName || '') !== (profile.full_name || '') ||
    (roleId ?? null) !== (profile.main_role_id ?? null) ||
    (cityFk ?? null) !== (profile.city_id ?? null) ||
    !sameSide ||
    (bio || '') !== (profile.bio || '') ||
    (resolvedPortfolioUrl || '') !== (profile.portfolio_url || '') ||
    Object.keys(pendingShowreelThumbs).length > 0
);
  }, [profile, fullName, mainRole, cityId, sideRoles, bio, mp4MainUrl, showreels, pendingShowreelThumbs]);

  /* ---------- close job (own) ---------- */

  const closeJob = async (jobId: string) => {
    try {
      setClosingJobId(jobId);
      const { error } = await supabase
        .from('jobs')
        .update({ is_closed: true, closed_at: new Date().toISOString() })
        .eq('id', jobId);
      if (error) throw error;

      setMyJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (e: any) {
      Alert.alert('Could not close job', e.message ?? 'Error');
    } finally {
      setClosingJobId(null);
    }
  };

  /* ---------- submission thumbnail upload (copy from Challenge) ---------- */

function withTimeout<T>(promise: Promise<T>, ms = 20000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Upload timed out. Please try again."));
    }, ms);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function uploadSubmissionThumbToStorage(opts: {
  userId: string;
  submissionId: string;
  asset: any; // DocumentPicker asset
  bucket?: string;
}): Promise<{ publicUrl: string; path: string }> {
  const { userId, submissionId, asset, bucket = THUMB_BUCKET } = opts;

  let blob: Blob | File | Uint8Array;
  let contentType = "image/jpeg";

  // WEB: use the actual file directly
  if (Platform.OS === "web" && asset?.file) {
    const file = asset.file as File;
    blob = file;
    contentType = file.type || "image/jpeg";
  } else {
    const uri = asset?.uri;
    if (!uri) throw new Error("No thumbnail URI");

    if (Platform.OS !== "web" && uri.startsWith("file://")) {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64' as any,
      });
      const bytes = Buffer.from(base64, "base64");
      blob = new Uint8Array(bytes);
      contentType = asset?.mimeType || asset?.mime_type || "image/jpeg";
    } else {
      const resp = await fetch(uri);
      const fetchedBlob = await resp.blob();
      blob = fetchedBlob;
      contentType = fetchedBlob.type || "image/jpeg";
    }
  }

  const ext =
    contentType.includes("png")
      ? ".png"
      : contentType.includes("jpeg") || contentType.includes("jpg")
      ? ".jpg"
      : contentType.includes("webp")
      ? ".webp"
      : ".jpg";

  const path = `submissions/${userId}/${submissionId}/${Date.now()}${ext}`;

  const uploadPromise = supabase.storage.from(bucket).upload(path, blob, {
    upsert: true,
    contentType,
    cacheControl: "3600",
  });

  const up: { data: any; error: Error | null } = await withTimeout(
  uploadPromise as Promise<{ data: any; error: Error | null }>,
  20000
);

if (up.error) throw up.error;

  const pub = supabase.storage.from(bucket).getPublicUrl(path);
  const publicUrl = pub?.data?.publicUrl;

  if (!publicUrl) throw new Error("Could not get public thumbnail URL");

  return { publicUrl, path };
}

async function uploadShowreelThumbToStorage(opts: {
  userId: string;
  showreelId: string;
  asset: any; // DocumentPicker asset
  bucket?: string;
}): Promise<{ publicUrl: string; path: string }> {
  const { userId, showreelId, asset, bucket = THUMB_BUCKET } = opts;

  let blob: Blob | File | Uint8Array;
  let contentType = "image/jpeg";

  // WEB: use the actual file directly
  if (Platform.OS === "web" && asset?.file) {
    const file = asset.file as File;
    blob = file;
    contentType = file.type || "image/jpeg";
  } else {
    const uri = asset?.uri;
    if (!uri) throw new Error("No thumbnail URI");

    if (Platform.OS !== "web" && uri.startsWith("file://")) {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64' as any,
      });
      const bytes = Buffer.from(base64, "base64");
      blob = new Uint8Array(bytes);
      contentType = asset?.mimeType || asset?.mime_type || "image/jpeg";
    } else {
      const resp = await fetch(uri);
      const fetchedBlob = await resp.blob();
      blob = fetchedBlob;
      contentType = fetchedBlob.type || "image/jpeg";
    }
  }

  const ext =
    contentType.includes("png")
      ? ".png"
      : contentType.includes("jpeg") || contentType.includes("jpg")
      ? ".jpg"
      : contentType.includes("webp")
      ? ".webp"
      : ".jpg";

  const path = `showreels/${userId}/${showreelId}/${Date.now()}${ext}`;

  const uploadPromise = supabase.storage.from(bucket).upload(path, blob, {
    upsert: true,
    contentType,
    cacheControl: "3600",
  });

  const up: { data: any; error: Error | null } = await withTimeout(
  uploadPromise as Promise<{ data: any; error: Error | null }>,
  20000
);

if (up.error) throw up.error;

  const pub = supabase.storage.from(bucket).getPublicUrl(path);
  const publicUrl = pub?.data?.publicUrl;

  if (!publicUrl) throw new Error("Could not get public thumbnail URL");

  return { publicUrl, path };
}

async function uploadThumbnailToStorage(opts: {
  userId: string;
  thumbUri: string; // file:// (native) OR data:image/... (web) OR blob:... (web)
  objectName?: string;
  bucket?: string;
}): Promise<{ publicUrl: string; path: string }> {
  const {
    userId,
    thumbUri,
    objectName = `submissions/${userId}/${Date.now()}`,
    bucket = THUMB_BUCKET,
  } = opts;

  let blob: Blob;
  let contentType = "image/jpeg";

  if (Platform.OS !== "web" && thumbUri.startsWith("file://")) {
    const base64 = await FileSystem.readAsStringAsync(thumbUri, {
      encoding: 'base64' as any,
    });
    const bytes = Buffer.from(base64, "base64");
    blob = new Blob([bytes], { type: "image/jpeg" });
    contentType = "image/jpeg";
  } else {
    const resp = await fetch(thumbUri);
    blob = await resp.blob();
    contentType = blob.type || "image/jpeg";
  }

  const ext =
    contentType.includes("png")
      ? ".png"
      : contentType.includes("jpeg") || contentType.includes("jpg")
      ? ".jpg"
      : contentType.includes("webp")
      ? ".webp"
      : ".jpg";

  const filePath = `${objectName}${ext}`;

  const uploadPromise = supabase.storage.from(bucket).upload(filePath, blob, {
    upsert: true,
    contentType,
    cacheControl: "3600",
  });

  const up: { data: any; error: Error | null } = await withTimeout(
  uploadPromise as Promise<{ data: any; error: Error | null }>,
  20000
);

if (up.error) throw up.error;

  const pub = supabase.storage.from(bucket).getPublicUrl(filePath);
  const publicUrl = pub?.data?.publicUrl;

  if (!publicUrl) throw new Error("Could not get public thumbnail URL");

  return { publicUrl, path: filePath };
}
  /* ---------- apply to job in viewed user's profile ---------- */



  const applyToJob = async (job: MyJob) => {
    try {
      const {
        data: { user: me },
      } = await supabase.auth.getUser();
      if (!me) {
        Alert.alert('Sign in required', 'Please log in to apply for this role.');
        return;
      }

      const jobId = job.id;

      if (alreadyAppliedJobIds.includes(jobId)) {
        Alert.alert('Already applied', 'You have already applied for this role.');
        return;
      }

      setApplyLoadingJobId(jobId);

      const { data: existing, error: existingErr } = await supabase
        .from('applications')
        .select('id')
        .eq('job_id', jobId)
        .eq('applicant_id', me.id)
        .maybeSingle();

      if (existingErr) {
        console.error(existingErr);
      }

      if (existing) {
        setAlreadyAppliedJobIds((prev) =>
          prev.includes(jobId) ? prev : [...prev, jobId]
        );
        Alert.alert('Already applied', 'You have already applied for this role.');
        return;
      }

      const { error: insertErr } = await supabase.from('applications').insert({
        job_id: jobId,
        applicant_id: me.id,
        applied_at: new Date().toISOString(),
      });

      if (insertErr) {
        console.error(insertErr);
        Alert.alert('Application failed', 'Please try again.');
        return;
      }

      setAlreadyAppliedJobIds((prev) =>
        prev.includes(jobId) ? prev : [...prev, jobId]
      );
      Alert.alert('Applied', 'Your profile has been shared with the poster.');
    } catch (e: any) {
      console.error('applyToJob error', e);
      Alert.alert('Application failed', e?.message ?? 'Unexpected error.');
    } finally {
      setApplyLoadingJobId(null);
    }
  };

  /* ---------- AUTH / CHAT ---------- */

  const handleLogout = async () => {
    try {
      setSigningOutFlag(true);
      clearAuthRoutingFlags();

      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.history.replaceState(null, "", "/signin");
      }

      const { error } = await supabase.auth.signOut();
      if (error) {
        setSigningOutFlag(false);
        Alert.alert('Logout Failed', error.message);
        return;
      }

      clearAuthRoutingFlags();
    } catch (e: any) {
      setSigningOutFlag(false);
      Alert.alert('Logout Failed', e?.message || 'Failed to sign out.');
    }
  };

  const copyCreativeProtocolLink = async () => {
  if (!publicProfileUrl) {
    Alert.alert("Unavailable", "Public link is not ready yet.");
    return;
  }

  await Clipboard.setStringAsync(publicProfileUrl);
  Alert.alert("Copied", "Portfolio has been copied.");
};

const previewCreativeProtocolLink = () => {
  if (!profile?.public_slug) {
    Alert.alert("Unavailable", "Public link is not ready yet.");
    return;
  }

  navigation.navigate("PublicProfile", { slug: profile.public_slug });
};

  const startOneToOneChat = async () => {
        if (!currentUserId) {
      promptSignIn("Create an account or sign in to message users.");
      return;
    }
    if (!profile) return;
    try {
      setStartingChat(true);
      const {
        data: { user: me },
      } = await supabase.auth.getUser();
      if (!me) throw new Error('Not authenticated.');

      const { data: candidates } = await supabase
        .from('conversations')
        .select('id, participant_ids, is_group')
        .eq('is_group', false)
        .contains('participant_ids', [me.id, profile.id]);

      let conversationId: string | undefined = candidates?.find(
        (c: any) =>
          Array.isArray(c.participant_ids) &&
          c.participant_ids.length === 2 &&
          c.participant_ids.includes(me.id) &&
          c.participant_ids.includes(profile.id)
      )?.id;

      if (!conversationId) {
        const { data: created, error: createErr } = await supabase
          .from('conversations')
          .insert({
            is_group: false,
            is_city_group: false,
            participant_ids: [me.id, profile.id],
            label: null,
            last_message_content: null,
            last_message_sent_at: null,
          })
          .select('id')
          .single();

        if (createErr) throw createErr;
        conversationId = created.id;
      }

      openChat({
        conversationId,
        peerUser: {
          id: profile.id,
          full_name: profile.full_name,
          avatar_url: profile.avatar_url,
        },
      });
    } catch (e: any) {
      Alert.alert('Could not start chat', e?.message ?? 'Unexpected error.');
    } finally {
      setStartingChat(false);
    }
  };
 const openShowreel = async (row: ShowreelRow) => {
    try {
      if (showreelModalCleanupRef.current) {
        clearTimeout(showreelModalCleanupRef.current);
        showreelModalCleanupRef.current = null;
      }

      const playbackUrl =
        row.url ||
        (row.file_path
          ? supabase.storage.from(SHOWREEL_BUCKET).getPublicUrl(row.file_path).data.publicUrl
          : '');

      if (!playbackUrl && !row.file_path) {
        Alert.alert('Still preparing', 'This showreel is still being prepared. Please try again in a moment.');
        return;
      }

      void pauseAllExcept(PAUSE_NONE_ID);
      setActiveShowreel({ ...row, url: playbackUrl || row.url });
      setShowreelPlaybackKey((key) => key + 1);
      setShowreelModalOpen(true);
    } catch (e) {
      console.warn("openShowreel failed:", e);
    }
  };

  const closeShowreelModal = async () => {
  try {
    await pauseAllExcept(PAUSE_NONE_ID);
  } catch {}
  setShowreelModalOpen(false);

  if (showreelModalCleanupRef.current) {
    clearTimeout(showreelModalCleanupRef.current);
  }

  showreelModalCleanupRef.current = setTimeout(() => {
    setActiveShowreel(null);
    showreelModalCleanupRef.current = null;
  }, 260);
};
/* ---------- RENDERERS ---------- */

// ✅ Must be OUTSIDE renderHero so it can be used anywhere (including MAIN RENDER if needed)
const renderEditProfileCard = () => {
  const level = displayLevel || 1;
  const xp = displayXp || 0;
  const ringColor = getRingColorForLevel(level);
  const compactMobile = isMobileLike;
  const achievement = workshopAchievement;

  return (
    <View
  style={[
    styles.utilityCard,
    {
      marginTop: 0,
paddingVertical: compactMobile ? 9 : 4,
paddingHorizontal: compactMobile ? 10 : 0,
    },
  ]}
>
      <View style={styles.profileActionStack}>
        <View style={styles.profilePrimaryActions}>
        {isOwnProfile ? (
          <TouchableOpacity
            style={styles.profilePrimaryAction}
            onPress={() => setShowEditModal(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="create-outline" size={16} color="#000" />
            <Text style={styles.profilePrimaryActionText}>Edit Profile</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.profilePrimaryAction}
            onPress={startOneToOneChat}
            disabled={startingChat}
            activeOpacity={0.85}
          >
            {startingChat ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <>
                <Ionicons name="chatbubble-ellipses-outline" size={16} color="#000" />
                <Text style={styles.profilePrimaryActionText}>Message</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {!isOwnProfile && profile && (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={toggleProfileSupport}
            style={[
              styles.profileSecondaryAction,
              isSupporting && styles.profileSecondaryActionActive,
              isLight && {
                backgroundColor: isSupporting ? COLORS.cardAlt : COLORS.card,
                borderColor: isSupporting ? COLORS.primary : COLORS.borderStrong,
              },
            ]}
          >
            <Ionicons
              name={isSupporting ? "checkmark-circle-outline" : "star-outline"}
              size={15}
              color={isSupporting ? COLORS.primary : COLORS.textPrimary}
            />
            <Text style={[styles.profileSecondaryActionText, { color: isSupporting ? COLORS.primary : COLORS.textPrimary }]}>
              {isSupporting ? "Supporting" : "Support"}
            </Text>
          </TouchableOpacity>
        )}
        </View>

        {!isOwnProfile && profile && (
          <View style={styles.profileSafetyActions}>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={reportProfile}
              style={styles.profileSafetyAction}
            >
              <Ionicons name="flag-outline" size={14} color={COLORS.textSecondary} />
              <Text style={styles.profileSafetyActionText}>Report</Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.85}
              onPress={blockProfileUser}
              style={[styles.profileSafetyAction, hasBlockedProfile && styles.profileSafetyActionBlocked]}
            >
              <Ionicons
                name="ban-outline"
                size={14}
                color={hasBlockedProfile ? COLORS.danger : COLORS.textSecondary}
              />
              <Text
                style={[
                  styles.profileSafetyActionText,
                  hasBlockedProfile && { color: COLORS.danger },
                ]}
              >
                {hasBlockedProfile ? "Blocked" : "Block"}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <View style={{ height: compactMobile ? 0 : 8 }} />
      {achievement ? (
        <View style={styles.profileAchievementMeta}>
          <Text
            style={[styles.profileAchievementTitle, { color: achievement.color }]}
            numberOfLines={2}
          >
            {achievement.badgeTitle}
          </Text>
          <Text style={[styles.profileAchievementDetail, { color: COLORS.textSecondary }]} numberOfLines={1}>
            {achievement.detail}
          </Text>
        </View>
      ) : (
        <View
    style={{
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: compactMobile ? 7 : 10,
      flexWrap: "wrap",
    }}
  >
        <Text
          style={{
            color: ringColor,
            fontSize: compactMobile ? 10 : 11,
            fontFamily: FONT_OBLIVION,
            letterSpacing: 1,
            textTransform: "uppercase",
            fontWeight: "700",
          }}
        >
          Lv {level}
        </Text>

        <View
          style={{
            width: 3,
            height: 3,
            borderRadius: 2,
            backgroundColor: COLORS.textSecondary,
            opacity: 0.6,
          }}
        />

        <Text
          style={{
            color: COLORS.textSecondary,
            fontSize: compactMobile ? 10 : 11,
            fontFamily: FONT_OBLIVION,
            letterSpacing: 0.7,
            textTransform: "uppercase",
          }}
        >
          {xp} XP
        </Text>

        <View
          style={{
            width: 3,
            height: 3,
            borderRadius: 2,
            backgroundColor: COLORS.textSecondary,
            opacity: 0.6,
          }}
        />

        <Text
          style={{
            color: COLORS.textSecondary,
            fontSize: compactMobile ? 10 : 11,
            fontFamily: FONT_OBLIVION,
            letterSpacing: 0.7,
            textTransform: "uppercase",
          }}
          numberOfLines={1}
        >
          {displayTitle || defaultTitle}
        </Text>
        </View>
      )}
    </View>
  );
};
const renderCreativeProtocolCard = () => {
  const compactMobile = isMobileLike;

  return (
    <View
  style={[
    styles.utilityTopBar,
    {
      paddingVertical: compactMobile ? 0 : 2,
paddingHorizontal: compactMobile ? 8 : 0,
    },
  ]}
>
       <View
  style={{
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  }}
>
  <TouchableOpacity
    onPress={copyCreativeProtocolLink}
    activeOpacity={0.85}
    style={compactMobile ? styles.utilitySingleLinkBtnMobile : styles.utilitySingleLinkBtn}
  >
    <Text
      style={
        compactMobile
          ? styles.utilitySingleLinkBtnTextMobile
          : styles.utilitySingleLinkBtnText
      }
    >
      Share Portfolio Link
    </Text>
  </TouchableOpacity>
</View>
    </View>
  );
};
const renderMobileBannerActions = () => {
  if (!isMobileLike) return null;

  const mobilePrimaryText = "#211A0E";
  const mobileGhostText = "rgba(244,239,230,0.86)";
  const mobileGhostMuted = "rgba(244,239,230,0.70)";
  const mobileDangerText = hasBlockedProfile ? COLORS.danger : mobileGhostMuted;

  return (
    <View style={styles.mobileBannerActions}>
      {isOwnProfile ? (
        <TouchableOpacity
          style={styles.mobileBannerPrimaryBtn}
          onPress={() => setShowEditModal(true)}
          activeOpacity={0.85}
        >
          <Ionicons name="create-outline" size={12} color={mobilePrimaryText} />
          <Text style={styles.mobileBannerPrimaryBtnText}>Edit Profile</Text>
        </TouchableOpacity>
      ) : (
        <>
          <TouchableOpacity
            style={styles.mobileBannerPrimaryBtn}
            onPress={startOneToOneChat}
            disabled={startingChat}
            activeOpacity={0.85}
          >
            {startingChat ? (
              <ActivityIndicator color={mobilePrimaryText} size="small" />
            ) : (
              <>
                <Ionicons name="chatbubble-ellipses-outline" size={12} color={mobilePrimaryText} />
                <Text style={styles.mobileBannerPrimaryBtnText} numberOfLines={1}>Message</Text>
              </>
            )}
          </TouchableOpacity>

                    {profile && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={toggleProfileSupport}
              style={[
                styles.mobileBannerGhostBtn,
                isSupporting && styles.mobileBannerGhostBtnActive,
              ]}
            >
              <Ionicons
                name={isSupporting ? "checkmark-circle-outline" : "star-outline"}
                size={11}
                color={isSupporting ? COLORS.primary : mobileGhostText}
              />
              <Text
                style={[styles.mobileBannerGhostBtnText, { color: isSupporting ? COLORS.primary : mobileGhostText }]}
                numberOfLines={1}
              >
                {isSupporting ? "Supporting" : "Support"}
              </Text>
            </TouchableOpacity>
          )}

          {profile && (
            <>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={reportProfile}
                style={styles.mobileBannerGhostBtn}
              >
                <Ionicons name="flag-outline" size={11} color={mobileGhostMuted} />
                <Text style={[styles.mobileBannerGhostBtnText, { color: mobileGhostMuted }]} numberOfLines={1}>Report</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={blockProfileUser}
                style={[styles.mobileBannerGhostBtn, hasBlockedProfile && styles.mobileBannerDangerBtn]}
              >
                <Ionicons
                  name="ban-outline"
                  size={11}
                  color={mobileDangerText}
                />
                <Text style={[styles.mobileBannerGhostBtnText, { color: mobileDangerText }]} numberOfLines={1}>
                  {hasBlockedProfile ? "Blocked" : "Block"}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </>
      )}
    </View>
  );
};

// ✅ Extract About/Streaks into its own renderer so it can show on BOTH web + mobile
const renderAboutStreaksCard = () => {
  const hasBio = !!bio?.trim()?.length;
  const hasSideRoles = sideRoles.length > 0;
  const showBioDetails = hasBio || hasSideRoles || isOwnProfile;

  return (
  <View
    style={[
      styles.aboutCard,
      {
        marginTop: 0,
paddingHorizontal: isMobileLike ? 4 : 0,
      },
    ]}
  >

      {/* ✅ Streaks live INSIDE About */}
      <View style={{ marginTop: isMobileLike ? 0 : 2 }}>
        {(() => {
          const s = streakLoading ? 0 : Math.max(0, Number(streak || 0));
          const fullYears = Math.floor(s / 12);
          const remainder = s % 12;
          const yearsToShow = Math.max(1, fullYears + 1);

          return Array.from({ length: yearsToShow }).map((_, idx) => {
            const yearNumber = idx + 1;
            const isCompletedYear = yearNumber <= fullYears;
            const monthsThisYear = isCompletedYear ? 12 : remainder;
            const pct = streakLoading ? 0 : Math.min((monthsThisYear / 12) * 100, 100);

            return (
              <View
  key={`year-${yearNumber}`}
  style={{ marginTop: idx === 0 ? 0 : isMobileLike ? 8 : 12 }}
>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 6,
                    flexWrap: "wrap",
                    rowGap: 6,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      color: COLORS.textSecondary,
                      letterSpacing: 1.4,
                      fontFamily: FONT_OBLIVION,
                    }}
                  >
                    Filmmaking consistency
                  </Text>

                  <Text
                    style={{
                      fontSize: isMobileLike ? 9 : 11,
                      color: COLORS.textSecondary,
                      letterSpacing: 1.4,
                      fontFamily: FONT_OBLIVION,
                      opacity: 0.9,
                      marginLeft: 8,
                    }}
                  >
                    • Year {yearNumber}
                  </Text>

                  {isCompletedYear ? (
                    <View
                      style={{
                        marginLeft: 10,
                        paddingHorizontal: isMobileLike ? 8 : 10,
paddingVertical: isMobileLike ? 3 : 4,
                        borderRadius: 6,
                        backgroundColor: "rgba(198,166,100,0.18)",
                        borderWidth: 1,
                        borderColor: "rgba(198,166,100,0.35)",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: isMobileLike ? 9 : 11,
                          color: "#C6A664",
                          letterSpacing: 1.2,
                          fontFamily: FONT_OBLIVION,
                        }}
                      >
                        COMPLETED
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* ✅ Ensure rail has a real width on web */}
                <View style={[block.progressRail, { width: "100%" }]}>
                  <View style={[block.progressFill, { width: `${pct}%` }]} />
                </View>

                <Text
                  style={{
  marginTop: isMobileLike ? 4 : 6,
  fontSize: isMobileLike ? 11 : 12,
  color: COLORS.textPrimary,
  fontFamily: FONT_OBLIVION,
  textAlign: "center",
}}
                >
                  {streakLoading ? "—" : `${monthsThisYear} / 12 months`}
                </Text>
              </View>
            );
          });
        })()}
      </View>

      {showBioDetails ? (
        <>
          {/* ✅ Subtle divider so streak feels “attached” */}
          <View
            style={{
              height: 1,
              backgroundColor: COLORS.border,
              opacity: 0.45,
              marginTop: isMobileLike ? 8 : 12,
              marginBottom: isMobileLike ? 8 : 10,
            }}
          />

          {/* ✅ Bio */}
          <Text
            style={[
              styles.aboutBody,
              { color: COLORS.textSecondary },
              isMobileLike ? { lineHeight: 16, fontSize: 12 } : null,
            ]}
          >
            {bio || "—"}
          </Text>

          {hasSideRoles && (
            <Text
              style={[
                styles.aboutBody,
                { color: COLORS.textSecondary },
                { marginTop: isMobileLike ? 6 : 8, fontStyle: "italic" },
                isMobileLike ? { fontSize: 12, lineHeight: 16 } : null,
              ]}
            >
              <Text style={{ color: COLORS.textPrimary, fontWeight: "900" }}>Side roles: </Text>
              {sideRoles.map((role) => translateRoleLabel(role)).join(", ")}
            </Text>
          )}
        </>
      ) : null}
      {isMobileLike ? (
  <View style={{ marginTop: 10, alignItems: "flex-start" }}>
    {renderCreativeProtocolCard()}
  </View>
) : null}
    </View>
  );
};

const renderHero = () => {
  const avatarUrl = image || profile?.avatar_url || null;
const heroBg = avatarUrl;

  const bannerColor = displayBannerColor || GOLD;
  const level = displayLevel || 1;
  const xp = displayXp || 0;
  const title = (displayTitle || defaultTitle).toUpperCase();
  const ringColor = getRingColorForLevel(level);
  const achievement = workshopAchievement;
  const achievementColor = achievement?.color || ringColor;
  const avatarRingColor = ringColor;
  const mobileAchievementTitle = achievement
    ? `${achievement.pathLabel} Ch. ${achievement.chapterNumber} Complete`
    : "";

  // ✅ Better mobile + mobile-web spacing: clamp hero width + consistent side padding
  const heroPad = isMobileLike ? 0 : 20;
const heroMaxW = isMobileLike ? contentMaxWidth : "100%";

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
            // ✅ smaller gap between image and edit card on mobile/mobile-web
            gap: isMobileLike ? 8 : 18,
            alignItems: "stretch",
          },
        ]}
      >
        {/* LEFT SIDE */}
        <View
          style={[
            styles.heroLeft,
            isMobileLike ? styles.heroLeftMobile : styles.heroLeftDesktop,
            isMobileLike ? { width: "100%", flex: 0 } : null, // ✅ key line
          ]}
        >
          <ImageBackground
            source={heroBg ? { uri: heroBg } : undefined}
            style={[
              styles.heroImage,
              isMobileLike ? styles.heroImageMobile : styles.heroImageDesktop,
              // ✅ Avoid weird stretching on web-mobile
              isMobileLike ? { width: "100%" } : null,
              // ✅ ensures the bottom bar takes up real space (prevents overlap issues)
              { paddingBottom: isMobileLike ? 12 : 16 },
            ]}
            imageStyle={[styles.heroImageInner, { backgroundColor: bannerColor }]}
          >
            <LinearGradient
              colors={["rgba(0,0,0,0.2)", "rgba(0,0,0,0.65)", "rgba(0,0,0,0.95)"]}
              style={styles.heroGradient}
            />

            {renderMobileBannerActions()}

            {/* ✔ ROLE + NAME BLOCK */}
            {!!mainRoleName && (
              <View
                style={[
                  styles.roleWrap,
                  // ✅ keep clear space for avatar bottom bar
                  isMobileLike
                    ? { paddingHorizontal: 14, paddingBottom: 96 }
                    : { paddingBottom: 98 },
                ]}
              >
                <Text
  style={[
    styles.heroRoleBond,
    isMobileLike ? styles.heroRoleBondMobile : styles.heroRoleBondDesktop,
  ]}
  numberOfLines={1}
>
  {translateRoleLabel(mainRoleName).toUpperCase()}
</Text>

<Text
  style={[
    styles.heroIdentityBond,
    isMobileLike ? styles.heroIdentityBondMobile : styles.heroIdentityBondDesktop,
  ]}
  numberOfLines={2}
>
  {profile?.full_name || "—"}
  {cityName ? `  •  ${cityName}` : ""}
</Text>

                {/* ✅ MOBILE: counts centered directly under name/city */}
                {isMobileLike && (
                  <View style={{ marginTop: 14, alignItems: "center" }}>
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "center",
                        // ✅ closer spacing on mobile
                        gap: 14,
                      }}
                    >
                      <TouchableOpacity
                        onPress={() => {
  setConnectionsTab("supporters");
  setConnectionsModalVisible(true);
}}
                        style={{
                          alignItems: "center",
                          minWidth: 92,
                          paddingVertical: 7,
                          paddingHorizontal: 10,
                        }}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={{
                            color: "#FFFFFF",
                            fontWeight: "900",
                            fontFamily: FONT_OBLIVION,
                            letterSpacing: 1,
                            fontSize: 14,
                            textShadowColor: "rgba(0,0,0,0.55)",
                            textShadowRadius: 6,
                          }}
                        >
                          {supportersCount}
                        </Text>
                        <Text
                          style={{
                            color: "rgba(255,255,255,0.82)",
                            fontSize: 12,
                            fontFamily: FONT_OBLIVION,
                            textShadowColor: "rgba(0,0,0,0.55)",
                            textShadowRadius: 6,
                          }}
                        >
                          Supporters
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => {
  setConnectionsTab("supporting");
  setConnectionsModalVisible(true);
}}
                        style={{
                          alignItems: "center",
                          minWidth: 92,
                          paddingVertical: 7,
                          paddingHorizontal: 10,
                        }}
                        activeOpacity={0.85}
                      >
                        <Text
                          style={{
                            color: "#FFFFFF",
                            fontWeight: "900",
                            fontFamily: FONT_OBLIVION,
                            letterSpacing: 1,
                            fontSize: 14,
                            textShadowColor: "rgba(0,0,0,0.55)",
                            textShadowRadius: 6,
                          }}
                        >
                          {supportingCount}
                        </Text>
                        <Text
                          style={{
                            color: "rgba(255,255,255,0.82)",
                            fontSize: 12,
                            fontFamily: FONT_OBLIVION,
                            textShadowColor: "rgba(0,0,0,0.55)",
                            textShadowRadius: 6,
                          }}
                        >
                          Supporting
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </View>
            )}

            {/* ✅ Bottom bar: avatar (+ counts on desktop only) */}
            <View
              style={[
                styles.heroBottomBar,
                // ✅ NOT absolute here — prevents the next sections overlapping
                {
                  position: "relative",
                  left: undefined,
                  right: undefined,
                  bottom: undefined,
                  width: "100%",
                  paddingHorizontal: isMobileLike ? 14 : 18,
                  paddingTop: 6,
                  flexDirection: "row",
                  alignItems: "flex-end",
                  justifyContent: isMobileLike ? "flex-start" : "space-between",
                  gap: 16,
                },
              ]}
            >
              {/* Avatar */}
              <View style={{ alignItems: "center" }}>
                <View style={styles.avatarAchievementFrame}>
                  <LinearGradient
                    colors={[avatarRingColor, avatarRingColor]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[styles.avatarRing, { borderColor: avatarRingColor }]}
                  >
                    <View style={[styles.avatarInner, isMobileLike && styles.avatarInnerMobile, isCompact && styles.avatarInnerCompact]}>
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
                {achievement && isMobileLike ? (
                  <View style={styles.mobileAchievementMeta}>
                    <Text style={[styles.mobileAchievementTitle, { color: achievementColor }]} numberOfLines={2}>
                      {mobileAchievementTitle}
                    </Text>
                    <Text style={styles.mobileAchievementDetail} numberOfLines={1}>
                      {achievement.detail}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* ✅ DESKTOP ONLY: counts stay here (UPDATED: centered + tighter) */}
              {!isMobileLike && (
                <View style={{ marginTop: 14, alignItems: "center", justifyContent: "center" }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 18,
                    }}
                  >
                    <TouchableOpacity
  onPress={() => {
    setConnectionsTab("supporters");
    setConnectionsModalVisible(true);
  }}
  style={{
    alignItems: "center",
    minWidth: 92,
    paddingVertical: 7,
    paddingHorizontal: 10,
  }}
  activeOpacity={0.85}
>
                      <Text
                        style={{
                          color: "#FFFFFF",
                          fontWeight: "900",
                          fontFamily: FONT_OBLIVION,
                          letterSpacing: 1,
                          fontSize: 14, // ✅ slightly smaller so it sits nicely under the name
                          textShadowColor: "rgba(0,0,0,0.55)",
                          textShadowRadius: 6,
                        }}
                      >
                        {supportersCount}
                      </Text>
                      <Text
                        style={{
                          color: "rgba(255,255,255,0.82)",
                          fontSize: 12,
                          fontFamily: FONT_OBLIVION,
                          textShadowColor: "rgba(0,0,0,0.55)",
                          textShadowRadius: 6,
                        }}
                      >
                        Supporters
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
  onPress={() => {
    setConnectionsTab("supporting");
    setConnectionsModalVisible(true);
  }}
  style={{
    alignItems: "center",
    minWidth: 92,
    paddingVertical: 7,
    paddingHorizontal: 10,
  }}
  activeOpacity={0.85}
>
                      <Text
                        style={{
                          color: "#FFFFFF",
                          fontWeight: "900",
                          fontFamily: FONT_OBLIVION,
                          letterSpacing: 1,
                          fontSize: 14,
                          textShadowColor: "rgba(0,0,0,0.55)",
                          textShadowRadius: 6,
                        }}
                      >
                        {supportingCount}
                      </Text>
                      <Text
                        style={{
                          color: "rgba(255,255,255,0.82)",
                          fontSize: 12,
                          fontFamily: FONT_OBLIVION,
                          textShadowColor: "rgba(0,0,0,0.55)",
                          textShadowRadius: 6,
                        }}
                      >
                        Supporting
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          </ImageBackground>
        </View>

        {/* RIGHT SIDE */}
<View
  style={[
    styles.heroRight,
    isMobileLike ? { marginTop: 0, width: "100%", flex: 0 } : null,
  ]}
>
  {!isMobileLike ? (
  <View style={styles.webInfoRail}>
    {renderEditProfileCard()}

    <View
      style={{
        height: 1,
        backgroundColor: COLORS.border,
        opacity: 0.35,
        marginVertical: 14,
      }}
    />

    {renderCreativeProtocolCard()}

    <View
      style={{
        height: 1,
        backgroundColor: COLORS.border,
        opacity: 0.35,
        marginVertical: 14,
      }}
    />

    {renderAboutStreaksCard()}
  </View>
) : null}
</View>
      </View>

{isMobileLike ? (
  <View
    style={{
      width: "100%",
      maxWidth: heroMaxW,
      alignSelf: "center",
      marginTop: 2,
    }}
  >
    {renderAboutStreaksCard()}
  </View>
) : null}
    </View>
  );
};

const renderFeaturedFilm = () => {
  const primaryRow =
    showreels.find((r) => r.is_primary) ||
    showreels[0] ||
    null;

  if (!primaryRow) return null;

  const primaryPlayable = !!(primaryRow.url || primaryRow.file_path);
  const secondaryRows = showreels
    .filter((r) => r.id !== primaryRow.id)
    .slice(0, 2);

  const maxW = isMobileLike ? contentMaxWidth : SHOWREEL_MAX_W;
  const secondaryCols = 2;
  const secondaryGap = isMobileLike ? 10 : 12;
const availableWidth = maxW;
const secondaryTileW = Math.floor((availableWidth - secondaryGap) / 2) - (isMobileLike ? 2 : 0);
  const secondaryTileH = isMobileLike
  ? Math.floor(secondaryTileW * 0.64)
  : Math.floor(secondaryTileW * (9 / 16));
  const primaryPlaybackUrl =
    primaryRow.url ||
    (primaryRow.file_path
      ? supabase.storage.from(SHOWREEL_BUCKET).getPublicUrl(primaryRow.file_path).data.publicUrl
      : '');

  return (
    <View style={[block.section, { alignItems: "center" }]}>
      <Text
  style={[
    block.sectionTitleCentered,
    { color: COLORS.textPrimary },
    isMobileLike && {
      fontSize: 12,
      letterSpacing: 2.2,
      marginBottom: 12,
    },
  ]}
>
  {primaryRow.category ? `${primaryRow.category} Showreel` : "Showreel"}
</Text>

      <View
        style={[
          block.mediaCard,
          {
            width: '100%',
            maxWidth: maxW,
            alignSelf: 'center',
            padding: 0,
            overflow: 'hidden',
            backgroundColor: '#000',
          },
        ]}
      >
        {primaryPlayable ? (
          <ShowreelVideoInline
            key={`primary_showreel_${primaryRow.id}`}
            playerId={`primary_showreel_${primaryRow.id}`}
            filePathOrUrl={primaryPlaybackUrl || primaryRow.file_path}
            width={maxW}
            maxWidth={maxW}
            autoPlay={false}
            posterUri={primaryRow.thumbnail_url}
          />
        ) : (
          <View
            style={{
              width: '100%',
              aspectRatio: 16 / 9,
              backgroundColor: '#000',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Ionicons name="videocam" size={34} color={COLORS.textSecondary} />
            <Text
              style={{
                marginTop: 8,
                color: COLORS.textSecondary,
                fontFamily: FONT_OBLIVION,
                fontSize: 12,
              }}
            >
              Preparing showreel
            </Text>
          </View>
        )}
      </View>

      {secondaryRows.length > 0 && (
        <View
          style={{
            width: "100%",
            maxWidth: maxW,
            alignSelf: "center",
            marginTop: 14,
          }}
        >
          <View
  style={{
    flexDirection: "row",
    flexWrap: "wrap",
    gap: secondaryGap,
    marginTop: 8,
    justifyContent: "space-between",
  }}
>
            {secondaryRows.map((r) => {
              const secondaryPlayable = !!(r.url || r.file_path);
              const secondaryPlaybackUrl =
                r.url ||
                (r.file_path
                  ? supabase.storage.from(SHOWREEL_BUCKET).getPublicUrl(r.file_path).data.publicUrl
                  : '');
              const secondaryLabel = r.category ? `${r.category} Showreel` : 'Showreel';

              return (
                <View
                  key={r.id}
                  style={{
                    width: secondaryTileW,
                  }}
                >
                  <Text
                    style={{
                      color: COLORS.textPrimary,
                      fontSize: isMobileLike ? 10 : 12,
                      fontFamily: FONT_OBLIVION,
                      fontWeight: "900",
                      letterSpacing: isMobileLike ? 0.5 : 0.8,
                      textTransform: "uppercase",
                      marginBottom: 7,
                    }}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.82}
                  >
                    {secondaryLabel}
                  </Text>

                  <View
                    style={[
                      block.mediaCard,
                      {
                        padding: 0,
                        overflow: "hidden",
                        backgroundColor: "#000",
                      },
                    ]}
                  >
                    {secondaryPlayable ? (
                      <ShowreelVideoInline
                        key={`secondary_showreel_${r.id}`}
                        playerId={`secondary_showreel_${r.id}`}
                        filePathOrUrl={secondaryPlaybackUrl || r.file_path}
                        width={secondaryTileW}
                        maxWidth={secondaryTileW}
                        maxHeight={secondaryTileH}
                        autoPlay={false}
                        posterUri={r.thumbnail_url}
                      />
                    ) : (
                      <View
                        style={{
                          width: "100%",
                          height: secondaryTileH,
                          backgroundColor: "#000",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Ionicons name="videocam" size={24} color={COLORS.textSecondary} />
                      </View>
                    )}
                  </View>
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
  <View style={[block.mediaRowCard, { backgroundColor: COLORS.card, borderColor: COLORS.border }]}>
    <View
      style={[
        block.mediaIcon,
        { backgroundColor: isLight ? COLORS.backgroundAlt : "#0C0C0C", borderColor: COLORS.border },
      ]}
    >
      <Ionicons name="musical-notes-outline" size={20} color={COLORS.textSecondary} />
    </View>

    <View style={{ flex: 1 }}>
      <Text style={[block.mediaRowTitle, { color: COLORS.textPrimary }]} numberOfLines={1}>
        {item.title ?? "Audio"}
      </Text>
      <View
        style={[
          block.progressRail,
          { backgroundColor: isLight ? COLORS.backgroundAlt : "#0F0F0F", borderColor: COLORS.border },
        ]}
      >
        <View style={[block.progressFill, { width: playingId === item.id ? "35%" : "0%" }]} />
      </View>
    </View>

    <TouchableOpacity onPress={() => togglePlayAudio(item)} style={block.rowBtn}>
      <Text style={block.rowBtnText}>{playingId === item.id ? "Pause" : "Play"}</Text>
    </TouchableOpacity>

    {isOwnProfile && (
      <TouchableOpacity
        onPress={() => deletePortfolioItem(item.id)}
        style={[
          block.rowBtnGhost,
          { backgroundColor: isLight ? COLORS.card : "#0C0C0C", borderColor: COLORS.border },
        ]}
      >
        <Text style={[block.rowBtnGhostText, { color: COLORS.textPrimary }]}>Delete</Text>
      </TouchableOpacity>
    )}
  </View>
);

const PdfTile = ({ item }: { item: PortfolioItem }) => (
  <View style={[block.mediaRowCard, { backgroundColor: COLORS.card, borderColor: COLORS.border }]}>
    <View
      style={[
        block.mediaIcon,
        { backgroundColor: isLight ? COLORS.backgroundAlt : "#0C0C0C", borderColor: COLORS.border },
      ]}
    >
      <Ionicons name="document-text-outline" size={20} color={COLORS.textSecondary} />
    </View>

    <Text style={[block.mediaRowTitle, { flex: 1, color: COLORS.textPrimary }]} numberOfLines={1}>
      {item.title ?? "PDF"}
    </Text>

    <TouchableOpacity onPress={() => Linking.openURL(item.url)} style={block.rowBtn}>
      <Text style={block.rowBtnText}>Open</Text>
    </TouchableOpacity>

    {isOwnProfile && (
      <TouchableOpacity
        onPress={() => deletePortfolioItem(item.id)}
        style={[
          block.rowBtnGhost,
          { backgroundColor: isLight ? COLORS.card : "#0C0C0C", borderColor: COLORS.border },
        ]}
      >
        <Text style={[block.rowBtnGhostText, { color: COLORS.textPrimary }]}>Delete</Text>
      </TouchableOpacity>
    )}
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
  const usable = isMobileLike
  ? contentMaxWidth
  : Math.min(width, PAGE_MAX) - horizontalPad * 2;
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
          <Text
  style={[
    block.sectionTitleCentered,
    { color: COLORS.textPrimary },
    isMobileLike && {
      fontSize: 12,
      letterSpacing: 2.2,
      marginBottom: 12,
    },
  ]}
>
  Portfolio
</Text>
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

                  {isOwnProfile && (
                    <TouchableOpacity
                      style={block.closeDot}
                      onPress={() => deletePortfolioItem(item.id)}
                      accessibilityLabel="Delete"
                    >
                      <Ionicons name="close" size={14} color="#000" />
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>
      )}

      {auds.length > 0 && (
        <View style={block.section}>
          <Text style={[block.h3Centered, { color: COLORS.textPrimary }]}>Audio</Text>
          <View style={{ gap: 10 }}>
            {auds.map((item) => (
              <AudioTile key={item.id} item={item} />
            ))}
          </View>
        </View>
      )}

      {pdfs.length > 0 && (
        <View style={block.section}>
          <Text style={[block.h3Centered, { color: COLORS.textPrimary }]}>PDF</Text>
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
        <Text
  style={[
    block.sectionTitleCentered,
    { color: COLORS.textPrimary },
    isMobileLike && {
      fontSize: 12,
      letterSpacing: 2.2,
      marginBottom: 12,
    },
  ]}
>
  Submissions
</Text>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!visibleOwnedSubmissions.length && !visibleWorkedOnSubmissions.length) return null;

  const cols = isCompact || isMobileLike ? 2 : width < 1100 ? 3 : 4;
  const usable = isMobileLike
    ? contentMaxWidth
    : Math.min(width, PAGE_MAX) - horizontalPad * 2;
  const tileW = Math.floor((usable - GRID_GAP * (cols - 1)) / cols);
  const tileH = Math.floor(tileW * (9 / 16));

  const watchPagePadX = isMobileLike ? 0 : 22;
  const watchPagePadTop = isMobileLike
    ? Math.max(insets.top, 0)
    : Math.max(insets.top + 8, 18);
  const hasWatchSideRail =
    !isMobileLike &&
    !!activeSubmission &&
    visibleSubmissions.some((submission) => submission.id !== activeSubmission.id);
  const watchReservedRailW = !isMobileLike
    ? Math.min(520, Math.max(340, Math.floor(width * 0.26)))
    : 0;
  const watchSideRailW = hasWatchSideRail ? watchReservedRailW : 0;
  const watchRailGap = hasWatchSideRail ? 20 : 0;
  const watchDesktopMaxH = Math.min(windowHeight * 0.7, 720);
  const watchDesktopMaxW = Math.floor(watchDesktopMaxH * (16 / 9));
  const watchDesktopReserveW = watchReservedRailW > 0 ? watchReservedRailW + 20 : 0;
  const watchDesktopAvailableW = Math.max(
    360,
    width - watchPagePadX * 2 - watchDesktopReserveW
  );
  const watchMainW = isMobileLike
    ? Math.max(280, width)
    : Math.max(360, Math.min(watchDesktopAvailableW, watchDesktopMaxW));
  const watchMediaW = Math.floor(watchMainW);
  const watchMediaH = Math.floor(watchMediaW * (9 / 16));
  const watchMediaMaxH = Math.floor(
    isMobileLike ? Math.min(windowHeight * 0.38, 360) : watchDesktopMaxH
  );
  const watchSurface = isLight ? "#FAF7F1" : "#000000";

  const renderSubmissionGrid = (
    title: string,
    items: SubmissionRow[],
    showCreditRole = false
  ) => {
    if (!items.length) return null;

    return (
      <View style={block.section}>
        <Text style={[block.sectionTitleCentered, { color: COLORS.textPrimary }]}>{title}</Text>

        <View style={[block.grid, { gap: GRID_GAP }]}>
          {items.map((s) => {
            const yt = s.youtube_url ? ytThumb(s.youtube_url) : null;
            const mp4Thumb = s.thumbnail_url || null;
            const thumb = yt || mp4Thumb;

            return (
              <Pressable
                key={s.id}
                onPress={() => {
                  void openSubmissionModal(s);
                }}
                style={({ pressed }) => [
                  { width: tileW },
                  pressed && { opacity: 0.84 },
                ]}
              >
                <View style={[styles.profileSubmissionTile, { height: tileH }]}>
                  {thumb ? (
                    <Image
                      source={{ uri: thumb }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={styles.profileSubmissionThumbFallback}>
                      <Ionicons name="videocam" size={22} color={COLORS.textSecondary} />
                    </View>
                  )}

                  <View style={styles.profileSubmissionQualityBadge}>
                    <Text style={styles.profileSubmissionQualityText}>4K</Text>
                  </View>

                  <View style={styles.profileSubmissionTileOverlay}>
                    <Text style={styles.profileSubmissionTileTitle} numberOfLines={1}>
                      {s.title || "Untitled"}
                    </Text>
                    {showCreditRole ? (
                      <Text style={styles.profileSubmissionTileMeta} numberOfLines={1}>
                        {s.collaboration_role || "Collaborator"}
                      </Text>
                    ) : null}
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  const activeCreator =
    activeSubmission?.users ||
    (activeSubmission?.user_id === profile?.id
      ? {
          id: profile.id,
          full_name: profile.full_name,
          avatar_url: profile.avatar_url,
        }
      : null);
  const activeCreatorId = activeCreator?.id || activeSubmission?.user_id || null;
  const activeCreatorIsCurrentUser = !!activeCreatorId && activeCreatorId === currentUserId;
  const activeCreatorSupportActive =
    !!activeCreatorId &&
    (activeCreatorId === profile?.id ? isSupporting : watchCreatorIsSupporting);
  const activeSubmissionVoteActive =
    !!activeSubmission?.id && submissionVotedIds.has(activeSubmission.id);
  const activeSubmissionVoteBusy =
    !!activeSubmission?.id && !!submissionVoteBusy[activeSubmission.id];
  const profileWatchName =
    activeCreator?.full_name || profile?.full_name || fullName || "Unknown creator";
  const profileWatchAvatar =
    activeCreator?.avatar_url ||
    (activeSubmission?.user_id === profile?.id ? image || profile?.avatar_url : null);
  const activeCreditRole = activeSubmission?.collaboration_role?.trim() || "";
  const activeCreatorMeta = (
    activeSubmission?.film_category ||
    activeSubmission?.category ||
    activeSubmission?.word ||
    (activeSubmission?.is_collaboration_credit
      ? activeCreditRole
        ? `Worked on as ${activeCreditRole}`
        : "Worked on"
      : "Film")
  ).toString();
  const activeSubmissionCollaborators =
    (((activeSubmission as any)?.collaborators || []) as SubmissionCollaborator[]);
  const profileSubmissionSuggestions = activeSubmission
    ? buildProfileUpNextQueue(activeSubmission, visibleSubmissions, {
        recentIds: recentSubmissionWatchIds,
        fallbackGenre:
          activeSubmission.film_category ||
          activeSubmission.category ||
          activeSubmission.word ||
          null,
        limit: 8,
      })
    : [];
  const autoplayNextProfileSubmission = () => {
    const next = profileSubmissionSuggestions[0];
    if (next) void openSubmissionModal(next);
  };
  const profileSoftSurface = isLight ? "#FFFDF8" : "#0B0B0B";
  const profileSubText = isLight ? "#62584B" : "rgba(216,210,200,0.62)";
  const profileWatchBorder = isLight ? "rgba(93,72,43,0.16)" : "rgba(255,255,255,0.08)";
  const scrollSubmissionComposerIntoView = () => {
    if (Platform.OS !== 'android') return;

    setTimeout(() => {
      submissionWatchScrollRef.current?.scrollToEnd({ animated: true });
    }, 90);
  };
  const openSubmissionComments = (focusComposer = false) => {
    setSubmissionCommentsExpanded(true);
    scrollSubmissionComposerIntoView();
    if (focusComposer) {
      setTimeout(() => {
        submissionCommentInputRef.current?.focus();
      }, 60);
    }
  };

  const renderActiveSubmissionMedia = () => (
    <View
      style={[
        styles.profileWatchPlayerWrap,
        {
          backgroundColor: "#000",
          borderColor: isLight ? "transparent" : profileWatchBorder,
        },
      ]}
    >
        {activeSubmission ? (
          activeSubmission.youtube_url ? (
            <View
              style={{
                width: watchMediaW,
                height: watchMediaH,
                backgroundColor: "#000",
                overflow: "hidden",
              }}
            >
              <YoutubePlayer
                height={watchMediaH}
                width={watchMediaW}
                videoId={extractYoutubeId(activeSubmission.youtube_url) || undefined}
                play={true}
                webViewStyle={{ backgroundColor: "#000" }}
                webViewProps={{
                  allowsInlineMediaPlayback: true,
                  mediaPlaybackRequiresUserAction: false,
                  // @ts-ignore
                  allowsFullscreenVideo: true,
                }}
                initialPlayerParams={{ rel: false }}
                onChangeState={(state) => {
                  if (state === "ended") autoplayNextProfileSubmission();
                }}
              />
            </View>
          ) : activeSubmission.video_url || activeSubmission.video_path ? (
            <ShowreelVideoInline
              key={`submission_${activeSubmission.id}_${activeSubmission.video_url || activeSubmission.video_path || ""}`}
              playerId={`submission_${activeSubmission.id}`}
              filePathOrUrl={activeSubmission.video_url || activeSubmission.video_path || ""}
              width={watchMediaW}
              maxWidth={watchMediaW}
              maxHeight={watchMediaMaxH}
              alignSelf="flex-start"
              autoPlay={true}
              posterUri={activeSubmission.thumbnail_url}
              squareCorners
              loop={false}
              onPlaybackEnd={autoplayNextProfileSubmission}
            />
          ) : (
        <View
          style={[
            styles.profileWatchPlayerFallback,
            {
              width: watchMediaW,
              height: watchMediaH,
              backgroundColor: "#000",
            },
          ]}
        >
              {!!(
                activeSubmission?.mux_upload_id ||
                activeSubmission?.mux_asset_id ||
                activeSubmission?.mux_playback_id ||
                activeSubmission?.mux_status
              ) ? (
                <>
                  <View style={stylesShowreel.loadingBubble}>
                    <ActivityIndicator color={COLORS.primary} />
                  </View>
                  <Text
                    style={[
                      block.muted,
                      { color: COLORS.textSecondary, textAlign: "center", marginTop: 10 },
                    ]}
                  >
                    Video is still processing
                  </Text>
                </>
              ) : (
                <Text style={[block.muted, { color: COLORS.textSecondary, textAlign: "center" }]}>
                  No video found for this submission.
                </Text>
              )}
            </View>
          )
        ) : null}
    </View>
  );

  const renderSubmissionCommentsPanel = () => (
    <View
      style={[
        styles.profileCommentsPanel,
        {
          backgroundColor: profileSoftSurface,
          borderColor: COLORS.border,
        },
      ]}
    >
      <View style={[styles.profileCommentsHeader, { borderBottomColor: COLORS.border }]}>
        <View>
          <Text style={[styles.profileCommentsTitle, { color: COLORS.textPrimary }]}>Comments</Text>
          <Text style={[styles.profileCommentsSubtitle, { color: COLORS.textSecondary }]}>
            Shared with this film across Overlooked.
          </Text>
        </View>
        <View style={styles.profileCommentsHeaderActions}>
          {loadingComments ? <ActivityIndicator color={COLORS.primary} size="small" /> : null}
          <TouchableOpacity
            onPress={() => setSubmissionCommentsExpanded(false)}
            activeOpacity={0.85}
            style={[
              styles.profileCommentsCollapseBtn,
              {
                backgroundColor: isLight ? COLORS.backgroundAlt : "rgba(255,255,255,0.05)",
                borderColor: COLORS.border,
              },
            ]}
          >
            <Ionicons name="chevron-up" size={16} color={COLORS.textSecondary} />
          </TouchableOpacity>
        </View>
      </View>

      {loadingComments && comments.length === 0 ? (
        <View style={styles.profileCommentsLoading}>
          <ActivityIndicator color={COLORS.primary} />
        </View>
      ) : comments.length === 0 ? (
        <View style={styles.profileCommentsEmpty}>
          <Text style={[styles.profileCommentsEmptyTitle, { color: COLORS.textPrimary }]}>No comments yet</Text>
          <Text style={[styles.profileCommentsEmptyText, { color: COLORS.textSecondary }]}>
            Be the first to leave a note.
          </Text>
        </View>
      ) : (
        <ScrollView
          style={styles.profileCommentsList}
          contentContainerStyle={styles.profileCommentsListContent}
          showsVerticalScrollIndicator
          nestedScrollEnabled
        >
          {comments.map((comment) => {
            const user = comment.users || comment.user;
            const body = comment.comment || comment.content || "";
            return (
              <View
                key={comment.id}
                style={[
                  styles.profileCommentCard,
                  { backgroundColor: "transparent", borderColor: COLORS.border },
                ]}
              >
                <TouchableOpacity
                  onPress={() => {
                    void goToCommentUserProfile(user?.id || comment.user_id);
                  }}
                  activeOpacity={0.82}
                  style={styles.profileCommentAvatarTap}
                >
                  {user?.avatar_url ? (
                    <Image source={{ uri: user.avatar_url }} style={styles.profileCommentAvatar} />
                  ) : (
                    <View
                      style={[
                        styles.profileCommentAvatarFallback,
                        {
                          backgroundColor: isLight ? COLORS.backgroundAlt : "#111",
                          borderColor: COLORS.border,
                        },
                      ]}
                    >
                      <Text style={[styles.profileCommentAvatarText, { color: COLORS.textPrimary }]}>
                        {(user?.full_name || "U").slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
                <View style={styles.profileCommentBody}>
                  <View style={styles.profileCommentTopRow}>
                    <TouchableOpacity
                      onPress={() => {
                        void goToCommentUserProfile(user?.id || comment.user_id);
                      }}
                      activeOpacity={0.82}
                      style={styles.profileCommentNameTap}
                    >
                      <Text style={[styles.profileCommentName, { color: COLORS.textPrimary }]} numberOfLines={1}>
                        {user?.full_name || "Unknown"}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => {
                        void reportSubmissionComment(comment);
                      }}
                      activeOpacity={0.8}
                      style={[
                        styles.profileCommentReport,
                        { backgroundColor: "transparent" },
                      ]}
                    >
                      <Ionicons name="flag-outline" size={13} color={COLORS.textSecondary} />
                      <Text style={[styles.profileCommentReportText, { color: COLORS.textSecondary }]}>Report</Text>
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.profileCommentText, { color: COLORS.textSecondary }]}>{body}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      <Animated.View style={Platform.OS === 'android' ? submissionKeyboardLiftStyle : null}>
        <View style={[styles.profileCommentComposer, { borderTopColor: COLORS.border }]}>
          <TextInput
            ref={submissionCommentInputRef}
            value={commentText}
            onChangeText={setCommentText}
            placeholder={currentUserId ? "Add a comment..." : "Sign in to comment..."}
            placeholderTextColor={COLORS.textMuted}
            style={[
              styles.profileCommentInput,
              WEB_NO_OUTLINE,
              {
                backgroundColor: COLORS.input,
                borderColor: COLORS.border,
                color: COLORS.textPrimary,
              },
            ]}
            multiline
            maxLength={500}
            onFocus={() => {
              scrollSubmissionComposerIntoView();
              if (!currentUserId) {
                promptSignIn('Create an account or sign in to comment on films.');
              }
            }}
          />
          <TouchableOpacity
            onPress={submitSubmissionComment}
            disabled={sendingComment || (!!currentUserId && !commentText.trim())}
            style={[
              styles.profileCommentPostBtn,
              (sendingComment || (!!currentUserId && !commentText.trim())) && { opacity: 0.5 },
            ]}
            activeOpacity={0.9}
          >
            {sendingComment ? (
              <ActivityIndicator color="#000" size="small" />
            ) : (
              <Text style={styles.profileCommentPostText}>
                {currentUserId ? "Post" : "Sign In"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );

  const renderSubmissionCommentsPreview = () => {
    const firstComment = comments[0];
    const firstUser = firstComment?.users || firstComment?.user;
    const firstBody = firstComment?.comment || firstComment?.content || "";

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => openSubmissionComments(false)}
        style={[
          styles.profileWatchCommentsPreview,
          {
            backgroundColor: profileSoftSurface,
            borderColor: COLORS.border,
          },
        ]}
      >
        <View style={styles.profileWatchCommentsPreviewHeader}>
          <Text style={[styles.profileWatchCommentsPreviewTitle, { color: COLORS.textPrimary }]}>Comments</Text>
          <Text style={[styles.profileWatchCommentsPreviewCount, { color: COLORS.textSecondary }]}>
            {comments.length}
          </Text>
          {loadingComments ? <ActivityIndicator color={COLORS.primary} size="small" /> : null}
          <Ionicons name="chevron-forward" size={16} color={COLORS.textSecondary} />
        </View>

        {firstComment ? (
          <View style={styles.profileWatchCommentsPreviewRow}>
            {firstUser?.avatar_url ? (
              <Image
                source={{ uri: firstUser.avatar_url }}
                style={styles.profileWatchCommentsPreviewAvatar}
              />
            ) : (
              <View style={styles.profileWatchCommentsPreviewAvatarFallback}>
                <Text style={styles.profileWatchCommentsPreviewInitial}>
                  {(firstUser?.full_name || "U").slice(0, 1).toUpperCase()}
                </Text>
              </View>
            )}
            <View style={styles.profileWatchCommentsPreviewBody}>
              <Text style={[styles.profileWatchCommentsPreviewName, { color: COLORS.textPrimary }]} numberOfLines={1}>
                {firstUser?.full_name || "Unknown"}
              </Text>
              <Text style={[styles.profileWatchCommentsPreviewText, { color: COLORS.textSecondary }]} numberOfLines={2}>
                {firstBody}
              </Text>
            </View>
          </View>
        ) : (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => openSubmissionComments(true)}
            style={[
              styles.profileWatchCommentsPreviewInput,
              {
                backgroundColor: COLORS.input,
                borderColor: COLORS.border,
              },
            ]}
          >
            <Text style={[styles.profileWatchCommentsPreviewInputText, { color: COLORS.textMuted }]}>
              Add a comment...
            </Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const renderSubmissionSuggestion = (submission: SubmissionRow) => {
    const yt = submission.youtube_url ? ytThumb(submission.youtube_url) : null;
    const thumb = yt || submission.thumbnail_url || null;
    const role = submission.collaboration_role?.trim() || "";
    const meta = submission.is_collaboration_credit
      ? role
        ? `Worked on as ${role}`
        : "Worked on"
      : submission.users?.full_name || profile?.full_name || profileWatchName;
    const suggestionGenre = String(
      submission.film_category || submission.category || submission.word || "Film"
    );
    const suggestionMetaParts = [
      formatVoteCount(submission.votes),
      suggestionGenre,
    ].filter(Boolean);

    return (
      <Pressable
        key={submission.id}
        onPress={() => {
          void openSubmissionModal(submission);
        }}
        style={(state: any) => [
          styles.profileWatchSuggestionCard,
          {
            backgroundColor: state.hovered
              ? isLight
                ? "rgba(20,17,13,0.055)"
                : "rgba(255,255,255,0.055)"
              : "transparent",
            opacity: state.pressed ? 0.86 : 1,
          },
        ]}
      >
        {thumb ? (
          <Image
            source={{ uri: thumb }}
            style={[
              styles.profileWatchSuggestionThumb,
              !isMobileLike && styles.profileWatchSuggestionThumbDesktop,
            ]}
            resizeMode="cover"
          />
        ) : (
          <View
            style={[
              styles.profileWatchSuggestionThumb,
              !isMobileLike && styles.profileWatchSuggestionThumbDesktop,
              styles.profileWatchSuggestionFallback,
            ]}
          >
            <Ionicons name="videocam" size={20} color={COLORS.textSecondary} />
          </View>
        )}
        <View style={styles.profileWatchSuggestionBody}>
          <Text style={[styles.profileWatchSuggestionTitle, { color: COLORS.textPrimary }]} numberOfLines={2}>
            {submission.title || "Untitled"}
          </Text>
          <Text style={[styles.profileWatchSuggestionCreator, { color: profileSubText }]} numberOfLines={1}>
            {meta}
          </Text>
          <Text style={[styles.profileWatchSuggestionMeta, { color: profileSubText }]} numberOfLines={1}>
            {suggestionMetaParts.join(" · ")}
          </Text>
        </View>
      </Pressable>
    );
  };

  const renderSubmissionSuggestionsSection = () => {
    if (profileSubmissionSuggestions.length === 0) return null;

    return (
      <View style={styles.profileWatchSuggestionsSection}>
        <Text style={[styles.profileWatchSectionTitle, { color: COLORS.textPrimary }]}>Up next</Text>
        <View style={styles.profileWatchSuggestionsList}>
          {profileSubmissionSuggestions.map(renderSubmissionSuggestion)}
        </View>
      </View>
    );
  };

  return (
    <>
      {renderSubmissionGrid("Submissions", visibleOwnedSubmissions)}
      {renderSubmissionGrid("Worked On", visibleWorkedOnSubmissions, true)}

      {/* Playback modal */}
      <SmoothModal
        visible={submissionModalOpen}
        transparent
        enterOffset={isMobileLike ? 88 : 64}
        baseFrameStyle={{ backgroundColor: watchSurface }}
        frameStyle={{ backgroundColor: watchSurface }}
        presentationStyle="overFullScreen"
        hardwareAccelerated
        statusBarTranslucent
        onRequestClose={() => {
          void closeSubmissionModal();
        }}
      >
        <View style={[styles.profileWatchOverlay, { backgroundColor: watchSurface }]}>
          <TouchableOpacity
            onPress={() => {
              void closeSubmissionModal();
            }}
            accessibilityRole="button"
            accessibilityLabel="Close film"
            activeOpacity={0.9}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            style={[
              styles.profileWatchFixedClose,
              {
                top: Math.max(insets.top + 12, 16),
                right: isMobileLike ? 12 : 16,
                backgroundColor: isLight ? "rgba(255,255,255,0.94)" : "rgba(0,0,0,0.66)",
                borderColor: isLight ? COLORS.borderStrong : "rgba(255,255,255,0.18)",
              },
            ]}
          >
            <Ionicons name="close" size={22} color={isLight ? COLORS.textPrimary : "#F4EFE6"} />
          </TouchableOpacity>

          <ScrollView
            ref={submissionWatchScrollRef}
            style={styles.profileWatchScroll}
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="always"
            contentContainerStyle={[
              styles.profileWatchFullscreenContent,
              {
                paddingHorizontal: watchPagePadX,
                paddingTop: watchPagePadTop,
                paddingBottom:
                  Math.max(insets.bottom + 30, 48) +
                  (submissionKeyboardVisible ? submissionKeyboardLift + 28 : 0),
                backgroundColor: watchSurface,
              },
            ]}
          >
            <View
              style={[
                styles.profileWatchFullscreenLayout,
                isMobileLike && styles.profileWatchFullscreenLayoutMobile,
                { gap: watchRailGap },
              ]}
            >
              <View
                style={[
                  styles.profileWatchMainColumn,
                  isMobileLike ? { width: "100%" } : { width: watchMainW },
                ]}
              >
                {renderActiveSubmissionMedia()}

                <View
                  style={[
                    styles.profileWatchDetailsPanel,
                    { paddingHorizontal: isMobileLike ? SIDE_PAD_MOBILE : 0 },
                  ]}
                >
                  <View style={styles.profileWatchMetaBlock}>
                    <Text style={[styles.profileWatchTitle, { color: COLORS.textPrimary }]} numberOfLines={2}>
                      {activeSubmission?.title || "Untitled"}
                    </Text>

                    <View style={styles.profileWatchCreatorRow}>
                      <TouchableOpacity
                        onPress={() => {
                          if (activeCreator?.id) {
                            void goToCommentUserProfile(activeCreator.id);
                          }
                        }}
                        disabled={!activeCreator?.id}
                        activeOpacity={0.85}
                        style={styles.profileWatchCreatorTap}
                      >
                        <View
                          style={[
                            styles.profileWatchCreatorAvatar,
                            {
                              backgroundColor: isLight ? COLORS.cardAlt : "rgba(198,166,100,0.16)",
                              borderColor: isLight ? COLORS.borderStrong : "rgba(198,166,100,0.26)",
                            },
                          ]}
                        >
                          {profileWatchAvatar ? (
                            <Image
                              source={{ uri: profileWatchAvatar }}
                              style={styles.profileWatchCreatorAvatarImage}
                            />
                          ) : (
                            <Text style={styles.profileWatchCreatorAvatarText}>
                              {profileWatchName.slice(0, 1).toUpperCase()}
                            </Text>
                          )}
                        </View>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.profileWatchCreatorName, { color: COLORS.textPrimary }]} numberOfLines={1}>
                            {profileWatchName}
                          </Text>
                          <Text style={[styles.profileWatchCreatorMeta, { color: profileSubText }]} numberOfLines={1}>
                            {activeCreatorMeta}
                          </Text>
                        </View>
                      </TouchableOpacity>

                      {activeCreatorId && !activeCreatorIsCurrentUser ? (
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onPress={() => {
                            void toggleWatchCreatorSupport();
                          }}
                          disabled={watchCreatorSupportBusy}
                          style={[
                            styles.profileWatchSupportButton,
                            {
                              backgroundColor: activeCreatorSupportActive
                                ? isLight
                                  ? "rgba(198,166,100,0.12)"
                                  : "rgba(198,166,100,0.10)"
                                : "transparent",
                              borderColor: activeCreatorSupportActive
                                ? "rgba(198,166,100,0.32)"
                                : isLight
                                ? "rgba(20,17,13,0.14)"
                                : "rgba(255,255,255,0.12)",
                              opacity: watchCreatorSupportBusy ? 0.62 : 1,
                            },
                          ]}
                        >
                          <Ionicons
                            name={activeCreatorSupportActive ? "checkmark-circle-outline" : "star-outline"}
                            size={12}
                            color={activeCreatorSupportActive ? COLORS.primary : COLORS.textPrimary}
                          />
                          <Text
                            style={[
                              styles.profileWatchSupportText,
                              { color: activeCreatorSupportActive ? COLORS.primary : COLORS.textPrimary },
                            ]}
                          >
                            {activeCreatorSupportActive ? "Supporting" : "Support"}
                          </Text>
                        </TouchableOpacity>
                      ) : null}

                      {activeSubmissionCollaborators.length > 0 ? (
                        <View style={styles.profileWatchCreditsInlineWrap}>
                          {activeSubmissionCollaborators.map((item) => {
                            const collaboratorName =
                              item.users?.full_name ||
                              (item.user_id ? "Collaborator" : "Credit");
                            const canOpenProfile = !!item.users?.id;

                            return (
                              <TouchableOpacity
                                key={`${item.user_id}-${item.role || "role"}`}
                                activeOpacity={0.82}
                                onPress={() => {
                                  if (item.users?.id) {
                                    void goToCommentUserProfile(item.users.id);
                                  }
                                }}
                                disabled={!canOpenProfile}
                                style={styles.profileWatchCreditPerson}
                              >
                                {item.users?.avatar_url ? (
                                  <Image
                                    source={{ uri: item.users.avatar_url }}
                                    style={styles.profileWatchCreditAvatar}
                                  />
                                ) : (
                                  <View
                                    style={[
                                      styles.profileWatchCreditAvatarFallback,
                                      {
                                        backgroundColor: isLight ? COLORS.cardAlt : "rgba(198,166,100,0.14)",
                                        borderColor: isLight ? COLORS.borderStrong : "rgba(198,166,100,0.22)",
                                      },
                                    ]}
                                  >
                                    <Text style={styles.profileWatchCreditAvatarInitial}>
                                      {collaboratorName.slice(0, 1).toUpperCase()}
                                    </Text>
                                  </View>
                                )}

                                <View style={styles.profileWatchCreditTextWrap}>
                                  <Text style={[styles.profileWatchCreditName, { color: COLORS.textPrimary }]} numberOfLines={1}>
                                    {collaboratorName}
                                  </Text>
                                  <Text style={styles.profileWatchCreditRole} numberOfLines={1}>
                                    {item.role || "Collaborator"}
                                  </Text>
                                </View>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      ) : null}
                    </View>

                    <View style={styles.profileWatchActionsRow}>
                      {activeSubmission ? (
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onPress={() => {
                            setSubmissionActionsMenuOpen(false);
                            void toggleProfileSubmissionVote(activeSubmission);
                          }}
                          disabled={activeSubmissionVoteBusy || activeSubmission.user_id === currentUserId}
                          style={[
                            styles.profileWatchActionChip,
                            {
                              backgroundColor: isLight ? COLORS.card : "#101010",
                              borderColor: isLight ? COLORS.border : "#242424",
                            },
                            activeSubmissionVoteActive && styles.profileWatchActionChipActive,
                            activeSubmissionVoteActive &&
                              {
                                backgroundColor: isLight
                                  ? "rgba(198,166,100,0.13)"
                                  : "rgba(198,166,100,0.12)",
                                borderColor: "rgba(198,166,100,0.35)",
                              },
                            (activeSubmissionVoteBusy || activeSubmission.user_id === currentUserId) && {
                              opacity: 0.55,
                            },
                          ]}
                        >
                          <Ionicons
                            name={activeSubmissionVoteActive ? "heart" : "heart-outline"}
                            size={16}
                            color={activeSubmissionVoteActive ? COLORS.primary : COLORS.textPrimary}
                          />
                          <Text style={[styles.profileWatchActionText, { color: COLORS.textPrimary }]}>
                            {activeSubmissionVoteActive ? "Voted" : "Vote"}
                          </Text>
                          <Text style={[styles.profileWatchActionMeta, { color: profileSubText }]}>
                            {activeSubmissionVoteBusy ? "..." : activeSubmission.votes ?? 0}
                          </Text>
                        </TouchableOpacity>
                      ) : null}

                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => {
                          setSubmissionActionsMenuOpen(false);
                          openSubmissionComments(true);
                        }}
                        style={[
                          styles.profileWatchActionChip,
                          {
                            backgroundColor: isLight ? COLORS.card : "#101010",
                            borderColor: isLight ? COLORS.border : "#242424",
                          },
                        ]}
                      >
                        <Ionicons name="chatbubble-ellipses-outline" size={16} color={COLORS.textPrimary} />
                        <Text style={[styles.profileWatchActionText, { color: COLORS.textPrimary }]}>Comment</Text>
                        <Text style={[styles.profileWatchActionMeta, { color: profileSubText }]}>
                          {comments.length}
                        </Text>
                      </TouchableOpacity>

                      {activeSubmission ? (
                        <TouchableOpacity
                          activeOpacity={0.9}
                          onPress={() => {
                            setSubmissionActionsMenuOpen(false);
                            void shareProfileSubmissionLink(activeSubmission);
                          }}
                          style={[
                            styles.profileWatchActionChip,
                            {
                              backgroundColor: isLight ? COLORS.card : "#101010",
                              borderColor: isLight ? COLORS.border : "#242424",
                            },
                          ]}
                        >
                          <Ionicons name="arrow-redo-outline" size={16} color={COLORS.textPrimary} />
                          <Text style={[styles.profileWatchActionText, { color: COLORS.textPrimary }]}>Share</Text>
                        </TouchableOpacity>
                      ) : null}

                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => setSubmissionActionsMenuOpen(false)}
                        style={[
                          styles.profileWatchActionChip,
                          {
                            backgroundColor: isLight ? COLORS.card : "#101010",
                            borderColor: isLight ? COLORS.border : "#242424",
                          },
                        ]}
                      >
                        <Ionicons name="people-outline" size={16} color={COLORS.textPrimary} />
                        <Text style={[styles.profileWatchActionText, { color: COLORS.textPrimary }]}>Credits</Text>
                        <Text style={[styles.profileWatchActionMeta, { color: profileSubText }]}>
                          {activeSubmissionCollaborators.length}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        activeOpacity={0.9}
                        onPress={() => setSubmissionActionsMenuOpen((open) => !open)}
                        style={[
                          styles.profileWatchActionChip,
                          styles.profileWatchActionChipIconOnly,
                          {
                            backgroundColor: isLight ? COLORS.card : "#101010",
                            borderColor: isLight ? COLORS.border : "#242424",
                          },
                        ]}
                      >
                        <Ionicons name="ellipsis-horizontal" size={16} color={COLORS.textPrimary} />
                      </TouchableOpacity>
                    </View>

                    {submissionActionsMenuOpen && activeSubmission ? (
                      <View
                        style={[
                          styles.profileWatchMoreMenu,
                          {
                            backgroundColor: isLight ? COLORS.card : "#101010",
                            borderColor: isLight ? COLORS.border : "#242424",
                          },
                        ]}
                      >
                        <TouchableOpacity
                          activeOpacity={0.85}
                          onPress={() => {
                            setSubmissionActionsMenuOpen(false);
                            void reportProfileSubmission(activeSubmission);
                          }}
                          style={styles.profileWatchMoreMenuItem}
                        >
                          <Ionicons name="flag-outline" size={15} color={COLORS.danger} />
                          <Text style={[styles.profileWatchMoreMenuText, { color: COLORS.danger }]}>
                            Report film
                          </Text>
                        </TouchableOpacity>

                        {activeCreatorId && !activeCreatorIsCurrentUser ? (
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => {
                              setSubmissionActionsMenuOpen(false);
                              void blockProfileSubmissionCreator(activeSubmission);
                            }}
                            style={styles.profileWatchMoreMenuItem}
                          >
                            <Ionicons name="ban-outline" size={15} color={COLORS.danger} />
                            <Text style={[styles.profileWatchMoreMenuText, { color: COLORS.danger }]}>
                              Block creator
                            </Text>
                          </TouchableOpacity>
                        ) : null}

                        {isOwnProfile ? (
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => {
                              setSubmissionActionsMenuOpen(false);
                              void updateSubmissionProfileVisibility(activeSubmission, true);
                            }}
                            style={styles.profileWatchMoreMenuItem}
                          >
                            <Ionicons name="eye-off-outline" size={15} color={COLORS.textSecondary} />
                            <Text style={[styles.profileWatchMoreMenuText, { color: COLORS.textPrimary }]}>
                              Hide from profile
                            </Text>
                          </TouchableOpacity>
                        ) : null}

                        {activeSubmission.user_id === currentUserId &&
                        !activeSubmission.is_collaboration_credit ? (
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => {
                              setSubmissionActionsMenuOpen(false);
                              void deleteSubmission(activeSubmission);
                            }}
                            style={styles.profileWatchMoreMenuItem}
                          >
                            <Ionicons name="trash-outline" size={15} color={COLORS.danger} />
                            <Text style={[styles.profileWatchMoreMenuText, { color: COLORS.danger }]}>
                              Delete film
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    ) : null}
                  </View>

                  {activeSubmission ? (
                    <View
                      style={[
                        styles.profileWatchDescriptionPanel,
                        {
                          backgroundColor: isLight
                            ? "rgba(255,253,248,0.86)"
                            : "rgba(255,255,255,0.035)",
                          borderColor: profileWatchBorder,
                        },
                      ]}
                    >
                      {(() => {
                        const genre = String(
                          activeSubmission.film_category ||
                            activeSubmission.category ||
                            activeSubmission.word ||
                            "Film"
                        );
                        const date = formatWatchDateShort(activeSubmission.submitted_at);
                        const description = String(
                          (activeSubmission as any).description || activeSubmission.word || ""
                        ).trim();
                        const metaParts = [
                          formatVoteCount(activeSubmission.votes),
                          genre,
                          date,
                        ].filter(Boolean);

                        return (
                          <>
                            {metaParts.length > 0 ? (
                              <Text
                                style={[
                                  styles.profileWatchDescriptionMeta,
                                  { color: COLORS.textPrimary },
                                ]}
                                numberOfLines={1}
                              >
                                {metaParts.join(" · ")}
                              </Text>
                            ) : null}
                            {description ? (
                              <Text
                                style={[
                                  styles.profileWatchDescriptionText,
                                  { color: profileSubText },
                                ]}
                                numberOfLines={4}
                              >
                                {description}
                              </Text>
                            ) : null}
                          </>
                        );
                      })()}
                    </View>
                  ) : null}

                  {submissionCommentsExpanded
                    ? renderSubmissionCommentsPanel()
                    : renderSubmissionCommentsPreview()}

                  {isMobileLike ? renderSubmissionSuggestionsSection() : null}
                </View>
              </View>

              {!isMobileLike && profileSubmissionSuggestions.length > 0 ? (
                <View style={[styles.profileWatchSideRail, { width: watchSideRailW }]}>
                  {renderSubmissionSuggestionsSection()}
                </View>
              ) : null}
            </View>
          </ScrollView>
        </View>
      </SmoothModal>
    </>
  );
};

const onRefresh = useCallback(async () => {
  setRefreshing(true);

  try {
    triggerAppRefresh();

    await fetchProfile();

    try {
      await refreshStreak?.();
    } catch {}

    if (profile?.id) {
      await Promise.allSettled([
        fetchPortfolioItems(profile.id),
        fetchShowreelList(profile.id),
        fetchUserSubmissions(profile.id),
      ]);
    }
  } finally {
    setRefreshing(false);
  }
}, [
  triggerAppRefresh,
  fetchProfile,
  refreshStreak,
  profile?.id,
]);

/* ---------- MAIN RENDER ---------- */

if (!authReady || isLoading) {
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

if (!profile && !currentUserId && !targetIdParam) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
      }}
    >
      <Text
        style={{
          color: COLORS.textPrimary,
          fontSize: 20,
          fontFamily: FONT_DISPLAY,
          fontWeight: "700",
          letterSpacing: 0,
          textAlign: "center",
          marginBottom: 12,
        }}
      >
        Sign in to view your profile
      </Text>

      <Text
        style={{
          color: COLORS.textSecondary,
          fontSize: 13,
          fontFamily: FONT_OBLIVION,
          textAlign: "center",
          marginBottom: 20,
          lineHeight: 20,
        }}
      >
        Create an account or sign in to edit your profile, upload work, and connect with other creatives.
      </Text>

      <TouchableOpacity
        style={[styles.primaryBtn, { width: 220, marginBottom: 10 }]}
        onPress={() => navigation.navigate("Auth", { screen: "SignIn" })}
      >
        <Text style={styles.primaryBtnText}>Sign In</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.ghostBtn, { width: 220 }]}
        onPress={() => navigation.navigate("Auth", { screen: "SignUp" })}
      >
        <Text style={styles.ghostBtnText}>Create Account</Text>
      </TouchableOpacity>
    </View>
  );
}

if (!profile) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: COLORS.background,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Text style={{ color: COLORS.textSecondary }}>Profile not found.</Text>
    </View>
  );
}

return (
  <>
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={['top']}>
            <ScrollView
  style={{ flex: 1, backgroundColor: COLORS.background }}
  contentContainerStyle={{
    alignItems: "center",
    paddingTop: 20,
    paddingBottom: 40 + Math.max(insets.bottom, 8),
  }}
  refreshControl={
    <RefreshControl
      refreshing={refreshing}
      onRefresh={onRefresh}
      tintColor={GOLD}
      progressBackgroundColor={COLORS.card}
    />
  }
>
    <View
  style={{
    width: "100%",
    maxWidth: isMobileLike ? contentMaxWidth + horizontalPad * 2 : contentMaxWidth,
    paddingHorizontal: horizontalPad,
    paddingTop: Math.max(headerHeight - insets.top, 0),
    alignSelf: "center",
  }}
>
    

    {renderHero()}
    {renderFeaturedFilm()}
    {renderEditorialPortfolio()}
    {renderSubmissionsSection()}
  </View>
</ScrollView>
    </SafeAreaView>

    {/* Fullscreen image viewer */}
    <Modal
      visible={imageViewerIndex !== null}
      transparent
      animationType="fade"
      onRequestClose={closeImageViewer}
      statusBarTranslucent
    >
      <Pressable style={block.viewerOverlay} onPress={closeImageViewer}>
        {activeImageViewerUrl && imageViewerIndex !== null && (
          <>
            <Pressable
              onPress={(event) => event.stopPropagation()}
              style={[block.viewerImageFrame, imageViewerFrameStyle]}
            >
              <Image
                source={{ uri: activeImageViewerUrl }}
                style={block.viewerImage}
                resizeMode="contain"
              />
            </Pressable>
            <Pressable
              style={block.viewerCloseHint}
              onPress={closeImageViewer}
            >
              <Text style={block.viewerHintText}>Tap outside to close</Text>
            </Pressable>

            {imageViewerIndex > 0 && (
              <TouchableOpacity
                style={[navStyles.arrow, navStyles.left]}
                onPress={(event) => {
                  event.stopPropagation();
                  setImageViewerIndex((i) => (i! > 0 ? i! - 1 : i));
                }}
              >
                <Ionicons name="chevron-back" size={28} color="#FFF" />
              </TouchableOpacity>
            )}

            {imageViewerIndex < imageViewerUrls.length - 1 && (
              <TouchableOpacity
                style={[navStyles.arrow, navStyles.right]}
                onPress={(event) => {
                  event.stopPropagation();
                  setImageViewerIndex((i) =>
                    i! < imageViewerUrls.length - 1 ? i! + 1 : i
                  );
                }}
              >
                <Ionicons name="chevron-forward" size={28} color="#FFF" />
              </TouchableOpacity>
            )}
          </>
        )}
      </Pressable>
    </Modal>

     {/* Secondary showreel playback modal */}
    <SmoothModal
      visible={showreelModalOpen}
      transparent
      enterOffset={isMobileLike ? 88 : 64}
      baseFrameStyle={{ backgroundColor: "#050505" }}
      frameStyle={{ backgroundColor: "#050505" }}
      onRequestClose={closeShowreelModal}
      presentationStyle="overFullScreen"
      hardwareAccelerated
      statusBarTranslucent
    >
      <View style={styles.showreelPreviewOverlay}>
        <TouchableOpacity
          activeOpacity={1}
          onPress={closeShowreelModal}
          style={StyleSheet.absoluteFillObject}
        />

        <View style={[styles.showreelPreviewHeader, { top: Math.max(insets.top + 12, 18) }]}>
          <Text
            style={styles.showreelPreviewTitle}
            numberOfLines={1}
          >
            {activeShowreel?.category || "Showreel"}
          </Text>
        </View>

        <TouchableOpacity
          onPress={closeShowreelModal}
          accessibilityRole="button"
          accessibilityLabel="Close showreel"
          activeOpacity={0.9}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={[
            styles.showreelPreviewClose,
            {
              top: Math.max(insets.top + 12, 18),
              right: isMobileLike ? 12 : 18,
            },
          ]}
        >
          <Ionicons name="close" size={30} color="#F4EFE6" />
        </TouchableOpacity>

        <View
          pointerEvents="box-none"
          style={[
            styles.showreelPreviewBody,
            {
              paddingTop: Math.max(insets.top + 76, 92),
              paddingBottom: Math.max(insets.bottom + 24, 32),
              paddingHorizontal: isMobileLike ? 12 : 44,
            },
          ]}
        >

          {activeShowreel ? (
  <View style={styles.showreelPreviewPlayerWrap}>
    <ShowreelVideoInline
      key={`${activeShowreel.id}_${showreelPlaybackKey}`}
      playerId={`showreel_modal_${activeShowreel.id}_${showreelPlaybackKey}`}
      filePathOrUrl={activeShowreel.url || activeShowreel.file_path}
      width={Math.max(280, Math.min(width - (isMobileLike ? 24 : 88), 1180))}
      maxWidth={Math.max(280, Math.min(width - (isMobileLike ? 24 : 88), 1180))}
      maxHeight={Math.max(220, windowHeight - insets.top - insets.bottom - (isMobileLike ? 140 : 172))}
      squareCorners
      autoPlay={true}
    />
  </View>
) : null}
        </View>
      </View>
    </SmoothModal>

    {/* Edit Profile Modal */}
    <SmoothModal
      visible={showEditModal}
      transparent
      onRequestClose={() => {
        if (cityOpen) {
          setCityOpen(false);
          return;
        }
        if (roleSearchModalVisible) {
          setRoleSearchModalVisible(false);
          return;
        }
        if (sideRoleModalVisible) {
          setSideRoleModalVisible(false);
          return;
        }
        if (srUploading || mp4MainUploading) return;
        setShowEditModal(false);
      }}
    >
      <KeyboardAvoidingView
  style={[
    styles.modalOverlay,
    { backgroundColor: isLight ? "rgba(20,17,13,0.26)" : "#000000CC" },
  ]}
  behavior={Platform.OS === "ios" ? "height" : undefined}
>
        <View
          style={[
            styles.modalContainer,
            { backgroundColor: editModalBackground, borderColor: COLORS.border },
          ]}
        >
          <View style={[styles.modalHandle, { backgroundColor: isLight ? COLORS.borderStrong : "rgba(255,255,255,0.18)" }]} />
          <Text style={[styles.modalTitle, { color: COLORS.textPrimary }]}>Edit Profile</Text>

          <ScrollView
  style={{ flex: 1, width: "100%", backgroundColor: editModalBackground }}
  contentContainerStyle={{
  paddingBottom: Math.max(insets.bottom + 36, 56),
  paddingTop: 4,
  backgroundColor: editModalBackground,
}}
  showsVerticalScrollIndicator={false}
  keyboardShouldPersistTaps="handled"
>
            {/* Profile picture (own profile only) */}
            {isOwnProfile && (
              <View style={[styles.field, { marginTop: 8 }]}>
                <Text style={[styles.fieldLabel, { color: COLORS.textSecondary }]}>Profile picture</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 2 }}>
                  {image || profile.avatar_url ? (
                    <Image
  source={{ uri: image || profile.avatar_url || "" }}
  style={{
  width: 50,
  height: 50,
  borderRadius: 25,
  backgroundColor: COLORS.card,
  borderWidth: 1,
  borderColor: COLORS.border,
}}
/>
                  ) : (
                    <View
                      style={{
                        width: 50,
                        height: 50,
                        borderRadius: 25,
                        backgroundColor: COLORS.card,
                        borderWidth: 1,
                        borderColor: COLORS.border,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="person-outline" size={18} color={COLORS.textSecondary} />
                    </View>
                  )}

                  <TouchableOpacity
                    style={[styles.pillBtn, { backgroundColor: editModalPill, borderColor: COLORS.border }]}
                    onPress={pickImage}
                    disabled={uploading}
                  >
                    <Text style={[styles.pillText, { color: COLORS.textPrimary }]}>
                      {uploading ? "Uploading..." : "Change profile picture"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Full name */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: COLORS.textSecondary }]}>Name</Text>
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                style={[
                  styles.input,
                  {
                    backgroundColor: editModalInput,
                    borderColor: COLORS.border,
                    color: COLORS.textPrimary,
                  },
                  WEB_NO_OUTLINE,
                ]}
                placeholder="Your name"
                placeholderTextColor={COLORS.textSecondary}
              />
            </View>

            {/* City */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: COLORS.textSecondary }]}>City</Text>
              <TouchableOpacity
                style={[styles.pickerBtn, { backgroundColor: editModalInput, borderColor: COLORS.border }]}
                onPress={() => {
                  setCitySearch('');
                  setCityItems([]);
                  setSearchingCities(false);
                  setCityOpen(true);
                }}
              >
                <Text style={[styles.pickerBtnText, { color: cityName ? COLORS.textPrimary : COLORS.textSecondary }]}>
                  {cityName || "Search city"}
                </Text>
                <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Main role */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: COLORS.textSecondary }]}>Main role</Text>
              <TouchableOpacity
                style={[styles.pickerBtn, { backgroundColor: editModalInput, borderColor: COLORS.border }]}
                onPress={() => {
                  setRoleSearchModalVisible(true);
                  setRoleSearchTerm("");
                  setRoleSearchItems([]);
                  setSearchingRoles(false);
                }}
              >
                <Text style={[styles.pickerBtnText, { color: mainRoleName ? COLORS.textPrimary : COLORS.textSecondary }]}>
                  {mainRoleName ? translateRoleLabel(mainRoleName) : "Search role"}
                </Text>
                <Ionicons name="search" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Side roles */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: COLORS.textSecondary }]}>Side roles</Text>
              <TouchableOpacity
                style={[styles.pickerBtn, { backgroundColor: editModalInput, borderColor: COLORS.border }]}
                onPress={() => {
                  setSideRoleModalVisible(true);
                  setRoleSearchTerm("");
                  setRoleSearchItems([]);
                  setSearchingRoles(false);
                }}
              >
                <Text style={[styles.pickerBtnText, { color: sideRoles.length ? COLORS.textPrimary : COLORS.textSecondary }]}>
                  {sideRoles.length ? sideRoles.map((role) => translateRoleLabel(role)).join(", ") : "Add side roles"}
                </Text>
                <Ionicons name="add" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Bio */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: COLORS.textSecondary }]}>About</Text>
              <TextInput
                value={bio}
                onChangeText={setBio}
                style={[
                  styles.input,
                  styles.multiline,
                  {
                    backgroundColor: editModalInput,
                    borderColor: COLORS.border,
                    color: COLORS.textPrimary,
                  },
                  WEB_NO_OUTLINE,
                ]}
                placeholder="Tell people who you are, what you’re drawn to, and what you’re looking for."
                placeholderTextColor={COLORS.textSecondary}
                multiline
              />
            </View>

            {isOwnProfile && hiddenProfileSubmissions.length > 0 && (
              <View style={styles.field}>
                <Text style={[styles.fieldLabel, { color: COLORS.textSecondary }]}>Hidden submissions</Text>
                <View style={styles.hiddenSubmissionList}>
                  {hiddenProfileSubmissions.map((submission) => {
                    const thumb = submission.youtube_url
                      ? ytThumb(submission.youtube_url)
                      : submission.thumbnail_url || null;

                    return (
                      <View
                        key={submission.id}
                        style={[
                          styles.hiddenSubmissionRow,
                          { backgroundColor: editModalCard, borderColor: COLORS.border },
                        ]}
                      >
                        <View
                          style={[
                            styles.hiddenSubmissionThumb,
                            { backgroundColor: COLORS.backgroundAlt, borderColor: COLORS.border },
                          ]}
                        >
                          {thumb ? (
                            <Image source={{ uri: thumb }} style={{ width: "100%", height: "100%" }} resizeMode="cover" />
                          ) : (
                            <Ionicons name="videocam" size={18} color={COLORS.textSecondary} />
                          )}
                        </View>

                        <View style={styles.hiddenSubmissionCopy}>
                          <Text
                            style={[styles.hiddenSubmissionTitle, { color: COLORS.textPrimary }]}
                            numberOfLines={1}
                          >
                            {submission.title || "Untitled"}
                          </Text>
                          <Text
                            style={[styles.hiddenSubmissionMeta, { color: COLORS.textSecondary }]}
                            numberOfLines={1}
                          >
                            Hidden from profile
                          </Text>
                        </View>

                        <TouchableOpacity
                          onPress={() => {
                            void updateSubmissionProfileVisibility(submission, false);
                          }}
                          style={[
                            styles.hiddenSubmissionAction,
                            {
                              backgroundColor: editModalPillSelected,
                              borderColor: COLORS.primary,
                            },
                          ]}
                          activeOpacity={0.86}
                        >
                          <Text style={[styles.hiddenSubmissionActionText, { color: COLORS.primary }]}>Unhide</Text>
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </View>
              </View>
            )}

            {/* Featured Showreel (MP4 only) */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: COLORS.textSecondary }]}>Showreels</Text>

              <View style={{ marginTop: 8 }}>
                {showreels.length > 0 ? (
                  <>
                    <Text style={[styles.fieldLabel, { color: COLORS.textSecondary, marginBottom: 8 }]}>Current showreels</Text>

                    <View style={{ gap: 10 }}>
                      {showreels.map((r, index) => {
                        const isMain = !!r.is_primary;
                        const rawTitle = (r.title || "").trim();
                        const looksLikeFilename =
                          /\.(mp4|mov|m4v|webm)$/i.test(rawTitle) ||
                          rawTitle.length > 54 ||
                          rawTitle.toLowerCase().includes("utc");
                        const displayTitle =
                          rawTitle && !looksLikeFilename
                            ? rawTitle
                            : `${r.category || "Showreel"} ${index + 1}`;
                        const isUnavailable = !r.url && !r.file_path;
                        const pendingThumb = pendingShowreelThumbs[r.id];
                        const thumbUri =
                          r.thumbnail_url ||
                          (typeof pendingThumb === "string" ? pendingThumb : pendingThumb?.uri) ||
                          null;

                        return (
                          <View
                            key={r.id}
                            style={{
                              borderWidth: 1,
                              borderColor: isMain ? COLORS.primary : COLORS.border,
                              borderRadius: 10,
                              padding: 10,
                              backgroundColor: isLight ? COLORS.card : editModalCard,
                              shadowColor: isLight ? "rgba(0,0,0,0.18)" : "#000",
                              shadowOpacity: isLight ? 0.04 : 0,
                              shadowRadius: isLight ? 8 : 0,
                              shadowOffset: { width: 0, height: 3 },
                            }}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 12,
                              }}
                            >
                              <View
                                style={{
                                  width: 86,
                                  height: 54,
                                  borderRadius: 8,
                                  overflow: "hidden",
                                  backgroundColor: COLORS.backgroundAlt,
                                  borderWidth: 1,
                                  borderColor: COLORS.border,
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {thumbUri ? (
                                  <Image
                                    source={{ uri: thumbUri }}
                                    style={{ width: "100%", height: "100%" }}
                                    resizeMode="cover"
                                  />
                                ) : (
                                  <Ionicons name="film-outline" size={24} color={COLORS.textSecondary} />
                                )}
                              </View>

                              <View style={{ flex: 1, minWidth: 0 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                                  <Text
                                    style={{
                                      color: COLORS.textPrimary,
                                      fontFamily: FONT_OBLIVION,
                                      fontSize: 14,
                                      fontWeight: "800",
                                      flex: 1,
                                    }}
                                    numberOfLines={1}
                                  >
                                    {displayTitle}
                                  </Text>

                                  {isMain ? (
                                    <View
                                      style={{
                                        paddingHorizontal: 8,
                                        paddingVertical: 4,
                                        borderRadius: 6,
                                        backgroundColor: editModalPillSelected,
                                        borderWidth: 1,
                                        borderColor: COLORS.primary,
                                      }}
                                    >
                                      <Text
                                        style={{
                                          color: COLORS.primary,
                                          fontFamily: FONT_OBLIVION,
                                          fontSize: 9,
                                          fontWeight: "800",
                                          textTransform: "uppercase",
                                        }}
                                      >
                                        Main
                                      </Text>
                                    </View>
                                  ) : null}
                                </View>

                                <Text
                                  style={{
                                    color: COLORS.textSecondary,
                                    fontFamily: FONT_OBLIVION,
                                    fontSize: 12,
                                    marginTop: 4,
                                  }}
                                  numberOfLines={1}
                                >
                                  {r.category || "No category selected"}
                                  {isMain ? " • Main showreel" : ""}
                                  {isUnavailable ? " • Preparing" : ""}
                                </Text>
                              </View>

                              {!isMain && (
                                <TouchableOpacity
                                  onPress={() => setPrimaryShowreel(r)}
                                  style={[
                                    styles.pillBtn,
                                    { backgroundColor: COLORS.backgroundAlt, borderColor: COLORS.border },
                                    isUnavailable ? { opacity: 0.55 } : null,
                                  ]}
                                  disabled={isUnavailable}
                                >
                                  <Text style={[styles.pillText, { color: COLORS.textPrimary }]}>Make Main</Text>
                                </TouchableOpacity>
                              )}
                            </View>

                            <View style={{ marginTop: 10 }}>
                              <Text
                                style={{
                                  color: COLORS.textSecondary,
                                  fontSize: 11,
                                  fontFamily: FONT_OBLIVION,
                                  marginBottom: 6,
                                }}
                              >
                                Category
                              </Text>

                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={{ gap: 8 }}
                              >
                                {SHOWREEL_CATEGORIES.map((cat) => {
                                  const selected = r.category === cat;
                                  return (
                                    <TouchableOpacity
                                      key={`${r.id}_edit_${cat}`}
                                      onPress={() => updateShowreelCategory(r, cat)}
                                      style={{
                                        paddingHorizontal: 10,
                                        paddingVertical: 6,
                                        borderRadius: 7,
                                        backgroundColor: selected ? editModalPillSelected : COLORS.backgroundAlt,
                                        borderWidth: 1,
                                        borderColor: selected ? COLORS.primary : COLORS.border,
                                      }}
                                    >
                                      <Text
                                        style={{
                                          color: selected ? COLORS.primary : COLORS.textSecondary,
                                          fontSize: 11,
                                          fontFamily: FONT_OBLIVION,
                                          fontWeight: selected ? "800" : "600",
                                        }}
                                      >
                                        {cat}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </ScrollView>
                            </View>

                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                              <TouchableOpacity
  style={[
    styles.pillBtn,
    { backgroundColor: COLORS.backgroundAlt, borderColor: COLORS.border },
    showreelThumbUploadingId === r.id ? { opacity: 0.7 } : null,
  ]}
  onPress={() => changeShowreelThumbnail(r)}
  disabled={showreelThumbUploadingId === r.id}
>
  {showreelThumbUploadingId === r.id ? (
    <ActivityIndicator color={COLORS.textPrimary} />
  ) : (
    <Text style={[styles.pillText, { color: COLORS.textPrimary }]}>
  {pendingShowreelThumbs[r.id] || r.thumbnail_url ? "Change Thumbnail" : "Add Thumbnail"}
</Text>
  )}
</TouchableOpacity>

                              <TouchableOpacity
                                style={[
                                  styles.pillBtn,
                                  { backgroundColor: editModalDangerBg, borderColor: COLORS.danger },
                                ]}
                                onPress={() => deleteShowreel(r)}
                              >
                                <Text style={[styles.pillText, { color: COLORS.danger }]}>Delete</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </>
                ) : (
                  <Text style={[block.muted, { color: COLORS.textSecondary, marginBottom: 6 }]}>
                    Free includes 1 showreel. Pro lets you upload up to 3 showreels and choose your main featured reel.
                  </Text>
                )}

                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    {
                      marginTop: 10,
                      opacity: mp4MainUploading || srUploading || showreels.length >= 3 ? 0.7 : 1,
                    },
                  ]}
                  onPress={uploadMainMP4}
                  disabled={mp4MainUploading || srUploading || showreels.length >= 3}
                >
                  {mp4MainUploading || srUploading ? (
                    <ActivityIndicator color={COLORS.textOnPrimary} />
                  ) : (
                    <Text style={[styles.primaryBtnText, { color: COLORS.textOnPrimary }]}>
                      {showreels.length >= 3
                        ? "Maximum of 3 showreels reached"
                        : showreels.length === 0
                        ? "Upload First Showreel"
                        : "Upload Another Showreel"}
                    </Text>
                  )}
                </TouchableOpacity>

                {!!showreelUploadNotice && (
                  <View
                    style={{
                      marginTop: 10,
                      borderWidth: 1,
                      borderColor: COLORS.primary,
                      backgroundColor: editModalPillSelected,
                      borderRadius: 9,
                      paddingHorizontal: 12,
                      paddingVertical: 10,
                    }}
                  >
                    <Text
                      style={{
                        color: COLORS.textPrimary,
                        fontFamily: FONT_OBLIVION,
                        fontSize: 12,
                        lineHeight: 17,
                        textAlign: 'center',
                      }}
                    >
                      {showreelUploadNotice}
                    </Text>
                  </View>
                )}

                {(mp4MainUploading || srUploading) && (
                  <View style={{ marginTop: 8, alignItems: "center" }}>
                    {!!(mp4Status || srStatus) && (
                      <Text style={[block.muted, { color: COLORS.textSecondary, marginBottom: 4 }]}>
                        {mp4Status || srStatus}
                      </Text>
                    )}
                    <View
                      style={[
                        block.progressRail,
                        { backgroundColor: isLight ? COLORS.backgroundAlt : "#0F0F0F", borderColor: COLORS.border },
                      ]}
                    >
                      <View
                        style={[
                          block.progressFill,
                          { width: `${Math.max(mp4Progress || 0, srProgress || 0)}%` },
                        ]}
                      />
                    </View>
                    <Text style={[block.muted, { color: COLORS.textSecondary, marginTop: 4 }]}>
                      {Math.max(mp4Progress || 0, srProgress || 0)}%
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Extra portfolio uploads */}
            <View style={styles.field}>
              <Text style={[styles.fieldLabel, { color: COLORS.textSecondary }]}>Add supporting work</Text>
              <View style={styles.uploadRow}>
                <TouchableOpacity
                  style={[styles.pillBtn, { backgroundColor: editModalPill, borderColor: COLORS.border }]}
                  onPress={uploadPortfolioImage}
                >
                  <Text style={[styles.pillText, { color: COLORS.textPrimary }]}>+ Image</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pillBtn, { backgroundColor: editModalPill, borderColor: COLORS.border }]}
                  onPress={uploadPortfolioPDF}
                >
                  <Text style={[styles.pillText, { color: COLORS.textPrimary }]}>+ PDF</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.pillBtn, { backgroundColor: editModalPill, borderColor: COLORS.border }]}
                  onPress={uploadPortfolioMP3}
                >
                  <Text style={[styles.pillText, { color: COLORS.textPrimary }]}>+ Audio</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Actions */}
            <View
  style={{
    flexDirection: "row",
    gap: 10,
    marginTop: 18,
    marginBottom: Math.max(insets.bottom, 8),
  }}
>
              <TouchableOpacity
                style={[
                  styles.ghostBtn,
                  {
                    flex: 1,
                    backgroundColor: editModalPill,
                    borderColor: COLORS.border,
                  },
                ]}
                onPress={() => {
                  if (srUploading || mp4MainUploading) return;
                  setShowEditModal(false);
                }}
                disabled={uploading || srUploading || mp4MainUploading}
              >
                <Text style={[styles.ghostBtnText, { color: COLORS.textPrimary }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.primaryBtn,
                  {
                    flex: 1,
                    opacity: !isDirty || uploading || srUploading || mp4MainUploading ? 0.72 : 1,
                    backgroundColor: COLORS.primary,
                    borderColor: COLORS.primary,
                  },
                ]}
                disabled={!isDirty || uploading || srUploading || mp4MainUploading}
                onPress={saveProfile}
              >
                {uploading ? (
                  <ActivityIndicator color={COLORS.textOnPrimary} />
                ) : (
                  <Text style={[styles.primaryBtnText, { color: COLORS.textOnPrimary }]}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>

        {(showreelCategoryModalVisible || srUploading) && (
          <View
            style={[
              showreelSetup.overlay,
              { backgroundColor: showreelUploadTheme.overlay },
            ]}
          >
            <View
              style={[
                showreelSetup.panel,
                {
                  backgroundColor: showreelUploadTheme.panel,
                  borderColor: showreelUploadTheme.panelBorder,
                  shadowColor: showreelUploadTheme.shadow,
                },
              ]}
            >
              <View
                style={[
                  showreelSetup.header,
                  {
                    backgroundColor: showreelUploadTheme.header,
                    borderBottomColor: showreelUploadTheme.divider,
                  },
                ]}
              >
                <Text style={[showreelSetup.title, { color: showreelUploadTheme.title }]}>
                  Upload showreel
                </Text>
                <Text style={[showreelSetup.subtitle, { color: showreelUploadTheme.subtitle }]}>
                  Add your video, thumbnail, and category before publishing.
                </Text>
              </View>

              {srUploading ? (
                <View style={showreelSetup.progressState}>
                  <View style={showreelSetup.progressTopRow}>
                    <View
                      style={[
                        showreelSetup.progressIcon,
                        {
                          borderColor: showreelUploadTheme.selectedBorder,
                          backgroundColor: showreelUploadTheme.selectedBg,
                        },
                      ]}
                    >
                      {srProgress >= 100 ? (
                        <Ionicons name="checkmark" size={20} color={COLORS.primary} />
                      ) : (
                        <ActivityIndicator color={COLORS.primary} />
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text
                        style={[
                          showreelSetup.progressTitle,
                          { color: showreelUploadTheme.title },
                        ]}
                      >
                        Uploading to Overlooked
                      </Text>
                      <Text
                        style={[
                          showreelSetup.progressBody,
                          { color: showreelUploadTheme.subtitle },
                        ]}
                        numberOfLines={2}
                      >
                        {srStatus || 'Uploading your showreel...'}
                      </Text>
                    </View>
                    <Text style={[showreelSetup.progressPercent, { color: COLORS.primary }]}>
                      {Math.max(0, Math.min(100, srProgress || 0))}%
                    </Text>
                  </View>

                  {pendingShowreelThumbPreviewUri ? (
                    <Image
                      source={{ uri: pendingShowreelThumbPreviewUri }}
                      style={[
                        showreelSetup.progressThumb,
                        {
                          borderColor: showreelUploadTheme.dropzoneBorder,
                          backgroundColor: showreelUploadTheme.videoDropzoneBg,
                        },
                      ] as any}
                      resizeMode="cover"
                    />
                  ) : null}

                  <View
                    style={[
                      showreelSetup.progressTrack,
                      {
                        backgroundColor: showreelUploadTheme.progressTrack,
                        borderColor: showreelUploadTheme.dropzoneBorder,
                      },
                    ]}
                  >
                    <View
                      style={[
                        showreelSetup.progressFill,
                        {
                          width: `${Math.max(0, Math.min(100, srProgress || 0))}%`,
                          backgroundColor: COLORS.primary,
                        },
                      ]}
                    />
                  </View>

                  <Text
                    style={[
                      showreelSetup.progressFootnote,
                      { color: showreelUploadTheme.helper },
                    ]}
                  >
                    Keep this window open. Processing may continue briefly after upload completes.
                  </Text>
                </View>
              ) : (
                <>
                  <ScrollView
                    style={showreelSetup.bodyScroll}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={showreelSetup.bodyContent}
                  >
                    <View
                      style={[
                        showreelSetup.uploadGrid,
                        !isMobileLike && showreelSetup.uploadGridDesktop,
                      ]}
                    >
                      <View style={showreelSetup.videoColumn}>
                        <Text
                          style={[
                            showreelSetup.fieldLabel,
                            { color: showreelUploadTheme.label },
                          ]}
                        >
                          Video file
                        </Text>
                        <Pressable
                          onPress={pendingShowreelPreviewUri ? undefined : choosePendingShowreelVideo}
                          {...(Platform.OS === 'web'
                            ? {
                                onDragOver: (evt: any) => evt.preventDefault?.(),
                                onDrop: handlePendingShowreelVideoDrop,
                              }
                            : {})}
                          style={(state: any) => [
                            showreelSetup.videoDropzone,
                            {
                              backgroundColor: showreelUploadTheme.videoDropzoneBg,
                              borderColor: showreelUploadTheme.dropzoneBorder,
                            },
                            state.hovered && {
                              backgroundColor: showreelUploadTheme.dropzoneHoverBg,
                              borderColor: showreelUploadTheme.dropzoneHoverBorder,
                            },
                          ]}
                        >
                          {pendingShowreelPreviewUri ? (
                            Platform.OS === 'web' ? (
                              // @ts-ignore - react-native-web passes this through as a real HTML video element.
                              <WebVideo
                                src={pendingShowreelPreviewUri}
                                controls
                                playsInline
                                preload="metadata"
                                style={{
                                  width: '100%',
                                  height: '100%',
                                  objectFit: 'contain',
                                  objectPosition: 'center center',
                                  display: 'block',
                                  background: '#000',
                                }}
                              />
                            ) : (
                              <Video
                                source={{ uri: pendingShowreelPreviewUri }}
                                style={showreelSetup.previewMedia}
                                useNativeControls
                                resizeMode={ResizeMode.CONTAIN}
                                shouldPlay={false}
                              />
                            )
                          ) : (
                            <View style={showreelSetup.dropzoneEmpty}>
                              <Ionicons name="cloud-upload-outline" size={26} color={COLORS.primary} />
                              <Text
                                style={[
                                  showreelSetup.dropzoneTitle,
                                  { color: showreelUploadTheme.title },
                                ]}
                              >
                                Drop your showreel here or choose a video file
                              </Text>
                              <Text
                                style={[
                                  showreelSetup.dropzoneHint,
                                  { color: showreelUploadTheme.muted },
                                ]}
                              >
                                MP4 only · up to 1 GB
                              </Text>
                            </View>
                          )}

                          {pendingShowreelPreviewUri ? (
                            <Pressable
                              onPress={choosePendingShowreelVideo}
                              style={(state: any) => [
                                showreelSetup.videoChangeBadge,
                                {
                                  borderColor: showreelUploadTheme.selectedBorder,
                                },
                                state.hovered && showreelSetup.videoChangeBadgeHover,
                              ]}
                            >
                              <Ionicons name="swap-horizontal-outline" size={13} color="#F6E7BD" />
                              <Text style={showreelSetup.videoChangeText}>
                                Choose different video
                              </Text>
                            </Pressable>
                          ) : null}
                        </Pressable>
                        <Text
                          style={[
                            showreelSetup.helperText,
                            { color: showreelUploadTheme.helper },
                          ]}
                        >
                          MP4 only. Large files may take a few minutes to upload.
                        </Text>
                      </View>

                      <View style={showreelSetup.sideColumn}>
                        <Text
                          style={[
                            showreelSetup.fieldLabel,
                            { color: showreelUploadTheme.label },
                          ]}
                        >
                          Thumbnail
                        </Text>
                        <Pressable
                          onPress={pickPendingShowreelThumbnail}
                          {...(Platform.OS === 'web'
                            ? {
                                onDragOver: (evt: any) => evt.preventDefault?.(),
                                onDrop: handlePendingShowreelThumbDrop,
                              }
                            : {})}
                          style={(state: any) => [
                            showreelSetup.thumbDropzone,
                            {
                              backgroundColor: showreelUploadTheme.dropzoneBg,
                              borderColor: showreelUploadTheme.dropzoneBorder,
                            },
                            pendingShowreelError && !pendingShowreelThumbAsset
                              ? showreelSetup.dropzoneError
                              : null,
                            pendingShowreelThumbPreviewUri
                              ? { borderColor: showreelUploadTheme.selectedBorder }
                              : null,
                            state.hovered && {
                              backgroundColor: showreelUploadTheme.dropzoneHoverBg,
                              borderColor: showreelUploadTheme.dropzoneHoverBorder,
                            },
                          ]}
                        >
                          {pendingShowreelThumbPreviewUri ? (
                            <Image
                              source={{ uri: pendingShowreelThumbPreviewUri }}
                              style={showreelSetup.previewMedia as any}
                              resizeMode="cover"
                            />
                          ) : (
                            <View style={showreelSetup.dropzoneEmptyCompact}>
                              <Ionicons name="image-outline" size={22} color={COLORS.primary} />
                              <Text
                                style={[
                                  showreelSetup.dropzoneTitleSmall,
                                  { color: showreelUploadTheme.title },
                                ]}
                              >
                                Add thumbnail — required
                              </Text>
                              <Text
                                style={[
                                  showreelSetup.dropzoneHint,
                                  { color: showreelUploadTheme.muted },
                                ]}
                              >
                                16:9 recommended
                              </Text>
                            </View>
                          )}
                        </Pressable>

                        <View style={showreelSetup.categoryBlock}>
                          <View style={showreelSetup.sectionHeader}>
                            <Text
                              style={[
                                showreelSetup.fieldLabel,
                                { color: showreelUploadTheme.label },
                              ]}
                            >
                              Category
                            </Text>
                            <Text
                              style={[
                                showreelSetup.sectionHint,
                                { color: showreelUploadTheme.muted },
                              ]}
                            >
                              Choose one
                            </Text>
                          </View>

                          <View style={showreelSetup.categoryGrid}>
                            {SHOWREEL_CATEGORIES.map((cat) => {
                              const selected = selectedShowreelCategory === cat;
                              const meta = SHOWREEL_CATEGORY_META[cat];

                              return (
                                <Pressable
                                  key={cat}
                                  onPress={() => {
                                    setSelectedShowreelCategory(cat);
                                    setPendingShowreelError('');
                                  }}
                                  style={(state: any) => [
                                    showreelSetup.categoryCard,
                                    {
                                      backgroundColor: showreelUploadTheme.categoryBg,
                                      borderColor: showreelUploadTheme.categoryBorder,
                                    },
                                    selected && {
                                      backgroundColor: showreelUploadTheme.selectedBg,
                                      borderColor: COLORS.primary,
                                    },
                                    state.hovered && !selected
                                      ? {
                                          backgroundColor: showreelUploadTheme.categoryHoverBg,
                                          borderColor: showreelUploadTheme.categoryHoverBorder,
                                        }
                                      : null,
                                  ]}
                                >
                                  <View
                                    style={[
                                      showreelSetup.categoryIcon,
                                      {
                                        backgroundColor: showreelUploadTheme.iconBg,
                                        borderColor: showreelUploadTheme.iconBorder,
                                      },
                                      selected && {
                                        backgroundColor: showreelUploadTheme.selectedBg,
                                        borderColor: showreelUploadTheme.selectedBorder,
                                      },
                                    ]}
                                  >
                                    <Ionicons
                                      name={meta.icon as any}
                                      size={14}
                                      color={selected ? COLORS.primary : showreelUploadTheme.iconColor}
                                    />
                                  </View>

                                  <View style={{ flex: 1, minWidth: 0 }}>
                                    <Text
                                      style={[
                                        showreelSetup.categoryTitle,
                                        { color: showreelUploadTheme.title },
                                      ]}
                                      numberOfLines={1}
                                    >
                                      {cat}
                                    </Text>
                                    <Text
                                      style={[
                                        showreelSetup.categoryDetail,
                                        { color: showreelUploadTheme.muted },
                                      ]}
                                      numberOfLines={1}
                                    >
                                      {meta.detail}
                                    </Text>
                                  </View>
                                </Pressable>
                              );
                            })}
                          </View>
                        </View>
                      </View>
                    </View>
                  </ScrollView>

                  <View
                    style={[
                      showreelSetup.footer,
                      {
                        backgroundColor: showreelUploadTheme.footer,
                        borderTopColor: showreelUploadTheme.divider,
                      },
                    ]}
                  >
                    <View style={showreelSetup.validationWrap}>
                      {!!pendingShowreelError ? (
                        <Text
                          style={[
                            showreelSetup.errorText,
                            { color: showreelUploadTheme.error },
                          ]}
                        >
                          {pendingShowreelError}
                        </Text>
                      ) : (
                        <Text
                          style={[
                            showreelSetup.validationText,
                            { color: showreelUploadTheme.helper },
                            pendingShowreelAsset && pendingShowreelThumbAsset
                              ? { color: showreelUploadTheme.ready }
                              : null,
                          ]}
                        >
                          {!pendingShowreelAsset
                            ? 'Choose a video file to continue.'
                            : !pendingShowreelThumbAsset
                            ? 'Thumbnail required before upload.'
                            : 'Ready to upload.'}
                        </Text>
                      )}
                    </View>

                    <View style={showreelSetup.footerActions}>
                      <Pressable
                        onPress={() => {
                          setShowreelCategoryModalVisible(false);
                          clearPendingShowreelDraft();
                        }}
                        style={(state: any) => [
                          showreelSetup.footerButton,
                          showreelSetup.footerButtonGhost,
                          {
                            backgroundColor: showreelUploadTheme.ghostBg,
                            borderColor: showreelUploadTheme.ghostBorder,
                          },
                          state.hovered && {
                            backgroundColor: showreelUploadTheme.ghostHoverBg,
                            borderColor: showreelUploadTheme.categoryHoverBorder,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            showreelSetup.footerButtonGhostText,
                            { color: showreelUploadTheme.ghostText },
                          ]}
                        >
                          Cancel
                        </Text>
                      </Pressable>

                      <Pressable
                        disabled={!pendingShowreelAsset || !pendingShowreelThumbAsset}
                        onPress={confirmUploadShowreel}
                        style={(state: any) => [
                          showreelSetup.footerButton,
                          showreelSetup.footerButtonPrimary,
                          {
                            backgroundColor: showreelUploadTheme.primaryBg,
                            borderColor: showreelUploadTheme.primaryBg,
                          },
                          (!pendingShowreelAsset || !pendingShowreelThumbAsset) &&
                            showreelSetup.footerButtonDisabled,
                          state.hovered &&
                            pendingShowreelAsset &&
                            pendingShowreelThumbAsset &&
                            {
                              backgroundColor: showreelUploadTheme.primaryHoverBg,
                              borderColor: showreelUploadTheme.primaryHoverBg,
                            },
                        ]}
                      >
                        <Text
                          style={[
                            showreelSetup.footerButtonPrimaryText,
                            { color: showreelUploadTheme.primaryText },
                          ]}
                        >
                          Upload
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                </>
              )}
            </View>
          </View>
        )}
        <InlineSelectorOverlay
          visible={cityOpen || roleSearchModalVisible || sideRoleModalVisible}
          style={{
            backgroundColor: isLight ? "rgba(20,17,13,0.32)" : "rgba(0,0,0,0.78)",
          }}
        >
          <KeyboardAvoidingView
            style={styles.editSelectorKeyboard}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            {cityOpen ? (
              <View
                style={[
                  styles.editSelectorCard,
                  {
                    backgroundColor: editModalBackground,
                    borderColor: COLORS.border,
                    shadowColor: isLight ? "rgba(0,0,0,0.22)" : "#000",
                  },
                ]}
              >
                <Text style={[styles.editSelectorTitle, { color: COLORS.textPrimary }]}>Select City</Text>

                <TextInput
                  value={citySearch}
                  onChangeText={(text) => {
                    setCitySearch(text);
                    scheduleCitySearch(text);
                  }}
                  placeholder="Start typing your city..."
                  placeholderTextColor={COLORS.textSecondary}
                  style={[
                    styles.editSelectorSearchInput,
                    {
                      backgroundColor: editModalInput,
                      borderColor: citySearchFocused ? COLORS.primary : COLORS.border,
                      color: COLORS.textPrimary,
                    },
                    WEB_NO_OUTLINE,
                  ]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  blurOnSubmit={false}
                  returnKeyType="search"
                  onFocus={() => setCitySearchFocused(true)}
                  onBlur={() => setCitySearchFocused(false)}
                />

                <View style={styles.editSelectorResultsArea}>
                  {searchingCities ? (
                    <View style={styles.editSelectorLoadingWrap}>
                      <ActivityIndicator color={COLORS.primary} />
                    </View>
                  ) : (
                    <ScrollView
                      style={styles.editSelectorScroll}
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}
                    >
                      {cityItems.length === 0 ? (
                        <Text style={[styles.editSelectorEmptyText, { color: COLORS.textSecondary }]}>
                          {citySearch.trim().length >= 2
                            ? "No matching cities found. Try a broader search."
                            : "Type to search cities."}
                        </Text>
                      ) : (
                        cityItems.map((c) => {
                          const isSelected = Number(cityId) === Number(c.value);

                          return (
                            <TouchableOpacity
                              key={c.value}
                              style={[
                                styles.editSelectorListItem,
                                { borderColor: COLORS.border },
                                isSelected && {
                                  backgroundColor: editModalPillSelected,
                                  borderColor: COLORS.primary,
                                },
                              ]}
                              onPress={() => {
                                const cleanLabel = `${c.name}, ${c.country_code}`;
                                setCityId(c.value);
                                setCityName(cleanLabel);
                                setCityOpen(false);
                              }}
                              activeOpacity={0.82}
                            >
                              <Text
                                style={[
                                  styles.editSelectorListItemText,
                                  { color: COLORS.textPrimary },
                                  isSelected && { color: COLORS.primary },
                                ]}
                                numberOfLines={1}
                              >
                                {c.label}
                              </Text>

                              {isSelected ? (
                                <Ionicons name="checkmark-circle" size={19} color={COLORS.primary} />
                              ) : null}
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </ScrollView>
                  )}
                </View>

                <TouchableOpacity
                  onPress={() => setCityOpen(false)}
                  style={[
                    styles.editSelectorCloseButton,
                    { backgroundColor: editModalPill, borderColor: COLORS.border },
                  ]}
                  activeOpacity={0.86}
                >
                  <Text style={[styles.editSelectorCloseText, { color: COLORS.textPrimary }]}>Close</Text>
                </TouchableOpacity>
              </View>
            ) : roleSearchModalVisible ? (
              <View
                style={[
                  styles.editSelectorCard,
                  {
                    backgroundColor: editModalBackground,
                    borderColor: COLORS.border,
                    shadowColor: isLight ? "rgba(0,0,0,0.22)" : "#000",
                  },
                ]}
              >
                <Text style={[styles.editSelectorTitle, { color: COLORS.textPrimary }]}>Select Main Role</Text>

                <TextInput
                  value={roleSearchTerm}
                  onChangeText={(t) => {
                    setRoleSearchTerm(t);
                    fetchSearchRoles(t);
                  }}
                  placeholder="Start typing a role..."
                  placeholderTextColor={COLORS.textSecondary}
                  style={[
                    styles.editSelectorSearchInput,
                    {
                      backgroundColor: editModalInput,
                      borderColor: roleSearchFocused ? COLORS.primary : COLORS.border,
                      color: COLORS.textPrimary,
                    },
                    WEB_NO_OUTLINE,
                  ]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  blurOnSubmit={false}
                  returnKeyType="search"
                  onFocus={() => setRoleSearchFocused(true)}
                  onBlur={() => setRoleSearchFocused(false)}
                />

                <View style={styles.editSelectorResultsArea}>
                  {searchingRoles ? (
                    <View style={styles.editSelectorLoadingWrap}>
                      <ActivityIndicator color={COLORS.primary} />
                    </View>
                  ) : (
                    <ScrollView
                      style={styles.editSelectorScroll}
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}
                    >
                      {roleSearchItems.length === 0 ? (
                        <Text style={[styles.editSelectorEmptyText, { color: COLORS.textSecondary }]}>
                          Type to search roles.
                        </Text>
                      ) : (
                        roleSearchItems.map((r) => {
                          const isSelected = Number(mainRole) === Number(r.value);

                          return (
                            <TouchableOpacity
                              key={r.value}
                              style={[
                                styles.editSelectorListItem,
                                { borderColor: COLORS.border },
                                isSelected && {
                                  backgroundColor: editModalPillSelected,
                                  borderColor: COLORS.primary,
                                },
                              ]}
                              onPress={() => {
                                setMainRole(r.value);
                                setMainRoleName(r.label);
                                setRoleSearchModalVisible(false);
                              }}
                              activeOpacity={0.82}
                            >
                              <Text
                                style={[
                                  styles.editSelectorListItemText,
                                  { color: COLORS.textPrimary },
                                  isSelected && { color: COLORS.primary },
                                ]}
                                numberOfLines={1}
                              >
                                {translateRoleLabel(r.label)}
                              </Text>

                              {isSelected ? (
                                <Ionicons name="checkmark-circle" size={19} color={COLORS.primary} />
                              ) : null}
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </ScrollView>
                  )}
                </View>

                <TouchableOpacity
                  onPress={() => setRoleSearchModalVisible(false)}
                  style={[
                    styles.editSelectorCloseButton,
                    { backgroundColor: editModalPill, borderColor: COLORS.border },
                  ]}
                  activeOpacity={0.86}
                >
                  <Text style={[styles.editSelectorCloseText, { color: COLORS.textPrimary }]}>Close</Text>
                </TouchableOpacity>
              </View>
            ) : sideRoleModalVisible ? (
              <View
                style={[
                  styles.editSelectorCard,
                  {
                    backgroundColor: editModalBackground,
                    borderColor: COLORS.border,
                    shadowColor: isLight ? "rgba(0,0,0,0.22)" : "#000",
                  },
                ]}
              >
                <Text style={[styles.editSelectorTitle, { color: COLORS.textPrimary }]}>Add Side Roles</Text>

                <TextInput
                  value={roleSearchTerm}
                  onChangeText={(t) => {
                    setRoleSearchTerm(t);
                    fetchSearchRoles(t);
                  }}
                  placeholder="Start typing a role..."
                  placeholderTextColor={COLORS.textSecondary}
                  style={[
                    styles.editSelectorSearchInput,
                    {
                      backgroundColor: editModalInput,
                      borderColor: sideRoleSearchFocused ? COLORS.primary : COLORS.border,
                      color: COLORS.textPrimary,
                    },
                    WEB_NO_OUTLINE,
                  ]}
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoFocus
                  blurOnSubmit={false}
                  returnKeyType="search"
                  onFocus={() => setSideRoleSearchFocused(true)}
                  onBlur={() => setSideRoleSearchFocused(false)}
                />

                <View style={styles.editSelectorResultsArea}>
                  {searchingRoles ? (
                    <View style={styles.editSelectorLoadingWrap}>
                      <ActivityIndicator color={COLORS.primary} />
                    </View>
                  ) : (
                    <ScrollView
                      style={styles.editSelectorScroll}
                      keyboardShouldPersistTaps="handled"
                      showsVerticalScrollIndicator={false}
                    >
                      {roleSearchItems.length === 0 ? (
                        <Text style={[styles.editSelectorEmptyText, { color: COLORS.textSecondary }]}>
                          Type to search roles.
                        </Text>
                      ) : (
                        roleSearchItems.map((r) => {
                          const isSelected = sideRoles.includes(r.label);

                          return (
                            <TouchableOpacity
                              key={r.value}
                              style={[
                                styles.editSelectorListItem,
                                { borderColor: COLORS.border },
                                isSelected && {
                                  backgroundColor: editModalPillSelected,
                                  borderColor: COLORS.primary,
                                },
                              ]}
                              onPress={() => {
                                setSideRoles((prev) =>
                                  isSelected ? prev.filter((x) => x !== r.label) : [...prev, r.label]
                                );
                              }}
                              activeOpacity={0.82}
                            >
                              <Text
                                style={[
                                  styles.editSelectorListItemText,
                                  { color: COLORS.textPrimary },
                                  isSelected && { color: COLORS.primary },
                                ]}
                                numberOfLines={1}
                              >
                                {translateRoleLabel(r.label)}
                              </Text>

                              <Ionicons
                                name={isSelected ? "checkmark-circle" : "add-circle-outline"}
                                size={19}
                                color={isSelected ? COLORS.primary : COLORS.textSecondary}
                              />
                            </TouchableOpacity>
                          );
                        })
                      )}
                    </ScrollView>
                  )}
                </View>

                <TouchableOpacity
                  onPress={() => setSideRoleModalVisible(false)}
                  style={[
                    styles.editSelectorDoneButton,
                    { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
                  ]}
                  activeOpacity={0.88}
                >
                  <Text style={[styles.editSelectorDoneText, { color: COLORS.textOnPrimary }]}>Done</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </KeyboardAvoidingView>
        </InlineSelectorOverlay>
      </KeyboardAvoidingView>
    </SmoothModal>

    {/* Avatar cropper */}
    <AvatarCropper
      visible={cropperOpen}
      imageUri={cropSource || undefined}
      onCancel={() => {
        setCropperOpen(false);
        setCropSource(null);
      }}
      onCropped={handleAvatarCropped}
      fullName={fullName || profile?.full_name || ""}
      mainRoleName={mainRoleName || ""}
      cityName={cityName || ""}
      level={displayLevel}
    />

    {/* Supporters / Supporting Modal */}
    <ConnectionsModal
  visible={connectionsModalVisible}
  onClose={() => setConnectionsModalVisible(false)}
  userId={profile?.id ?? ""}
  profileOwnerName={isOwnProfile ? "You" : profile?.full_name || "This user"}
  onSelectUser={(id) => {
    setConnectionsModalVisible(false);
    navigation.navigate("Profile", { userId: id });
  }}
/>
    <ReportContentModal
      visible={reportOpen}
      title={
        reportTarget?.type === 'comment'
          ? 'Report Comment'
          : reportTarget?.type === 'submission'
          ? 'Report Film'
          : 'Report Profile'
      }
      subtitle={
        reportTarget?.type === 'comment'
          ? 'Tell us what happened. Comment reports are reviewed within 24 hours.'
          : reportTarget?.type === 'submission'
          ? 'Tell us what happened. Film reports are reviewed within 24 hours.'
          : 'Tell us what happened. Profile reports are reviewed within 24 hours.'
      }
      selectedReason={reportReason}
      details={reportDetails}
      submitting={reportSubmitting}
      onReasonChange={setReportReason}
      onDetailsChange={setReportDetails}
      onClose={() => {
        if (!reportSubmitting) {
          setReportOpen(false);
          setReportTarget(null);
        }
      }}
      onSubmit={submitProfileReport}
    />
  </>
);
} // ✅ CLOSE THE COMPONENT HERE

/* ======================= STYLES ======================= */
const styles = StyleSheet.create({
  heroWrap: { paddingTop: 0, paddingBottom: 12 },
  heroGrid: { flexDirection: "row", gap: GRID_GAP },
  heroLeft: { flex: 2 },
  heroLeftMobile: { width: "100%" },
  heroLeftDesktop: { minHeight: 420 },
  heroRight: { flex: 0.92, gap: GRID_GAP },

  webInfoRail: {
    backgroundColor: "rgba(255,255,255,0.012)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: 10,
    paddingVertical: 18,
    paddingHorizontal: 18,
    minHeight: 420,
    justifyContent: "flex-start",
  },

  heroImage: {
    borderRadius: 10,
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  heroImageMobile: {
    width: "100%",
    minHeight: 300,
    borderRadius: 10,
  },
  heroImageDesktop: {
    width: "100%",
    height: "100%",
    minHeight: 420,
  },
  heroImageInner: { resizeMode: "cover", opacity: 0.98 },
  heroGradient: { ...StyleSheet.absoluteFillObject },

  mobileBannerActions: {
    position: "absolute",
    right: 14,
    bottom: 16,
    width: 188,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 7,
    columnGap: 6,
    maxWidth: "52%",
    zIndex: 50,
    elevation: 50,
  },
  mobileBannerPrimaryBtn: {
    flexBasis: "48%",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 30,
    backgroundColor: "rgba(198,166,100,0.76)",
    borderWidth: 1,
    borderColor: "rgba(244,239,230,0.22)",
    paddingVertical: 4,
    paddingHorizontal: 7,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 4,
    borderRadius: 8,
  },
  mobileBannerPrimaryBtnText: {
    color: "#211A0E",
    fontWeight: "800",
    letterSpacing: 0.45,
    fontFamily: FONT_OBLIVION,
    fontSize: 9,
    textTransform: "uppercase",
    flexShrink: 1,
  },
  mobileBannerGhostBtn: {
    flexBasis: "48%",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 30,
    backgroundColor: "rgba(0,0,0,0.28)",
    borderWidth: 1,
    borderColor: "rgba(244,239,230,0.20)",
    paddingVertical: 4,
    paddingHorizontal: 7,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 4,
    borderRadius: 8,
  },
  mobileBannerGhostBtnActive: {
    backgroundColor: "rgba(198,166,100,0.12)",
    borderColor: "rgba(198,166,100,0.34)",
  },
  mobileBannerDangerBtn: {
    borderColor: "rgba(255,107,107,0.24)",
    backgroundColor: "rgba(255,107,107,0.055)",
  },
  mobileBannerGhostBtnText: {
    color: "rgba(244,239,230,0.86)",
    fontWeight: "800",
    letterSpacing: 0.45,
    fontFamily: FONT_OBLIVION,
    fontSize: 9,
    textTransform: "uppercase",
    flexShrink: 1,
  },
  roleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },

  heroRoleThin: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 52,
    letterSpacing: 3.2,
    fontWeight: "600",
    textAlign: "center",
    textTransform: "uppercase",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
  },
  heroMeta: {
  marginTop: 12,
  color: COLORS.textPrimary,
  fontFamily: FONT_OBLIVION,
  letterSpacing: 1.4,
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

  card: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: "#0A0A0A",
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  infoButtons: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    marginBottom: 8,
  },

  protocolTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  protocolBody: {
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  protocolButtons: {
    flexDirection: "row",
    gap: 8,
  },

  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.primary,
    minWidth: 0,
    alignItems: "center",
  },
  btnPrimaryText: {
    color: "#000",
    fontWeight: "800",
    letterSpacing: 0.7,
    fontFamily: FONT_OBLIVION,
    fontSize: 12,
    textTransform: "uppercase",
  },

  aboutCard: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    borderRadius: 0,
    padding: 0,
  },
  aboutTitle: {
    color: COLORS.textPrimary,
    fontWeight: "700",
    letterSpacing: 4,
    marginBottom: 10,
    fontFamily: FONT_OBLIVION,
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
    padding: 2,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarInner: {
    width: 80,
    height: 80,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.16)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarInnerMobile: {
    width: 74,
    height: 74,
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
  avatarAchievementFrame: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  mobileAchievementMeta: {
    marginTop: 5,
    maxWidth: 150,
    alignItems: "center",
  },
  mobileAchievementTitle: {
    fontFamily: FONT_OBLIVION,
    fontSize: 9,
    lineHeight: 11,
    fontWeight: "900",
    letterSpacing: 0.25,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowRadius: 6,
  },
  mobileAchievementDetail: {
    marginTop: 1,
    maxWidth: 150,
    color: "rgba(255,255,255,0.76)",
    fontFamily: FONT_OBLIVION,
    fontSize: 8.5,
    lineHeight: 10,
    letterSpacing: 0.1,
    textAlign: "center",
    textShadowColor: "rgba(0,0,0,0.65)",
    textShadowRadius: 6,
  },
  utilityCard: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    borderRadius: 0,
  },
  profileActionStack: {
    gap: 12,
    alignItems: "center",
  },
  profilePrimaryActions: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  profileAchievementMeta: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 8,
  },
  profileAchievementTitle: {
    fontSize: 11,
    lineHeight: 14,
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.55,
    fontWeight: "800",
    textTransform: "uppercase",
    textAlign: "center",
    maxWidth: "100%",
  },
  profileAchievementDetail: {
    fontSize: 10,
    lineHeight: 13,
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },
  profilePrimaryAction: {
    minHeight: 40,
    borderRadius: 9,
    paddingHorizontal: 18,
    paddingVertical: 9,
    backgroundColor: "rgba(198,166,100,0.88)",
    borderWidth: 1,
    borderColor: "rgba(244,239,230,0.20)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  profilePrimaryActionText: {
    color: "#000",
    fontFamily: FONT_OBLIVION,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.45,
    textTransform: "uppercase",
  },
  profileSecondaryAction: {
    minHeight: 40,
    borderRadius: 9,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: "rgba(255,255,255,0.035)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  profileSecondaryActionActive: {
    borderColor: "rgba(198,166,100,0.36)",
    backgroundColor: "rgba(198,166,100,0.10)",
  },
  profileSecondaryActionText: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.45,
    textTransform: "uppercase",
  },
  profileSafetyActions: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  profileSafetyAction: {
    minHeight: 34,
    borderRadius: 8,
    paddingHorizontal: 15,
    paddingVertical: 8,
    backgroundColor: "rgba(255,255,255,0.028)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  profileSafetyActionBlocked: {
    borderColor: "rgba(255,107,107,0.32)",
    backgroundColor: "rgba(255,107,107,0.08)",
  },
  profileSafetyActionText: {
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.45,
    textTransform: "uppercase",
  },
  utilityTopBar: {
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "transparent",
    borderRadius: 0,
  },

  utilityPrimaryBtn: {
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  utilityPrimaryBtnText: {
    color: "#000",
    fontWeight: "700",
    letterSpacing: 0.45,
    fontFamily: FONT_OBLIVION,
    fontSize: 11,
    textTransform: "uppercase",
  },

  utilityGhostBtn: {
    backgroundColor: "#0C0C0C",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  utilityGhostBtnText: {
    color: COLORS.textSecondary,
    fontWeight: "700",
    letterSpacing: 0.5,
    fontFamily: FONT_OBLIVION,
    fontSize: 11,
    textTransform: "uppercase",
  },

  utilityPrimaryBtnCompact: {
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 16,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },

heroRoleEpic: {
  textAlign: "center",
  textTransform: "uppercase",
  fontFamily: FONT_OBLIVION,
  color: "#FFF8EE",
  fontWeight: "900",
  textShadowColor: "rgba(0,0,0,0.65)",
  textShadowOffset: { width: 0, height: 3 },
  textShadowRadius: 14,
},

heroRoleEpicMobile: {
  fontSize: 22,
  lineHeight: 26,
  letterSpacing: 2.6,
  marginTop: 8,
},

heroRoleEpicDesktop: {
  fontSize: 42,
  lineHeight: 46,
  letterSpacing: 5,
  marginBottom: 10,
},

heroIdentityEpic: {
  textAlign: "center",
  textTransform: "uppercase",
  fontFamily: FONT_OBLIVION,
  color: "#F3E7D0",
  fontWeight: "800",
  textShadowColor: "rgba(0,0,0,0.55)",
  textShadowOffset: { width: 0, height: 2 },
  textShadowRadius: 10,
},

heroIdentityEpicMobile: {
  fontSize: 14,
  lineHeight: 20,
  letterSpacing: 1.4,
  marginTop: 10,
},

heroIdentityEpicDesktop: {
  fontSize: 22,
  lineHeight: 28,
  letterSpacing: 2.6,
  marginTop: 8,
},
  utilityGhostBtnCompact: {
    backgroundColor: "#0C0C0C",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },

  utilityTextActionBtn: {
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingVertical: 4,
    paddingHorizontal: 2,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },

  utilityTextActionBtnText: {
    color: COLORS.textPrimary,
    fontWeight: "700",
    letterSpacing: 0.8,
    fontFamily: FONT_OBLIVION,
    fontSize: 14,
    textTransform: "uppercase",
  },

  utilityPrimaryBtnMini: {
    backgroundColor: COLORS.primary,
    borderWidth: 1,
    borderColor: COLORS.primary,
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 12,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  utilityGhostBtnMini: {
    backgroundColor: "#0C0C0C",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 7,
    paddingVertical: 6,
    paddingHorizontal: 10,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  utilityMiniBtnText: {
    color: COLORS.textSecondary,
    fontWeight: "700",
    letterSpacing: 0.4,
    fontFamily: FONT_OBLIVION,
    fontSize: 10,
    textTransform: "uppercase",
  },
  utilityMiniPrimaryBtnText: {
    color: "#000",
    fontWeight: "800",
    letterSpacing: 0.4,
    fontFamily: FONT_OBLIVION,
    fontSize: 10,
    textTransform: "uppercase",
  },
  utilitySingleLinkBtn: {
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingVertical: 4,
    paddingHorizontal: 0,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },

  utilitySingleLinkBtnText: {
    color: COLORS.primary,
    fontWeight: "700",
    letterSpacing: 1,
    fontFamily: FONT_OBLIVION,
    fontSize: 11,
    textTransform: "uppercase",
    opacity: 0.95,
  },

  utilitySingleLinkBtnMobile: {
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingVertical: 2,
    paddingHorizontal: 0,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  utilitySingleLinkBtnTextMobile: {
    color: COLORS.primary,
    fontWeight: "700",
    letterSpacing: 0.4,
    fontFamily: FONT_OBLIVION,
    fontSize: 9,
    textTransform: "uppercase",
    opacity: 0.95,
  },
  utilityBareMiniBtn: {
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingVertical: 2,
    paddingHorizontal: 0,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  utilityBareMiniBtnText: {
    color: COLORS.textSecondary,
    fontWeight: "600",
    letterSpacing: 0.3,
    fontFamily: FONT_OBLIVION,
    fontSize: 9,
    textTransform: "uppercase",
    opacity: 0.9,
  },

  utilityBarePreviewBtn: {
    backgroundColor: "transparent",
    borderWidth: 0,
    paddingVertical: 2,
    paddingHorizontal: 0,
    minHeight: 0,
    alignItems: "center",
    justifyContent: "center",
  },

  utilityBarePreviewBtnText: {
    color: COLORS.primary,
    fontWeight: "700",
    letterSpacing: 0.4,
    fontFamily: FONT_OBLIVION,
    fontSize: 9,
    textTransform: "uppercase",
  },
  gamifyWrap: {
    marginTop: 10,
    alignItems: "center",
  },
  gamifyTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
    fontFamily: FONT_OBLIVION,
  },
  gamifyRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 5,
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

    cityModalSafeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  cityModalShell: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 16,
  },

  cityModalHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  cityModalTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0,
  },

  cityModalCloseIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  citySearchInput: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.card,
    fontFamily: FONT_OBLIVION,
  },

  cityModalLoadingWrap: {
    paddingTop: 24,
  },

  cityListContent: {
    paddingTop: 12,
    paddingBottom: 10,
  },

  cityPickerItem: {
    minHeight: 58,
    borderRadius: 10,
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  cityPickerItemSelected: {
    borderColor: COLORS.primary,
    backgroundColor: '#0E0D09',
  },

  cityPickerItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    paddingRight: 10,
  },

  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: COLORS.textSecondary,
    alignItems: 'center',
    justifyContent: 'center',
  },

  radioOuterSelected: {
    borderColor: COLORS.primary,
  },

  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },

  cityPickerText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: '700',
  },

  cityPickerTextSelected: {
    color: COLORS.textPrimary,
    fontWeight: '800',
  },

  bestMatchBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#18140B',
    borderWidth: 1,
    borderColor: '#3D3119',
  },

  bestMatchText: {
    fontSize: 10,
    color: COLORS.primary,
    fontFamily: FONT_OBLIVION,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },

  emptySearchState: {
    paddingVertical: 24,
    alignItems: 'center',
  },

  cityModalCancelButton: {
    marginTop: 4,
    minHeight: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  cityModalCancelText: {
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 14,
    fontWeight: '700',
    textTransform: 'uppercase',
  },

  profileSubmissionList: {
    gap: 12,
  },
  profileSubmissionTile: {
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileSubmissionTileOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 9,
    paddingVertical: 8,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  profileSubmissionTileTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 12,
    fontWeight: '800',
  },
  profileSubmissionTileMeta: {
    marginTop: 2,
    color: COLORS.primary,
    fontFamily: FONT_OBLIVION,
    fontSize: 10,
    fontWeight: '800',
  },
  profileSubmissionRow: {
    minHeight: 92,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#090909',
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileSubmissionRowPressed: {
    backgroundColor: '#101010',
    borderColor: 'rgba(198,166,100,0.28)',
  },
  profileSubmissionThumb: {
    width: 132,
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  profileSubmissionThumbFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#080808',
  },
  profileSubmissionQualityBadge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: 'rgba(0,0,0,0.72)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  profileSubmissionQualityText: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 9,
    fontWeight: '700',
  },
  profileSubmissionCopy: {
    flex: 1,
    minWidth: 0,
    gap: 5,
  },
  profileSubmissionTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '800',
  },
  profileSubmissionMeta: {
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  hiddenSubmissionList: {
    marginTop: 8,
    gap: 10,
  },
  hiddenSubmissionRow: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
    padding: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  hiddenSubmissionThumb: {
    width: 64,
    aspectRatio: 16 / 9,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: COLORS.cardAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hiddenSubmissionCopy: {
    flex: 1,
    minWidth: 0,
  },
  hiddenSubmissionTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 13,
    fontWeight: '800',
  },
  hiddenSubmissionMeta: {
    marginTop: 2,
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 11,
  },
  hiddenSubmissionAction: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(198,166,100,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.35)',
  },
  hiddenSubmissionActionText: {
    color: COLORS.primary,
    fontFamily: FONT_OBLIVION,
    fontSize: 11,
    fontWeight: '800',
    textTransform: 'uppercase',
  },

  profileWatchOverlay: {
    flex: 1,
    backgroundColor: "#000000",
    alignItems: "stretch",
    justifyContent: "flex-start",
  },
  profileWatchFixedClose: {
    position: "absolute",
    zIndex: 100,
    elevation: 100,
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  profileWatchCard: {
    width: "100%",
    overflow: "hidden",
    backgroundColor: "#000",
    borderColor: "rgba(255,255,255,0.08)",
    shadowColor: "#000",
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  profileWatchCardMobile: {
    flex: 1,
    maxHeight: "100%",
    borderRadius: 0,
    borderWidth: 0,
  },
  profileWatchScroll: {
    flex: 1,
    width: "100%",
  },
  profileWatchFullscreenContent: {
    flexGrow: 1,
    width: "100%",
  },
  profileWatchFullscreenLayout: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
  },
  profileWatchFullscreenLayoutMobile: {
    flexDirection: "column",
  },
  profileWatchMainColumn: {
    flexShrink: 0,
    minWidth: 0,
  },
  profileWatchDetailsPanel: {
    width: "100%",
    paddingTop: 0,
    paddingBottom: 8,
  },
  profileWatchSideRail: {
    flexShrink: 0,
    minWidth: 0,
    paddingTop: 1,
    paddingRight: 2,
  },
  showreelPreviewOverlay: {
    flex: 1,
    backgroundColor: "#050505",
    alignItems: "stretch",
    justifyContent: "center",
  },
  showreelPreviewHeader: {
    position: "absolute",
    left: 72,
    right: 72,
    zIndex: 90,
    elevation: 90,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none" as any,
  },
  showreelPreviewTitle: {
    color: "#F4EFE6",
    fontFamily: FONT_OBLIVION,
    fontWeight: "800",
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    fontSize: 16,
    textShadowColor: "rgba(0,0,0,0.72)",
    textShadowRadius: 10,
  },
  showreelPreviewClose: {
    position: "absolute",
    zIndex: 100,
    elevation: 100,
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.20)",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  showreelPreviewBody: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  showreelPreviewPlayerWrap: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  profileWatchContent: {
    paddingBottom: 16,
  },
  profileWatchTopBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    marginBottom: 8,
    zIndex: 30,
    elevation: 30,
  },
  profileWatchCloseCircle: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  profileWatchPlayerWrap: {
    width: "100%",
    alignItems: "flex-start",
    justifyContent: "center",
    borderRadius: Platform.OS === "web" ? 10 : 0,
    overflow: "hidden",
    backgroundColor: "#000",
    borderWidth: Platform.OS === "web" ? StyleSheet.hairlineWidth : 0,
    borderColor: "rgba(255,255,255,0.08)",
    marginBottom: 10,
  },
  profileWatchPlayerFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  profileWatchMetaBlock: {
    paddingBottom: 0,
    marginBottom: 8,
  },
  profileWatchTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "800",
    fontSize: 19,
    lineHeight: 24,
  },
  profileWatchCreatorRow: {
    marginTop: 7,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  profileWatchCreatorTap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    maxWidth: "100%",
    minWidth: 0,
  },
  profileWatchSupportButton: {
    minHeight: 24,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  profileWatchSupportText: {
    fontFamily: FONT_OBLIVION,
    fontWeight: "700",
    fontSize: 9,
    letterSpacing: 0.35,
    textTransform: "uppercase",
  },
  profileWatchCreatorAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    backgroundColor: "rgba(198,166,100,0.16)",
    borderWidth: 1,
    borderColor: "rgba(198,166,100,0.26)",
  },
  profileWatchCreatorAvatarImage: {
    width: "100%",
    height: "100%",
  },
  profileWatchCreatorAvatarText: {
    color: COLORS.primary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "900",
    fontSize: 13,
  },
  profileWatchCreatorName: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "900",
    fontSize: 12.5,
    lineHeight: 15,
  },
  profileWatchCreatorMeta: {
    marginTop: 1,
    color: "rgba(216,210,200,0.62)",
    fontFamily: FONT_OBLIVION,
    fontWeight: "700",
    fontSize: 10.5,
    lineHeight: 13,
  },
  profileWatchCreditsInlineWrap: {
    flex: 1,
    minWidth: Platform.OS === "web" ? 200 : 150,
    maxWidth: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 10,
  },
  profileWatchCreditPerson: {
    maxWidth: Platform.OS === "web" ? 185 : 178,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingRight: 4,
  },
  profileWatchCreditAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#050505",
  },
  profileWatchCreditAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(198,166,100,0.14)",
    borderWidth: 1,
    borderColor: "rgba(198,166,100,0.22)",
  },
  profileWatchCreditAvatarInitial: {
    color: COLORS.primary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "900",
    fontSize: 10.5,
  },
  profileWatchCreditTextWrap: {
    minWidth: 0,
    flexShrink: 1,
  },
  profileWatchCreditName: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "900",
    fontSize: 11,
    lineHeight: 13,
  },
  profileWatchCreditRole: {
    marginTop: 0,
    color: COLORS.primary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "800",
    fontSize: 10,
    lineHeight: 12,
  },
  profileWatchActionsRow: {
    marginTop: 9,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
  },
  profileWatchActionChip: {
    minHeight: 28,
    borderRadius: 7,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.075)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  profileWatchActionChipIconOnly: {
    width: 30,
    paddingHorizontal: 0,
  },
  profileWatchActionChipActive: {
    backgroundColor: "rgba(198,166,100,0.12)",
    borderColor: "rgba(198,166,100,0.35)",
  },
  profileWatchDangerChip: {
    backgroundColor: "rgba(255,70,70,0.075)",
    borderColor: "rgba(255,90,90,0.22)",
  },
  profileWatchActionText: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 0,
  },
  profileWatchActionMeta: {
    color: "rgba(216,210,200,0.54)",
    fontFamily: FONT_OBLIVION,
    fontWeight: "800",
    fontSize: 10.5,
  },
  profileWatchDangerText: {
    color: COLORS.danger,
    fontFamily: FONT_OBLIVION,
    fontWeight: "700",
    fontSize: 11,
    letterSpacing: 0.2,
  },
  profileWatchMoreMenu: {
    alignSelf: "flex-start",
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 4,
    minWidth: 158,
  },
  profileWatchMoreMenuItem: {
    minHeight: 32,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  profileWatchMoreMenuText: {
    fontFamily: FONT_OBLIVION,
    fontSize: 11,
    fontWeight: "900",
  },
  profileWatchDescriptionPanel: {
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  profileWatchDescriptionMeta: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "900",
    fontSize: 11.5,
    lineHeight: 15,
  },
  profileWatchDescriptionText: {
    marginTop: 4,
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "600",
    fontSize: 11.5,
    lineHeight: 16,
  },
  profileWatchCommentsPreview: {
    borderRadius: 8,
    backgroundColor: "#0B0B0B",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    paddingHorizontal: 10,
    paddingVertical: 9,
    marginBottom: 10,
  },
  profileWatchCommentsPreviewHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  profileWatchCommentsPreviewTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "900",
    fontSize: 13,
  },
  profileWatchCommentsPreviewCount: {
    color: "rgba(216,210,200,0.56)",
    fontFamily: FONT_OBLIVION,
    fontWeight: "800",
    fontSize: 12,
    flex: 1,
  },
  profileWatchCommentsPreviewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    marginTop: 10,
  },
  profileWatchCommentsPreviewAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#000",
  },
  profileWatchCommentsPreviewAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(198,166,100,0.16)",
  },
  profileWatchCommentsPreviewInitial: {
    color: COLORS.primary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "900",
    fontSize: 11,
  },
  profileWatchCommentsPreviewBody: {
    flex: 1,
    minWidth: 0,
  },
  profileWatchCommentsPreviewName: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "900",
    fontSize: 11,
  },
  profileWatchCommentsPreviewText: {
    marginTop: 2,
    color: "rgba(216,210,200,0.70)",
    fontFamily: FONT_OBLIVION,
    fontWeight: "600",
    fontSize: 12,
    lineHeight: 16,
  },
  profileWatchCommentsPreviewInput: {
    height: 34,
    borderRadius: 8,
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)",
    justifyContent: "center",
    paddingHorizontal: 12,
    marginTop: 10,
  },
  profileWatchCommentsPreviewInputText: {
    color: "rgba(216,210,200,0.42)",
    fontFamily: FONT_OBLIVION,
    fontWeight: "700",
    fontSize: 12,
  },
  profileWatchSuggestionsSection: {
    paddingTop: 0,
    paddingBottom: 4,
  },
  profileWatchSectionTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "900",
    fontSize: 13,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  profileWatchSuggestionsList: {
    gap: 5,
  },
  profileWatchSuggestionCard: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 8,
    backgroundColor: "transparent",
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  profileWatchSuggestionThumb: {
    width: 128,
    aspectRatio: 16 / 9,
    borderRadius: 7,
    backgroundColor: "#080808",
  },
  profileWatchSuggestionThumbDesktop: {
    width: 168,
  },
  profileWatchSuggestionFallback: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  profileWatchSuggestionBody: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  profileWatchSuggestionTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "900",
    fontSize: 13,
    lineHeight: 17,
  },
  profileWatchSuggestionCreator: {
    marginTop: 4,
    color: "rgba(216,210,200,0.55)",
    fontFamily: FONT_OBLIVION,
    fontWeight: "700",
    fontSize: 11.5,
    lineHeight: 14,
  },
  profileWatchSuggestionMeta: {
    marginTop: 2,
    color: "rgba(216,210,200,0.45)",
    fontFamily: FONT_OBLIVION,
    fontWeight: "700",
    fontSize: 10.5,
    lineHeight: 13,
  },

  submissionModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  },
  submissionModalTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "900",
    fontSize: 18,
    lineHeight: 22,
  },
  submissionModalMeta: {
    marginTop: 3,
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 11,
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  submissionModalCloseIcon: {
    width: 38,
    height: 38,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  submissionModalActions: {
    gap: 10,
    marginTop: 12,
  },
  profileCommentsPanel: {
    marginTop: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#080808",
    overflow: "hidden",
  },
  profileCommentsHeader: {
    minHeight: 44,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.07)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  profileCommentsHeaderActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  profileCommentsCollapseBtn: {
    width: 26,
    height: 26,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  profileCommentsTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 12.5,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  profileCommentsSubtitle: {
    marginTop: 1,
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 10.5,
  },
  profileCommentsLoading: {
    minHeight: 86,
    alignItems: "center",
    justifyContent: "center",
  },
  profileCommentsEmpty: {
    minHeight: 96,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  profileCommentsEmptyTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 14,
    fontWeight: "900",
  },
  profileCommentsEmptyText: {
    marginTop: 4,
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 12,
  },
  profileCommentsList: {
    maxHeight: 220,
  },
  profileCommentsListContent: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    gap: 2,
  },
  profileCommentCard: {
    flexDirection: "row",
    gap: 9,
    borderRadius: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
    borderColor: "rgba(255,255,255,0.06)",
    paddingHorizontal: 0,
    paddingVertical: 7,
  },
  profileCommentAvatarTap: {
    width: 30,
    height: 30,
    borderRadius: 15,
  },
  profileCommentAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#111",
  },
  profileCommentAvatarFallback: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  profileCommentAvatarText: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 12,
    fontWeight: "900",
  },
  profileCommentBody: {
    flex: 1,
    minWidth: 0,
  },
  profileCommentTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  profileCommentNameTap: {
    flex: 1,
    minWidth: 0,
  },
  profileCommentName: {
    flex: 1,
    minWidth: 0,
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 12,
    fontWeight: "900",
  },
  profileCommentText: {
    marginTop: 3,
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 12.5,
    lineHeight: 17,
  },
  profileCommentReport: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 0,
    backgroundColor: "transparent",
  },
  profileCommentReportText: {
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.15,
    textTransform: "uppercase",
  },
  profileCommentComposer: {
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.07)",
    padding: 8,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 7,
  },
  profileCommentInput: {
    flex: 1,
    minHeight: 36,
    maxHeight: 82,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0F0F0F",
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontSize: 12,
    lineHeight: 17,
    paddingHorizontal: 11,
    paddingVertical: 8,
  },
  profileCommentPostBtn: {
    minHeight: 36,
    minWidth: 64,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.primary,
    paddingHorizontal: 12,
  },
  profileCommentPostText: {
    color: "#000",
    fontFamily: FONT_OBLIVION,
    fontSize: 10.5,
    fontWeight: "900",
    letterSpacing: 0.45,
    textTransform: "uppercase",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "#000000CC",
    justifyContent: "flex-end",
    paddingHorizontal: 10,
    paddingTop: 0,
  },
  modalContainer: {
    backgroundColor: COLORS.cardAlt,
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 10,
    height: "94%",
    width: "100%",
    maxWidth: Platform.OS === "web" ? 960 : "100%",
    alignSelf: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: "auto",
  },
  editSelectorOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 120,
    elevation: 120,
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  editSelectorKeyboard: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  editSelectorCard: {
    width: "100%",
    maxWidth: 620,
    height: 460,
    alignSelf: "center",
    borderRadius: 12,
    borderWidth: 1,
    padding: 18,
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  editSelectorTitle: {
    fontSize: 19,
    fontWeight: "800",
    marginBottom: 14,
    textAlign: "center",
    letterSpacing: 0.8,
    fontFamily: FONT_OBLIVION,
    textTransform: "uppercase",
  },
  editSelectorSearchInput: {
    borderRadius: 9,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    fontFamily: FONT_OBLIVION,
    fontSize: 15,
  },
  editSelectorResultsArea: {
    flex: 1,
    minHeight: 0,
    marginTop: 10,
  },
  editSelectorLoadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  editSelectorScroll: {
    width: "100%",
    flex: 1,
  },
  editSelectorListItem: {
    minHeight: 52,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  editSelectorListItemText: {
    flex: 1,
    fontSize: 15,
    textAlign: "center",
    fontFamily: FONT_OBLIVION,
    fontWeight: "600",
  },
  editSelectorEmptyText: {
    marginTop: 24,
    textAlign: "center",
    fontSize: 13,
    fontFamily: FONT_OBLIVION,
    lineHeight: 18,
  },
  editSelectorCloseButton: {
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  editSelectorCloseText: {
    fontSize: 14,
    fontWeight: "700",
    fontFamily: FONT_OBLIVION,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  editSelectorDoneButton: {
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  editSelectorDoneText: {
    fontSize: 14,
    fontWeight: "900",
    fontFamily: FONT_OBLIVION,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  compactSupportBtn: {
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  compactSupportBtnActive: {
    backgroundColor: "#1C1C1C",
    borderColor: "#444",
  },
  compactSupportBtnInactive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  compactSupportBtnText: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    fontFamily: FONT_OBLIVION,
    textTransform: "uppercase",
  },

  modalHandle: {
    width: 56,
    height: 5,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignSelf: "center",
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: "700",
    color: COLORS.textPrimary,
    textAlign: "center",
    letterSpacing: 1.4,
    fontFamily: FONT_OBLIVION,
    textTransform: "uppercase",
    marginBottom: 6,
  },

  field: { marginTop: 18 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginBottom: 8,
    marginLeft: 2,
    fontFamily: FONT_OBLIVION,
    letterSpacing: 1.1,
    textTransform: "uppercase",
    opacity: 0.92,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 9,
    paddingVertical: 14,
    paddingHorizontal: 16,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.card,
    fontFamily: FONT_OBLIVION,
    fontSize: 15,
    letterSpacing: 0.2,
    outlineStyle: "none" as any,
  },
  multiline: { minHeight: 100 },

  pickerBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 9,
    paddingVertical: 14,
    paddingHorizontal: 14,
    backgroundColor: COLORS.card,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  inputFocused: {
    borderColor: COLORS.primary,
    backgroundColor: "#0A0A0A",
  },
  pickerBtnText: {
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 15,
    letterSpacing: 0.2,
  },

  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 13,
    alignItems: "center",
  },
  primaryBtnText: {
    color: "#000",
    fontWeight: "800",
    letterSpacing: 1,
    fontFamily: FONT_OBLIVION,
    textTransform: "uppercase",
    fontSize: 13,
  },

  ghostBtn: {
    backgroundColor: "transparent",
    borderColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderRadius: 9,
    paddingVertical: 13,
    alignItems: "center",
  },
  ghostBtnText: {
    color: COLORS.textPrimary,
    fontWeight: "700",
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.6,
    textTransform: "uppercase",
    fontSize: 12,
  },
heroRoleBond: {
  textAlign: "center",
  textTransform: "uppercase",
  fontFamily: FONT_OBLIVION,
  color: "#F5EFE4",
  fontWeight: "700",
  textShadowColor: "rgba(0,0,0,0.38)",
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 6,
},

heroRoleBondMobile: {
  fontSize: 17,
  lineHeight: 20,
  letterSpacing: 4.8,
  marginTop: 6,
},

heroRoleBondDesktop: {
  fontSize: 31,
  lineHeight: 35,
  letterSpacing: 8.5,
  marginBottom: 10,
},

heroIdentityBond: {
  textAlign: "center",
  textTransform: "uppercase",
  fontFamily: FONT_OBLIVION,
  color: "#D2AE67",
  fontWeight: "600",
  textShadowColor: "rgba(0,0,0,0.28)",
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 4,
},

heroIdentityBondMobile: {
  fontSize: 11,
  lineHeight: 15,
  letterSpacing: 2.2,
  marginTop: 8,
},

heroIdentityBondDesktop: {
  fontSize: 14,
  lineHeight: 18,
  letterSpacing: 4.6,
  marginTop: 6,
},
  uploadRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  pillBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#0A0A0A",
  },
  pillText: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "700",
    letterSpacing: 0.45,
    textTransform: "uppercase",
    fontSize: 12,
  },
});

const block = StyleSheet.create({
  section: { marginTop: 34 },

  h3Centered: {
    color: COLORS.textSecondary,
    fontSize: 10,
    fontWeight: "600",
    marginBottom: 10,
    letterSpacing: 2.1,
    textAlign: "center",
    fontFamily: FONT_OBLIVION,
    textTransform: "uppercase",
    opacity: 0.9,
  },
  muted: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.2,
  },

  sectionTitleCentered: {
    color: "rgba(255,255,255,0.92)",
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 3.2,
    marginBottom: 18,
    textAlign: "center",
    fontFamily: FONT_OBLIVION,
    textTransform: "uppercase",
    opacity: 0.96,
  },

  mediaCard: {
    backgroundColor: "#000",
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  videoWrap: {
    width: "100%",
    alignSelf: "center",
    backgroundColor: "#000",
    justifyContent: "center",
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
  closeDot: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: COLORS.primary,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: COLORS.primary,
  },

  protocolTitle: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
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
  protocolButtons: {
    flexDirection: "row",
    gap: 10,
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
    fontFamily: FONT_OBLIVION,
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

  row: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  rowBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: COLORS.primary,
  },
  rowBtnText: {
    color: "#000",
    fontWeight: "800",
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontSize: 11,
  },
  rowBtnGhost: {
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 9,
    marginLeft: 0,
    backgroundColor: "#0C0C0C",
  },
  rowBtnGhostText: {
    color: COLORS.textPrimary,
    fontWeight: "700",
    fontFamily: FONT_OBLIVION,
    letterSpacing: 0.5,
    textTransform: "uppercase",
    fontSize: 11,
  },

  viewerOverlay: {
    flex: 1,
    backgroundColor: "#000000EE",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
  },
  viewerImageFrame: {
    alignItems: "center",
    justifyContent: "center",
  },
  viewerImage: { width: "100%", height: "100%" },
  viewerCloseHint: {
    position: "absolute",
    bottom: 24,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "#ffffff22",
    borderRadius: 8,
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

const centered = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "#000000CC",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    backgroundColor: COLORS.cardAlt,
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  title: {
    color: COLORS.textPrimary,
    fontWeight: "700",
    fontSize: 18,
    textAlign: "center",
    marginBottom: 8,
    fontFamily: FONT_OBLIVION,
    letterSpacing: 2.6,
    textTransform: "uppercase",
  },
});

const showreelSetup = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    elevation: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  panel: {
    width: '100%',
    maxWidth: 900,
    maxHeight: '92%',
    borderRadius: 10,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 16,
    paddingBottom: 13,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(198,166,100,0.14)',
    backgroundColor: '#0B0907',
  },
  title: {
    fontFamily: FONT_OBLIVION,
    color: '#F7F2E8',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  subtitle: {
    marginTop: 4,
    fontFamily: FONT_OBLIVION,
    color: 'rgba(247,242,232,0.58)',
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  bodyScroll: {
    maxHeight: 580,
  },
  bodyContent: {
    padding: 18,
    paddingBottom: 16,
  },
  uploadGrid: {
    gap: 16,
  },
  uploadGridDesktop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  videoColumn: {
    flex: 1.5,
    minWidth: 0,
  },
  sideColumn: {
    flex: 1,
    minWidth: 270,
    gap: 13,
  },
  fieldLabel: {
    fontFamily: FONT_OBLIVION,
    color: '#F7F2E8',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
    marginBottom: 7,
  },
  videoDropzone: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(247,242,232,0.12)',
    backgroundColor: '#020202',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  thumbDropzone: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(247,242,232,0.12)',
    backgroundColor: '#11100E',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dropzoneHover: {
    borderColor: 'rgba(198,166,100,0.58)',
    backgroundColor: '#15120D',
  },
  dropzoneSelected: {
    borderColor: 'rgba(198,166,100,0.42)',
  },
  dropzoneError: {
    borderColor: 'rgba(255,122,122,0.82)',
  },
  dropzoneEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 22,
    gap: 7,
  },
  dropzoneEmptyCompact: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 5,
  },
  dropzoneTitle: {
    color: '#F7F2E8',
    fontFamily: FONT_OBLIVION,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 18,
  },
  dropzoneTitleSmall: {
    color: '#F7F2E8',
    fontFamily: FONT_OBLIVION,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 16,
  },
  dropzoneHint: {
    color: 'rgba(247,242,232,0.48)',
    fontFamily: FONT_OBLIVION,
    fontSize: 10.5,
    fontWeight: '600',
  },
  previewMedia: {
    width: '100%',
    height: '100%',
  },
  videoChangeBadge: {
    position: 'absolute',
    right: 9,
    bottom: 9,
    minHeight: 26,
    borderRadius: 7,
    paddingHorizontal: 9,
    backgroundColor: 'rgba(0,0,0,0.66)',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.32)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  videoChangeBadgeHover: {
    backgroundColor: 'rgba(20,16,10,0.86)',
    borderColor: 'rgba(198,166,100,0.58)',
  },
  videoChangeText: {
    color: '#F6E7BD',
    fontFamily: FONT_OBLIVION,
    fontSize: 10,
    fontWeight: '700',
  },
  helperText: {
    marginTop: 8,
    color: 'rgba(247,242,232,0.46)',
    fontFamily: FONT_OBLIVION,
    fontSize: 10.5,
    lineHeight: 15,
  },
  categoryBlock: {
    marginTop: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  sectionHint: {
    color: 'rgba(247,242,232,0.44)',
    fontFamily: FONT_OBLIVION,
    fontSize: 10.5,
    fontWeight: '600',
  },
  categoryGrid: {
    gap: 7,
  },
  categoryCard: {
    minHeight: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(247,242,232,0.10)',
    backgroundColor: '#11100E',
    paddingHorizontal: 9,
    paddingVertical: 7,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  categoryCardHover: {
    borderColor: 'rgba(247,242,232,0.20)',
    backgroundColor: '#17140F',
  },
  categoryCardSelected: {
    borderColor: '#C6A664',
    backgroundColor: 'rgba(198,166,100,0.10)',
  },
  categoryIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(247,242,232,0.12)',
    backgroundColor: '#090806',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryIconSelected: {
    borderColor: 'rgba(198,166,100,0.58)',
    backgroundColor: 'rgba(198,166,100,0.12)',
  },
  categoryTitle: {
    color: '#F7F2E8',
    fontFamily: FONT_OBLIVION,
    fontSize: 11.5,
    fontWeight: '700',
  },
  categoryDetail: {
    marginTop: 1,
    color: 'rgba(247,242,232,0.44)',
    fontFamily: FONT_OBLIVION,
    fontSize: 10,
    fontWeight: '600',
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: 'rgba(198,166,100,0.14)',
    backgroundColor: '#0B0907',
    paddingHorizontal: 18,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  validationWrap: {
    flex: 1,
    minWidth: 0,
  },
  validationText: {
    color: 'rgba(247,242,232,0.50)',
    fontFamily: FONT_OBLIVION,
    fontSize: 11,
    fontWeight: '600',
  },
  validationReady: {
    color: 'rgba(198,166,100,0.92)',
  },
  errorText: {
    color: '#FF8A8A',
    fontFamily: FONT_OBLIVION,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 15,
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  footerButton: {
    minHeight: 34,
    minWidth: 94,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerButtonGhost: {
    backgroundColor: '#10100E',
    borderColor: 'rgba(247,242,232,0.14)',
  },
  footerButtonGhostHover: {
    backgroundColor: '#17140F',
    borderColor: 'rgba(247,242,232,0.24)',
  },
  footerButtonPrimary: {
    backgroundColor: '#C6A664',
    borderColor: '#C6A664',
  },
  footerButtonPrimaryHover: {
    backgroundColor: '#D3B673',
    borderColor: '#D3B673',
  },
  footerButtonDisabled: {
    opacity: 0.48,
  },
  footerButtonGhostText: {
    color: '#F7F2E8',
    fontFamily: FONT_OBLIVION,
    fontSize: 11,
    fontWeight: '800',
  },
  footerButtonPrimaryText: {
    color: '#0A0805',
    fontFamily: FONT_OBLIVION,
    fontSize: 11,
    fontWeight: '800',
  },
  progressState: {
    padding: 18,
    gap: 14,
  },
  progressTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  progressIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.35)',
    backgroundColor: 'rgba(198,166,100,0.10)',
  },
  progressTitle: {
    color: '#F7F2E8',
    fontFamily: FONT_OBLIVION,
    fontSize: 13,
    fontWeight: '900',
  },
  progressBody: {
    marginTop: 2,
    color: 'rgba(247,242,232,0.52)',
    fontFamily: FONT_OBLIVION,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 15,
  },
  progressPercent: {
    color: '#C6A664',
    fontFamily: FONT_OBLIVION,
    fontSize: 18,
    fontWeight: '900',
  },
  progressThumb: {
    width: 160,
    aspectRatio: 16 / 9,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(247,242,232,0.10)',
    backgroundColor: '#000',
  },
  progressTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#15130F',
    borderWidth: 1,
    borderColor: 'rgba(247,242,232,0.10)',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#C6A664',
  },
  progressFootnote: {
    color: 'rgba(247,242,232,0.48)',
    fontFamily: FONT_OBLIVION,
    fontSize: 10.5,
    lineHeight: 15,
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
    left: 12,
    right: 12,
    bottom: 8,
    height: 18,
    justifyContent: "center",
    zIndex: 20,
    elevation: 20,
  },
  progressTrack: {
    height: 2,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.22)",
    overflow: "hidden",
  },
  progressFill: {
    height: 2,
    borderRadius: 999,
    backgroundColor: GOLD,
  },
  progressThumb: {
    position: "absolute",
    top: -4,
    width: 10,
    height: 10,
    marginLeft: -5,
    borderRadius: 5,
    backgroundColor: GOLD,
  },
  playerChromeDock: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 8,
    paddingHorizontal: 10,
    paddingTop: 7,
    paddingBottom: 7,
    borderRadius: 10,
    backgroundColor: "rgba(5,5,5,0.58)",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 10,
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
    fontFamily: FONT_OBLIVION,
  },
  centerCue: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 76,
    height: 76,
    marginLeft: -38,
    marginTop: -38,
    borderRadius: 38,
    backgroundColor: "rgba(0,0,0,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 8,
  },
  loadingOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 14,
    elevation: 14,
    gap: 8,
  },
  loadingBubble: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
  },
  loadingText: {
    maxWidth: "82%",
    color: "#F7F2E8",
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
    fontFamily: FONT_OBLIVION,
    textShadowColor: "rgba(0,0,0,0.7)",
    textShadowRadius: 8,
  },
  fsButton: {
    position: "absolute",
    left: 10,
    top: 10,
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
    elevation: 20,
  },
  soundBtn: {
    position: "absolute",
    right: 10,
    top: 10,
    minHeight: 36,
    paddingHorizontal: 10,
    backgroundColor: "rgba(0,0,0,0.58)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    zIndex: 20,
    elevation: 20,
  },
  qualityBtn: {
    position: "absolute",
    right: 10,
    top: 10,
    minHeight: 36,
    paddingHorizontal: 10,
    backgroundColor: "rgba(0,0,0,0.58)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    zIndex: 20,
    elevation: 20,
  },
  qualityBtnText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontFamily: FONT_OBLIVION,
  },
  qualityMenu: {
    position: "absolute",
    right: 10,
    top: 52,
    minWidth: 124,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    overflow: "hidden",
    paddingVertical: 4,
    zIndex: 22,
    elevation: 22,
  },
  qualityMenuItem: {
    minHeight: 34,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  qualityMenuItemSelected: {
    backgroundColor: "rgba(198,166,100,0.14)",
  },
  qualityMenuText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    fontFamily: FONT_OBLIVION,
  },
  qualityMenuTextSelected: {
    color: GOLD,
  },
  soundText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0.4,
    fontFamily: FONT_OBLIVION,
  },
});
