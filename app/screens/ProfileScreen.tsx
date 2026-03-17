// TODO: Apply full LinkedIn-style connections transformation
// UPDATED PROFILESCREEN WITH LINKEDIN-STYLE CONNECTIONS (placeholder)
// app/screens/ProfileScreen.tsx — Noir portfolio refit + Showreels manager

import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  SafeAreaView,
  Animated,
  Easing,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openChat } from '../navigation/navigationRef';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { Audio, Video, ResizeMode, VideoFullscreenUpdate, AVPlaybackStatus } from 'expo-av';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import AvatarCropper from '../../components/AvatarCropper';
import ConnectionsModal from '../../components/ConnectionsModal';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuth } from '../context/AuthProvider';
import { Upload } from 'tus-js-client';
import { supportUser, unsupportUser } from "../lib/connections";
import * as FileSystem from "expo-file-system";
import { Buffer } from "buffer";
import { useMonthlyStreak } from "../lib/useMonthlyStreak";
import YoutubePlayer from "react-native-youtube-iframe";
import * as Clipboard from 'expo-clipboard';

/* ---------- Noir palette ---------- */
const GOLD = '#C6A664';
const COLORS = {
  background: '#000000',
  card: '#0A0A0A',
  cardAlt: '#0E0E0E',
  border: '#FFFFFF1A',
  textPrimary: '#FFFFFF',
  textSecondary: '#D0D0D0',
  primary: GOLD,
  danger: '#FF6B6B',
};

/* ---------- Fonts ---------- */
const FONT_CINZEL =
  Platform.select({ ios: 'Cinzel', android: 'Cinzel', default: 'Cinzel' }) || 'Cinzel';
const FONT_OBLIVION =
  Platform.select({
    ios: 'Avenir Next',
    android: 'sans-serif-light',
    default: 'Avenir Next',
  }) || 'Avenir Next';

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

/* ---------- helpers ---------- */
const sanitizeFileName = (name: string) => name.replace(/[^\w.\-]+/g, '_').slice(-120);
const ts = () => `?t=${Date.now()}`;
const addBuster = (url?: string | null) =>
  url ? `${url}${/\?/.test(url) ? '&' : '?'}t=${Date.now()}` : null;
const stripBuster = (url?: string | null) => (url ? url.replace(/[?&]t=\d+$/, '') : url);

const ONE_GB = 1024 * 1024 * 1024;

const looksLikeVideo = (u: string) => {
  const s = (u || "").toLowerCase();
  return s.endsWith(".mp4") || s.includes(".mp4?");
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

  if (fileBlob) {
    file = fileBlob as Blob;
    // @ts-ignore
    if ((fileBlob as any)?.type) type = (fileBlob as any).type as string;
  } else if (localUri) {
    const resp = await fetch(localUri);
    file = await resp.blob();
    // @ts-ignore
    if ((file as any)?.type) type = (file as any).type as string;
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
      onProgress: (sent, total) => {
        if (!total) return;
        const pct = Math.max(0, Math.min(100, Math.round((sent / total) * 100)));
        onProgress?.(pct);
      },
      onError: (err) => reject(err),
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
  `;
  document.head.appendChild(style);
  PROFILE_VIDEO_CSS_INJECTED = true;
}
injectWebVideoCSS();


/* Signed URL cache just for showreels */
const showreelSignedUrlCache = new Map<string, { url: string; exp: number }>();
const showreelInflight = new Map<string, Promise<string>>();

/** Sign a storage path from portfolios, or pass through if it's already a URL */
async function signShowreelPath(pathOrUrl: string, expiresInSec = 300): Promise<string> {
  if (!pathOrUrl) throw new Error('Missing showreel path');
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
      throw error ?? new Error('Failed to sign showreel URL');
    }
    const url = data.signedUrl;
    showreelSignedUrlCache.set(pathOrUrl, { url, exp: now + expiresInSec * 1000 });
    showreelInflight.delete(pathOrUrl);
    return url;
  })();

  showreelInflight.set(pathOrUrl, p);
  return p;
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

/* ---------- Inline showreel video (Featured-style) ---------- */

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
  const [pendingShowreelThumbs, setPendingShowreelThumbs] = useState<Record<string, any>>({});

  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState(0);
  const opacity = useRef(new Animated.Value(0)).current;

  const progressRef = useRef<View>(null);

  // Comments (submission modal)
  const [comments, setComments] = useState<SubmissionCommentRow[]>([]);
  const [loadingComments, setLoadingComments] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [sendingComment, setSendingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  // ✅ Still keep this for your fullscreen logic + audio behavior
  const [isFullscreen, setIsFullscreen] = useState(false);

  const clampedW = Math.min(width, SHOWREEL_MAX_W);
  const heightFromAspect = clampedW / aspect;

  // register in player registry
  useEffect(() => {
    const handle: PlayerHandle = {
      id: playerId,
      pause: async () => {
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
      playerRegistry.delete(playerId);
    };
  }, [playerId]);

  // resolve signed URL / direct URL
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const url = await signShowreelPath(filePathOrUrl);
        if (alive) setSrc(url);
      } catch (e) {
        console.warn('[ShowreelVideoInline] sign failed', e);
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
      if (Platform.OS === 'web') {
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
    } catch (e) {
      console.warn('[ShowreelVideoInline] play error', e);
    }
  };

  const pause = async () => {
    try {
      if (Platform.OS === 'web') {
        const el = htmlRef.current;
        el?.pause();
      } else {
        await expoRef.current?.pauseAsync();
      }
    } catch {}
    setIsPlaying(false);
  };

  // initial autoplay / mute behavior once src is ready
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
            await expoRef.current?.setIsMutedAsync(true);
          } catch {}
        }
        setMuted(true);
      }
    })();
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

  const onSurfacePress = async () => {
    if (isPlaying) await pause();
    else await play(false);
  };

  const onExpoStatus = (status: AVPlaybackStatus) => {
    syncFromStatus(status);
  };

  const onExpoReady = (e: any) => {
    const ns = e?.naturalSize;
    if (ns?.width && ns?.height) updateAspect(ns.width, ns.height);
    fadeIn();
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

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handler = () => {
      const el = htmlRef.current as any;
      const fs = (document as any).fullscreenElement;

      if (el && fs === el) {
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
        const el = htmlRef.current as any;
        if (el?.requestFullscreen) {
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

  const onProgressPress = async (evt: any) => {
    try {
      if (!progressRef.current || !duration) return;
      const node: any = progressRef.current;
      const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : { left: 0, width: 1 };

      const clientX =
        evt.nativeEvent?.locationX != null
          ? rect.left + evt.nativeEvent.locationX
          : evt.nativeEvent?.pageX ?? 0;

      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const target = ratio * duration;

      if (Platform.OS === 'web' && htmlRef.current) {
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
        overflow: 'hidden',
        backgroundColor: '#000',
        alignSelf: 'center',
        position: 'relative',
      }}
    >
      <Animated.View style={[StyleSheet.absoluteFillObject, { opacity }]}>
        {Platform.OS === 'web' ? (
          // @ts-ignore
          <WebVideo
            ref={htmlRef}
            src={src || undefined}
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
            ref={expoRef}
            source={src ? { uri: src } : undefined}
            style={StyleSheet.absoluteFillObject}
            // ✅ ALWAYS FIT (no crop), like Submissions
            resizeMode={ResizeMode.CONTAIN}
            isLooping
            shouldPlay={autoPlay}
            isMuted={muted}
            useNativeControls={false}
            onReadyForDisplay={onExpoReady}
            onPlaybackStatusUpdate={onExpoStatus}
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

      <TouchableOpacity onPress={enterFullscreen} style={stylesShowreel.fsButton} activeOpacity={0.9}>
        <View style={stylesShowreel.cornerBox} />
      </TouchableOpacity>

      <TouchableOpacity onPress={toggleMute} style={stylesShowreel.soundBtn} activeOpacity={0.9}>
        <Ionicons
          name={muted ? 'volume-mute-outline' : 'volume-high-outline'}
          size={14}
          color="#fff"
        />
        <Text style={stylesShowreel.soundText}>{muted ? 'Sound Off' : 'Sound On'}</Text>
      </TouchableOpacity>
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
  youtube_url: string | null;
  video_url?: string | null;
  video_path?: string | null;
  mime_type?: string | null;
  thumbnail_url?: string | null;   // ✅ ADD THIS
  votes?: number | null;
  submitted_at: string;
}

interface SubmissionCommentRow {
  id: string;
  submission_id: string;
  user_id: string;
  content: string;
  created_at: string;
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
export default function ProfileScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Responsive flags
  const isMobile = width < 768;

  // Treat narrow web viewports like mobile
  const isMobileLike =
    isMobile || (Platform.OS === 'web' && width < 520);

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

  const { refreshProfile } = useAuth();
  const savingRef = useRef(false);

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

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const publicProfileUrl = profile?.public_slug
  ? `${Platform.OS === "web" ? window.location.origin : "https://your-domain.com"}/creative/${profile.public_slug}`
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
  const [thumbUploadingId, setThumbUploadingId] = useState<string | null>(null);
  const [showreelThumbUploadingId, setShowreelThumbUploadingId] = useState<string | null>(null);

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
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [imageViewerIndex, setImageViewerIndex] = useState<number | null>(null);

  // avatar cropper
  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);

  // showreels
  const [showreels, setShowreels] = useState<ShowreelRow[]>([]);
  const [srUploading, setSrUploading] = useState(false);
  const [srProgress, setSrProgress] = useState(0);
  const [srStatus, setSrStatus] = useState('');
  const [showreelCategoryModalVisible, setShowreelCategoryModalVisible] = useState(false);
  const [pendingShowreelAsset, setPendingShowreelAsset] = useState<any | null>(null);
  const [selectedShowreelCategory, setSelectedShowreelCategory] =
    useState<ShowreelCategory>('Acting');
    const [pendingShowreelThumbs, setPendingShowreelThumbs] = useState<Record<string, any>>({});
    const [activeShowreel, setActiveShowreel] = useState<ShowreelRow | null>(null);
const [showreelModalOpen, setShowreelModalOpen] = useState(false);

  const [isDirty, setIsDirty] = useState(false);

  // Gamification display
  const [displayLevel, setDisplayLevel] = useState<number>(1);
  const [displayTitle, setDisplayTitle] = useState<string>(defaultTitle);
  const [displayBannerColor, setDisplayBannerColor] = useState<string>('#FFEDE4');
  const [displayXp, setDisplayXp] = useState<number>(0);

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
          .maybeSingle<LevelRow>();
        if (data) row = data;
      }

      if (!row) {
        const { data } = await supabase
          .from('gamification_levels')
          .select('level,name,banner_color,min_xp')
          .lte('min_xp', xp)
          .order('min_xp', { ascending: false })
          .limit(1)
          .maybeSingle<LevelRow>();
        if (data) row = data;
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
      // 1) GET AUTH USER
      const {
        data: { user: authUser },
        error: authErr,
      } = await supabase.auth.getUser();

      // If auth isn't ready yet → STOP here
      if (authErr || !authUser || !authUser.id) {
        console.log("Auth not ready yet — delaying profile load...");
        return; // <-- IMPORTANT: no setIsLoading(false) here anymore
      }

      // Auth is valid now
      setCurrentUserId(authUser.id);

      const targetId = targetIdParam ?? authUser.id;
      const own = !viewedUserId || viewedUserId === authUser.id;
      setIsOwnProfile(own);

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

        if (!own) {
          const { count: supportCheck } = await supabase
            .from("user_supports")
            .select("supported_id", { count: "exact", head: true })
            .eq("supporter_id", authUser.id)
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

      if (existing && looksLikeVideo(existing)) {
        setMp4MainUrl(`${existing}${ts()}`);
        setMp4MainName(existing.split("/").pop() || "Showreel.mp4");
      } else {
        setMp4MainUrl("");
        setMp4MainName("");
      }

      if (pd.main_role_id != null) {
        const { data: roleData } = await supabase
          .from("creative_roles")
          .select("name")
          .eq("id", Number(pd.main_role_id))
          .maybeSingle<{ name: string }>();
        setMainRoleName(roleData?.name ?? "");
      } else {
        setMainRoleName("");
      }

      if (pd.city_id != null) {
        const { data: cityData } = await supabase
          .from("cities")
          .select("name, country_code")
          .eq("id", Number(pd.city_id))
          .maybeSingle<{ name?: string; country_code?: string }>();
        const label = cityData?.name ?? "";
        setCityName(
          label ? (cityData?.country_code ? `${label}, ${cityData.country_code}` : label) : ""
        );
      } else {
        setCityName("");
      }

      await loadGamificationMeta(pd);

      if (targetId) {
        await Promise.all([
          fetchPortfolioItems(targetId),
          fetchShowreelList(targetId),
          fetchUserSubmissions(targetId),
        ]);
      }

      if (own) {
        await fetchMyJobsWithApplicants(authUser.id);
        setUserJobs([]);
        setLoadingUserJobs(false);
        setAlreadyAppliedJobIds([]);
      } else {
        setMyJobs([]);
        await fetchUserJobs(targetId, authUser.id);
      }
    } catch (e) {
      console.log("fetchProfile fatal:", e);
    } finally {
      setIsLoading(false);
    }
  }, [targetIdParam, loadGamificationMeta]);

  useFocusEffect(
    useCallback(() => {
      fetchProfile();
    }, [fetchProfile])
  );

  /* ---------- user_showreels CRUD ---------- */

  const fetchShowreelList = async (userId: string) => {
    const { data, error } = await supabase
      .from('user_showreels')
      .select('id, user_id, file_path, title, category, thumbnail_url, is_primary, sort_order, created_at')
      .eq('user_id', userId)
      .order('is_primary', { ascending: false })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false });

    if (error) {
      console.warn('fetchShowreelList error:', error.message);
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

  const uploadAnotherShowreel = async () => {
    try {
      if (showreels.length >= 3) {
        Alert.alert('Maximum reached', 'Users can only have up to 3 showreels.');
        return;
      }

      const pick = await DocumentPicker.getDocumentAsync({
        type: ['video/mp4'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (pick.canceled || !pick.assets?.length) return;

      const asset: any = pick.assets[0];
      const name = (asset.name || '').toLowerCase();
      const mime = (asset.mime_type || asset.mimeType || '').toLowerCase() || 'video/mp4';
      const size = asset.size ?? asset.fileSize ?? asset.bytes ?? null;

      const isMp4 = name.endsWith('.mp4') || mime === 'video/mp4';

      if (!isMp4) {
        Alert.alert('MP4 only', 'Please select an .mp4 video.');
        return;
      }
      if (size && size > ONE_GB) {
        Alert.alert('Too large', 'Please select a video that is 1 GB or less.');
        return;
      }

      setPendingShowreelAsset(asset);
      setSelectedShowreelCategory('Acting');
      setShowreelCategoryModalVisible(true);
    } catch (e: any) {
      console.warn('uploadAnotherShowreel failed:', e?.message ?? e);
      Alert.alert('Upload failed', e?.message ?? 'Could not prepare showreel upload.');
    }
  };

  const confirmUploadShowreel = async () => {
    try {
      if (!pendingShowreelAsset) return;

      const asset: any = pendingShowreelAsset;
      const name = (asset.name || '').toLowerCase();

      setShowreelCategoryModalVisible(false);
      setSrUploading(true);
      setSrProgress(0);
      setSrStatus('Preparing…');

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { path } = await uploadResumableToBucket({
        userId: user.id,
        fileBlob:
          Platform.OS === 'web' ? ((asset.file as File | Blob | null) ?? undefined) : undefined,
        localUri: Platform.OS !== 'web' ? (asset.uri as string) : undefined,
        onProgress: (pct) => setSrProgress(pct),
        onPhase: (label) => setSrStatus(label),
        objectName: `user_${user.id}/${Date.now()}_${sanitizeFileName(name || 'showreel')}`,
        bucket: SHOWREEL_BUCKET,
      });

      const currentCount = showreels.length;
      const makePrimary = currentCount === 0;

      const { data: ins, error: insErr } = await supabase
        .from('user_showreels')
        .insert({
          user_id: user.id,
          file_path: path,
          title: asset.name || selectedShowreelCategory,
          category: selectedShowreelCategory,
          thumbnail_url: null,
          is_primary: makePrimary,
          sort_order: currentCount,
        })
        .select('id')
        .single();

      if (insErr || !ins) throw insErr;

      if (makePrimary) {
        const { data: pub } = supabase.storage.from(SHOWREEL_BUCKET).getPublicUrl(path);
        const publicUrl = pub.publicUrl;
        await supabase.from('users').update({ portfolio_url: publicUrl }).eq('id', user.id);
        setMp4MainUrl(`${publicUrl}${ts()}`);
        setMp4MainName(asset.name || 'Showreel.mp4');
      }

      setPendingShowreelAsset(null);
      await fetchShowreelList(user.id);
      Alert.alert('Uploaded', 'Showreel added.');
    } catch (e: any) {
      console.warn('confirmUploadShowreel failed:', e?.message ?? e);
      Alert.alert('Upload failed', e?.message ?? 'Could not upload video.');
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

      const { data: pub } = supabase.storage.from(SHOWREEL_BUCKET).getPublicUrl(row.file_path);
      const publicUrl = pub.publicUrl;

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

      await supabase.storage.from(SHOWREEL_BUCKET).remove([row.file_path]);
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

        const { data: pub } = supabase.storage.from(SHOWREEL_BUCKET).getPublicUrl(fallback.file_path);
        await supabase.from('users').update({ portfolio_url: pub.publicUrl }).eq('id', user.id);

        setMp4MainUrl(`${pub.publicUrl}${ts()}`);
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

      const rows = (data || []) as any[];

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
          const raw = pickVideoField(s);

          // If nothing exists, this is the REAL problem (upload didn’t store a reference)
          if (!raw) return s as SubmissionRow;

          // If already http(s):
          if (/^https?:\/\//i.test(raw)) {
            const pub = pathFromPublicUrl(raw);

            // Not a supabase public object url → just use directly
            if (!pub) {
              return { ...(s as SubmissionRow), video_url: stripQuery(raw) };
            }

            // Supabase public url → sign for reliable access
            const { data: signed, error: signErr } = await supabase.storage
              .from(pub.bucket)
              .createSignedUrl(pub.path, 60 * 60);

            if (!signErr && signed?.signedUrl) {
              return { ...(s as SubmissionRow), video_url: signed.signedUrl };
            }

            console.warn("[SIGN FAIL public url]", raw, signErr?.message || "");
            return { ...(s as SubmissionRow), video_url: stripQuery(raw) };
          }

          // Otherwise raw is a storage path
          const cleanPath = stripQuery(raw);

          // Try films
          const { data: signedFilms, error: signErrFilms } = await supabase.storage
            .from("films")
            .createSignedUrl(cleanPath, 60 * 60);

          if (!signErrFilms && signedFilms?.signedUrl) {
            return { ...(s as SubmissionRow), video_url: signedFilms.signedUrl };
          }

          // Fallback portfolios
          const { data: signedPort, error: signErrPort } = await supabase.storage
            .from("portfolios")
            .createSignedUrl(cleanPath, 60 * 60);

          if (!signErrPort && signedPort?.signedUrl) {
            return { ...(s as SubmissionRow), video_url: signedPort.signedUrl };
          }

          console.warn(
            "[SIGN FAIL path]",
            cleanPath,
            signErrFilms?.message || signErrPort?.message || ""
          );

          return s as SubmissionRow;
        })
      );

      setSubmissions(withPlayableUrls);
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
        const ids = Array.from(new Set((appsData || []).map((a: any) => String(a.job_id))));
        setAlreadyAppliedJobIds(ids);
      }
    } else {
      setAlreadyAppliedJobIds([]);
    }

    setLoadingUserJobs(false);
  };

  /* ---------- City search ---------- */

  const fetchCities = async (query: string) => {
    const q = (query || '').trim();
    const { data } = await supabase
      .from('cities')
      .select('id, name, country_code')
      .ilike('name', `%${q}%`)
      .limit(120);

    if (!data) {
      setCityItems([]);
      return;
    }

    const lower = q.toLowerCase();
    const ranked = [...data].sort((a, b) => {
      const aName = (a.name || '').toLowerCase();
      const bName = (b.name || '').toLowerCase();
      const aScore =
        aName === lower ? 0 : aName.startsWith(lower) ? 1 : aName.includes(lower) ? 2 : 3;
      const bScore =
        bName === lower ? 0 : bName.startsWith(lower) ? 1 : bName.includes(lower) ? 2 : 3;
      if (aScore !== bScore) return aScore - bScore;
      if (aName < bName) return -1;
      if (aName > bName) return 1;
      return 0;
    });

    if (cityId != null) {
      const idx = ranked.findIndex((c) => Number(c.id) === Number(cityId));
      if (idx > 0) {
        const pinned = ranked.splice(idx, 1)[0];
        ranked.unshift(pinned);
      }
    }

    const formatted = ranked.map((c) => ({
      label: `${c.name}, ${c.country_code}`,
      value: Number(c.id),
      country_code: c.country_code,
      name: c.name,
    }));
    setCityItems(formatted);
  };

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
      const userObj = user;
      if (!userObj) throw new Error('Not authenticated');

      const fileName = `${Date.now()}_avatar.jpg`;
      const path = `user_${userObj.id}/${fileName}`;

      const response = await fetch(croppedUri);
      const blob = await response.blob();
      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, blob, {
          contentType: 'image/jpeg',
          upsert: true,
        });
      if (uploadErr) throw uploadErr;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(path);
      const publicUrl = urlData.publicUrl;

      setImage(publicUrl);

      const { error: updErr } = await supabase
        .from('users')
        .update({ avatar_url: publicUrl })
        .eq('id', userObj.id);
      if (updErr) throw updErr;

      await fetchProfile();
    } catch (err: any) {
      Alert.alert('Upload failed', err?.message ?? 'Unexpected error.');
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
      if (showreels.length >= 3) {
        Alert.alert('Maximum reached', 'Users can only have up to 3 showreels.');
        return;
      }

      const pick = await DocumentPicker.getDocumentAsync({
        type: ['video/mp4'],
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (pick.canceled || !pick.assets?.length) return;

      const asset: any = pick.assets[0];
      const name = (asset.name || '').toLowerCase();
      const mime = (asset.mime_type || asset.mimeType || '').toLowerCase() || 'video/mp4';
      const size = asset.size ?? asset.fileSize ?? asset.bytes ?? null;

      const isMp4 = name.endsWith('.mp4') || mime === 'video/mp4';

      if (!isMp4) {
        Alert.alert('MP4 only', 'Please select an .mp4 video.');
        return;
      }
      if (size && size > ONE_GB) {
        Alert.alert('Too large', 'Please select a video that is 1 GB or less.');
        return;
      }

      setPendingShowreelAsset(asset);
      setSelectedShowreelCategory('Acting');
      setShowreelCategoryModalVisible(true);
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
      prev.map((s) => (s.id === showreelId ? { ...s, thumbnail_url: publicUrl } : s))
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
    const resolvedPortfolioUrl = primaryShowreel
      ? stripBuster(primaryShowreel.url || mp4MainUrl || profile?.portfolio_url || null)
      : mp4MainUrl
      ? stripBuster(mp4MainUrl)
      : profile?.portfolio_url ?? null;

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
        .maybeSingle<{ name: string }>();
      setMainRoleName(roleData?.name ?? '');
    } else {
      setMainRoleName('');
    }

    if (pd.city_id != null) {
      const { data: cityData } = await supabase
        .from('cities')
        .select('name, country_code')
        .eq('id', Number(pd.city_id))
        .maybeSingle<{ name?: string; country_code?: string }>();
      const label = cityData?.name ?? '';
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

const THUMB_BUCKET = "thumbnails";

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
        encoding: FileSystem.EncodingType.Base64,
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

  const up = await withTimeout(uploadPromise, 20000);

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
        encoding: FileSystem.EncodingType.Base64,
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

  const up = await withTimeout(uploadPromise, 20000);

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
      encoding: FileSystem.EncodingType.Base64,
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

  const up = await withTimeout(uploadPromise, 20000);

  if (up.error) throw up.error;

  const pub = supabase.storage.from(bucket).getPublicUrl(filePath);
  const publicUrl = pub?.data?.publicUrl;

  if (!publicUrl) throw new Error("Could not get public thumbnail URL");

  return { publicUrl, path: filePath };
}
  /* ---------- apply to job in viewed user's profile ---------- */

  const changeSubmissionThumbnail = async (submission: any) => {
    try {
      setThumbUploadingId(submission.id);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const pick = await DocumentPicker.getDocumentAsync({
        type: ["image/*"] as any,
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (pick.canceled) return;

      const asset: any = pick.assets?.[0];
      if (!asset?.uri && !asset?.file) throw new Error("No image selected");

      let chosenUri: string | null = null;

      // web: use object url
      if (Platform.OS === "web" && asset.file) {
        chosenUri = URL.createObjectURL(asset.file as File);
      } else {
        chosenUri = asset.uri;
      }

      if (!chosenUri) throw new Error("Could not read selected image");

      const { publicUrl } = await uploadThumbnailToStorage({
        userId: user.id,
        thumbUri: chosenUri,
        objectName: `submissions/${user.id}/${submission.id}_${Date.now()}`,
        bucket: THUMB_BUCKET,
      });

      const { error: updErr } = await supabase
        .from("submissions")
        .update({ thumbnail_url: publicUrl })
        .eq("id", submission.id);

      if (updErr) throw updErr;

      // ✅ update local submissions list immediately
      setSubmissions((prev) =>
        prev.map((s) => (s.id === submission.id ? { ...s, thumbnail_url: publicUrl } : s))
      );

      // ✅ update active submission (modal) immediately
      setActiveSubmission((prev: any) =>
        prev?.id === submission.id ? { ...prev, thumbnail_url: publicUrl } : prev
      );

      Alert.alert("Updated", "Thumbnail updated.");
    } catch (e: any) {
      Alert.alert("Thumbnail update failed", e?.message ?? "Could not update thumbnail.");
    } finally {
      setThumbUploadingId(null);
    }
  };

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
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert('Logout Failed', error.message);
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
  };

  const copyCreativeProtocolLink = async () => {
  if (!publicProfileUrl) {
    Alert.alert("Unavailable", "Public link is not ready yet.");
    return;
  }

  await Clipboard.setStringAsync(publicProfileUrl);
  Alert.alert("Copied", "Creative Protocol link copied.");
};

const previewCreativeProtocolLink = () => {
  if (!profile?.public_slug) {
    Alert.alert("Unavailable", "Public link is not ready yet.");
    return;
  }

  navigation.navigate("PublicProfile", { slug: profile.public_slug });
};

  const startOneToOneChat = async () => {
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

  const closeShowreelModal = async () => {
  setShowreelModalOpen(false);
  setActiveShowreel(null);
  await pauseAllExcept(PAUSE_NONE_ID);
};
/* ---------- RENDERERS ---------- */

// ✅ Must be OUTSIDE renderHero so it can be used anywhere (including MAIN RENDER if needed)
const renderEditProfileCard = () => {
  const level = displayLevel || 1;
  const xp = displayXp || 0;
  const ringColor = getRingColorForLevel(level);
  const title = (displayTitle || defaultTitle).toUpperCase();

  return (
    <View style={[styles.infoCard, { marginTop: 12 }]}>
      {/* Buttons */}
      <View style={[styles.infoButtons, { marginTop: 0 }]}>
        {isOwnProfile ? (
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={() => setShowEditModal(true)}
            activeOpacity={0.85}
          >
            <Text style={styles.btnPrimaryText}>Edit Profile</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={startOneToOneChat}
            disabled={startingChat}
            activeOpacity={0.85}
          >
            {startingChat ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.btnPrimaryText}>Message</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Support button */}
      {!isOwnProfile && profile && currentUserId && (
        <View style={{ marginTop: 12 }}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={async () => {
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
            }}
            style={[
              {
                paddingVertical: 12,
                paddingHorizontal: 22,
                borderRadius: 999,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: "#000",
                shadowOpacity: 0.15,
                shadowRadius: 6,
                shadowOffset: { width: 0, height: 3 },
                elevation: 3,
                width: "100%",
              },
              isSupporting
                ? { backgroundColor: "#1C1C1C", borderWidth: 1, borderColor: "#444" }
                : { backgroundColor: COLORS.primary },
            ]}
          >
            <Text
              style={{
                fontSize: 16,
                fontWeight: "800",
                color: isSupporting ? "#F7DFA6" : "#000",
                letterSpacing: 0.5,
              }}
            >
              {isSupporting ? "Supporting" : "Support"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Gamification */}
      <View style={{ marginTop: 10, alignItems: "center" }}>
        <Text style={[styles.gamifyTitle, { color: ringColor }]} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.gamifyRow}>
          <Text style={styles.gamifyLevel}>Lv {level}</Text>
          <View style={styles.gamifyDot} />
          <Text style={styles.gamifyXp}>{xp} XP</Text>
        </View>
      </View>
    </View>
  );
};

// ✅ Extract About/Streaks into its own renderer so it can show on BOTH web + mobile
const renderAboutStreaksCard = () => {
  const shouldShow =
    !!bio?.trim()?.length ||
    sideRoles.length ||
    isOwnProfile ||
    streakLoading ||
    Number(streak || 0) > 0;

  if (!shouldShow) return null;

  return (
    <View style={[styles.aboutCard, { marginTop: 12 }]}>
      <Text style={styles.aboutTitle}>About</Text>

      {/* ✅ Streaks live INSIDE About */}
      <View style={{ marginTop: 10 }}>
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
              <View key={`year-${yearNumber}`} style={{ marginTop: idx === 0 ? 0 : 12 }}>
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
                    Filmmaking streak
                  </Text>

                  <Text
                    style={{
                      fontSize: 11,
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
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 999,
                        backgroundColor: "rgba(198,166,100,0.18)",
                        borderWidth: 1,
                        borderColor: "rgba(198,166,100,0.35)",
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 9,
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
                    marginTop: 6,
                    fontSize: 12,
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

      {/* ✅ Subtle divider so streak feels “attached” */}
      <View
        style={{
          height: 1,
          backgroundColor: COLORS.border,
          opacity: 0.7,
          marginTop: 12,
          marginBottom: 10,
        }}
      />

      {/* ✅ Bio */}
      <Text style={[styles.aboutBody, isMobileLike ? { lineHeight: 18 } : null]}>
        {bio || "—"}
      </Text>

      {!!sideRoles.length && (
        <Text style={[styles.aboutBody, { marginTop: 8, fontStyle: "italic" }]}>
          <Text style={{ fontWeight: "900" }}>Side roles: </Text>
          {sideRoles.join(", ")}
        </Text>
      )}
    </View>
  );
};

const renderHero = () => {
  const avatarUrl = image || profile?.avatar_url || null;
  const heroBg = avatarUrl ? addBuster(avatarUrl) : null;

  const bannerColor = displayBannerColor || GOLD;
  const level = displayLevel || 1;
  const xp = displayXp || 0;
  const title = (displayTitle || defaultTitle).toUpperCase();
  const ringColor = getRingColorForLevel(level);

  // ✅ Better mobile + mobile-web spacing: clamp hero width + consistent side padding
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
                    styles.heroMeta,
                    isMobileLike
                      ? { fontSize: 12, marginTop: 8, letterSpacing: 1.2, lineHeight: 16 }
                      : {
                          fontSize: 16, // ✅ bigger on web
                          letterSpacing: 3, // ✅ more cinematic
                          marginBottom: 6,
                          opacity: 0.95,
                        },
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
                        onPress={() => setConnectionsModalVisible(true)}
                        style={{ alignItems: "center", minWidth: 92, paddingVertical: 4 }}
                        activeOpacity={0.85}
                      >
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
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => setConnectionsModalVisible(true)}
                        style={{ alignItems: "center", minWidth: 92, paddingVertical: 4 }}
                        activeOpacity={0.85}
                      >
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
              {/* Avatar + level */}
              <View style={{ alignItems: "center" }}>
                <LinearGradient
                  colors={[ringColor, "rgba(255,255,255,0.04)", "rgba(0,0,0,0.9)"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={[styles.avatarRing, { borderColor: ringColor }]}
                >
                  <View style={[styles.avatarInner, isCompact && styles.avatarInnerCompact]}>
                    {avatarUrl ? (
                      <Image
                        source={{ uri: addBuster(avatarUrl) || avatarUrl }}
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

                <View style={[styles.levelPill, { backgroundColor: ringColor }]}>
                  <Text style={styles.levelPillText}>Lv {level}</Text>
                </View>
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
                      onPress={() => setConnectionsModalVisible(true)}
                      style={{ alignItems: "center", minWidth: 92, paddingVertical: 4 }}
                      activeOpacity={0.85}
                    >
                      <Text
                        style={{
                          color: COLORS.textPrimary,
                          fontWeight: "900",
                          fontFamily: FONT_OBLIVION,
                          letterSpacing: 1,
                          fontSize: 14, // ✅ slightly smaller so it sits nicely under the name
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
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => setConnectionsModalVisible(true)}
                      style={{ alignItems: "center", minWidth: 92, paddingVertical: 4 }}
                      activeOpacity={0.85}
                    >
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
            isMobileLike ? { marginTop: 0, width: "100%", flex: 0 } : null, // ✅ key line
          ]}
        >
          {/* ✅ Desktop: show edit card at top (like before) */}
          {!isMobileLike ? (
            <View
              style={[
                styles.infoCard,
                isMobileLike ? { paddingHorizontal: 14, paddingVertical: 14 } : null,
              ]}
            >
              {/* Buttons */}
              <View style={[styles.infoButtons, isMobileLike ? { marginTop: 0 } : null]}>
                {isOwnProfile ? (
                  <TouchableOpacity
                    style={styles.btnPrimary}
                    onPress={() => setShowEditModal(true)}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.btnPrimaryText}>Edit Profile</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={styles.btnPrimary}
                    onPress={startOneToOneChat}
                    disabled={startingChat}
                    activeOpacity={0.85}
                  >
                    {startingChat ? (
                      <ActivityIndicator color="#000" />
                    ) : (
                      <Text style={styles.btnPrimaryText}>Message</Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
              <View style={[styles.infoCard, { marginTop: 12 }]}>
  <Text style={styles.protocolTitle}>Share Creative Portfolio</Text>

  <Text style={styles.protocolBody}>
    Create a shareable link to your creative portfolio and showcase your films, showreels, and work across Instagram, TikTok, and beyond.
  </Text>

  <View style={styles.protocolButtons}>
    <TouchableOpacity
      style={[styles.ghostBtn, { flex: 1 }]}
      onPress={copyCreativeProtocolLink}
      activeOpacity={0.85}
    >
      <Text style={styles.ghostBtnText}>Copy Link</Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={[styles.btnPrimary, { flex: 1 }]}
      onPress={previewCreativeProtocolLink}
      activeOpacity={0.85}
    >
      <Text style={styles.btnPrimaryText}>Preview</Text>
    </TouchableOpacity>
  </View>
</View>

              {/* Support button */}
              {!isOwnProfile && profile && currentUserId && (
                <View style={{ marginTop: isMobileLike ? 10 : 12 }}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={async () => {
                      const targetIdToSupport = profile?.id; // ✅ always correct
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
                    }}
                    style={[
                      {
                        paddingVertical: isMobileLike ? 11 : 12,
                        paddingHorizontal: isMobileLike ? 18 : 22,
                        borderRadius: 999,
                        alignItems: "center",
                        justifyContent: "center",
                        shadowColor: "#000",
                        shadowOpacity: 0.15,
                        shadowRadius: 6,
                        shadowOffset: { width: 0, height: 3 },
                        elevation: 3,
                        width: "100%",
                      },
                      isSupporting
                        ? {
                            backgroundColor: "#1C1C1C",
                            borderWidth: 1,
                            borderColor: "#444",
                          }
                        : {
                            backgroundColor: COLORS.primary,
                          },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: "800",
                        color: isSupporting ? "#F7DFA6" : "#000",
                        letterSpacing: 0.5,
                      }}
                    >
                      {isSupporting ? "Supporting" : "Support"}
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Gamification */}
              <View style={[styles.gamifyWrap, isMobileLike ? { marginTop: 12 } : null]}>
                <Text style={[styles.gamifyTitle, { color: ringColor }]} numberOfLines={1}>
                  {title}
                </Text>
                <View style={styles.gamifyRow}>
                  <Text style={styles.gamifyLevel}>Lv {level}</Text>
                  <View style={styles.gamifyDot} />
                  <Text style={styles.gamifyXp}>{xp} XP</Text>
                </View>
              </View>
            </View>
          ) : null}
        </View>
      </View>

      {/* ✅ MOBILE: keep the edit card under hero like you had */}
      {isMobileLike ? <View style={{ width: "100%", marginTop: 12 }}>{renderEditProfileCard()}</View> : null}

      {/* ✅ NOW: About/Streaks renders on BOTH web + mobile */}
      <View style={{ width: "100%", maxWidth: heroMaxW, alignSelf: "center" }}>
        {renderAboutStreaksCard()}
      </View>
    </View>
  );
};

const renderFeaturedFilm = () => {
  const primaryRow =
    showreels.find((r) => r.is_primary) ||
    showreels[0] ||
    null;

  if (!primaryRow) return null;

  const secondaryRows = showreels
    .filter((r) => r.id !== primaryRow.id)
    .slice(0, 2);

  const maxW = isMobile ? SHOWREEL_MAX_W_MOBILE : SHOWREEL_MAX_W;
  const secondaryCols = isMobileLike ? 1 : 2;
  const secondaryGap = 12;
  const secondaryTileW =
    secondaryCols === 1
      ? maxW
      : Math.floor((maxW - secondaryGap) / 2);
  const secondaryTileH = Math.floor(secondaryTileW * (9 / 16));

  return (
    <View style={[block.section, { alignItems: "center" }]}>
      <Text style={block.sectionTitleCentered}>
  {primaryRow.category ? `${primaryRow.category} Showreel` : "Showreel"}
</Text>

      <View
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
        <ShowreelVideoInline
          playerId={`profile_showreel_primary_${primaryRow.id}`}
          filePathOrUrl={primaryRow.file_path || primaryRow.url}
          width={maxW}
          autoPlay={false}
        />
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
          <Text style={block.h3Centered}>More Showreels</Text>

          <View
            style={{
              flexDirection: isMobileLike ? "column" : "row",
              gap: secondaryGap,
              marginTop: 8,
            }}
          >
            {secondaryRows.map((r) => {
              const thumb = r.thumbnail_url ? addBuster(r.thumbnail_url) : null;

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

                  {isOwnProfile && (
                    <>
                      <View
                        style={{
                          flexDirection: "row",
                          flexWrap: "wrap",
                          gap: 8,
                          marginTop: 10,
                        }}
                      >
                        <TouchableOpacity onPress={() => setPrimaryShowreel(r)} style={block.rowBtn}>
                          <Text style={block.rowBtnText}>Make Main</Text>
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => changeShowreelThumbnail(r)} style={block.rowBtn}>
                          <Text style={block.rowBtnText}>
                            {pendingShowreelThumbs[r.id] || r.thumbnail_url
                              ? "Change Thumbnail"
                              : "Add Thumbnail"}
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => deleteShowreel(r)} style={block.rowBtnGhost}>
                          <Text style={block.rowBtnGhostText}>Delete</Text>
                        </TouchableOpacity>
                      </View>

                      <View style={{ marginTop: 10 }}>
                        <Text
                          style={{
                            color: COLORS.textSecondary,
                            fontSize: 11,
                            fontFamily: FONT_OBLIVION,
                            marginBottom: 6,
                            letterSpacing: 0.6,
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
                                key={`${r.id}_${cat}`}
                                onPress={() => updateShowreelCategory(r, cat)}
                                style={{
                                  paddingHorizontal: 10,
                                  paddingVertical: 6,
                                  borderRadius: 999,
                                  backgroundColor: selected
                                    ? "rgba(198,166,100,0.18)"
                                    : "#111",
                                  borderWidth: 1,
                                  borderColor: selected
                                    ? COLORS.primary
                                    : COLORS.border,
                                }}
                              >
                                <Text
                                  style={{
                                    color: selected
                                      ? COLORS.primary
                                      : COLORS.textSecondary,
                                    fontSize: 11,
                                    fontFamily: FONT_OBLIVION,
                                    fontWeight: "700",
                                  }}
                                >
                                  {cat}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </ScrollView>
                      </View>
                    </>
                  )}
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

    {isOwnProfile && (
      <TouchableOpacity onPress={() => deletePortfolioItem(item.id)} style={block.rowBtnGhost}>
        <Text style={block.rowBtnGhostText}>Delete</Text>
      </TouchableOpacity>
    )}
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

    {isOwnProfile && (
      <TouchableOpacity onPress={() => deletePortfolioItem(item.id)} style={block.rowBtnGhost}>
        <Text style={block.rowBtnGhostText}>Delete</Text>
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

  // Modal media sizing (always numeric → avoids TS error)
  const modalMaxW = Math.min(Math.min(width, PAGE_MAX) - horizontalPad * 2, 760);
  const modalMediaW = Math.max(280, Math.floor(modalMaxW));
  const modalMediaH = Math.floor(modalMediaW * (9 / 16));

  return (
    <View style={block.section}>
      <Text style={block.sectionTitleCentered}>Submissions</Text>

      <View style={[block.grid, { gap: GRID_GAP }]}>
        {submissions.map((s) => {
          const yt = s.youtube_url ? ytThumb(s.youtube_url) : null;
          const mp4Thumb = s.thumbnail_url ? addBuster(s.thumbnail_url) : null;

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
                {/* Thumbnail */}
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

                {/* overlay */}
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

      {/* Playback modal */}
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

            {/* ✅ Give the media a predictable 16:9 box */}
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
                      playerId={`submission_${activeSubmission.id}`}
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

            {isOwnProfile && activeSubmission && (
              <View style={{ gap: 10, marginTop: 12 }}>
                {!activeSubmission.youtube_url && (
                  <TouchableOpacity
                    onPress={() => changeSubmissionThumbnail(activeSubmission)}
                    style={styles.ghostBtn}
                    disabled={thumbUploadingId === activeSubmission.id}
                  >
                    {thumbUploadingId === activeSubmission.id ? (
                      <ActivityIndicator color={COLORS.textPrimary} />
                    ) : (
                      <Text style={styles.ghostBtnText}>
                        {activeSubmission.thumbnail_url ? "Change thumbnail" : "Add thumbnail"}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  onPress={() => deleteSubmission(activeSubmission)}
                  style={[styles.ghostBtn, { borderColor: COLORS.danger }]}
                >
                  <Text style={[styles.ghostBtnText, { color: COLORS.danger }]}>
                    Delete submission
                  </Text>
                </TouchableOpacity>
              </View>
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

/* ---------- MAIN RENDER ---------- */

if (isLoading) {
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
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <ScrollView
        style={{ flex: 1, backgroundColor: COLORS.background }}
        contentContainerStyle={{
          alignItems: "center",
          paddingBottom: 40 + Math.max(insets.bottom, 8),
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
        </View>
      </ScrollView>
    </SafeAreaView>

    {/* Fullscreen image viewer */}
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

     {/* Secondary showreel playback modal */}
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
            <ShowreelVideoInline
              playerId={`secondary_showreel_${activeShowreel.id}`}
              filePathOrUrl={activeShowreel.file_path || activeShowreel.url}
              width={Math.min(width - horizontalPad * 2 - 24, 760)}
              autoPlay={true}
            />
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

    {/* Edit Profile Modal */}
    <Modal
      visible={showEditModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowEditModal(false)}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHandle} />
          <Text style={styles.modalTitle}>Edit Profile</Text>

          <ScrollView
            style={{ flex: 1, width: "100%" }}
            contentContainerStyle={{ paddingBottom: 32 }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Profile picture (own profile only) */}
            {isOwnProfile && (
              <View style={[styles.field, { marginTop: 8 }]}>
                <Text style={styles.fieldLabel}>Profile picture</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  {image || profile.avatar_url ? (
                    <Image
                      source={{ uri: addBuster(image || profile.avatar_url || "") || "" }}
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 21,
                        backgroundColor: "#111",
                        borderWidth: 1,
                        borderColor: COLORS.border,
                      }}
                    />
                  ) : (
                    <View
                      style={{
                        width: 42,
                        height: 42,
                        borderRadius: 21,
                        backgroundColor: "#111",
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
                    style={styles.pillBtn}
                    onPress={pickImage}
                    disabled={uploading}
                  >
                    <Text style={styles.pillText}>
                      {uploading ? "Uploading..." : "Change profile picture"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Full name */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                value={fullName}
                onChangeText={setFullName}
                style={styles.input}
                placeholder="Your name"
                placeholderTextColor={COLORS.textSecondary}
              />
            </View>

            {/* City */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>City</Text>
              <TouchableOpacity
                style={styles.pickerBtn}
                onPress={() => {
                  setCityOpen(true);
                  fetchCities(citySearch || "");
                }}
              >
                <Text style={styles.pickerBtnText}>{cityName || "Search city"}</Text>
                <Ionicons name="chevron-down" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Main role */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Main role</Text>
              <TouchableOpacity
                style={styles.pickerBtn}
                onPress={() => {
                  setRoleSearchModalVisible(true);
                  setRoleSearchTerm("");
                  setRoleSearchItems([]);
                }}
              >
                <Text style={styles.pickerBtnText}>{mainRoleName || "Search role"}</Text>
                <Ionicons name="search" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Side roles */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Side roles</Text>
              <TouchableOpacity
                style={styles.pickerBtn}
                onPress={() => {
                  setSideRoleModalVisible(true);
                  setRoleSearchTerm("");
                  setRoleSearchItems([]);
                }}
              >
                <Text style={styles.pickerBtnText}>
                  {sideRoles.length ? sideRoles.join(", ") : "Add side roles"}
                </Text>
                <Ionicons name="add" size={16} color={COLORS.textSecondary} />
              </TouchableOpacity>
            </View>

            {/* Bio */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>About</Text>
              <TextInput
                value={bio}
                onChangeText={setBio}
                style={[styles.input, styles.multiline]}
                placeholder="Tell people who you are, what you’re drawn to, and what you’re looking for."
                placeholderTextColor={COLORS.textSecondary}
                multiline
              />
            </View>

            {/* Featured Showreel (MP4 only) */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Showreels</Text>

              <View style={{ marginTop: 8 }}>
                {showreels.length > 0 ? (
                  <>
                    <Text style={[styles.fieldLabel, { marginBottom: 8 }]}>Current showreels</Text>

                    <View style={{ gap: 10 }}>
                      {showreels.map((r, index) => {
                        const isMain = !!r.is_primary;
                        return (
                          <View
                            key={r.id}
                            style={{
                              borderWidth: 1,
                              borderColor: isMain ? COLORS.primary : COLORS.border,
                              borderRadius: 14,
                              padding: 10,
                              backgroundColor: isMain ? "rgba(198,166,100,0.08)" : "#0B0B0B",
                            }}
                          >
                            <View
                              style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                alignItems: "center",
                                gap: 10,
                              }}
                            >
                              <View style={{ flex: 1 }}>
                                <Text
                                  style={{
                                    color: COLORS.textPrimary,
                                    fontFamily: FONT_OBLIVION,
                                    fontSize: 14,
                                    fontWeight: "800",
                                  }}
                                  numberOfLines={1}
                                >
                                  {r.title || `Showreel ${index + 1}`}
                                </Text>

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
                                </Text>
                              </View>

                              {!isMain && (
                                <TouchableOpacity
                                  onPress={() => setPrimaryShowreel(r)}
                                  style={styles.pillBtn}
                                >
                                  <Text style={styles.pillText}>Make Main</Text>
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
                                        borderRadius: 999,
                                        backgroundColor: selected ? "rgba(198,166,100,0.18)" : "#111",
                                        borderWidth: 1,
                                        borderColor: selected ? COLORS.primary : COLORS.border,
                                      }}
                                    >
                                      <Text
                                        style={{
                                          color: selected ? COLORS.primary : COLORS.textSecondary,
                                          fontSize: 11,
                                          fontFamily: FONT_OBLIVION,
                                          fontWeight: "700",
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
    showreelThumbUploadingId === r.id ? { opacity: 0.7 } : null,
  ]}
  onPress={() => changeShowreelThumbnail(r)}
  disabled={showreelThumbUploadingId === r.id}
>
  {showreelThumbUploadingId === r.id ? (
    <ActivityIndicator color={COLORS.textPrimary} />
  ) : (
    <Text style={styles.pillText}>
  {pendingShowreelThumbs[r.id] || r.thumbnail_url ? "Change Thumbnail" : "Add Thumbnail"}
</Text>
  )}
</TouchableOpacity>

                              <TouchableOpacity
                                style={styles.pillBtn}
                                onPress={() => deleteShowreel(r)}
                              >
                                <Text style={styles.pillText}>Delete</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                        );
                      })}
                    </View>
                  </>
                ) : (
                  <Text style={[block.muted, { marginBottom: 6 }]}>
                    Upload up to 3 MP4 showreels. Pick a category for each one and choose which is the main featured reel.
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
                    <ActivityIndicator color="#000" />
                  ) : (
                    <Text style={styles.primaryBtnText}>
                      {showreels.length >= 3
                        ? "Maximum of 3 showreels reached"
                        : showreels.length === 0
                        ? "Upload First Showreel"
                        : "Upload Another Showreel"}
                    </Text>
                  )}
                </TouchableOpacity>

                {(mp4MainUploading || srUploading) && (
                  <View style={{ marginTop: 8, alignItems: "center" }}>
                    {!!(mp4Status || srStatus) && (
                      <Text style={[block.muted, { marginBottom: 4 }]}>{mp4Status || srStatus}</Text>
                    )}
                    <View style={block.progressRail}>
                      <View
                        style={[
                          block.progressFill,
                          { width: `${Math.max(mp4Progress || 0, srProgress || 0)}%` },
                        ]}
                      />
                    </View>
                    <Text style={[block.muted, { marginTop: 4 }]}>
                      {Math.max(mp4Progress || 0, srProgress || 0)}%
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Extra portfolio uploads */}
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Add supporting work</Text>
              <View style={styles.uploadRow}>
                <TouchableOpacity style={styles.pillBtn} onPress={uploadPortfolioImage}>
                  <Text style={styles.pillText}>+ Image</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.pillBtn} onPress={uploadPortfolioPDF}>
                  <Text style={styles.pillText}>+ PDF</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.pillBtn} onPress={uploadPortfolioMP3}>
                  <Text style={styles.pillText}>+ Audio</Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Actions */}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 18, marginBottom: 6 }}>
              <TouchableOpacity
                style={[styles.ghostBtn, { flex: 1 }]}
                onPress={() => setShowEditModal(false)}
                disabled={uploading}
              >
                <Text style={styles.ghostBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.primaryBtn, { flex: 1, opacity: !isDirty || uploading ? 0.6 : 1 }]}
                disabled={!isDirty || uploading}
                onPress={saveProfile}
              >
                {uploading ? (
                  <ActivityIndicator color="#000" />
                ) : (
                  <Text style={styles.primaryBtnText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    {/* Showreel category picker modal */}
    <Modal
      visible={showreelCategoryModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setShowreelCategoryModalVisible(false)}
    >
      <View style={centered.overlay}>
        <View style={centered.card}>
          <Text style={centered.title}>Choose Showreel Category</Text>

          <View style={{ gap: 8, marginTop: 8 }}>
            {SHOWREEL_CATEGORIES.map((cat) => {
              const selected = selectedShowreelCategory === cat;

              return (
                <TouchableOpacity
                  key={cat}
                  style={[
                    block.row,
                    {
                      backgroundColor: selected ? "#111" : "transparent",
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: selected ? COLORS.primary : COLORS.border,
                    },
                  ]}
                  onPress={() => setSelectedShowreelCategory(cat)}
                >
                  <Text style={{ color: COLORS.textPrimary, fontFamily: FONT_OBLIVION }}>
                    {cat}
                  </Text>
                  {selected && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <TouchableOpacity
              style={[styles.ghostBtn, { flex: 1 }]}
              onPress={() => {
                setShowreelCategoryModalVisible(false);
                setPendingShowreelAsset(null);
              }}
            >
              <Text style={styles.ghostBtnText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.primaryBtn, { flex: 1 }]}
              onPress={confirmUploadShowreel}
            >
              <Text style={styles.primaryBtnText}>Upload</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>

    {/* City search modal */}
    <Modal
      visible={cityOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setCityOpen(false)}
    >
      <View style={centered.overlay}>
        <View style={centered.card}>
          <Text style={centered.title}>Select City</Text>

          <TextInput
            value={citySearch}
            onChangeText={(t) => {
              setCitySearch(t);
              fetchCities(t);
            }}
            placeholder="Search city"
            placeholderTextColor={COLORS.textSecondary}
            style={styles.input}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <ScrollView style={{ maxHeight: 300, marginTop: 8 }}>
            {cityItems.length === 0 ? (
              <Text style={block.muted}>Type to search cities.</Text>
            ) : (
              cityItems.map((c) => {
                const label = `${c.name}, ${c.country_code}`;
                const isSelected = Number(cityId) === Number(c.value);
                return (
                  <TouchableOpacity
                    key={c.value}
                    style={[
                      block.row,
                      { backgroundColor: isSelected ? "#111" : "transparent" },
                    ]}
                    onPress={() => {
                      setCityId(c.value);
                      setCityName(label);
                      setCityOpen(false);
                    }}
                  >
                    <Text style={{ color: COLORS.textPrimary, fontFamily: FONT_OBLIVION }}>
                      {label}
                    </Text>
                    {isSelected && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          <TouchableOpacity style={[styles.ghostBtn, { marginTop: 10 }]} onPress={() => setCityOpen(false)}>
            <Text style={styles.ghostBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    {/* Main role search modal */}
    <Modal
      visible={roleSearchModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setRoleSearchModalVisible(false)}
    >
      <View style={centered.overlay}>
        <View style={centered.card}>
          <Text style={centered.title}>Select Main Role</Text>
          <TextInput
            value={roleSearchTerm}
            onChangeText={(t) => {
              setRoleSearchTerm(t);
              fetchSearchRoles(t);
            }}
            placeholder="Search roles"
            placeholderTextColor={COLORS.textSecondary}
            style={styles.input}
          />
          <ScrollView style={{ maxHeight: 260, marginTop: 8 }}>
            {searchingRoles && <ActivityIndicator color={COLORS.primary} />}

            {!searchingRoles &&
              roleSearchItems.map((r) => (
                <TouchableOpacity
                  key={r.value}
                  style={block.row}
                  onPress={() => {
                    setMainRole(r.value);
                    setMainRoleName(r.label);
                    setRoleSearchModalVisible(false);
                  }}
                >
                  <Text style={{ color: COLORS.textPrimary, fontFamily: FONT_OBLIVION }}>
                    {r.label}
                  </Text>
                </TouchableOpacity>
              ))}

            {!searchingRoles && !roleSearchItems.length && <Text style={block.muted}>Type to search roles.</Text>}
          </ScrollView>
          <TouchableOpacity style={[styles.ghostBtn, { marginTop: 10 }]} onPress={() => setRoleSearchModalVisible(false)}>
            <Text style={styles.ghostBtnText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    {/* Side roles modal */}
    <Modal
      visible={sideRoleModalVisible}
      transparent
      animationType="fade"
      onRequestClose={() => setSideRoleModalVisible(false)}
    >
      <View style={centered.overlay}>
        <View style={centered.card}>
          <Text style={centered.title}>Add Side Roles</Text>
          <TextInput
            value={roleSearchTerm}
            onChangeText={(t) => {
              setRoleSearchTerm(t);
              fetchSearchRoles(t);
            }}
            placeholder="Search roles"
            placeholderTextColor={COLORS.textSecondary}
            style={styles.input}
          />
          <ScrollView style={{ maxHeight: 260, marginTop: 8 }}>
            {searchingRoles && <ActivityIndicator color={COLORS.primary} />}

            {!searchingRoles &&
              roleSearchItems.map((r) => {
                const isSelected = sideRoles.includes(r.label);
                return (
                  <TouchableOpacity
                    key={r.value}
                    style={[
                      block.row,
                      { backgroundColor: isSelected ? "#111" : "transparent" },
                    ]}
                    onPress={() => {
                      setSideRoles((prev) =>
                        isSelected ? prev.filter((x) => x !== r.label) : [...prev, r.label]
                      );
                    }}
                  >
                    <Text style={{ color: COLORS.textPrimary, fontFamily: FONT_OBLIVION }}>
                      {r.label}
                    </Text>
                    {isSelected && <Ionicons name="checkmark" size={18} color={COLORS.primary} />}
                  </TouchableOpacity>
                );
              })}

            {!searchingRoles && !roleSearchItems.length && <Text style={block.muted}>Type to search roles.</Text>}
          </ScrollView>

          <TouchableOpacity style={[styles.primaryBtn, { marginTop: 10 }]} onPress={() => setSideRoleModalVisible(false)}>
            <Text style={styles.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

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
      userId={(viewedUserId || currentUserId) ?? ""}
      profileOwnerName={
        viewedUserId && viewedUserId !== currentUserId
          ? profile?.full_name || "This user"
          : "You"
      }
      onSelectUser={(id) => {
        setConnectionsModalVisible(false);
        navigation.navigate("Profile", { userId: id });
      }}
    />
  </>
);
} // ✅ CLOSE THE COMPONENT HERE

/* ======================= STYLES ======================= */
/* ======================= STYLES ======================= */
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
  },
  heroImageMobile: {
    width: "100%",
    aspectRatio: 16 / 9,
    minHeight: 230,
  },
  heroImageDesktop: {
    width: "100%",
    height: "100%",
    minHeight: 420,
  },
  heroImageInner: { resizeMode: "cover", opacity: 0.98 },
  heroGradient: { ...StyleSheet.absoluteFillObject },

  roleWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },

  heroRoleThin: {
    color: COLORS.textPrimary,
    fontFamily: FONT_CINZEL,
    fontSize: 52,
    letterSpacing: 3.2,
    fontWeight: "700",
    textAlign: "center",
    textTransform: "uppercase",
    textShadowColor: "rgba(0,0,0,0.35)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 10,
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
  infoButtons: {
    flexDirection: "row",
    gap: 10,
    justifyContent: "center",
    marginBottom: 8,
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

protocolButtons: {
  flexDirection: "row",
  gap: 10,
},
  btnPrimary: {
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.primary,
    minWidth: 140,
    alignItems: "center",
  },
  btnPrimaryText: {
    color: "#000",
    fontWeight: "800",
    letterSpacing: 1,
    fontFamily: FONT_OBLIVION,
    fontSize: 13,
    textTransform: "uppercase",
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

  modalOverlay: {
    flex: 1,
    backgroundColor: "#000000CC",
    justifyContent: "flex-end",
    paddingHorizontal: 10,
  },
  modalContainer: {
    backgroundColor: COLORS.cardAlt,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    maxHeight: "92%",
    width: "100%",
    alignSelf: "center",
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  modalHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.border,
    alignSelf: "center",
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: COLORS.textPrimary,
    textAlign: "center",
    letterSpacing: 3,
    fontFamily: FONT_CINZEL,
    textTransform: "uppercase",
  },

  field: { marginTop: 14 },
  fieldLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.textSecondary,
    marginBottom: 7,
    marginLeft: 2,
    fontFamily: FONT_OBLIVION,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 12,
    color: COLORS.textPrimary,
    backgroundColor: "#0C0C0C",
    fontFamily: FONT_OBLIVION,
    fontSize: 14,
    letterSpacing: 0.2,
  },
  multiline: { minHeight: 100 },

  pickerBtn: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: "#0C0C0C",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  pickerBtnText: {
    color: COLORS.textSecondary,
    fontFamily: FONT_OBLIVION,
    fontSize: 14,
    letterSpacing: 0.2,
  },

  primaryBtn: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 12,
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

  uploadRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    marginTop: 8,
  },
  pillBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: "#0C0C0C",
  },
  pillText: {
    color: COLORS.textPrimary,
    fontFamily: FONT_OBLIVION,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    fontSize: 12,
  },
});

const block = StyleSheet.create({
  section: { marginTop: 24 },

  // same vibe as the “Filmmaking streak • Year 1” text
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

  // same vibe as the streak label, just scaled up slightly
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
  rowBtnGhost: {
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    marginLeft: 6,
    backgroundColor: "#0C0C0C",
  },
  rowBtnGhostText: {
    color: COLORS.textPrimary,
    fontWeight: "700",
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
    borderRadius: 18,
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
    fontFamily: FONT_CINZEL,
    letterSpacing: 2.6,
    textTransform: "uppercase",
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