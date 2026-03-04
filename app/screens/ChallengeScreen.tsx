// app/screens/ChallengeScreen.tsx
import React, { useEffect, useRef, useState, useMemo } from "react";
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

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // 5GB

const STORAGE_BUCKET = "films";
const THUMB_BUCKET = "thumbnails";

/* ---------------- UX helpers ---------------- */
function notify(title: string, message?: string, setStatusFn?: (s: string) => void) {
  const text = message ? `${title} — ${message}` : title;

  if (setStatusFn) setStatusFn(text);

  try {
    if (Platform.OS === "web") {
      // @ts-ignore
      window.alert(message ? `${title}\n\n${message}` : title);
    } else {
      Alert.alert(title, message);
    }
  } catch {}
}

async function fetchCurrentChallenge() {
  try {
    const { error } = await supabase.rpc("finalize_last_month_winner_if_needed");
    if (error) console.warn("[challenge] finalize_last_month_winner_if_needed:", error.message);
  } catch (e: any) {
    console.warn("[challenge] finalize rpc threw:", e?.message || e);
  }

  try {
    const { error } = await supabase.rpc("insert_monthly_challenge_if_not_exists");
    if (error) console.warn("[challenge] insert_monthly_challenge_if_not_exists:", error.message);
  } catch (e: any) {
    console.warn("[challenge] insert rpc threw:", e?.message || e);
  }

  const start = dayjs().startOf("month");
  const end = start.add(1, "month");

  const startDateOnly = start.format("YYYY-MM-DD");
  const endDateOnly = end.format("YYYY-MM-DD");

  const exact = await supabase
    .from("monthly_challenges")
    .select("id, month_start, month_end, theme_word")
    .eq("month_start", startDateOnly)
    .eq("month_end", endDateOnly)
    .limit(1)
    .single();

  if (!exact.error && exact.data) return exact.data as MonthlyChallenge;

  const nowIso = new Date().toISOString();
  const range = await supabase
    .from("monthly_challenges")
    .select("id, month_start, month_end, theme_word")
    .lte("month_start", nowIso)
    .gt("month_end", nowIso)
    .order("month_start", { ascending: false })
    .limit(1)
    .single();

  if (!range.error && range.data) return range.data as MonthlyChallenge;

  const fallback = await supabase
    .from("monthly_challenges")
    .select("id, month_start, month_end, theme_word")
    .order("month_start", { ascending: false })
    .limit(1)
    .single();

  if (fallback.error) throw fallback.error;

  return fallback.data as MonthlyChallenge;
}

async function getResumableEndpoint() {
  const probe = supabase.storage.from(STORAGE_BUCKET).getPublicUrl("__probe__");
  const url = new URL(probe.data.publicUrl);
  const projectRef = url.hostname.split(".")[0];
  return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
}

async function uploadThumbnailToStorage(opts: {
  userId: string;
  thumbUri: string;
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
      chunkSize: 2 * 1024 * 1024,
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
            "";

          const detail = String(body || "").slice(0, 350);
          reject(
            new Error(
              `Upload failed (${status || "unknown"}): ${detail || err?.message || "Unknown error"}`
            )
          );
        } catch {
          reject(err);
        }
      },
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
async function captureFirstFrameWeb(videoSrc: string): Promise<{ dataUrl: string; aspect: number } | null> {
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
      try { video.pause(); } catch {}
      try { video.removeAttribute("src"); video.load(); } catch {}
      try { document.body.removeChild(video); } catch {}
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

      const timeout = setTimeout(() => finish(draw()), 8000);

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
          (video as any).requestVideoFrameCallback(() => tryFinish());
        } catch {}
      }

      video.addEventListener("loadeddata", tryFinish, { once: true });
      video.addEventListener("canplay", tryFinish, { once: true });
      video.addEventListener("seeked", tryFinish, { once: true });
      video.addEventListener("error", () => { clearTimeout(timeout); finish(null); }, { once: true });

      (async () => {
        try { await video.play(); video.pause(); } catch {}
        try { video.currentTime = 0.05; } catch {}
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
  "Drama","Comedy","Thriller","Horror","Sci-Fi","Romance","Action","Mystery","Crime","Fantasy",
  "Coming-of-Age","Experimental","Documentary-Style","No-Dialogue","One-Take","Found Footage",
  "Slow Cinema","Satire","Neo-Noir","Musical","Tragedy","Monologue","Character Study",
  "Dialogue-Driven","Dramedy","Dark Comedy","Psychological","Suspense","Period Piece",
  "Social Realism","Rom-Com","Heist","War","Western","Supernatural","Animation-Style",
  "Silent Film","Improvised","Voiceover","Two-Hander","Single Location",
];

/* ------------------------- insert helper (robust) ------------------------ */
function looksLikeMissingColumnError(msg: string) {
  const m = (msg || "").toLowerCase();
  if (m.includes("column") && m.includes("does not exist")) return true;
  if (m.includes("schema cache") && m.includes("could not find") && m.includes("column")) return true;
  return false;
}
function extractMissingColumnName(msg: string): string | null {
  const m1 = msg.match(/column\s+"([^"]+)"/i);
  if (m1?.[1]) return m1[1];

  const m2 = msg.match(/column\s+([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)\s+does\s+not\s+exist/i);
  if (m2?.[1]) return m2[1].split(".").pop() || null;

  const m3 = msg.match(/could\s+not\s+find\s+the\s+'([^']+)'\s+column/i);
  if (m3?.[1]) return m3[1];

  return null;
}

async function insertSubmissionRobust(
  payload: Record<string, any>,
  requiredKeys: string[] = ["user_id", "title", "submitted_at"]
) {
  let working = { ...payload };

  for (let attempt = 0; attempt < 12; attempt++) {
    const res = await supabase.from("submissions").insert(working).select().limit(1);

    if (!res.error) return res;

    const msg = String(res.error.message || "");
    const missingCol = extractMissingColumnName(msg);

    if (!looksLikeMissingColumnError(msg) || !missingCol) throw res.error;
    if (requiredKeys.includes(missingCol)) throw res.error;

    if (Object.prototype.hasOwnProperty.call(working, missingCol)) {
      delete working[missingCol];
      continue;
    }

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

  // ✅ user-picked thumbnail (required)
  const [customThumbUri, setCustomThumbUri] = useState<string | null>(null);
  const customThumbObjectUrlRef = useRef<string | null>(null);

  // ✅ category selection via modal (less clutter)
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [tagQuery, setTagQuery] = useState("");

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

  const { refreshStreak } = useMonthlyStreak();

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
      try { await previewPlayerRef.current?.stopAsync?.(); } catch {}
      try { await previewPlayerRef.current?.unloadAsync?.(); } catch {}
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
      try { await previewPlayerRef.current?.stopAsync?.(); } catch {}
      try { await previewPlayerRef.current?.unloadAsync?.(); } catch {}
    })();
  };

  const revokeCustomThumbObjectUrlIfAny = () => {
    if (customThumbObjectUrlRef.current) {
      try { URL.revokeObjectURL(customThumbObjectUrlRef.current); } catch {}
      customThumbObjectUrlRef.current = null;
    }
  };

  const removeCustomThumbnail = () => {
    revokeCustomThumbObjectUrlIfAny();
    setCustomThumbUri(null);
  };

  const resetSelectedFile = () => {
    if (objectUrlRef.current) {
      try { URL.revokeObjectURL(objectUrlRef.current); } catch {}
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
        setCountdown("Updating…");
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
        try { URL.revokeObjectURL(objectUrlRef.current); } catch {}
        objectUrlRef.current = null;
      }
      revokeCustomThumbObjectUrlIfAny();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const capText = "No duration limit. Max file size: 5GB.";

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
      notify("Could not pick thumbnail", "Try a different image.", setStatus);
    }
  };

  const openCategoryModal = () => {
    setTagQuery("");
    setTagModalVisible(true);
  };

  const closeCategoryModal = () => {
    setTagModalVisible(false);
  };

  const selectTag = (tag: string) => {
    setSelectedTags([tag]);
    setTagModalVisible(false);
  };

  const clearTag = () => setSelectedTags([]);

  const filteredTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return FILM_TAGS;
    return FILM_TAGS.filter((t) => t.toLowerCase().includes(q));
  }, [tagQuery]);

 // ✅ pickFile continues in Part 2 (unchanged logic, just moved)
// --- STOP PART 1 HERE ---

const pickFile = async () => {
  try {
    if (Platform.OS === "web") {
      const tierNorm = (userTier ?? "").toLowerCase().trim();

      if (!tierNorm) {
        notify("Loading your account…", "Try again in 1 second.", setStatus);

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
        notify("No file", "Please choose a file.", setStatus);
        return;
      }

      if (!asset.file) {
        notify(
          "Picker issue",
          "Your browser didn’t provide the actual file object. Try selecting from device storage or use Chrome.",
          setStatus
        );
        return;
      }

      let bytes: number | null = null;
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

      setFileSizeBytes(bytes);

      if (bytes != null && bytes > MAX_UPLOAD_BYTES) {
        notify(
          "File too large",
          `This file is ${formatBytes(bytes)}. Max allowed is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
          setStatus
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

    const {
      data: { user },
      error: uErr,
    } = await supabase.auth.getUser();

    if (uErr) {
      notify("Please try again", "We couldn’t verify your account right now.", setStatus);
      return;
    }
    if (!user) {
      notify("Please sign in", "You must be logged in to submit.", setStatus);
      return;
    }

    const { data: profile, error: pErr } = await supabase
      .from("users")
      .select("tier")
      .eq("id", user.id)
      .single();

    if (pErr) {
      notify("Please try again", "We couldn’t verify your Pro status right now.", setStatus);
      return;
    }

    const tierNorm = String(profile?.tier ?? "").toLowerCase().trim();
    setUserTier(profile?.tier ?? null);

    if (tierNorm !== "pro") {
      setUpgradeVisible(true);
      return;
    }

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
      notify("No file", "Please choose a file.", setStatus);
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
        `This file is ${formatBytes(bytes)}. Max allowed is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
        setStatus
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
    notify("Could not open picker", "Try again.", setStatus);
  }
};

/** ✅ FIX: this function MUST exist because the Video uses onLoad={onVideoLoaded} */
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
    return notify("Agreement required", "You must agree to the rules before submitting.", setStatus);

  if (!session) return notify("Please sign in", "You must be logged in to submit.", setStatus);

  if (!title.trim() || !description.trim()) return notify("Please complete all fields.", undefined, setStatus);

  if (!localUri && !webFile) return notify("No file selected", "Pick a file first.", setStatus);

  if (category === "film" && selectedTags.length === 0) {
    return notify("Pick a category", "Choose 1 category for your film.", setStatus);
  }

  if (category !== "music" && !customThumbUri) {
    return notify("Thumbnail required", "Please add a thumbnail image before submitting.", setStatus);
  }

  if (fileSizeBytes != null && fileSizeBytes > MAX_UPLOAD_BYTES) {
    return notify(
      "File too large",
      `This file is ${formatBytes(fileSizeBytes)}. Max allowed is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      setStatus
    );
  }

  setLoading(true);
  setStatus("Checking eligibility…");
  setProgressPct(0);
  setEtaText("");

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

    const finalThumbUri = customThumbUri;

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
      setStatus("Uploading thumbnail…");
      const thumbRes = await uploadThumbnailToStorage({
        userId: user.id,
        thumbUri: finalThumbUri,
        objectName: `submissions/${user.id}/${Date.now()}`,
        bucket: THUMB_BUCKET,
      });
      thumbnail_url = thumbRes.publicUrl;
    }

    setProgressPct(100);
    setStatus("Creating submission…");

    const media_kind = mediaKindFromMime(contentType);

      // ✅ Monthly theme removed from UI; keep DB fields safe
      // word is set to null (or existing default) so no theme is forced.
      const basePayload: any = {
        user_id: user.id,
        title: title.trim(),
        description: description.trim(),
        submitted_at: new Date().toISOString(),
        word: null,
        monthly_challenge_id: challenge?.id ?? null,
        storage_path: path,
        video_path: path,
        mime_type: contentType,
        media_kind,
        duration_seconds: durationSec ?? null,
        category,
        film_category: category === "film" ? selectedTags[0] ?? null : null,
        thumbnail_url,
      };

      const payloadWithTags: any =
        category === "film" ? { ...basePayload, tags: selectedTags } : basePayload;

      await insertSubmissionRobust(payloadWithTags, ["user_id", "title", "submitted_at"]);

      try {
        await refreshStreak();
      } catch {}

      try {
        await giveXp(user.id, SUBMIT_XP, "challenge_submission");
      } catch {}

      try {
        await refreshGamification();
      } catch {}

      setStatus("Submitted! 🎉");
      setEtaText("");
      notify("Submission received!", `Thanks — you just earned +${SUBMIT_XP} XP.`, setStatus);

      setTitle("");
      setDescription("");
      setSelectedTags([]);
      resetSelectedFile();
      setAgreed(false);
    } catch (e: any) {
      console.warn("Submit failed:", e?.message ?? e);
      const msg = e?.message ?? "Please try again.";
      notify("Submission failed", msg, setStatus);
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
        <ActivityIndicator size="large" color={T.olive} />
        <Text style={styles.loadingText}>Loading…</Text>
      </View>
    );
  }

  const previewThumbToShow = customThumbUri || thumbUri;

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={[T.bg, T.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

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
          {/* ✅ SIMPLE HEADER */}
          <View style={styles.topHeader}>
            <Text style={styles.topTitle}>Share your film</Text>
            <Text style={styles.topSub}>
              Title, one sentence, one category, upload.{" "}
              <Text style={styles.topSubStrong}>Time left: {countdown}</Text>
            </Text>
          </View>

          <View style={[styles.twoCol, isWide && styles.twoColWide]}>
            {/* LEFT */}
            <View style={[styles.col, isWide && styles.leftCol]}>
              <View style={styles.card}>
                <Text style={styles.sectionKicker}>How it works</Text>
                <Text style={styles.bullet}>• Add a title + one sentence</Text>
                <Text style={styles.bullet}>• Choose 1 category</Text>
                <Text style={styles.bullet}>• Upload your film + thumbnail</Text>
                <Text style={styles.bullet}>• It appears on Featured for voting</Text>

                <View style={styles.divider} />

                <View style={styles.xpMini}>
                  <Text style={styles.xpMiniText}>
                    Submit to earn <Text style={styles.xpMiniStrong}>+{SUBMIT_XP} XP</Text>
                    {` · `}
                    Win the month to earn <Text style={styles.xpMiniStrong}>+500 XP</Text>
                  </Text>

                  {!gamificationLoading && typeof level === "number" && (
                    <Text style={styles.xpMiniSub} numberOfLines={1}>
                      Lv <Text style={styles.xpMiniStrong}>{level}</Text>
                      {levelTitle ? (
                        <>
                          {" "}
                          · <Text style={styles.xpMiniStrong}>{String(levelTitle).toUpperCase()}</Text>
                        </>
                      ) : null}
                      {xpToNext !== null && xpToNext > 0 ? (
                        <>
                          {" "}
                          · <Text style={styles.xpMiniSubSoft}>{xpToNext} XP to next title</Text>
                        </>
                      ) : null}
                    </Text>
                  )}
                </View>

                <View style={styles.divider} />

                <Pressable onPress={() => setRulesVisible(true)} style={styles.linkRow}>
                  <Text style={styles.linkText}>View rules & terms</Text>
                </Pressable>
              </View>
            </View>

            {/* RIGHT */}
            <View style={[styles.col, isWide && styles.rightCol]}>
              <View style={styles.card}>
                <View style={styles.formHeaderLite}>
                  <Text style={styles.formTitle}>Submit</Text>
                  <Text style={styles.formSubtitle}>Simple, clear, intuitive.</Text>
                </View>

                <View style={styles.formBodyLite}>
                  <Text style={styles.label}>Title</Text>
                  <TextInput
                    style={styles.input}
                    placeholder={"e.g. Flicker in the Dark"}
                    placeholderTextColor={T.mute}
                    value={title}
                    onChangeText={setTitle}
                  />

                  <View style={styles.descRow}>
                    <Text style={[styles.label, { marginBottom: 0 }]}>One sentence</Text>
                    <Text style={styles.counterText}>{description.length}/100</Text>
                  </View>

                  <TextInput
                    style={styles.input}
                    placeholder={"One sentence about your film"}
                    placeholderTextColor={T.mute}
                    value={description}
                    onChangeText={(t) => setDescription(t.slice(0, 100))}
                    maxLength={100}
                  />

                  {/* ✅ Category modal trigger */}
                  {category === "film" ? (
                    <View style={{ marginTop: 14 }}>
                      <Text style={styles.label}>Category</Text>

                      <Pressable
                        onPress={openCategoryModal}
                        style={({ pressed }) => [styles.selectBtn, pressed && { opacity: 0.92 }]}
                      >
                        <Text style={styles.selectBtnText}>
                          {selectedTags[0] ? selectedTags[0] : "Choose a category"}
                        </Text>
                        <Text style={styles.selectBtnHint}>
                          {selectedTags[0] ? "Tap to change" : "Tap to select"}
                        </Text>
                      </Pressable>

                      {selectedTags[0] ? (
                        <View style={styles.selectedRow}>
                          <View style={styles.selectedChip}>
                            <Text style={styles.selectedChipText}>{selectedTags[0]}</Text>
                          </View>
                          <Pressable
                            onPress={clearTag}
                            style={({ pressed }) => [styles.clearChipBtn, pressed && { opacity: 0.9 }]}
                          >
                            <Text style={styles.clearChipText}>Clear</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <Text style={styles.helperText}>
                          Pick 1 category so Featured can sort your film.
                        </Text>
                      )}
                    </View>
                  ) : null}

                  {/* Pick file */}
                  <TouchableOpacity style={styles.primaryBtn} onPress={pickFile} activeOpacity={0.92}>
                    <Text style={styles.primaryBtnText}>
                      {localUri ? "Pick a different file" : "Pick a file"}
                    </Text>
                    <Text style={styles.primaryBtnSub}>Max file size: 5GB</Text>
                  </TouchableOpacity>

                  {localUri ? (
                    <View style={styles.fileActionsRow}>
                      <Pressable
                        onPress={pickFile}
                        style={({ pressed }) => [styles.secondaryBtn, pressed && { opacity: 0.9 }]}
                      >
                        <Text style={styles.secondaryBtnText}>Change file</Text>
                      </Pressable>

                      <Pressable
                        onPress={resetSelectedFile}
                        style={({ pressed }) => [styles.secondaryBtnDanger, pressed && { opacity: 0.9 }]}
                      >
                        <Text style={styles.secondaryBtnDangerText}>Remove</Text>
                      </Pressable>
                    </View>
                  ) : null}

                  {/* Preview */}
                  {localUri ? (
                    <Pressable
                      onPress={openPreview}
                      style={({ pressed }) => [styles.previewWrap, pressed && { opacity: 0.92 }]}
                    >
                      <View style={[styles.previewStage, { aspectRatio: thumbAspect }]}>
                        {thumbLoading ? (
                          <View style={styles.thumbLoading}>
                            <ActivityIndicator size="small" color={T.olive} />
                            <Text style={styles.thumbLoadingText}>Generating preview…</Text>
                          </View>
                        ) : previewThumbToShow ? (
                          <Image
                            source={{ uri: previewThumbToShow }}
                            style={styles.previewImg}
                            resizeMode={customThumbUri ? "cover" : "contain"}
                          />
                        ) : (
                          <View style={styles.thumbFallback}>
                            <Text style={styles.thumbFallbackText}>Watch preview</Text>
                          </View>
                        )}
                      </View>

                      <View style={styles.previewOverlay} pointerEvents="none">
                        <View style={styles.playPill}>
                          <Text style={styles.playPillText}>▶ Watch preview</Text>
                        </View>
                      </View>
                    </Pressable>
                  ) : null}

                  {/* REQUIRED thumbnail */}
                  {localUri && category !== "music" ? (
                    <View style={{ marginTop: 12 }}>
                      <View style={styles.thumbReqRow}>
                        <Text style={styles.thumbReqTitle}>Thumbnail (required)</Text>
                        {!customThumbUri ? (
                          <Text style={styles.thumbReqBadge}>Missing</Text>
                        ) : (
                          <Text
                            style={[
                              styles.thumbReqBadge,
                              { borderColor: "rgba(60,200,120,0.35)", color: "#BFF3D4" },
                            ]}
                          >
                            Added
                          </Text>
                        )}
                      </View>

                      <View style={{ flexDirection: "row", gap: 10 }}>
                        <Pressable
                          onPress={pickThumbnail}
                          style={({ pressed }) => [
                            styles.secondaryBtn,
                            pressed && { opacity: 0.9 },
                            { flex: 1, alignItems: "center" },
                          ]}
                        >
                          <Text style={styles.secondaryBtnText}>
                            {customThumbUri ? "Change thumbnail" : "Add thumbnail"}
                          </Text>
                        </Pressable>

                        {customThumbUri ? (
                          <Pressable
                            onPress={removeCustomThumbnail}
                            style={({ pressed }) => [
                              styles.secondaryBtnDanger,
                              pressed && { opacity: 0.9 },
                              { flex: 1, alignItems: "center" },
                            ]}
                          >
                            <Text style={styles.secondaryBtnDangerText}>Remove</Text>
                          </Pressable>
                        ) : null}
                      </View>

                      {!customThumbUri ? (
                        <Text style={styles.helperText}>You must add a thumbnail before submitting.</Text>
                      ) : (
                        <Text style={styles.helperText}>This is the image that will show on Featured.</Text>
                      )}
                    </View>
                  ) : null}

                  {/* hidden native video to read duration */}
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
                    style={[
                      styles.submitBtn,
                      (!agreed || loading || (category !== "music" && !customThumbUri)) && {
                        opacity: 0.6,
                      },
                    ]}
                    onPress={handleSubmit}
                    disabled={loading || !agreed || (category !== "music" && !customThumbUri)}
                    activeOpacity={0.92}
                  >
                    <Text style={styles.submitText}>{loading ? "Submitting…" : "Upload & submit"}</Text>
                  </TouchableOpacity>

                  <Text style={styles.formFootnote}>
                    Your entry will appear on Featured shortly after submission.
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* ✅ CATEGORY MODAL */}
          <Modal visible={tagModalVisible} animationType="fade" transparent>
            <View style={styles.modalOverlay}>
              <View style={styles.categoryModal}>
                <View style={styles.categoryModalHeader}>
                  <Text style={styles.modalTitle}>Choose a category</Text>
                  <Pressable onPress={closeCategoryModal} style={styles.modalIconClose}>
                    <Text style={styles.modalIconCloseText}>✕</Text>
                  </Pressable>
                </View>

                <TextInput
                  value={tagQuery}
                  onChangeText={setTagQuery}
                  placeholder="Search categories…"
                  placeholderTextColor={T.mute}
                  style={styles.modalSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <ScrollView style={{ maxHeight: 420 }} showsVerticalScrollIndicator={false}>
                  <View style={styles.tagList}>
                    {filteredTags.map((tag) => {
                      const active = selectedTags[0] === tag;
                      return (
                        <Pressable
                          key={tag}
                          onPress={() => selectTag(tag)}
                          style={({ pressed }) => [
                            styles.tagRow,
                            active && styles.tagRowActive,
                            pressed && { opacity: 0.9 },
                          ]}
                        >
                          <Text style={[styles.tagRowText, active && styles.tagRowTextActive]}>{tag}</Text>
                          {active ? <Text style={styles.tagRowCheck}>✓</Text> : null}
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>

                <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                  <Pressable
                    onPress={clearTag}
                    style={({ pressed }) => [styles.modalAltBtn, pressed && { opacity: 0.9 }]}
                  >
                    <Text style={styles.modalAltText}>Clear</Text>
                  </Pressable>
                  <Pressable
                    onPress={closeCategoryModal}
                    style={({ pressed }) => [styles.modalPrimaryBtn, pressed && { opacity: 0.9 }]}
                  >
                    <Text style={styles.modalPrimaryText}>Done</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </Modal>

          {/* RULES MODAL */}
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

                  <Text style={styles.modalTextStrong}>• IMPORTANT: Overlooked is for ART — not content.</Text>

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
                </ScrollView>

                <Pressable style={styles.modalClose} onPress={() => setRulesVisible(false)}>
                  <Text style={styles.modalCloseText}>Close</Text>
                </Pressable>
              </View>
            </View>
          </Modal>

          {/* Preview Modal */}
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
                            setPreviewError("Could not play this file. Try Retry or pick a different file.");
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
                            setPreviewError("Could not play this file. Try Retry or pick a different file.");
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
                    Duration: <Text style={styles.previewMetaStrong}>{formatDur(durationSec)}</Text>
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
        </View>
      </ScrollView>

      <UpgradeModal visible={upgradeVisible} context="challenge" onClose={() => setUpgradeVisible(false)} />
    </View>
  );
}

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
    paddingTop: 18,
  },

  pageWrap: {
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    paddingBottom: 22,
  },
  pageWrapWide: { maxWidth: 1180 },

  topHeader: {
    width: "100%",
    alignItems: "center",
    marginBottom: 16,
    paddingHorizontal: 8,
  },
  topTitle: {
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.2,
    color: T.text,
    fontFamily: SYSTEM_SANS,
    textAlign: "center",
    lineHeight: 30,
  },
  topSub: {
    marginTop: 8,
    fontSize: 13,
    color: T.mute,
    fontFamily: SYSTEM_SANS,
    textAlign: "center",
    lineHeight: 18,
  },
  topSubStrong: { color: T.text, fontWeight: "900" },

  twoCol: { width: "100%" },
  twoColWide: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 14,
  },

  col: { width: "100%" },
  leftCol: { flex: 1, minWidth: 520 },
  rightCol: { width: 520 },

  card: {
    width: "100%",
    borderRadius: RADIUS_XL,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.line,
    padding: 16,
  },

  divider: {
    height: 1,
    backgroundColor: "#FFFFFF10",
    marginVertical: 14,
  },

  sectionKicker: {
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 1.6,
    color: T.text,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
    marginBottom: 8,
  },
  bullet: {
    fontSize: 13,
    color: "#D0D0D0",
    lineHeight: 20,
    fontFamily: SYSTEM_SANS,
    marginBottom: 4,
  },

  xpMini: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#FFFFFF12",
    backgroundColor: "#0B0B0B",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  xpMiniText: {
    fontSize: 12,
    color: "#D7D7D7",
    lineHeight: 18,
    fontFamily: SYSTEM_SANS,
    fontWeight: "600",
  },
  xpMiniStrong: { color: T.text, fontWeight: "900" },
  xpMiniSub: {
    marginTop: 6,
    fontSize: 10,
    color: T.mute,
    fontFamily: SYSTEM_SANS,
  },
  xpMiniSubSoft: { color: "#B8B8B8", fontWeight: "600" },

  linkRow: { alignSelf: "flex-start" },
  linkText: {
    color: T.olive,
    fontWeight: "900",
    letterSpacing: 0.6,
    fontFamily: SYSTEM_SANS,
    textDecorationLine: "underline",
  },

  formHeaderLite: { paddingBottom: 10 },
  formTitle: {
    fontSize: 14,
    fontWeight: "900",
    letterSpacing: 1.6,
    color: T.text,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  formSubtitle: {
    marginTop: 6,
    fontSize: 12,
    color: "#B8B8B8",
    fontFamily: SYSTEM_SANS,
  },
  formBodyLite: { paddingTop: 6 },

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

  helperText: {
    marginTop: 8,
    fontSize: 11,
    color: T.mute,
    fontFamily: SYSTEM_SANS,
    lineHeight: 16,
  },

  selectBtn: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#262626",
    backgroundColor: "#121212",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  selectBtnText: {
    color: T.text,
    fontSize: 14,
    fontFamily: SYSTEM_SANS,
    fontWeight: "800",
  },
  selectBtnHint: {
    marginTop: 4,
    color: T.mute,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
  },

  selectedRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  selectedChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: T.olive,
    backgroundColor: "rgba(198,166,100,0.12)",
  },
  selectedChipText: {
    color: T.text,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: "900",
  },
  clearChipBtn: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ffffff1a",
    backgroundColor: "#111111",
  },
  clearChipText: {
    color: T.sub,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: "900",
  },

  primaryBtn: {
    marginTop: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#ffffff14",
    backgroundColor: "rgba(198,166,100,0.10)",
    paddingVertical: 14,
    alignItems: "center",
  },
  primaryBtnText: {
    fontWeight: "900",
    color: T.text,
    fontSize: 12,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  primaryBtnSub: {
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
  secondaryBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#ffffff1a",
    backgroundColor: "#111111",
    alignItems: "center",
  },
  secondaryBtnText: {
    color: T.text,
    fontWeight: "900",
    letterSpacing: 1.0,
    textTransform: "uppercase",
    fontSize: 10,
    fontFamily: SYSTEM_SANS,
  },
  secondaryBtnDanger: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(198,166,100,0.35)",
    backgroundColor: "rgba(198,166,100,0.10)",
    alignItems: "center",
  },
  secondaryBtnDangerText: {
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
  previewImg: { width: "100%", height: "100%", backgroundColor: "#0B0B0B" },
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
    letterSpacing: 1.6,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },

  thumbReqRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  thumbReqTitle: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.0,
    textTransform: "uppercase",
    color: T.text,
    fontFamily: SYSTEM_SANS,
  },
  thumbReqBadge: {
    fontSize: 11,
    color: "#FFD6D6",
    fontFamily: SYSTEM_SANS,
    fontWeight: "900",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,120,120,0.35)",
    backgroundColor: "rgba(255,120,120,0.10)",
    overflow: "hidden",
  },

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

  progressWrap: { marginTop: 12 },
  progressBar: {
    height: 6,
    borderRadius: 999,
    backgroundColor: "#1B1B1B",
    overflow: "hidden",
  },
  progressFill: { height: "100%", backgroundColor: T.olive },
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
  progressEta: { fontSize: 11, color: T.mute, fontFamily: SYSTEM_SANS },

  agreeBlock: { marginTop: 16 },
  agreeRow: { flexDirection: "row", alignItems: "center", gap: 10 },
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
  checkboxChecked: { backgroundColor: T.olive, borderColor: T.olive },
  checkGlyph: { color: "#0B0B0B", fontWeight: "900", fontSize: 12, fontFamily: SYSTEM_SANS },
  agreeText: { color: T.sub, fontSize: 12, fontFamily: SYSTEM_SANS },
  termsLink: { color: T.olive, fontWeight: "900" },
  termsHintRow: { marginTop: 6 },
  termsHintText: {
    fontSize: 11,
    color: T.mute,
    textDecorationLine: "underline",
    fontFamily: SYSTEM_SANS,
  },

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
    letterSpacing: 1.6,
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

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.72)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },

  /* category modal */
  categoryModal: {
    width: "100%",
    maxWidth: 520,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#2B2B2B",
    backgroundColor: "#0F0F0F",
  },
  categoryModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  modalIconClose: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#2B2B2B",
    backgroundColor: "#151515",
  },
  modalIconCloseText: { color: T.text, fontWeight: "900", fontFamily: SYSTEM_SANS },

  modalSearch: {
    backgroundColor: "#121212",
    borderWidth: 1,
    borderColor: "#262626",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: T.text,
    fontFamily: SYSTEM_SANS,
    // @ts-ignore
    outlineStyle: "none",
    marginBottom: 12,
  },

  tagList: { gap: 8 },
  tagRow: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A2A2A",
    backgroundColor: "#121212",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  tagRowActive: {
    borderColor: T.olive,
    backgroundColor: "rgba(198,166,100,0.12)",
  },
  tagRowText: { color: T.sub, fontSize: 13, fontFamily: SYSTEM_SANS, fontWeight: "700" },
  tagRowTextActive: { color: T.text, fontWeight: "900" },
  tagRowCheck: { color: T.olive, fontWeight: "900", fontFamily: SYSTEM_SANS },

  modalAltBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: "#151515",
    borderWidth: 1,
    borderColor: "#2B2B2B",
  },
  modalAltText: {
    color: T.text,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontSize: 11,
    fontFamily: SYSTEM_SANS,
  },

  modalPrimaryBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: T.olive,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.35)",
  },
  modalPrimaryText: {
    color: "#0B0B0B",
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
    fontSize: 11,
    fontFamily: SYSTEM_SANS,
  },

  /* rules modal */
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

  /* preview modal */
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
  previewVideo: { width: "100%", height: "100%", backgroundColor: "#0B0B0B" },
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
  previewErrorActions: { flexDirection: "row", gap: 10 },
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
  previewMetaRow: { marginTop: 10, flexDirection: "row", justifyContent: "space-between" },
  previewMeta: { fontSize: 12, color: T.mute, fontFamily: SYSTEM_SANS },
  previewMetaStrong: { color: T.text, fontWeight: "900", fontFamily: SYSTEM_SANS },
});