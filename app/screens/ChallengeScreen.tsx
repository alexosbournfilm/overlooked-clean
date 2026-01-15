// app/screens/ChallengeScreen.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
  ActivityIndicator,
  Platform,
  Modal,
  Pressable,
  ImageBackground,
  useWindowDimensions,
  Image,
} from "react-native";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { useNavigation } from "@react-navigation/native";
import { supabase, giveXp, XP_VALUES } from "../lib/supabase";
import type { Session } from "@supabase/supabase-js";
import type { MonthlyChallenge } from "../types";
import { Video, ResizeMode } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import { Upload } from "tus-js-client";
import { LinearGradient } from "expo-linear-gradient";
import { useGamification } from "../context/GamificationContext";
import { UpgradeModal } from "../../components/UpgradeModal";
import { backfillMissingSubmissionThumbnails } from "../lib/backfillThumbnails";
import { useMonthlyStreak } from "../lib/useMonthlyStreak";

import * as FileSystem from "expo-file-system";
import * as VideoThumbnails from "expo-video-thumbnails";
import { Buffer } from "buffer";

dayjs.extend(duration);

/* ------------------------------- palette ------------------------------- */
const GOLD = "#C6A664";
const DARK_BG = "#0D0D0D";
const BORDER = "#2A2A2A";
const TEXT_IVORY = "#EDEBE6";
const TEXT_MUTED = "#A7A6A2";

const T = {
  bg: DARK_BG,
  card: "#101010",
  text: TEXT_IVORY,
  sub: "#DADADA",
  mute: TEXT_MUTED,
  olive: GOLD,
  line: BORDER,
};

const SYSTEM_SANS = Platform.select({
  ios: "System",
  android: "Roboto",
  web: undefined,
  default: undefined,
});

/* ---------------------------- constants/types --------------------------- */
type Category = "film" | "acting" | "music";

const MAX_UPLOAD_BYTES = 3 * 1024 * 1024 * 1024; // 3GB

const STORAGE_BUCKET = "films";
const THUMB_BUCKET = "thumbnails";

/* ---------------- Hero image (warm + cinematic) ---------------- */
const HERO_IMAGE =
  "https://images.pexels.com/photos/3379943/pexels-photo-3379943.jpeg?auto=compress&cs=tinysrgb&w=2000";

/* ---------------- Film Grain ---------------- */
const GRAIN_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIElEQVQYV2P8//8/AzGAiYGB4T8mGJgYhBmMCEwMDAwA1wQq1i3gN8QAAAAASUVORK5CYII=";

const Grain = ({ opacity = 0.06 }: { opacity?: number }) => (
  <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { opacity }]}>
    <ImageBackground
      source={{ uri: GRAIN_PNG }}
      style={StyleSheet.absoluteFillObject}
      resizeMode={"repeat" as any}
    />
  </View>
);

/* ---------------- UX helpers ---------------- */
function notify(title: string, message?: string, setStatusFn?: (s: string) => void) {
  const text = message ? `${title} — ${message}` : title;

  // ✅ ALWAYS show something on-screen (works even if alerts are blocked)
  if (setStatusFn) setStatusFn(text);

  // Optional: also try alert
  try {
    if (Platform.OS === "web") {
      // @ts-ignore
      window.alert(message ? `${title}\n\n${message}` : title);
    } else {
      Alert.alert(title, message);
    }
  } catch {}
}

/**
 * ✅ THEME GUARANTEE (server-persisted)
 * IMPORTANT: Theme must NOT change on refresh.
 *
 * If theme_word is blank, we try to pick one and WRITE IT BACK to the DB.
 * If we cannot persist it (RLS / permissions / network), we DO NOT show a random word.
 * Instead we show a stable fallback ("Untitled") so the theme stays consistent across refreshes.
 */
async function ensureThemeWordOnChallengeRow(ch: MonthlyChallenge): Promise<MonthlyChallenge> {
  try {
    const current = (ch?.theme_word ?? "").trim();
    if (current) return ch;

    const pick = await supabase.from("theme_words").select("word").order("word", { ascending: true });

    if (!pick.error && Array.isArray(pick.data) && pick.data.length > 0) {
      const words = pick.data
        .map((r: any) => String(r?.word ?? "").trim())
        .filter((w: string) => w.length > 0);

      if (words.length > 0) {
        const chosen = words[Math.floor(Math.random() * words.length)];

        const upd = await supabase
          .from("monthly_challenges")
          .update({ theme_word: chosen })
          .eq("id", ch.id)
          .select("id, month_start, month_end, theme_word")
          .single();

        if (!upd.error && upd.data?.theme_word) return upd.data as MonthlyChallenge;

        return { ...ch, theme_word: "Untitled" } as MonthlyChallenge;
      }
    }

    return { ...ch, theme_word: "Untitled" } as MonthlyChallenge;
  } catch (e) {
    console.warn("[challenge] ensureThemeWord failed:", (e as any)?.message ?? e);
    return { ...ch, theme_word: (ch?.theme_word ?? "").trim() || "Untitled" } as MonthlyChallenge;
  }
}

async function fetchCurrentChallenge() {
  // 1) finalize winner (previous month) if needed
  try {
    const { error } = await supabase.rpc("finalize_last_month_winner_if_needed");
    if (error) console.warn("[challenge] finalize_last_month_winner_if_needed:", error.message);
  } catch (e: any) {
    console.warn("[challenge] finalize rpc threw:", e?.message || e);
  }

  // 2) ensure current month row exists
  try {
    const { error } = await supabase.rpc("insert_monthly_challenge_if_not_exists");
    if (error) console.warn("[challenge] insert_monthly_challenge_if_not_exists:", error.message);
  } catch (e: any) {
    console.warn("[challenge] insert rpc threw:", e?.message || e);
  }

  // 3) robust fetch: try exact month_start/month_end (DATE-safe), then range, then fallback
  const start = dayjs().startOf("month");
  const end = start.add(1, "month");

  const startDateOnly = start.format("YYYY-MM-DD");
  const endDateOnly = end.format("YYYY-MM-DD");

  // Try exact DATE match
  const exact = await supabase
    .from("monthly_challenges")
    .select("id, month_start, month_end, theme_word")
    .eq("month_start", startDateOnly)
    .eq("month_end", endDateOnly)
    .limit(1)
    .single();

  if (!exact.error && exact.data) {
    return (await ensureThemeWordOnChallengeRow(exact.data as MonthlyChallenge)) as MonthlyChallenge;
  }

  // Try timestamp range
  const nowIso = new Date().toISOString();
  const range = await supabase
    .from("monthly_challenges")
    .select("id, month_start, month_end, theme_word")
    .lte("month_start", nowIso)
    .gt("month_end", nowIso)
    .order("month_start", { ascending: false })
    .limit(1)
    .single();

  if (!range.error && range.data) {
    return (await ensureThemeWordOnChallengeRow(range.data as MonthlyChallenge)) as MonthlyChallenge;
  }

  // Final fallback: latest row
  const fallback = await supabase
    .from("monthly_challenges")
    .select("id, month_start, month_end, theme_word")
    .order("month_start", { ascending: false })
    .limit(1)
    .single();

  if (fallback.error) throw fallback.error;

  console.warn(
    "[challenge] WARNING: current month row not found. Using latest row instead.",
    "Expected month_start=",
    startDateOnly,
    "month_end=",
    endDateOnly
  );

  return (await ensureThemeWordOnChallengeRow(fallback.data as MonthlyChallenge)) as MonthlyChallenge;
}

async function getResumableEndpoint() {
  const probe = supabase.storage.from(STORAGE_BUCKET).getPublicUrl("__probe__");
  const url = new URL(probe.data.publicUrl);
  const projectRef = url.hostname.split(".")[0];
  return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
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

  if (Platform.OS !== "web" && thumbUri.startsWith("file://")) {
    const base64 = await FileSystem.readAsStringAsync(thumbUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = Buffer.from(base64, "base64");
    blob = new Blob([bytes], { type: "image/jpeg" });
  } else {
    const resp = await fetch(thumbUri);
    blob = await resp.blob();
  }

  const ext =
    blob.type.includes("png")
      ? ".png"
      : blob.type.includes("jpeg") || blob.type.includes("jpg")
      ? ".jpg"
      : blob.type.includes("webp")
      ? ".webp"
      : ".jpg";

  const filePath = `${objectName}${ext}`;

  const up = await supabase.storage.from(bucket).upload(filePath, blob, {
    upsert: true,
    contentType: blob.type || "image/jpeg",
    cacheControl: "3600",
  });

  if (up.error) throw up.error;

  const pub = supabase.storage.from(bucket).getPublicUrl(filePath);
  const publicUrl = pub?.data?.publicUrl;

  if (!publicUrl) throw new Error("Could not get public thumbnail URL");

  return { publicUrl, path: filePath };
}

async function uploadResumable(opts: {
  userId: string;
  fileBlob?: Blob | File | null;
  localUri?: string | null;
  onProgress?: (pct: number) => void;
  onPhase?: (label: string) => void;
  objectName?: string;
  bucket?: string;
}): Promise<{ path: string; contentType: string }> {
  const {
    userId,
    fileBlob,
    localUri,
    onProgress,
    onPhase,
    objectName = `submissions/${userId}/${Date.now()}`,
    bucket = STORAGE_BUCKET,
  } = opts;

  onPhase?.("Preparing file…");

  let file: Blob;
  let type = "application/octet-stream";

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
    throw new Error("No file to upload");
  }

  const ext =
    type.includes("png")
      ? ".png"
      : type.includes("jpeg") || type.includes("jpg")
      ? ".jpg"
      : type.includes("webp")
      ? ".webp"
      : type.includes("gif")
      ? ".gif"
      : type.includes("mp4")
      ? ".mp4"
      : type.includes("quicktime")
      ? ".mov"
      : type.startsWith("audio/")
      ? ".mp3"
      : type.startsWith("video/")
      ? ".mp4"
      : "";

  const finalObjectName = objectName + ext;

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error("Not signed in");

  const endpoint = await getResumableEndpoint();

  return new Promise<{ path: string; contentType: string }>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint,
      retryDelays: [0, 2000, 5000, 10000, 20000],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "x-upsert": "true",
      },
      metadata: {
        bucketName: bucket,
        objectName: finalObjectName,
        contentType: type,
        cacheControl: "3600",
      },
      onProgress: (sent, total) => {
        if (!total) return;
        const pct = Math.max(0, Math.min(100, Math.round((sent / total) * 100)));
        onProgress?.(pct);
      },
      onError: (err) => reject(err),
      onSuccess: () => resolve({ path: finalObjectName, contentType: type }),
    });

    onPhase?.("Uploading file…");
    upload.findPreviousUploads().then((prev) => {
      if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    });
  });
}

function mediaKindFromMime(
  mime: string | null | undefined
): "file_audio" | "file_video" | "youtube" {
  if (!mime) return "file_video";
  if (mime.startsWith("audio/")) return "file_audio";
  if (mime.startsWith("video/")) return "file_video";
  return "file_video";
}

/* ✅ formatting helpers */
function formatBytes(bytes?: number | null) {
  if (!bytes || !Number.isFinite(bytes)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let b = bytes;
  let u = 0;
  while (b >= 1024 && u < units.length - 1) {
    b /= 1024;
    u++;
  }
  const dp = u === 0 ? 0 : u === 1 ? 0 : 1;
  return `${b.toFixed(dp)} ${units[u]}`;
}
function formatDur(sec?: number | null) {
  if (!sec || !Number.isFinite(sec) || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* ✅ SUPER-ROBUST WEB thumbnail (first decodable frame) */
async function captureFirstFrameWeb(videoSrc: string): Promise<{
  dataUrl: string;
  aspect: number;
} | null> {
  try {
    // @ts-ignore
    if (Platform.OS !== "web" || typeof document === "undefined") return null;

    const video = document.createElement("video");
    video.src = videoSrc;
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "true");
    video.setAttribute("muted", "true");
    video.crossOrigin = "anonymous";

    video.style.position = "fixed";
    video.style.left = "-9999px";
    video.style.top = "0px";
    video.style.width = "1px";
    video.style.height = "1px";
    document.body.appendChild(video);

    const cleanup = () => {
      try {
        video.pause();
      } catch {}
      try {
        video.removeAttribute("src");
        video.load();
      } catch {}
      try {
        document.body.removeChild(video);
      } catch {}
    };

    const draw = (): { dataUrl: string; aspect: number } | null => {
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      if (!w || !h) return null;

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      ctx.drawImage(video, 0, 0, w, h);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      const aspect = w / h;
      return { dataUrl, aspect };
    };

    const result = await new Promise<{ dataUrl: string; aspect: number } | null>((resolve) => {
      let done = false;

      const finish = (val: { dataUrl: string; aspect: number } | null) => {
        if (done) return;
        done = true;
        resolve(val);
      };

      const timeout = setTimeout(() => {
        finish(draw());
      }, 8000);

      const tryFinish = () => {
        const out = draw();
        if (out) {
          clearTimeout(timeout);
          finish(out);
        }
      };

      // @ts-ignore
      if (typeof (video as any).requestVideoFrameCallback === "function") {
        try {
          // @ts-ignore
          (video as any).requestVideoFrameCallback(() => {
            tryFinish();
          });
        } catch {}
      }

      video.addEventListener("loadeddata", tryFinish, { once: true });
      video.addEventListener("canplay", tryFinish, { once: true });
      video.addEventListener("seeked", tryFinish, { once: true });
      video.addEventListener(
        "error",
        () => {
          clearTimeout(timeout);
          finish(null);
        },
        { once: true }
      );

      (async () => {
        try {
          await video.play();
          video.pause();
        } catch {}
        try {
          video.currentTime = 0.05;
        } catch {}
      })();
    });

    cleanup();
    return result;
  } catch {
    return null;
  }
}

/* -------------------- Film category tags (expanded) -------------------- */
const FILM_TAGS: string[] = [
  // Originals (kept)
  "Drama",
  "Comedy",
  "Thriller",
  "Horror",
  "Sci-Fi",
  "Romance",
  "Action",
  "Mystery",
  "Crime",
  "Fantasy",
  "Coming-of-Age",
  "Experimental",
  "Documentary-Style",
  "No-Dialogue",
  "One-Take",
  "Found Footage",
  "Slow Cinema",
  "Satire",
  "Neo-Noir",
  "Musical",

  // ✅ New (acting + narrative + tone)
  "Tragedy",
  "Monologue",
  "Character Study",
  "Dialogue-Driven",
  "Dramedy",
  "Dark Comedy",
  "Psychological",
  "Suspense",
  "Period Piece",
  "Social Realism",
  "Rom-Com",
  "Heist",
  "War",
  "Western",
  "Supernatural",
  "Animation-Style",
  "Silent Film",
  "Improvised",
  "Voiceover",
  "Two-Hander",
  "Single Location",
];

/* ------------------------- insert helper (robust) ------------------------ */
function looksLikeMissingColumnError(msg: string) {
  const m = (msg || "").toLowerCase();

  // Postgres style:
  // "column \"xyz\" of relation \"submissions\" does not exist"
  if (m.includes("column") && m.includes("does not exist")) return true;

  // PostgREST schema cache style (YOUR CURRENT ERROR):
  // "Could not find the 'monthly_challenge_id' column of 'submissions' in the schema cache"
  if (m.includes("schema cache") && m.includes("could not find") && m.includes("column")) return true;

  return false;
}
function extractMissingColumnName(msg: string): string | null {
  // Postgres: column "xyz" ...
  const m1 = msg.match(/column\s+"([^"]+)"/i);
  if (m1?.[1]) return m1[1];

  // Postgres: column submissions.xyz does not exist
  const m2 = msg.match(/column\s+([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)\s+does\s+not\s+exist/i);
  if (m2?.[1]) return m2[1].split(".").pop() || null;

  // PostgREST schema cache: could not find the 'xyz' column of 'submissions' in the schema cache
  const m3 = msg.match(/could\s+not\s+find\s+the\s+'([^']+)'\s+column/i);
  if (m3?.[1]) return m3[1];

  return null;
}

async function insertSubmissionRobust(
  payload: Record<string, any>,
  requiredKeys: string[] = ["user_id", "title", "submitted_at"]
) {
  // Try insert, and if schema mismatch (missing columns), remove unknown columns and retry.
  let working = { ...payload };

  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await supabase.from("submissions").insert(working).select().limit(1);

    if (!res.error) return res;

    const msg = String(res.error.message || "");
    const missingCol = extractMissingColumnName(msg);

    // If it's not a missing-column error, stop and throw it.
    if (!looksLikeMissingColumnError(msg) || !missingCol) throw res.error;

    // Never remove required fields.
    if (requiredKeys.includes(missingCol)) throw res.error;

    // Remove the missing column and retry.
    if (Object.prototype.hasOwnProperty.call(working, missingCol)) {
      delete working[missingCol];
      continue;
    }

    // If we couldn't find it in the object (weird message), bail.
    throw res.error;
  }

  throw new Error("Insert failed after multiple retries. Check submissions table schema / RLS.");
}

/* -------------------------------- Screen -------------------------------- */

export default function ChallengeScreen() {
  const navigation = useNavigation<any>();
  const { width, height: winH } = useWindowDimensions();

  const isWide = width >= 1100;

  const [challenge, setChallenge] = useState<MonthlyChallenge | null>(null);
  const [countdown, setCountdown] = useState("");
  const [session, setSession] = useState<Session | null>(null);

  const [category] = useState<Category>("film");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [agreed, setAgreed] = useState(false);

  const [localUri, setLocalUri] = useState<string | null>(null);
  const [webFile, setWebFile] = useState<File | Blob | null>(null);
  const objectUrlRef = useRef<string | null>(null);
  const [durationSec, setDurationSec] = useState<number | null>(null);

  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);

  const [thumbUri, setThumbUri] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [thumbAspect, setThumbAspect] = useState<number>(16 / 9);

  // ✅ user-picked thumbnail
  const [customThumbUri, setCustomThumbUri] = useState<string | null>(null);
  const customThumbObjectUrlRef = useRef<string | null>(null);

  // ✅ film categories (tags) - pick up to 3
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  const [previewVisible, setPreviewVisible] = useState(false);

  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [rulesVisible, setRulesVisible] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [etaText, setEtaText] = useState("");

  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [userTier, setUserTier] = useState<string | null>(null);

  const videoRef = useRef<Video>(null);
  const webDurationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const previewPlayerRef = useRef<Video>(null);
  const previewLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  const webPreviewVideoRef = useRef<HTMLVideoElement | null>(null);

  const {
    xp,
    level,
    levelTitle,
    nextLevelMinXp,
    loading: gamificationLoading,
    refresh: refreshGamification,
  } = useGamification();

  const {
  streak,
  loading: streakLoading,
  errorMsg: streakErrorMsg,
  refreshStreak,
} = useMonthlyStreak();

  const SUBMIT_XP = (XP_VALUES && (XP_VALUES as any).CHALLENGE_SUBMISSION) || 50;

  const xpToNext =
    nextLevelMinXp && typeof xp === "number" ? Math.max(0, nextLevelMinXp - xp) : null;

  const clearPreviewTimer = () => {
    if (previewLoadTimer.current) {
      clearTimeout(previewLoadTimer.current);
      previewLoadTimer.current = null;
    }
  };

  const startPreviewTimer = () => {
    clearPreviewTimer();
    previewLoadTimer.current = setTimeout(async () => {
      setPreviewLoading(false);
      setPreviewError("Preview is taking too long to load. Tap Retry or pick a different file.");
      try {
        await previewPlayerRef.current?.stopAsync?.();
      } catch {}
      try {
        await previewPlayerRef.current?.unloadAsync?.();
      } catch {}
    }, 12000);
  };

  const stopWebPreviewIfAny = () => {
    try {
      const el = webPreviewVideoRef.current;
      if (el) {
        el.pause();
        el.currentTime = 0;
      }
    } catch {}
  };

  const openPreview = () => {
    setPreviewError(null);
    setPreviewLoading(true);
    setPreviewNonce((n) => n + 1);
    setPreviewVisible(true);
    startPreviewTimer();
  };

  const retryPreview = () => {
    setPreviewError(null);
    setPreviewLoading(true);
    setPreviewNonce((n) => n + 1);
    startPreviewTimer();
  };

  const closePreview = () => {
    setPreviewVisible(false);
    setPreviewLoading(false);
    setPreviewError(null);
    clearPreviewTimer();

    stopWebPreviewIfAny();

    (async () => {
      try {
        await previewPlayerRef.current?.stopAsync?.();
      } catch {}
      try {
        await previewPlayerRef.current?.unloadAsync?.();
      } catch {}
    })();
  };

  const revokeCustomThumbObjectUrlIfAny = () => {
    if (customThumbObjectUrlRef.current) {
      try {
        URL.revokeObjectURL(customThumbObjectUrlRef.current);
      } catch {}
      customThumbObjectUrlRef.current = null;
    }
  };

  const removeCustomThumbnail = () => {
    revokeCustomThumbObjectUrlIfAny();
    setCustomThumbUri(null);
  };

  const resetSelectedFile = () => {
    if (objectUrlRef.current) {
      try {
        URL.revokeObjectURL(objectUrlRef.current);
      } catch {}
      objectUrlRef.current = null;
    }

    removeCustomThumbnail();

    setLocalUri(null);
    setWebFile(null);
    setDurationSec(null);
    setFileSizeBytes(null);

    setThumbUri(null);
    setThumbAspect(16 / 9);
    setThumbLoading(false);

    setPreviewVisible(false);
    setPreviewLoading(false);
    setPreviewError(null);
    clearPreviewTimer();

    setStatus("");
    setProgressPct(0);
    setEtaText("");
  };

  useEffect(() => {
  (async () => {
    try {
      setChallenge(await fetchCurrentChallenge());
    } catch {}

    const { data } = await supabase.auth.getSession();
    setSession(data.session);

    // ✅ cache tier for instant Pro gating (web-safe)
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("users")
          .select("tier")
          .eq("id", user.id)
          .single();

        setUserTier((profile?.tier ?? "").toLowerCase().trim() || null);
      } else {
        setUserTier(null);
      }
    } catch {
      setUserTier(null);
    }
  })();
}, []);

  useEffect(() => {
    if (!challenge) return;

    let alive = true;

    const updateCountdown = async () => {
      const fallbackEnd = dayjs().startOf("month").add(1, "month");
      const dbEnd = challenge?.month_end ? dayjs(challenge.month_end) : null;
      const targetEnd = dbEnd && dbEnd.isValid() && dbEnd.isAfter(dayjs()) ? dbEnd : fallbackEnd;

      const diffMs = targetEnd.diff(dayjs());

      if (diffMs <= 0) {
        setCountdown("This challenge has ended. Updating…");
        try {
          const next = await fetchCurrentChallenge();
          if (alive) setChallenge(next);
        } catch {}
        return;
      }

      const totalMinutes = Math.floor(diffMs / 60000);
      const minsPerDay = 60 * 24;
      const days = Math.floor(totalMinutes / minsPerDay);
      const hours = Math.floor((totalMinutes % minsPerDay) / 60);
      const minutes = totalMinutes % 60;

      setCountdown(`${days}d ${hours}h ${minutes}m`);
    };

    updateCountdown();
    const t = setInterval(updateCountdown, 60_000);

    const refresh = setInterval(() => {
      fetchCurrentChallenge().then((c) => alive && setChallenge(c)).catch(() => {});
    }, 10 * 60_000);

    return () => {
      alive = false;
      clearInterval(t);
      clearInterval(refresh);
    };
  }, [challenge]);

  useEffect(() => {
    return () => {
      clearPreviewTimer();
      if (webDurationTimer.current) {
        clearTimeout(webDurationTimer.current);
        webDurationTimer.current = null;
      }
      if (objectUrlRef.current) {
        try {
          URL.revokeObjectURL(objectUrlRef.current);
        } catch {}
        objectUrlRef.current = null;
      }
      revokeCustomThumbObjectUrlIfAny();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthLabel = dayjs().format("MMMM");

  const capText = "No duration limit. Max file size: 3GB.";

  const headerTitle = `${monthLabel} ${
    category === "film" ? "Film" : category === "acting" ? "Acting" : "Music"
  } Challenge`;

  const explainer =
    category === "film"
      ? "Make a short film. All levels welcome — upload your video directly here."
      : category === "acting"
      ? "Perform a monologue (max 2 minutes). All levels welcome — upload your video here."
      : "Create a track inspired by the theme. Upload an MP3 or a performance video.";

  const pickThumbnail = async () => {
    try {
      const pick = await DocumentPicker.getDocumentAsync({
        type: ["image/*"] as any,
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (pick.canceled) return;

      const asset: any = pick.assets?.[0];
      if (!asset?.uri && !asset?.file) return;

      revokeCustomThumbObjectUrlIfAny();

      if (Platform.OS === "web" && asset.file) {
        const f: File = asset.file;
        const objUrl = URL.createObjectURL(f);
        customThumbObjectUrlRef.current = objUrl;
        setCustomThumbUri(objUrl);
        return;
      }

      if (asset.uri) {
        setCustomThumbUri(asset.uri);
      }
    } catch (e: any) {
      console.warn("pickThumbnail failed:", e?.message ?? e);
      notify("Could not pick thumbnail", "Try a different image.");
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const has = prev.includes(tag);
      if (has) return prev.filter((t) => t !== tag);
      if (prev.length >= 3) return prev;
      return [...prev, tag];
    });
  };

const pickFile = async () => {
  try {
    // ---------------------------
    // ✅ WEB: MUST be synchronous
    // ---------------------------
    if (Platform.OS === "web") {
      // If tier hasn't loaded yet, don't try to open picker (browser will block if we await first)
      const tierNorm = (userTier ?? "").toLowerCase().trim();

      if (!tierNorm) {
        notify("Loading your account…", "Try again in 1 second.", setStatus);

        // refresh tier in background (NO picker this click)
        (async () => {
          try {
            const {
              data: { user },
              error: uErr,
            } = await supabase.auth.getUser();

            if (uErr || !user) return;

            const { data: profile } = await supabase
              .from("users")
              .select("tier")
              .eq("id", user.id)
              .single();

            if (profile?.tier) setUserTier(profile.tier);
          } catch {}
        })();

        return;
      }

      if (tierNorm !== "pro") {
        setUpgradeVisible(true);
        return;
      }

      // ✅ Tier is pro, so we are allowed to open picker immediately (no awaits before this)
      setStatus("");
      setDurationSec(null);
      setThumbUri(null);
      setThumbAspect(16 / 9);
      setThumbLoading(false);

      removeCustomThumbnail();

      setPreviewVisible(false);
      setPreviewLoading(false);
      setPreviewError(null);
      clearPreviewTimer();

      setLocalUri(null);
      setWebFile(null);
      setProgressPct(0);
      setEtaText("");

      const acceptType = category === "music" ? ["audio/*", "video/*"] : ["video/*"];

      const pick = await DocumentPicker.getDocumentAsync({
        type: acceptType as any,
        copyToCacheDirectory: true,
      });

      if (pick.canceled) return;

      const asset: any = pick.assets?.[0];
      if (!asset?.uri) {
        notify("No file", "Please choose a file.");
        return;
      }

      let bytes: number | null = null;

      if (asset.file) {
        const f: File = asset.file;
        bytes = typeof f.size === "number" ? f.size : null;

        if (objectUrlRef.current) {
          try {
            URL.revokeObjectURL(objectUrlRef.current);
          } catch {}
        }

        const objUrl = URL.createObjectURL(f);
        objectUrlRef.current = objUrl;

        setWebFile(f);
        setLocalUri(objUrl);
      } else {
        // fallback (rare on web)
        setWebFile(null);
        setLocalUri(asset.uri);
      }

      setFileSizeBytes(bytes);

      if (bytes != null && bytes > MAX_UPLOAD_BYTES) {
        notify(
          "File too large",
          `This file is ${formatBytes(bytes)}. Max allowed is ${formatBytes(MAX_UPLOAD_BYTES)}.`
        );
        resetSelectedFile();
        return;
      }

      const shouldTryThumb = category !== "music";
      if (shouldTryThumb) {
        setThumbLoading(true);

        const src = objectUrlRef.current ?? asset.uri;
        const thumb = await captureFirstFrameWeb(src);

        if (thumb?.dataUrl) {
          setThumbUri(thumb.dataUrl);
          setThumbAspect(thumb.aspect || 16 / 9);
        } else {
          setThumbUri(null);
        }

        setThumbLoading(false);
      }

      setStatus("Loaded file. Checking duration…");
      return;
    }

    // ---------------------------
    // ✅ NATIVE (iOS/Android): can await safely
    // ---------------------------
    const {
      data: { user },
      error: uErr,
    } = await supabase.auth.getUser();

    if (uErr) {
      notify("Please try again", "We couldn’t verify your account right now.");
      return;
    }
    if (!user) {
      notify("Please sign in", "You must be logged in to submit.");
      return;
    }

    // check tier (native can await before picker)
    const { data: profile, error: pErr } = await supabase
      .from("users")
      .select("tier")
      .eq("id", user.id)
      .single();

    if (pErr) {
      notify("Please try again", "We couldn’t verify your Pro status right now.");
      return;
    }

    const tierNorm = String(profile?.tier ?? "").toLowerCase().trim();
    setUserTier(profile?.tier ?? null);

    if (tierNorm !== "pro") {
      setUpgradeVisible(true);
      return;
    }

    // 🔽 existing picker logic (native)
    setStatus("");
    setDurationSec(null);

    setThumbUri(null);
    setThumbAspect(16 / 9);
    setThumbLoading(false);

    removeCustomThumbnail();

    setPreviewVisible(false);
    setPreviewLoading(false);
    setPreviewError(null);
    clearPreviewTimer();

    setLocalUri(null);
    setWebFile(null);
    setProgressPct(0);
    setEtaText("");

    const acceptType = category === "music" ? ["audio/*", "video/*"] : ["video/*"];

    const pick = await DocumentPicker.getDocumentAsync({
      type: acceptType as any,
      copyToCacheDirectory: true,
    });
    if (pick.canceled) return;

    const asset: any = pick.assets?.[0];
    if (!asset?.uri) {
      notify("No file", "Please choose a file.");
      return;
    }

    let bytes: number | null = null;

    if (typeof asset.size === "number") bytes = asset.size;
    if (bytes == null) {
      try {
        const info = await FileSystem.getInfoAsync(asset.uri, { size: true } as any);
        // @ts-ignore
        if (info?.exists && typeof (info as any)?.size === "number") bytes = (info as any).size;
      } catch {}
    }

    setWebFile(null);
    setLocalUri(asset.uri);

    setFileSizeBytes(bytes);

    if (bytes != null && bytes > MAX_UPLOAD_BYTES) {
      notify(
        "File too large",
        `This file is ${formatBytes(bytes)}. Max allowed is ${formatBytes(MAX_UPLOAD_BYTES)}.`
      );
      resetSelectedFile();
      return;
    }

    const shouldTryThumb = category !== "music";
    if (shouldTryThumb) {
      setThumbLoading(true);

      try {
        const thumb = await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 120 });
        if (thumb?.uri) setThumbUri(thumb.uri);

        // @ts-ignore
        const w = (thumb as any)?.width;
        // @ts-ignore
        const h = (thumb as any)?.height;
        if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) {
          setThumbAspect(w / h);
        }
      } catch {
        setThumbUri(null);
      } finally {
        setThumbLoading(false);
      }
    }

    setStatus("Loaded file. Checking duration…");
  } catch (e) {
    console.warn("pickFile failed:", (e as any)?.message ?? e);
    notify("Could not open picker", "Try again.");
  }
};


  useEffect(() => {
    if (Platform.OS !== "web" || !localUri) return;

    let cancelled = false;

    try {
      // @ts-ignore
      const videoEl = document.createElement("video");
      videoEl.preload = "metadata";
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.src = localUri;

      const sizeText = formatBytes(fileSizeBytes);

      const cleanup = () => {
        // @ts-ignore
        videoEl.onloadedmetadata = null;
        // @ts-ignore
        videoEl.ontimeupdate = null;
        // @ts-ignore
        videoEl.onerror = null;
        try {
          // @ts-ignore
          videoEl.src = "";
        } catch {}
        if (webDurationTimer.current) {
          clearTimeout(webDurationTimer.current);
          webDurationTimer.current = null;
        }
      };

      const applyDuration = (d: number | null) => {
        if (cancelled) return;
        if (d && Number.isFinite(d) && d > 0) {
          const dSec = Math.max(1, Math.round(d));
          setDurationSec(dSec);
          setStatus(`Media ready • duration ${formatDur(dSec)} • ${sizeText}`);
        } else {
          setDurationSec(null);
          setStatus(`Media ready (duration unknown) • ${sizeText}`);
        }
      };

      // @ts-ignore
      videoEl.onloadedmetadata = () => {
        // @ts-ignore
        if (Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
          // @ts-ignore
          applyDuration(videoEl.duration);
          cleanup();
          return;
        }

        try {
          // @ts-ignore
          videoEl.ontimeupdate = () => {
            // @ts-ignore
            if (Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
              // @ts-ignore
              applyDuration(videoEl.duration);
              cleanup();
            }
          };
          // @ts-ignore
          videoEl.currentTime = 1e101;
        } catch {
          applyDuration(null);
          cleanup();
        }
      };

      // @ts-ignore
      videoEl.onerror = () => {
        applyDuration(null);
        cleanup();
      };

      webDurationTimer.current = setTimeout(() => {
        // @ts-ignore
        applyDuration(Number.isFinite(videoEl.duration) ? videoEl.duration : null);
        cleanup();
      }, 12000);
    } catch {
      const sizeText = formatBytes(fileSizeBytes);
      setDurationSec(null);
      setStatus(`Media ready (duration unknown) • ${sizeText}`);
    }

    return () => {
      cancelled = true;
      if (webDurationTimer.current) {
        clearTimeout(webDurationTimer.current);
        webDurationTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localUri]);

  const onVideoLoaded = (payload: any) => {
    const dMs = payload?.durationMillis ?? 0;
    const dSec = Math.max(0, Math.round(dMs / 1000));
    if (dSec > 0) setDurationSec(dSec);

    const sizeText = formatBytes(fileSizeBytes);

    if (dSec > 0) {
      setStatus(`Media ready • duration ${formatDur(dSec)} • ${sizeText}`);
    } else {
      setStatus(`Media ready (duration unknown) • ${sizeText}`);
    }
  };

  const handleSubmit = async () => {
  if (!agreed)
    return notify(
      "Agreement required",
      "You must agree to the rules before submitting.",
      setStatus
    );

  if (!session)
    return notify(
      "Please sign in",
      "You must be logged in to submit.",
      setStatus
    );

  if (!title.trim() || !description.trim())
    return notify(
      "Please complete all fields.",
      undefined,
      setStatus
    );

  if (!localUri && !webFile)
    return notify(
      "No file selected",
      "Pick a file first.",
      setStatus
    );

  // ✅ require tags for film
  if (category === "film" && selectedTags.length === 0) {
    return notify(
      "Pick categories",
      "Choose at least 1 category (up to 3) for your film.",
      setStatus
    );
  }

    if (fileSizeBytes != null && fileSizeBytes > MAX_UPLOAD_BYTES) {
      return notify(
        "File too large",
        `This file is ${formatBytes(fileSizeBytes)}. Max allowed is ${formatBytes(MAX_UPLOAD_BYTES)}.`
      );
    }

    // ✅ Server preflight gate (TEMP BYPASS FOR TESTING)
    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr) throw userErr;
      if (!user) {
        notify("Please sign in", "You must be logged in to submit.");
        return;
      }

      const BYPASS_LIMITS_FOR_TESTING = false;

      if (!BYPASS_LIMITS_FOR_TESTING) {
        const { data, error } = await supabase.rpc("can_submit_this_month", {
          p_user_id: user.id,
        });

        if (error) throw error;

        const row = Array.isArray(data) ? data[0] : data;

        if (!row?.allowed) {
          if (row?.reason === "tier_too_low") {
            notify(
              "Upgrade required",
              "Submitting to the monthly challenge is available on the Pro tier."
            );
            setUpgradeVisible(true);
            return;
          }

          if (row?.reason === "no_submissions_left") {
            notify("Submission limit reached", "You’ve used all 2 submissions for this month.");
            return;
          }

          notify("Not allowed", "You can’t submit right now.");
          return;
        }
      }
    } catch (err) {
      console.warn("server preflight can_submit_this_month failed:", err);
      notify(
        "Please try again",
        "We couldn’t verify your submission limit just now. Try again in a moment."
      );
      return;
    }

    setLoading(true);
setStatus("Checking eligibility…");
setProgressPct(0);
setEtaText("");

// ✅ Server preflight gate
try {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr) throw userErr;
  if (!user) {
    setLoading(false);
    return notify("Please sign in", "You must be logged in to submit.", setStatus);
  }

  const { data, error } = await supabase.rpc("can_submit_this_month", {
    p_user_id: user.id,
  });

  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;

  if (!row?.allowed) {
    setLoading(false);

    if (row?.reason === "tier_too_low") {
      setUpgradeVisible(true);
      return notify("Upgrade required", "Submitting is available on Pro.", setStatus);
    }

    if (row?.reason === "no_submissions_left") {
      return notify("Submission limit reached", "You’ve used all 2 submissions for this month.", setStatus);
    }

    return notify("Not allowed", "You can’t submit right now.", setStatus);
  }
} catch (err) {
  console.warn("server preflight can_submit_this_month failed:", err);
  setLoading(false);
  return notify(
    "Please try again",
    "We couldn’t verify your submission limit just now. Try again in a moment.",
    setStatus
  );
}
    setStatus("Uploading file…");
    setProgressPct(0);
    setEtaText("");

    try {
      const {
        data: { user },
        error: userErr2,
      } = await supabase.auth.getUser();
      if (userErr2) throw userErr2;
      if (!user) throw new Error("Not signed in");

      // ✅ Use custom thumbnail for preview + upload (one box)
      let finalThumbUri = customThumbUri || thumbUri;

      if (!finalThumbUri && category !== "music") {
        try {
          setStatus("Generating thumbnail…");

          if (Platform.OS === "web") {
            const src = objectUrlRef.current ?? localUri ?? "";
            if (src) {
              const cap = await captureFirstFrameWeb(src);
              if (cap?.dataUrl) {
                finalThumbUri = cap.dataUrl;
                setThumbUri(cap.dataUrl);
                setThumbAspect(cap.aspect || 16 / 9);
              }
            }
          } else if (localUri) {
            const t = await VideoThumbnails.getThumbnailAsync(localUri, { time: 120 });
            if (t?.uri) {
              finalThumbUri = t.uri;
              setThumbUri(t.uri);
              // @ts-ignore
              const w = (t as any)?.width;
              // @ts-ignore
              const h = (t as any)?.height;
              if (w && h) setThumbAspect(w / h);
            }
          }
        } catch {
          // ok
        }
      }

      const { path, contentType } = await uploadResumable({
        userId: user.id,
        fileBlob: Platform.OS === "web" ? ((webFile as File | Blob | null) ?? undefined) : undefined,
        localUri: Platform.OS !== "web" ? (localUri as string) : undefined,
        onProgress: (pct) => setProgressPct(pct),
        onPhase: (label) => setStatus(label),
        objectName: `submissions/${user.id}/${Date.now()}`,
        bucket: STORAGE_BUCKET,
      });

      let thumbnail_url: string | null = null;

      if (category !== "music" && finalThumbUri) {
        try {
          setStatus("Uploading thumbnail…");
          const thumbRes = await uploadThumbnailToStorage({
            userId: user.id,
            thumbUri: finalThumbUri,
            objectName: `submissions/${user.id}/${Date.now()}`,
            bucket: THUMB_BUCKET,
          });
          thumbnail_url = thumbRes.publicUrl;
        } catch (e) {
          const msg = (e as any)?.message ?? String(e);
          console.warn("[thumb upload] failed:", msg);
          setStatus(`Thumbnail upload failed: ${msg}`);
          thumbnail_url = null;
        }
      }

      setProgressPct(100);
      setStatus("Creating submission…");

      const media_kind = mediaKindFromMime(contentType);

      // ✅ include challenge id if your DB supports it (robust insert will remove if not)
      const basePayload: any = {
        user_id: user.id,
        title: title.trim(),
        description: description.trim(),
        submitted_at: new Date().toISOString(),
        word: (challenge?.theme_word ?? "Untitled").trim() || "Untitled",

        // optional FK; safe if not present (robust insert strips)
        monthly_challenge_id: challenge?.id ?? null,

        storage_path: path,
        video_path: path,
        mime_type: contentType,
        media_kind,
        duration_seconds: durationSec ?? null,
        category,
        thumbnail_url,
      };

      const payloadWithTags: any =
        category === "film" ? { ...basePayload, tags: selectedTags } : basePayload;

      // ✅ SUPER ROBUST INSERT:
      // If your submissions table doesn't have some of these columns, we auto-strip them and retry.
      await insertSubmissionRobust(payloadWithTags, ["user_id", "title", "submitted_at"]);

      try {
  await refreshStreak();
} catch (e) {
  console.warn("refreshStreak failed:", e);
}

      try {
        await giveXp(user.id, SUBMIT_XP, "challenge_submission");
      } catch (xpErr) {
        console.warn("giveXp challenge_submission failed:", xpErr);
      }

      try {
        await refreshGamification();
      } catch (e) {
        console.warn("Gamification refresh after submission failed:", e);
      }

      setStatus("Submitted! 🎉");
      setEtaText("");
      notify(
        "Submission received!",
        `Thanks for entering this month’s challenge. You just earned +${SUBMIT_XP} XP.`
      );

      setTitle("");
      setDescription("");
      setSelectedTags([]);
      resetSelectedFile();
      setAgreed(false);
    } catch (e: any) {
      console.warn("Submit failed:", e?.message ?? e);
      const msg = e?.message ?? "Please try again.";
      notify("Submission failed", msg);
      setStatus("");
      setProgressPct(0);
      setEtaText("");
    } finally {
      setLoading(false);
    }
  };

  if (!challenge) {
    return (
      <View style={styles.loadingWrap}>
        <LinearGradient
          colors={[T.bg, T.bg]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Grain opacity={0.05} />
        <ActivityIndicator size="large" color={T.olive} />
        <Text style={styles.loadingText}>Loading this month&apos;s challenge…</Text>
      </View>
    );
  }

  const monthLabelText = dayjs().format("MMMM");

  // ✅ ONE preview image: custom overrides generated thumb
  const previewThumbToShow = customThumbUri || thumbUri;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[T.bg, T.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Grain opacity={0.05} />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { minHeight: winH + 1, paddingBottom: isWide ? 56 : 40 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.pageWrap, isWide && styles.pageWrapWide]}>
          <View style={[styles.twoCol, isWide && styles.twoColWide]}>
            {/* LEFT COLUMN */}
            <View style={[styles.col, isWide && styles.leftCol]}>
              <View style={styles.cardShell}>
                <View style={styles.heroCard}>
                  <View style={styles.heroImageWrap}>
                    <ImageBackground
                      source={{ uri: HERO_IMAGE }}
                      style={styles.heroImage}
                      resizeMode="cover"
                    >
                      <LinearGradient
                        colors={["rgba(0,0,0,0.10)", "rgba(0,0,0,0.74)"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 0, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                      <LinearGradient
                        colors={["rgba(198,166,100,0.18)", "rgba(0,0,0,0.65)"]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={StyleSheet.absoluteFill}
                      />
                      <Grain opacity={0.12} />

                      <View style={styles.heroImageInner}>
                        <Text style={styles.heroKicker}>MONTHLY CHALLENGE</Text>
                        <Text style={styles.heroTitleBig}>{headerTitle}</Text>

                        <View style={styles.pillsRow}>
                          <View style={[styles.pill, styles.pillGold]}>
                            <Text style={[styles.pillText, styles.pillTextDark]}>
                              THEME · {String(challenge.theme_word ?? "Untitled").toUpperCase()}
                            </Text>
                          </View>

                          <View style={styles.pill}>
                            <Text style={styles.pillText}>
                              TIME LEFT · {countdown.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </ImageBackground>
                  </View>

                  <Text style={styles.heroExplainer}>{explainer}</Text>

<View style={styles.hypeCard}>
  <View style={styles.hypeHeaderRow}>
  <Text style={styles.hypeTitle}>WHY UPLOAD MONTHLY</Text>
</View>

  <Text style={styles.hypeBody}>
    Most film students make only a handful of films across three years. Progress comes faster when
    you stop waiting and start finishing.
  </Text>

  <Text style={styles.hypeBody}>
    Uploading monthly builds momentum. Each project teaches you more than the last — and over time,
    your work naturally gets better.
  </Text>

  <Text style={styles.hypeBodyTight}>
    <Text style={styles.hypeStrong}>All levels are welcome.</Text> You don’t need to make something
    great — just make something, submit it, and keep going.
  </Text>

  <Text style={[styles.hypeBodyTight, { marginTop: 10 }]}>
    Streaks are simple: submit at least one film every month, and your streak grows. Miss a month
    and it resets — not to punish you, but to keep you creating.{" "}
    <Text style={styles.hypeStrong}>Consistent finishing is what turns you into a filmmaker.</Text>
  </Text>
</View>
  
                  <View style={styles.xpBanner}>
                    <Text style={styles.xpLine}>
                      Submit this month to earn{" "}
                      <Text style={styles.xpStrong}>+{SUBMIT_XP} XP</Text>. Win the month and gain{" "}
                      <Text style={styles.xpStrong}>+500 XP</Text>.
                    </Text>

                    {!gamificationLoading && typeof level === "number" && (
                      <Text style={styles.xpSub} numberOfLines={1}>
                        You are <Text style={styles.xpStrong}>Lv {level}</Text>
                        {levelTitle ? (
                          <>
                            {" "}
                            · <Text style={styles.xpTitle}>{String(levelTitle).toUpperCase()}</Text>
                          </>
                        ) : null}
                        {xpToNext !== null && xpToNext > 0 ? (
                          <>
                            {" "}
                            · <Text style={styles.xpSoft}>{xpToNext} XP to next title</Text>
                          </>
                        ) : null}
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            </View>

            {/* RIGHT COLUMN */}
            <View style={[styles.col, isWide && styles.rightCol]}>
              <View style={styles.cardShell}>
                <View style={styles.formCard}>
                  <View style={styles.formHeader}>
                    <Text style={styles.formHeaderText}>SUBMIT ENTRY</Text>
                    <Text style={styles.formHeaderSub}>Title, one sentence, then your file.</Text>
                  </View>

                  <View style={styles.formBody}>
                    <Text style={styles.label}>TITLE</Text>
                    <TextInput
                      style={styles.input}
                      placeholder={category === "music" ? "e.g. Quiet Fire" : "e.g. Flicker in the Dark"}
                      placeholderTextColor={T.mute}
                      value={title}
                      onChangeText={setTitle}
                    />

                    <View style={styles.descRow}>
                      <Text style={[styles.label, { marginBottom: 0 }]}>SHORT DESCRIPTION</Text>
                      <Text style={styles.counterText}>{description.length}/100</Text>
                    </View>

                    <TextInput
                      style={styles.input}
                      placeholder={
                        category === "music"
                          ? "One sentence about your track"
                          : category === "acting"
                          ? "One sentence about your monologue"
                          : "One sentence about your film"
                      }
                      placeholderTextColor={T.mute}
                      value={description}
                      onChangeText={(t) => setDescription(t.slice(0, 100))}
                      maxLength={100}
                    />

                    {/* ✅ Film categories (pick up to 3) */}
                    {category === "film" ? (
                      <View style={{ marginTop: 12 }}>
                        <View style={[styles.descRow, { marginBottom: 10 }]}>
                          <Text style={[styles.label, { marginBottom: 0 }]}>CATEGORIES (PICK UP TO 3)</Text>
                          <Text style={styles.counterText}>{selectedTags.length}/3</Text>
                        </View>

                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                          {FILM_TAGS.map((tag) => {
                            const active = selectedTags.includes(tag);
                            return (
                              <Pressable
                                key={tag}
                                onPress={() => toggleTag(tag)}
                                style={{
                                  paddingVertical: 8,
                                  paddingHorizontal: 12,
                                  borderRadius: 999,
                                  borderWidth: 1,
                                  borderColor: active ? T.olive : T.line,
                                  backgroundColor: active
                                    ? "rgba(198,166,100,0.12)"
                                    : "rgba(255,255,255,0.02)",
                                }}
                              >
                                <Text style={{ color: active ? T.text : T.sub, fontSize: 12, letterSpacing: 0.3 }}>
                                  {tag}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>

                        {selectedTags.length === 0 ? (
                          <Text style={[styles.formFootnote, { marginTop: 10 }]}>
                            Pick at least 1 category. This helps Featured sort your film.
                          </Text>
                        ) : null}
                      </View>
                    ) : null}

                    <TouchableOpacity style={styles.pickBtn} onPress={pickFile} activeOpacity={0.92}>
                      <Text style={styles.pickBtnText}>
                        {localUri ? "PICK A DIFFERENT FILE" : "PICK A FILE"}
                      </Text>
                      <Text style={styles.pickBtnSub}>Max file size: 3GB</Text>
                    </TouchableOpacity>

                    {localUri ? (
                      <View style={styles.fileActionsRow}>
                        <Pressable
                          onPress={pickFile}
                          style={({ pressed }) => [styles.fileActionBtn, pressed && { opacity: 0.9 }]}
                        >
                          <Text style={styles.fileActionText}>Change file</Text>
                        </Pressable>

                        <Pressable
                          onPress={resetSelectedFile}
                          style={({ pressed }) => [styles.fileActionBtnDanger, pressed && { opacity: 0.9 }]}
                        >
                          <Text style={styles.fileActionTextDanger}>Remove</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    {/* ✅ ONE preview box only: shows chosen thumbnail if present */}

                                        {/* ✅ ONE preview box only: shows chosen thumbnail if present */}
                    {localUri ? (
                      <Pressable
                        onPress={openPreview}
                        style={({ pressed }) => [styles.previewWrap, pressed && { opacity: 0.92 }]}
                      >
                        <View style={[styles.previewStage, { aspectRatio: thumbAspect }]}>
                          {thumbLoading ? (
                            <View style={styles.thumbLoading}>
                              <ActivityIndicator size="small" color={T.olive} />
                              <Text style={styles.thumbLoadingText}>Generating thumbnail…</Text>
                            </View>
                          ) : previewThumbToShow ? (
                            <Image
                              source={{ uri: previewThumbToShow }}
                              style={styles.previewImg}
                              resizeMode={customThumbUri ? "cover" : "contain"}
                            />
                          ) : (
                            <View style={styles.thumbFallback}>
                              <Text style={styles.thumbFallbackText}>WATCH PREVIEW</Text>
                            </View>
                          )}
                        </View>

                        <View style={styles.previewOverlay} pointerEvents="none">
                          <View style={styles.playPill}>
                            <Text style={styles.playPillText}>▶ WATCH PREVIEW</Text>
                          </View>
                        </View>
                      </Pressable>
                    ) : null}

                    {/* ✅ Thumbnail actions live under the preview (no second box) */}
                    {localUri && category !== "music" ? (
                      <View style={{ marginTop: 10 }}>
                        <View style={{ flexDirection: "row", gap: 10 }}>
                          <Pressable
                            onPress={pickThumbnail}
                            style={({ pressed }) => [
                              styles.fileActionBtn,
                              pressed && { opacity: 0.9 },
                              { flex: 1, alignItems: "center" },
                            ]}
                          >
                            <Text style={styles.fileActionText}>
                              {customThumbUri ? "Change thumbnail" : "Add thumbnail"}
                            </Text>
                          </Pressable>

                          {customThumbUri ? (
                            <Pressable
                              onPress={removeCustomThumbnail}
                              style={({ pressed }) => [
                                styles.fileActionBtnDanger,
                                pressed && { opacity: 0.9 },
                                { flex: 1, alignItems: "center" },
                              ]}
                            >
                              <Text style={styles.fileActionTextDanger}>Remove thumbnail</Text>
                            </Pressable>
                          ) : null}
                        </View>

                        <Text style={[styles.formFootnote, { marginTop: 8 }]}>
                          Optional: choose the exact image you want people to see on Featured.
                        </Text>
                      </View>
                    ) : null}

                    {localUri && category !== "music" && Platform.OS !== "web" ? (
                      <Video
                        ref={videoRef}
                        source={{ uri: localUri }}
                        style={{ width: 1, height: 1, opacity: 0.0001 }}
                        resizeMode={ResizeMode.CONTAIN}
                        isMuted
                        shouldPlay={false}
                        onLoad={onVideoLoaded}
                        onError={() => {
                          setDurationSec(null);
                          setStatus(`Media ready (duration unknown) • ${formatBytes(fileSizeBytes)}`);
                        }}
                      />
                    ) : null}

                    {!!status && (
                      <View style={styles.statusRow}>
                        {status.toLowerCase().includes("checking") ? (
                          <ActivityIndicator size="small" color={T.olive} />
                        ) : null}
                        <Text style={styles.statusText}>{status}</Text>
                      </View>
                    )}

                    {loading ? (
                      <View style={styles.progressWrap}>
                        <View style={styles.progressBar}>
                          <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
                        </View>
                        <View style={styles.progressLabels}>
                          <Text style={styles.progressText}>{progressPct}%</Text>
                          <Text style={styles.progressEta}>{etaText}</Text>
                        </View>
                      </View>
                    ) : null}

                    <View style={styles.agreeBlock}>
                      <Pressable
                        onPress={() => setAgreed(!agreed)}
                        style={({ pressed }) => [styles.agreeRow, pressed && { opacity: 0.9 }]}
                      >
                        <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
                          {agreed ? <Text style={styles.checkGlyph}>✓</Text> : null}
                        </View>

                        <Text style={styles.agreeText}>
                          I agree to{" "}
                          <Text
                            style={styles.termsLink}
                            onPress={() => setRulesVisible(true)}
                            suppressHighlighting
                          >
                            the rules & terms
                          </Text>
                        </Text>
                      </Pressable>

                      <Pressable onPress={() => setRulesVisible(true)} style={styles.termsHintRow}>
                        <Text style={styles.termsHintText}>View rules</Text>
                      </Pressable>
                    </View>

                    <TouchableOpacity
                      style={[styles.submitBtn, (!agreed || loading) && { opacity: 0.78 }]}
                      onPress={handleSubmit}
                      disabled={loading || !agreed}
                      activeOpacity={0.92}
                    >
                      <Text style={styles.submitText}>
                        {loading ? "SUBMITTING…" : "UPLOAD & SUBMIT"}
                      </Text>
                    </TouchableOpacity>

                    <Text style={styles.formFootnote}>
                      Your entry will appear on Featured shortly after submission.
                    </Text>
                  </View>
                </View>
              </View>

              {isWide ? <View style={{ height: 10 }} /> : null}
            </View>
          </View>
        </View>

        {/* RULES MODAL (keep as-is) */}
        <Modal visible={rulesVisible} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Challenge Rules & Terms</Text>

              <ScrollView style={{ marginBottom: 16 }}>
                <Text style={styles.modalText}>• Time limit: {capText}</Text>

                <Text style={styles.modalText}>
                  • File size: keep it reasonable. Extremely large uploads may fail or be removed.
                </Text>

                <Text style={styles.modalText}>
                  • Keep it original. No stolen footage, copyrighted films, or unlicensed music.
                </Text>

                <Text style={styles.modalText}>
                  • Be appropriate. No hate, harassment, explicit sexual content, or violent / harmful
                  material.
                </Text>

                <Text style={styles.modalTextStrong}>
                  • IMPORTANT: Overlooked is for ART — not content.
                </Text>

                <Text style={styles.modalText}>
                  • This is not Instagram or TikTok. Brain-rot / “content farm” style videos will be
                  removed.
                </Text>

                <Text style={styles.modalTextStrong}>
                  • Repeated low-effort “content” uploads can result in a permanent ban.
                </Text>

                <Text style={styles.modalText}>
                  • All levels are welcome. You do not need to submit something “perfect” — just
                  finish work and keep going.
                </Text>

                <Text style={styles.modalText}>
                  • If you submit every month for a year, you’ll make 12 films — more than most
                  people make in their entire lives.
                </Text>

                <Text style={styles.modalText}>
                  • The monthly theme word is optional inspiration — you don’t have to mention it.
                </Text>
              </ScrollView>

              <Pressable style={styles.modalClose} onPress={() => setRulesVisible(false)}>
                <Text style={styles.modalCloseText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </Modal>

        {/* ✅ Preview Player Modal (ALWAYS fits) */}
        <Modal visible={previewVisible} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.previewModal}>
              <Text style={styles.previewTitle}>Preview</Text>

              <View style={styles.previewVideoWrap}>
                <View style={styles.previewVideoStage}>
                  {localUri ? (
                    Platform.OS === "web" ? (
                      // @ts-ignore
                      <video
                        key={`web-preview-${previewNonce}-${localUri}`}
                        ref={(el) => {
                          // @ts-ignore
                          webPreviewVideoRef.current = el;
                        }}
                        src={localUri}
                        controls
                        autoPlay
                        playsInline
                        onLoadStart={() => {
                          setPreviewError(null);
                          setPreviewLoading(true);
                          startPreviewTimer();
                        }}
                        onCanPlay={() => {
                          clearPreviewTimer();
                          setPreviewLoading(false);
                        }}
                        onError={() => {
                          clearPreviewTimer();
                          setPreviewLoading(false);
                          setPreviewError(
                            "Could not play this file. Try Retry or pick a different file."
                          );
                        }}
                        style={{
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          background: "#0B0B0B",
                          display: "block",
                        }}
                      />
                    ) : (
                      <Video
                        key={`native-preview-${previewNonce}-${localUri}`}
                        ref={previewPlayerRef}
                        source={{ uri: localUri }}
                        style={styles.previewVideo}
                        resizeMode={ResizeMode.CONTAIN}
                        useNativeControls
                        shouldPlay
                        isLooping={false}
                        onLoadStart={() => {
                          setPreviewError(null);
                          setPreviewLoading(true);
                          startPreviewTimer();
                        }}
                        onReadyForDisplay={() => {
                          clearPreviewTimer();
                          setPreviewLoading(false);
                        }}
                        onLoad={() => {
                          clearPreviewTimer();
                          setPreviewLoading(false);
                        }}
                        onPlaybackStatusUpdate={(s: any) => {
                          if (s?.isLoaded) {
                            clearPreviewTimer();
                            setPreviewLoading(false);
                          }
                        }}
                        onError={() => {
                          clearPreviewTimer();
                          setPreviewLoading(false);
                          setPreviewError(
                            "Could not play this file. Try Retry or pick a different file."
                          );
                        }}
                      />
                    )
                  ) : null}

                  {previewLoading ? (
                    <View style={styles.previewLoadingOverlay} pointerEvents="none">
                      <ActivityIndicator size="large" color={T.olive} />
                      <Text style={styles.previewLoadingText}>Loading preview…</Text>
                    </View>
                  ) : null}

                  {previewError ? (
                    <View style={styles.previewErrorOverlay}>
                      <Text style={styles.previewErrorText}>{previewError}</Text>
                      <View style={styles.previewErrorActions}>
                        <Pressable style={styles.previewRetryBtn} onPress={retryPreview}>
                          <Text style={styles.previewRetryText}>Retry</Text>
                        </Pressable>
                        <Pressable style={styles.previewAltBtn} onPress={closePreview}>
                          <Text style={styles.previewAltText}>Close</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : null}
                </View>
              </View>

              <View style={styles.previewMetaRow}>
                <Text style={styles.previewMeta}>
                  Duration:{" "}
                  <Text style={styles.previewMetaStrong}>{formatDur(durationSec)}</Text>
                </Text>
                <Text style={styles.previewMeta}>
                  Size: <Text style={styles.previewMetaStrong}>{formatBytes(fileSizeBytes)}</Text>
                </Text>
              </View>

              <Pressable style={styles.modalClose} onPress={closePreview}>
                <Text style={styles.modalCloseText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </ScrollView>

      <UpgradeModal
        visible={upgradeVisible}
        context="challenge"
        onClose={() => setUpgradeVisible(false)}
      />
    </View>
  );
}

// ------------------------------- STYLES -------------------------------

                  
// STOP HERE — styles go below this line in your file

/* -------------------------------- Styles -------------------------------- */

const RADIUS_XL = 20;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: T.bg,
  },
  loadingText: { marginTop: 10, color: T.sub, fontFamily: SYSTEM_SANS },

  scroll: {
    paddingHorizontal: 16,
    paddingTop: 12,
  },

  pageWrap: {
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    paddingBottom: 22,
  },
  pageWrapWide: {
    maxWidth: 1180,
  },

  twoCol: { width: "100%" },
  twoColWide: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },
  col: { width: "100%" },
  leftCol: { flex: 1, minWidth: 520 },
  rightCol: { width: 520 },

  cardShell: {
    width: "100%",
    borderRadius: RADIUS_XL + 2,
    padding: 1,
    backgroundColor: "#FFFFFF10",
  },

  heroCard: {
    borderRadius: RADIUS_XL,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.line,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 16,
  },

  heroImageWrap: {
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ffffff12",
    backgroundColor: "#0B0B0B",
  },
  heroImage: { width: "100%", height: 170 },
  heroImageInner: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  heroKicker: {
    fontSize: 10,
    letterSpacing: 2.4,
    color: "rgba(237,235,230,0.72)",
    fontWeight: "800",
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
    marginBottom: 6,
  },
  heroTitleBig: {
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: 0.2,
    color: T.text,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
    lineHeight: 30,
  },

  pillsRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "flex-start",
    flexWrap: "wrap",
    gap: 10,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ffffff18",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  pillGold: {
    borderColor: "rgba(0,0,0,0.55)",
    backgroundColor: T.olive,
  },
  pillText: {
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.2,
    color: T.text,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  pillTextDark: { color: "#0B0B0B" },

  heroExplainer: {
    marginTop: 14,
    fontSize: 14,
    color: "#E2E2E2",
    textAlign: "left",
    lineHeight: 20,
    fontFamily: SYSTEM_SANS,
  },

  segmentWrap: {
    marginTop: 14,
    flexDirection: "row",
    alignSelf: "flex-start",
    backgroundColor: "#0B0B0B",
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 999,
    padding: 4,
    gap: 6,
  },
  segment: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "transparent",
  },
  segmentActive: {
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: T.olive,
  },
  segmentText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.6,
    color: T.mute,
    fontFamily: SYSTEM_SANS,
  },
  segmentTextActive: { color: T.olive },

  xpBanner: {
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2B2B2B",
    backgroundColor: "#0B0B0B",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  xpLine: {
    fontSize: 12,
    color: "#D7D7D7",
    fontWeight: "600",
    lineHeight: 18,
    fontFamily: SYSTEM_SANS,
    textAlign: "left",
  },
  xpStrong: { color: T.text, fontWeight: "900" },
  xpSub: {
    marginTop: 6,
    fontSize: 10,
    color: T.mute,
    textAlign: "left",
    fontFamily: SYSTEM_SANS,
  },
  xpTitle: {
    color: T.text,
    fontWeight: "800",
    letterSpacing: 0.8,
    fontFamily: SYSTEM_SANS,
  },
  xpSoft: { color: "#B8B8B8", fontWeight: "600", fontFamily: SYSTEM_SANS },

  formCard: {
    borderRadius: RADIUS_XL,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.line,
    overflow: "hidden",
  },
  formHeader: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#1F1F1F",
    backgroundColor: "#0E0E0E",
  },
  hypeCard: {
    marginTop: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2B2B2B",
    backgroundColor: "#0B0B0B",
    padding: 14,
  },
  hypeTitle: {
  fontSize: 12,
  fontWeight: "900",
  letterSpacing: 2.0,
  color: T.text,
  textTransform: "uppercase",
  fontFamily: SYSTEM_SANS,
  marginBottom: 0, // ✅ was 8
},
  hypeBody: {
    fontSize: 13,
    color: "#D0D0D0",
    lineHeight: 19,
    fontFamily: SYSTEM_SANS,
    marginBottom: 8,
  },
  hypeBodyTight: {
    fontSize: 13,
    color: "#D0D0D0",
    lineHeight: 19,
    fontFamily: SYSTEM_SANS,
    marginBottom: 0,
  },
  hypeStrong: {
    color: T.text,
    fontWeight: "900",
    fontFamily: SYSTEM_SANS,
  },
hypeHeaderRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  marginBottom: 8,
},

streakBadge: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "rgba(198,166,100,0.35)",
  backgroundColor: "rgba(198,166,100,0.10)",
},

streakBadgeLabel: {
  fontSize: 10,
  fontWeight: "900",
  letterSpacing: 1.4,
  color: "rgba(237,235,230,0.70)",
  textTransform: "uppercase",
  fontFamily: SYSTEM_SANS,
},

streakBadgeValue: {
  fontSize: 12,
  fontWeight: "900",
  letterSpacing: 1.0,
  color: T.text,
  textTransform: "uppercase",
  fontFamily: SYSTEM_SANS,
},


  formHeaderText: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 2.2,
    color: T.text,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  formHeaderSub: {
    marginTop: 6,
    fontSize: 12,
    color: "#B8B8B8",
    fontFamily: SYSTEM_SANS,
  },
  formBody: { padding: 16 },

  label: {
    fontSize: 11,
    color: T.text,
    marginBottom: 8,
    fontWeight: "900",
    letterSpacing: 1.0,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  descRow: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  counterText: {
    fontSize: 11,
    color: T.mute,
    fontFamily: SYSTEM_SANS,
  },
  input: {
    backgroundColor: "#121212",
    borderWidth: 1,
    borderColor: "#262626",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: T.text,
    fontFamily: SYSTEM_SANS,
    // @ts-ignore
    outlineStyle: "none",
  },

  pickBtn: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ffffff14",
    backgroundColor: "rgba(198,166,100,0.10)",
    paddingVertical: 14,
    alignItems: "center",
  },
  pickBtnText: {
    fontWeight: "900",
    color: T.text,
    fontSize: 12,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  pickBtnSub: {
    marginTop: 6,
    fontSize: 12,
    color: "#B8B8B8",
    fontFamily: SYSTEM_SANS,
  },

  fileActionsRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 10,
  },
  fileActionBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ffffff1a",
    backgroundColor: "#111111",
    alignItems: "center",
  },
  fileActionText: {
    color: T.text,
    fontWeight: "900",
    letterSpacing: 1.0,
    textTransform: "uppercase",
    fontSize: 10,
    fontFamily: SYSTEM_SANS,
  },
  fileActionBtnDanger: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(198,166,100,0.35)",
    backgroundColor: "rgba(198,166,100,0.10)",
    alignItems: "center",
  },
  fileActionTextDanger: {
    color: T.olive,
    fontWeight: "900",
    letterSpacing: 1.0,
    textTransform: "uppercase",
    fontSize: 10,
    fontFamily: SYSTEM_SANS,
  },

  previewWrap: {
    marginTop: 12,
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ffffff14",
    backgroundColor: "#0B0B0B",
  },
  previewStage: {
    width: "100%",
    backgroundColor: "#0B0B0B",
    minHeight: 240,
    justifyContent: "center",
    alignItems: "center",
  },
  previewImg: {
    width: "100%",
    height: "100%",
    backgroundColor: "#0B0B0B",
  },
  thumbLoading: {
    width: "100%",
    height: "100%",
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  thumbLoadingText: {
    color: T.sub,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.0,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  thumbFallback: {
    width: "100%",
    height: "100%",
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbFallbackText: {
    color: "#B8B8B8",
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },

  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 12,
  },
  playPill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ffffff22",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  playPillText: {
    fontWeight: "900",
    color: T.text,
    fontSize: 10,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },

  /* -------- status + progress -------- */

  statusRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusText: {
    color: T.sub,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
  },

  progressWrap: {
    marginTop: 12,
  },
  progressBar: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "#1B1B1B",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    backgroundColor: T.olive,
  },
  progressLabels: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressText: {
    fontSize: 11,
    color: T.text,
    fontWeight: "800",
    fontFamily: SYSTEM_SANS,
  },
  progressEta: {
    fontSize: 11,
    color: T.mute,
    fontFamily: SYSTEM_SANS,
  },

  /* -------- agreement -------- */

  agreeBlock: {
    marginTop: 16,
  },
  agreeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#3A3A3A",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0B0B0B",
  },
  checkboxChecked: {
    backgroundColor: T.olive,
    borderColor: T.olive,
  },
  checkGlyph: {
    color: "#0B0B0B",
    fontWeight: "900",
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
  },
  agreeText: {
    color: T.sub,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
  },
  termsLink: {
    color: T.olive,
    fontWeight: "900",
  },
  termsHintRow: {
    marginTop: 6,
  },
  termsHintText: {
    fontSize: 11,
    color: T.mute,
    textDecorationLine: "underline",
    fontFamily: SYSTEM_SANS,
  },

  streakRow: {
  marginTop: 12,
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
},

streakPill: {
  paddingHorizontal: 12,
  paddingVertical: 10,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "#ffffff18",
  backgroundColor: "rgba(0,0,0,0.35)",
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
},

streakPillLabel: {
  fontSize: 10,
  fontWeight: "900",
  letterSpacing: 1.2,
  color: "rgba(237,235,230,0.75)",
  textTransform: "uppercase",
  fontFamily: SYSTEM_SANS,
},

streakPillValue: {
  fontSize: 12,
  fontWeight: "900",
  letterSpacing: 1.0,
  color: T.text,
  textTransform: "uppercase",
  fontFamily: SYSTEM_SANS,
},

streakHint: {
  flex: 1,
  fontSize: 11,
  color: "rgba(237,235,230,0.70)",
  lineHeight: 16,
  fontFamily: SYSTEM_SANS,
},

  /* -------- submit -------- */
  submitBtn: {
    marginTop: 14,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: T.olive,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.35)",
  },
  submitText: {
    color: "#0B0B0B",
    fontWeight: "900",
    letterSpacing: 2,
    fontSize: 12,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  formFootnote: {
    marginTop: 10,
    fontSize: 11,
    color: T.mute,
    textAlign: "center",
    fontFamily: SYSTEM_SANS,
  },

  /* -------- Modals -------- */

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  modalContent: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2B2B2B",
    backgroundColor: "#0F0F0F",
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.6,
    color: T.text,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
    marginBottom: 12,
  },
  modalText: {
    fontSize: 13,
    color: "#D0D0D0",
    lineHeight: 19,
    marginBottom: 10,
    fontFamily: SYSTEM_SANS,
  },
  modalTextStrong: {
    fontSize: 13,
    color: T.text,
    lineHeight: 19,
    marginBottom: 10,
    fontFamily: SYSTEM_SANS,
    fontWeight: "900",
  },
  modalClose: {
    width: "100%",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "#2B2B2B",
  },
  modalCloseText: {
    color: T.text,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
  },

  /* -------- Preview Modal -------- */

  previewModal: {
    width: "100%",
    maxWidth: 720,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2B2B2B",
    backgroundColor: "#0F0F0F",
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.6,
    color: T.text,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
    marginBottom: 10,
  },
  previewVideoWrap: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#2B2B2B",
    backgroundColor: "#0B0B0B",
  },
  previewVideoStage: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#0B0B0B",
  },
  previewVideo: {
    width: "100%",
    height: "100%",
    backgroundColor: "#0B0B0B",
  },
  previewLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  previewLoadingText: {
    color: T.sub,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  previewErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  previewErrorText: {
    color: T.text,
    fontSize: 13,
    lineHeight: 18,
    textAlign: "center",
    fontFamily: SYSTEM_SANS,
    marginBottom: 12,
  },
  previewErrorActions: {
    flexDirection: "row",
    gap: 10,
  },
  previewRetryBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: T.olive,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.35)",
  },
  previewRetryText: {
    color: "#0B0B0B",
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontSize: 11,
    fontFamily: SYSTEM_SANS,
  },
  previewAltBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "#2B2B2B",
  },
  previewAltText: {
    color: T.text,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontSize: 11,
    fontFamily: SYSTEM_SANS,
  },

  previewMetaRow: {
    marginTop: 10,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  previewMeta: {
    fontSize: 12,
    color: T.mute,
    fontFamily: SYSTEM_SANS,
  },
  previewMetaStrong: {
    color: T.text,
    fontWeight: "900",
    fontFamily: SYSTEM_SANS,
  },
});
