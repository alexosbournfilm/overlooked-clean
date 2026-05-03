// app/screens/WorkshopSubmitScreen.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native";
import { supabase, giveXp } from "../lib/supabase";
import { Video, ResizeMode } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import { Upload } from "tus-js-client";
import { LinearGradient } from "expo-linear-gradient";
import * as FileSystem from "expo-file-system/legacy";
import * as VideoThumbnails from "expo-video-thumbnails";
import { Buffer } from "buffer";
import { useGamification } from "../context/GamificationContext";
import { useMonthlyStreak } from "../lib/useMonthlyStreak";
import { UpgradeModal } from "../../components/UpgradeModal";
import dayjs from "dayjs";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";

/* ------------------------------- palette ------------------------------- */


type WorkshopPathKey =
  | "acting"
  | "editing"
  | "cinematography"
  | "directing"
  | "sound"
  | "filmmaker";

type SubmitMode = "monthly" | "workshop";

type WorkshopSubmitRouteParams = {
  WorkshopSubmit: {
    mode?: SubmitMode;
    pathKey?: WorkshopPathKey;
    step?: number;
    lessonTitle?: string;
    lessonDescription?: string;
    lessonPrompt?: string;
    lessonXp?: number;
  };
};

type MonthlyChallenge = {
  id: string | number;
  month_start: string;
  month_end: string;
  theme_word?: string | null;
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
const STORAGE_BUCKET = "films";
const THUMB_BUCKET = "thumbnails";

const FILM_TAGS: string[] = [
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

/* ------------------------------- helpers ------------------------------- */
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
async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out. Please check your connection and try again.`));
    }, ms);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result as T;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

async function pickWebVideoFile(): Promise<File | null> {
  if (Platform.OS !== "web") return null;

  return new Promise((resolve) => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "video/*";
      input.style.display = "none";

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
      console.warn("pickWebVideoFile failed:", err);
      resolve(null);
    }
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

async function getResumableEndpoint() {
  const probe = supabase.storage.from(STORAGE_BUCKET).getPublicUrl("__probe__");
  const url = new URL(probe.data.publicUrl);
  const projectRef = url.hostname.split(".")[0];
  return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const bytes = Buffer.from(base64, "base64");
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
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
    objectName = `uploads/${userId}/${Date.now()}`,
    bucket = THUMB_BUCKET,
  } = opts;

  if (Platform.OS === "web") {
    const resp = await fetch(thumbUri);
    const blob = await resp.blob();

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

  const base64 = await FileSystem.readAsStringAsync(thumbUri, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const arrayBuffer = base64ToArrayBuffer(base64);
  const filePath = `${objectName}.jpg`;

  const up = await supabase.storage.from(bucket).upload(filePath, arrayBuffer, {
    upsert: true,
    contentType: "image/jpeg",
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
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  onProgress?: (pct: number) => void;
  onPhase?: (label: string) => void;
  objectName?: string;
  bucket?: string;
}): Promise<{ path: string; contentType: string }> {
  const {
    userId,
    fileBlob,
    localUri,
    fileName,
    fileSize,
    mimeType,
    onProgress,
    onPhase,
    objectName = `uploads/${userId}/${Date.now()}`,
    bucket = STORAGE_BUCKET,
  } = opts;

  onPhase?.("Preparing file…");

  let uploadTarget: any;
  let type = mimeType || "application/octet-stream";
  let finalSize = fileSize ?? null;

  if (Platform.OS === "web") {
    if (fileBlob) {
      uploadTarget = fileBlob as Blob;
      if ((fileBlob as any)?.type) type = (fileBlob as any).type as string;
      if (typeof (fileBlob as any)?.size === "number") finalSize = (fileBlob as any).size;
    } else if (localUri) {
      const resp = await fetch(localUri);
      const blob = await resp.blob();
      uploadTarget = blob;
      if ((blob as any)?.type) type = (blob as any).type as string;
      if (typeof (blob as any)?.size === "number") finalSize = (blob as any).size;
    } else {
      throw new Error("No file to upload");
    }
  } else {
    if (!localUri) throw new Error("No local file to upload");

    let nativeSize = finalSize;
    if (nativeSize == null) {
      try {
        const info = await FileSystem.getInfoAsync(localUri, { size: true } as any);
        if (info?.exists && typeof (info as any)?.size === "number") {
          nativeSize = (info as any).size;
        }
      } catch {}
    }

    if (!nativeSize) {
      throw new Error("Could not determine file size for upload.");
    }

    if (!type || type === "application/octet-stream") {
      const lower = localUri.toLowerCase();
      if (lower.endsWith(".mov")) type = "video/quicktime";
      else if (lower.endsWith(".mp4")) type = "video/mp4";
      else if (lower.endsWith(".m4v")) type = "video/x-m4v";
      else type = "video/mp4";
    }

    uploadTarget = {
      uri: localUri,
      name: fileName || `upload-${Date.now()}`,
      type,
    };

    finalSize = nativeSize;
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
      : type.includes("quicktime")
      ? ".mov"
      : type.includes("mp4")
      ? ".mp4"
      : type.includes("m4v")
      ? ".m4v"
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
    const upload = new Upload(uploadTarget, {
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
      uploadSize: finalSize ?? undefined,
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



async function captureFirstFrameWeb(
  videoSrc: string
): Promise<{ dataUrl: string; aspect: number } | null> {
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
async function canUserSubmitLifetimeFilm(
  userId: string,
  tier: string | null | undefined
): Promise<{
  allowed: boolean;
  used: number;
  remaining: number;
  reason: null | "not_logged_in" | "no_free_uploads_left";
}> {
  if (!userId) {
    return {
      allowed: false,
      used: 0,
      remaining: 0,
      reason: "not_logged_in",
    };
  }

  const tierNorm = String(tier ?? "").toLowerCase().trim();

  if (tierNorm === "pro") {
    return {
      allowed: true,
      used: 0,
      remaining: 999999,
      reason: null,
    };
  }

  try {
  const rpcResult: any = await withTimeout<any>(
    supabase.rpc("can_insert_lifetime_submission", {
      p_user_id: userId,
    }) as any,
    6000,
    "Upload limit check"
  );

  const allowedFromDb = rpcResult?.data;
  const rpcError = rpcResult?.error;

  if (!rpcError && typeof allowedFromDb === "boolean") {
      if (allowedFromDb) {
        return {
          allowed: true,
          used: 0,
          remaining: 1,
          reason: null,
        };
      }

      return {
        allowed: false,
        used: 1,
        remaining: 0,
        reason: "no_free_uploads_left",
      };
    }

    if (rpcError) {
      console.warn("can_insert_lifetime_submission RPC error:", rpcError.message);
    }
  } catch (e: any) {
    console.warn("can_insert_lifetime_submission timed out or failed:", e?.message ?? e);
  }

  const countResult: any = await withTimeout<any>(
  supabase
    .from("submissions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId) as any,
  6000,
  "Fallback submission count"
);

const count = countResult?.count;
const error = countResult?.error;

if (error) {
  throw error;
}

const used = count ?? 0;
  const remaining = Math.max(0, 1 - used);

  if (remaining <= 0) {
    return {
      allowed: false,
      used,
      remaining: 0,
      reason: "no_free_uploads_left",
    };
  }

  return {
    allowed: true,
    used,
    remaining,
    reason: null,
  };
}

async function fetchCurrentChallenge(): Promise<MonthlyChallenge> {
  try {
    const { error } = await supabase.rpc("finalize_last_month_winner_if_needed");
    if (error) console.warn("[workshop-submit] finalize_last_month_winner_if_needed:", error.message);
  } catch (e: any) {
    console.warn("[workshop-submit] finalize rpc threw:", e?.message || e);
  }

  try {
    const { error } = await supabase.rpc("insert_monthly_challenge_if_not_exists");
    if (error) console.warn("[workshop-submit] insert_monthly_challenge_if_not_exists:", error.message);
  } catch (e: any) {
    console.warn("[workshop-submit] insert rpc threw:", e?.message || e);
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

async function createMuxDirectUpload(input: {
  userId: string;
  title: string;
  mimeType?: string | null;
  category?: string | null;
  challengeId?: string | number | null;
  workshopPath?: string | null;
  workshopStep?: number | null;
  workshopLessonTitle?: string | null;
}) {
  const { data, error } = await supabase.functions.invoke("mux-create-upload", {
    body: {
      userId: input.userId,
      title: input.title,
      mimeType: input.mimeType ?? null,
      category: input.category ?? null,
      challengeId: input.challengeId ?? null,
      workshopPath: input.workshopPath ?? null,
      workshopStep: input.workshopStep ?? null,
      workshopLessonTitle: input.workshopLessonTitle ?? null,
    },
  });

  if (error) throw error;
  if (!data?.uploadUrl || !data?.uploadId) {
    throw new Error("Mux upload URL was not returned.");
  }

  return {
    uploadId: data.uploadId as string,
    uploadUrl: data.uploadUrl as string,
    status: (data.status as string) ?? "waiting",
  };
}

async function uploadFileToMuxDirectUrl(opts: {
  uploadUrl: string;
  fileBlob?: Blob | File | null;
  localUri?: string | null;
  mimeType?: string | null;
  onProgress?: (pct: number) => void;
}) {
  const { uploadUrl, fileBlob, localUri, mimeType, onProgress } = opts;

  if (Platform.OS === "web") {
    const blob = fileBlob;
    if (!blob) throw new Error("No web file selected for Mux upload.");

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.open("PUT", uploadUrl, true);
      xhr.setRequestHeader("Content-Type", mimeType || "application/octet-stream");
      xhr.timeout = 1000 * 60 * 60; // 1 hour for large uploads

      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable) return;
        const pct = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)));
        onProgress?.(pct);
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          onProgress?.(100);
          resolve();
        } else {
          reject(new Error(`Mux upload failed: ${xhr.status} ${xhr.responseText || ""}`));
        }
      };

      xhr.onerror = () => {
        reject(new Error("Mux upload failed due to a network error."));
      };

      xhr.ontimeout = () => {
        reject(new Error("Mux upload timed out."));
      };

      xhr.onabort = () => {
        reject(new Error("Mux upload was aborted."));
      };

      xhr.send(blob);
    });

    return;
  }

  if (!localUri) throw new Error("No local file selected for Mux upload.");

  const result = await FileSystem.uploadAsync(uploadUrl, localUri, {
    httpMethod: "PUT",
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
    headers: {
      "Content-Type": mimeType || "application/octet-stream",
    },
  });

  onProgress?.(100);

  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Mux upload failed: ${result.status} ${result.body || ""}`);
  }
}
export default function WorkshopSubmitScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<WorkshopSubmitRouteParams, "WorkshopSubmit">>();
  const { width } = useWindowDimensions();
  const isMobileWeb = Platform.OS === "web" && width < 768;
  const isWide = width >= 1100;
  const isDesktopPreview = width >= 900;
  const isPhone = width < 520;
  const isTablet = width >= 768 && width < 1100;
  const [showInfoPanel, setShowInfoPanel] = useState(false);

  const mode: SubmitMode = route.params?.mode ?? "workshop";
  const isWorkshopMode = mode === "workshop";

  const pathKey = route.params?.pathKey;
  const step = route.params?.step;
  const lessonTitle = route.params?.lessonTitle ?? "";
  const lessonDescription = route.params?.lessonDescription ?? "";
  const lessonPrompt = route.params?.lessonPrompt ?? "";
  const lessonXp = route.params?.lessonXp ?? 0;

  const { refresh: refreshGamification } = useGamification();
  const { refreshStreak } = useMonthlyStreak();

  const [currentChallenge, setCurrentChallenge] = useState<MonthlyChallenge | null>(null);

  const [title, setTitle] = useState(isWorkshopMode ? lessonTitle || "" : "");
  const [description, setDescription] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [alreadyCompleted, setAlreadyCompleted] = useState(false);

  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagModalVisible, setTagModalVisible] = useState(false);
  const [tagQuery, setTagQuery] = useState("");

  const [localUri, setLocalUri] = useState<string | null>(null);
  const [webFile, setWebFile] = useState<File | Blob | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [durationSec, setDurationSec] = useState<number | null>(null);
  const [fileSizeBytes, setFileSizeBytes] = useState<number | null>(null);

  const [thumbUri, setThumbUri] = useState<string | null>(null);
  const [thumbLoading, setThumbLoading] = useState(false);
  const [thumbAspect, setThumbAspect] = useState<number>(16 / 9);

  const [customThumbUri, setCustomThumbUri] = useState<string | null>(null);
  const customThumbObjectUrlRef = useRef<string | null>(null);

  const [previewVisible, setPreviewVisible] = useState(false);

  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [progressPct, setProgressPct] = useState(0);

  const [rulesVisible, setRulesVisible] = useState(false);

  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [userTier, setUserTier] = useState<string | null>(null);
  const [storyModeOpen, setStoryModeOpen] = useState(false);
  const [storyModeItem, setStoryModeItem] = useState<{
    title?: string | null;
    shareSlug: string;
    thumbnailUrl?: string | null;
  } | null>(null);

  const videoRef = useRef<Video>(null);
  const previewPlayerRef = useRef<Video>(null);
  const webPreviewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewLoadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        const challenge = await fetchCurrentChallenge();
        if (alive) setCurrentChallenge(challenge);
      } catch (e: any) {
        console.warn("Failed to fetch current monthly challenge:", e?.message || e);
      }

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const { data: profile } = await supabase.from("users").select("tier").eq("id", user.id).single();

          if (alive) {
            setUserTier((profile?.tier ?? "").toLowerCase().trim() || null);
          }
        } else {
          if (alive) setUserTier(null);
        }
      } catch {
        if (alive) setUserTier(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!isWorkshopMode || !pathKey || typeof step !== "number") return;

    let alive = true;

    (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) return;

        const { data } = await supabase
          .from("workshop_progress")
          .select("step")
          .eq("user_id", user.id)
          .eq("path_key", pathKey)
          .eq("step", step)
          .maybeSingle();

        if (alive && data) {
          setAlreadyCompleted(true);
          setStatus("Already completed — You already completed this workshop lesson.");
        }
      } catch {}
    })();

    return () => {
      alive = false;
    };
  }, [isWorkshopMode, pathKey, step]);

  const filteredTags = useMemo(() => {
    const q = tagQuery.trim().toLowerCase();
    if (!q) return FILM_TAGS;
    return FILM_TAGS.filter((t) => t.toLowerCase().includes(q));
  }, [tagQuery]);

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
      setPreviewError("Preview is taking too long to load. Tap Retry or close it.");
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

  const openStoryMode = (item: {
    title?: string | null;
    shareSlug: string;
    thumbnailUrl?: string | null;
  }) => {
    setStoryModeItem(item);
    setStoryModeOpen(true);
  };

  const closeStoryMode = () => {
    setStoryModeOpen(false);
    setStoryModeItem(null);
  };

  const copyCurrentStoryLink = async () => {
    if (!storyModeItem?.shareSlug) return;

    try {
      await copyFilmLink({ shareSlug: storyModeItem.shareSlug });

      if (Platform.OS === "web") {
        window.alert("Link copied");
      } else {
        Alert.alert("Link copied", "Your watch link has been copied.");
      }
    } catch (err: any) {
      console.warn("Copy failed:", err?.message || err);
      Alert.alert("Copy failed", "Could not copy the link.");
    }
  };

  const resetSelectedFile = () => {
    closePreview();

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

    setStatus(alreadyCompleted ? "Already completed — You already completed this workshop lesson." : "");
    setProgressPct(0);
  };

  useEffect(() => {
    return () => {
      clearPreviewTimer();
      stopWebPreviewIfAny();

      if (objectUrlRef.current) {
        try {
          URL.revokeObjectURL(objectUrlRef.current);
        } catch {}
        objectUrlRef.current = null;
      }

      revokeCustomThumbObjectUrlIfAny();
    };
  }, []);

  const pickThumbnail = async () => {
  try {
    if (Platform.OS === "web") {
      const pick = await DocumentPicker.getDocumentAsync({
        type: ["image/*"] as any,
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (pick.canceled) return;

      const asset: any = pick.assets?.[0];
      if (!asset?.uri && !asset?.file) return;

      revokeCustomThumbObjectUrlIfAny();

      if (asset.file) {
        const f: File = asset.file;
        const objUrl = URL.createObjectURL(f);
        customThumbObjectUrlRef.current = objUrl;
        setCustomThumbUri(objUrl);
        return;
      }

      if (asset.uri) {
        setCustomThumbUri(asset.uri);
      }

      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      notify("Permission needed", "Please allow photo library access.", setStatus);
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
      allowsEditing: false,
      selectionLimit: 1,
    });

    if (result.canceled) return;

    const asset = result.assets?.[0];
    if (!asset?.uri) return;

    revokeCustomThumbObjectUrlIfAny();
    setCustomThumbUri(asset.uri);
  } catch (e: any) {
    console.warn("pickThumbnail failed:", e?.message ?? e);
    notify("Could not pick thumbnail", "Try a different image.", setStatus);
  }
};

 const pickFile = async () => {
  try {
    // WEB: check upload limit BEFORE opening the file picker.
    if (Platform.OS === "web") {
  setStatus("Checking your upload limit…");

  const sessionResult: any = await withTimeout<any>(
  supabase.auth.getSession() as any,
  6000,
  "Session check"
);

const session = sessionResult?.data?.session ?? null;
const sessionErr = sessionResult?.error;

  if (sessionErr) {
    notify("Please try again", "We couldn’t verify your account right now.", setStatus);
    return;
  }

  if (!session?.user) {
    notify("Please sign in", "You must be logged in to upload.", setStatus);
    return;
  }

  setStatus("Checking your membership…");

  const profileResult: any = await withTimeout<any>(
  supabase
    .from("users")
    .select("tier")
    .eq("id", session.user.id)
    .single() as any,
  6000,
  "Membership check"
);

const profile = profileResult?.data;
const pErr = profileResult?.error;

  if (pErr) {
    notify("Please try again", "We couldn’t verify your account right now.", setStatus);
    return;
  }

  const tierNorm = String(profile?.tier ?? "").toLowerCase().trim();
  setUserTier(tierNorm || null);

  setStatus("Checking your upload limit…");

  const canUpload = await canUserSubmitLifetimeFilm(session.user.id, tierNorm);

  if (!canUpload.allowed) {
    setUpgradeVisible(true);
    setStatus("");
    return notify(
      "Upgrade required",
      "You’ve already used your free film upload. Upgrade to Pro to upload more films.",
      setStatus
    );
  }

  setStatus("Opening file picker…");

  const file = await pickWebVideoFile();

  if (!file) {
    setStatus("No file selected.");
    return;
  }

  const bytes = typeof file.size === "number" ? file.size : null;

  if (bytes != null && bytes > MAX_UPLOAD_BYTES) {
    notify(
      "File too large",
      `This file is ${formatBytes(bytes)}. Max allowed is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
      setStatus
    );
    resetSelectedFile();
    return;
  }

  setStatus(alreadyCompleted ? "Already completed — You already completed this workshop lesson." : "");
  setDurationSec(null);
  setThumbUri(null);
  setThumbAspect(16 / 9);
  setThumbLoading(false);

  removeCustomThumbnail();
  closePreview();

  setLocalUri(null);
  setWebFile(null);
  setProgressPct(0);

  if (objectUrlRef.current) {
    try {
      URL.revokeObjectURL(objectUrlRef.current);
    } catch {}
  }

  const objUrl = URL.createObjectURL(file);
  objectUrlRef.current = objUrl;

  setWebFile(file);
  setLocalUri(objUrl);
  setFileSizeBytes(bytes);

  setThumbLoading(true);

  const thumb = await captureFirstFrameWeb(objUrl);

  if (thumb?.dataUrl) {
    setThumbUri(thumb.dataUrl);
    setThumbAspect(thumb.aspect || 16 / 9);
  } else {
    setThumbUri(null);
  }

  setThumbLoading(false);
  setStatus(`Loaded file • ${formatBytes(bytes)}`);
  return;
}

    // MOBILE / NATIVE
    const {
      data: { user },
      error: uErr,
    } = await supabase.auth.getUser();

    if (uErr) {
      notify("Please try again", "We couldn’t verify your account right now.", setStatus);
      return;
    }

    if (!user) {
      notify("Please sign in", "You must be logged in to upload.", setStatus);
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
    setUserTier(tierNorm || null);

    const canUpload = await canUserSubmitLifetimeFilm(user.id, tierNorm);

    if (!canUpload.allowed) {
      setUpgradeVisible(true);
      return notify(
        "Upgrade required",
        "You’ve already used your free film upload. Upgrade to Pro to upload more films.",
        setStatus
      );
    }

    setStatus(alreadyCompleted ? "Already completed — You already completed this workshop lesson." : "");
    setDurationSec(null);
    setThumbUri(null);
    setThumbAspect(16 / 9);
    setThumbLoading(false);

    removeCustomThumbnail();
    closePreview();

    setLocalUri(null);
    setWebFile(null);
    setProgressPct(0);

    const pick = await DocumentPicker.getDocumentAsync({
      type: ["video/*"] as any,
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
        if (info?.exists && typeof (info as any)?.size === "number") {
          bytes = (info as any).size;
        }
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

    setThumbLoading(true);

    try {
      const thumb = await VideoThumbnails.getThumbnailAsync(asset.uri, { time: 120 });

      if (thumb?.uri) setThumbUri(thumb.uri);

      const w = (thumb as any)?.width;
      const h = (thumb as any)?.height;

      if (typeof w === "number" && typeof h === "number" && w > 0 && h > 0) {
        setThumbAspect(w / h);
      }
    } catch {
      setThumbUri(null);
    } finally {
      setThumbLoading(false);
    }

    setStatus(`Loaded file • ${formatBytes(bytes)}`);
  } catch (e: any) {
    console.warn("pickFile failed:", e?.message ?? e);
    notify("Could not open picker", e?.message ?? "Try again.", setStatus);
  }
};

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

  const handleSubmit = async () => {
    if (isWorkshopMode && alreadyCompleted) {
      return notify("Already completed", "This workshop lesson has already been completed.", setStatus);
    }

    if (!agreed) {
      return notify("Agreement required", "You must agree to the rules before submitting.", setStatus);
    }

    if (!title.trim() || !description.trim()) {
      return notify("Please complete all fields.", undefined, setStatus);
    }

    if (!localUri && !webFile) {
      return notify("No file selected", "Pick a file first.", setStatus);
    }

    if (selectedTags.length === 0) {
      return notify("Pick a category", "Choose 1 category for your film.", setStatus);
    }

    if (!customThumbUri) {
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
    setStatus(isWorkshopMode ? "Checking workshop + monthly eligibility…" : "Checking monthly eligibility…");
    setProgressPct(0);

    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr) throw userErr;
      if (!user) throw new Error("Not signed in");

      const { data: profile, error: profileErr } = await supabase.from("users").select("tier").eq("id", user.id).single();

      if (profileErr) throw profileErr;

      const tierNorm = String(profile?.tier ?? "").toLowerCase().trim();
      setUserTier(tierNorm || null);

      const canUpload = await canUserSubmitLifetimeFilm(user.id, tierNorm);

if (!canUpload.allowed) {
  setLoading(false);
  setUpgradeVisible(true);
  return notify(
    "Upgrade required",
    "You’ve already used your free film upload. Upgrade to Pro to upload more films.",
    setStatus
  );
}

      if (!currentChallenge) {
        const fresh = await fetchCurrentChallenge();
        setCurrentChallenge(fresh);
      }

      const challengeToUse = currentChallenge ?? (await fetchCurrentChallenge());

      if (!challengeToUse?.id) {
        throw new Error("Could not find the current monthly challenge.");
      }

      

      if (isWorkshopMode && pathKey && typeof step === "number") {
        const { data: existingProgress, error: progressCheckError } = await supabase
          .from("workshop_progress")
          .select("step")
          .eq("user_id", user.id)
          .eq("path_key", pathKey)
          .eq("step", step)
          .maybeSingle();

        if (progressCheckError) throw progressCheckError;

        if (existingProgress) {
          setAlreadyCompleted(true);
          setLoading(false);
          return notify("Already completed", "You already completed this workshop lesson.", setStatus);
        }
      }

      setStatus("Preparing upload…");

const uploadPrefix = isWorkshopMode ? `workshop/${user.id}` : `monthly/${user.id}`;

const contentType =
  Platform.OS === "web"
    ? (((webFile as any)?.type as string | undefined) ?? "video/mp4")
    : localUri?.toLowerCase().endsWith(".mov")
    ? "video/quicktime"
    : localUri?.toLowerCase().endsWith(".m4v")
    ? "video/x-m4v"
    : "video/mp4";

const muxUpload = await createMuxDirectUpload({
  userId: user.id,
  title: title.trim(),
  mimeType: contentType,
  category: "film",
  challengeId: challengeToUse.id,
  workshopPath: isWorkshopMode ? pathKey ?? null : null,
  workshopStep: isWorkshopMode ? step ?? null : null,
  workshopLessonTitle: isWorkshopMode ? lessonTitle ?? null : null,
});

setStatus("Creating submission…");

const media_kind = mediaKindFromMime(contentType);

const submissionInsert = await insertSubmissionRobust(
  {
    user_id: user.id,
    title: title.trim(),
    description: description.trim(),
    submitted_at: new Date().toISOString(),
    word: null,
    monthly_challenge_id: challengeToUse.id,
    storage_path: null,
    video_path: null,
    mime_type: contentType,
    media_kind,
    duration_seconds: durationSec ?? null,
    category: "film",
    film_category: selectedTags[0] ?? null,
    thumbnail_url: null,
    mux_upload_id: muxUpload.uploadId,
    mux_asset_id: null,
    mux_playback_id: null,
    mux_status: "waiting",
    source: isWorkshopMode ? "workshop" : "monthly_upload",
    workshop_path: isWorkshopMode ? pathKey ?? null : null,
    workshop_step: isWorkshopMode ? step ?? null : null,
    workshop_lesson_title: isWorkshopMode ? lessonTitle ?? null : null,
  },
  ["user_id", "title", "submitted_at"]
);

const createdSubmission = submissionInsert?.data?.[0];
if (!createdSubmission?.id) {
  throw new Error("Submission created, but no submission ID was returned.");
}

setStatus(
  Platform.OS === "web"
    ? "Uploading to Overlooked… This can take a while for large files."
    : "Uploading to Overlooked… Please keep the app open for large files."
);
setProgressPct(0);

await uploadFileToMuxDirectUrl({
  uploadUrl: muxUpload.uploadUrl,
  fileBlob: Platform.OS === "web" ? ((webFile as File | Blob | null) ?? undefined) : undefined,
  localUri: Platform.OS !== "web" ? (localUri as string) : undefined,
  mimeType: contentType,
  onProgress: (pct) => setProgressPct(pct),
});

setStatus("Uploading thumbnail…");

const thumbRes = await uploadThumbnailToStorage({
  userId: user.id,
  thumbUri: customThumbUri,
  objectName: `${uploadPrefix}/${Date.now()}`,
  bucket: THUMB_BUCKET,
});

setProgressPct(100);
setStatus("Finalizing submission…");

const { error: finalizeError } = await supabase
  .from("submissions")
  .update({
    thumbnail_url: thumbRes.publicUrl,
  })
  .eq("id", createdSubmission.id);

if (finalizeError) {
  throw finalizeError;
}

const shareSlug = await ensureSubmissionShareSlug({
  id: createdSubmission.id,
  title: createdSubmission.title ?? title.trim(),
  share_slug: createdSubmission.share_slug ?? null,
});
const sharedFilmUrl = buildSharedFilmUrl(shareSlug);
console.log("Shared film URL:", sharedFilmUrl);

if (isWorkshopMode && pathKey && typeof step === "number") {
  setStatus("Marking lesson complete…");

  const { error: progressInsertError } = await supabase.from("workshop_progress").insert({
    user_id: user.id,
    path_key: pathKey,
    step,
  });

  if (progressInsertError) {
    const msg = String(progressInsertError.message || "").toLowerCase();
    const alreadyExists = msg.includes("duplicate") || msg.includes("unique") || msg.includes("already");

    if (!alreadyExists) throw progressInsertError;
  }

  if (lessonXp > 0) {
    try {
      await giveXp(user.id, lessonXp, "manual_adjust");
    } catch (xpErr) {
      console.log("Workshop XP award error:", xpErr);
    }
  }
}

try {
  await refreshGamification?.();
} catch {}

try {
  await refreshStreak?.();
} catch {}

if (isWorkshopMode) {
  setAlreadyCompleted(true);
}

setStatus("Submitted! 🎉");

      const successTitle = isWorkshopMode ? "Workshop submitted!" : "Film uploaded!";
const successMessage = isWorkshopMode
  ? "Your film has been uploaded and entered into this month’s challenge, and your workshop lesson is now complete. It may take a little time to process before it appears on Featured."
  : "Your film has been uploaded and entered into this month’s challenge. It may take a little time to process before it appears on Featured.";

      const uploadedTitle = createdSubmission.title ?? title.trim();
      const uploadedThumb = thumbRes.publicUrl;

      if (Platform.OS === "web") {
        try {
          await copyFilmLink({ shareSlug });
        } catch (err: any) {
          console.warn("Copy failed:", err?.message || err);
        }

        const shouldOpenStory =
          typeof window !== "undefined" &&
          window.confirm(
            `${successMessage}\n\nYour link has been copied. Press OK to open story mode, or Cancel to finish.`
          );

        if (shouldOpenStory) {
          openStoryMode({
            title: uploadedTitle,
            shareSlug,
            thumbnailUrl: uploadedThumb,
          });
          return;
        }

        navigation.goBack();
      } else {
        Alert.alert(successTitle, successMessage, [
          {
            text: "Done",
            onPress: () => navigation.goBack(),
          },
          {
            text: "Copy Link",
            onPress: async () => {
              try {
                await copyFilmLink({ shareSlug });

                Alert.alert(
                  "Link copied",
                  "Your watch link has been copied. Do you want to open story mode for a screenshot?",
                  [
                    {
                      text: "Not now",
                      style: "cancel",
                      onPress: () => navigation.goBack(),
                    },
                    {
                      text: "Open story mode",
                      onPress: () => {
                        openStoryMode({
                          title: uploadedTitle,
                          shareSlug,
                          thumbnailUrl: uploadedThumb,
                        });
                      },
                    },
                  ]
                );
              } catch (err: any) {
                console.warn("Copy failed:", err?.message || err);
                navigation.goBack();
              }
            },
          },
        ]);
      }
    } catch (e: any) {
  console.warn("Workshop/monthly submit failed:", e?.message ?? e);
  const stepMessage = status ? `Last step: ${status}\n\n${e?.message ?? "Please try again."}` : (e?.message ?? "Please try again.");
  notify("Submission failed", stepMessage, setStatus);
  setProgressPct(0);
} finally {
      setLoading(false);
    }
  };

  const previewThumbToShow = customThumbUri || thumbUri;

  const headerTitle = isWorkshopMode ? "Workshop submission" : "Upload film";
  const headerSub = isWorkshopMode
    ? `Step ${step ?? "—"} • ${lessonTitle || "Workshop lesson"}`
    : "Upload your film to appear on Featured and enter this month’s challenge.";

  const leftTitle = isWorkshopMode ? "Lesson" : "How it works";
  const rightTitle = isWorkshopMode ? "Upload your workshop film" : "Upload your film";
  const rightSubtitle = isWorkshopMode
    ? "This counts as both a workshop submission and a monthly challenge upload."
    : "Simple, clear, and ready to submit.";

  const submitButtonText = isWorkshopMode
    ? alreadyCompleted
      ? "Lesson already completed"
      : loading
      ? "Submitting…"
      : "Upload & complete lesson"
    : loading
    ? "Submitting…"
    : "Upload film";

  const footnoteText = isWorkshopMode
    ? "This will create a Featured submission, enter the monthly challenge, and complete the workshop step."
    : "Your upload will appear on Featured and be entered into this month’s challenge.";

  const rulesTitle = isWorkshopMode ? "Workshop Rules & Terms" : "Upload Rules & Terms";
return (
  <View style={styles.container}>
    <LinearGradient
      colors={[T.bg, T.bg]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={StyleSheet.absoluteFill}
    />

    <View style={[styles.webScrollShell, isMobileWeb && styles.webScrollShellMobileWeb]}>
      <ScrollView
        style={[styles.scrollView, isMobileWeb && styles.scrollViewMobileWeb]}
        contentContainerStyle={[styles.scroll, isMobileWeb && styles.scrollMobileWeb]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={false}
      >
        <View
          style={[
            styles.pageWrap,
            isWide && styles.pageWrapWide,
            isPhone && styles.pageWrapPhone,
          ]}
        >
          <View style={styles.topNavRow}>
            <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.goBack()} style={styles.backBtn}>
              <Text style={styles.backBtnText}>← Back</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.heroHeader}>
            <Text style={[styles.heroTitle, isPhone && styles.heroTitlePhone]}>{headerTitle}</Text>
            <Text style={[styles.heroSubtitle, isPhone && styles.heroSubtitlePhone]}>
              {headerSub}
            </Text>
          </View>

          {!isWide ? (
            <Pressable
              onPress={() => setShowInfoPanel((v) => !v)}
              style={({ pressed }) => [styles.infoToggleCard, pressed && { opacity: 0.94 }]}
            >
              <View style={styles.infoToggleLeft}>
                <Text style={styles.infoToggleKicker}>Before you upload</Text>
                <Text style={styles.infoToggleTitle}>
                  {showInfoPanel ? "Hide steps & rules" : "View steps & rules"}
                </Text>
              </View>
              <Text style={styles.infoToggleChevron}>{showInfoPanel ? "−" : "+"}</Text>
            </Pressable>
          ) : null}

          <View
            style={[
              styles.layoutShell,
              isWide && styles.layoutShellWide,
              isTablet && styles.layoutShellTablet,
            ]}
          >
            {(isWide || showInfoPanel) && (
              <View style={[styles.infoColumn, isWide && styles.infoColumnWide]}>
                <View style={[styles.card, styles.infoCard, isPhone && styles.cardPhone]}>
                  <Text style={styles.infoSectionLabel}>How it works</Text>
                  <Text style={styles.infoSectionTitle}>Upload your film</Text>
                  <Text style={styles.infoSectionBody}>
                    Add a title, choose a category, upload your film and thumbnail, then submit it to Featured and this month’s challenge.
                  </Text>

                  <View style={styles.softDivider} />

                  <Text style={styles.infoMiniTitle}>Steps</Text>
                  <View style={styles.infoList}>
                    <Text style={styles.infoBullet}>• Add a title + one sentence</Text>
                    <Text style={styles.infoBullet}>• Choose 1 category</Text>
                    <Text style={styles.infoBullet}>• Upload your film + thumbnail</Text>
                    <Text style={styles.infoBullet}>• Agree to the rules</Text>
                    <Text style={styles.infoBullet}>• Submit your upload</Text>
                  </View>

                  <View style={styles.softDivider} />

                  <Text style={styles.infoMiniTitle}>What happens after upload</Text>
<View style={styles.infoList}>
  <Text style={styles.infoBullet}>• Your film is uploaded and entered into this month’s challenge</Text>
  <Text style={styles.infoBullet}>• Your lesson is completed straight away after upload</Text>
  <Text style={styles.infoBullet}>• Featured can take a little time to process your film before it appears</Text>
  <Text style={styles.infoBullet}>• Once processing finishes, it will show on Featured and play normally</Text>
  <Text style={styles.infoBullet}>• Other users can then watch and vote on it</Text>
  {isWorkshopMode ? (
    <Text style={styles.infoBullet}>• This lesson is marked complete automatically</Text>
  ) : null}
</View>

                  <View style={styles.softDivider} />

                  <Text style={styles.infoMiniTitle}>Rules</Text>
                  <View style={styles.infoList}>
                    <Text style={styles.infoBullet}>• File size must be 5GB or under</Text>
                    <Text style={styles.infoBullet}>• Your first film upload is free</Text>
<Text style={styles.infoBullet}>• Pro is required for additional uploads</Text>
                    <Text style={styles.infoBullet}>• Your film must be original</Text>
                    <Text style={styles.infoBullet}>• No stolen, hateful, or harmful content</Text>
                    <Text style={styles.infoBullet}>• Thumbnail is required</Text>
                    <Text style={styles.infoBullet}>• You must choose 1 category</Text>
                  </View>
                </View>
              </View>
            )}

            <View style={[styles.formColumn, isWide && styles.formColumnWide]}>
              <View style={[styles.card, styles.formCard, isPhone && styles.cardPhone]}>
                <View style={styles.formHeaderClean}>
                  <Text style={styles.formTitleLarge}>{rightTitle}</Text>
                  <Text style={styles.formSubtitleClean}>{rightSubtitle}</Text>
                </View>

                <View style={[styles.formBodyLite, isPhone && styles.formBodyLitePhone]}>
                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Title</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Static Hour"
                      placeholderTextColor={T.mute}
                      value={title}
                      onChangeText={setTitle}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>One sentence</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="One sentence about your film"
                      placeholderTextColor={T.mute}
                      value={description}
                      onChangeText={(t) => setDescription(t.slice(0, 100))}
                      maxLength={100}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Category</Text>

                    <Pressable
                      onPress={() => {
                        setTagQuery("");
                        setTagModalVisible(true);
                      }}
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
                          onPress={() => setSelectedTags([])}
                          style={({ pressed }) => [styles.clearChipBtn, pressed && { opacity: 0.9 }]}
                        >
                          <Text style={styles.clearChipText}>Clear</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Text style={styles.helperText}>Pick 1 category so Featured can sort your film.</Text>
                    )}
                  </View>

                  <View style={styles.uploadBox}>
                    <TouchableOpacity style={styles.primaryBtn} onPress={pickFile} activeOpacity={0.92}>
                      <Text style={styles.primaryBtnText}>{localUri ? "Pick a different file" : "Pick a file"}</Text>
                      <Text style={styles.primaryBtnSub}>1 free upload • Pro for unlimited • Max file size: 5GB</Text>
                    </TouchableOpacity>

                    {localUri ? (
                      <View style={[styles.fileActionsRow, isPhone && styles.fileActionsRowPhone]}>
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
                  </View>

                  {localUri ? (
                    <View style={styles.mediaSection}>
                      <View style={styles.mediaSectionHeader}>
                        <Text style={styles.mediaSectionTitle}>Thumbnail</Text>
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

                      <View style={[styles.thumbActionsRow, isPhone && styles.thumbActionsRowPhone]}>
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

                  {localUri ? (
                    <View style={styles.mediaSection}>
                      <Text style={styles.mediaSectionTitle}>Preview</Text>

                      <Pressable
                        onPress={openPreview}
                        style={({ pressed }) => [styles.previewWrap, pressed && { opacity: 0.92 }]}
                      >
                        <View style={[styles.previewStage, { aspectRatio: thumbAspect || 16 / 9 }]}>
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

                        <View style={styles.previewBadgeOverlay} pointerEvents="none">
                          <View style={styles.playPill}>
                            <Text style={styles.playPillText}>▶ Watch preview</Text>
                          </View>
                        </View>
                      </Pressable>
                    </View>
                  ) : null}

                  {localUri && Platform.OS !== "web" ? (
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
                      {status.toLowerCase().includes("upload") || status.toLowerCase().includes("checking") ? (
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
                      </View>
                    </View>
                  ) : null}
                </View>

                <View style={styles.formFooter}>
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
    (loading || (isWorkshopMode && alreadyCompleted)) && {
      opacity: 0.6,
    },
  ]}
  onPress={handleSubmit}
  disabled={loading || (isWorkshopMode && alreadyCompleted)}
  activeOpacity={0.92}
>
  <Text style={styles.submitText}>{submitButtonText}</Text>
</TouchableOpacity>

                  <View style={styles.formFootnoteWrap}>
  <Text style={styles.formFootnote}>{footnoteText}</Text>
  <Text style={styles.processingNote}>
    After upload finishes, your film may take a little time to process before it appears on Featured.
  </Text>
</View>
                </View>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>

    <Modal
      visible={tagModalVisible}
      animationType="fade"
      transparent
      onRequestClose={() => setTagModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setTagModalVisible(false)} />
        <View style={styles.categoryModal}>
          <View style={styles.categoryModalHeader}>
            <Text style={styles.modalTitle}>Choose a category</Text>
            <Pressable onPress={() => setTagModalVisible(false)} style={styles.modalIconClose}>
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
                    onPress={() => {
                      setSelectedTags([tag]);
                      setTagModalVisible(false);
                    }}
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
              onPress={() => setSelectedTags([])}
              style={({ pressed }) => [styles.modalAltBtn, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.modalAltText}>Clear</Text>
            </Pressable>
            <Pressable
              onPress={() => setTagModalVisible(false)}
              style={({ pressed }) => [styles.modalPrimaryBtn, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.modalPrimaryText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>

    <Modal visible={rulesVisible} animationType="fade" transparent onRequestClose={() => setRulesVisible(false)}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setRulesVisible(false)} />
        <View style={styles.modalContent}>
          <Text style={styles.modalTitle}>{rulesTitle}</Text>

          <ScrollView style={{ marginBottom: 16 }}>
            <Text style={styles.modalText}>• File size: max 5GB.</Text>
            <Text style={styles.modalText}>• Your first film upload is free.</Text>
<Text style={styles.modalText}>• Pro is required for additional uploads.</Text>
            <Text style={styles.modalText}>• Keep it original. No stolen footage or unlicensed material.</Text>
            <Text style={styles.modalText}>
              • Keep it appropriate. No hate, harassment, or explicit harmful content.
            </Text>
            <Text style={styles.modalText}>• Thumbnail is required.</Text>
            <Text style={styles.modalText}>• You must choose a category.</Text>
            <Text style={styles.modalText}>• This upload will become a Featured submission.</Text>
            <Text style={styles.modalText}>• This upload will be entered into the current monthly challenge.</Text>
            {isWorkshopMode ? (
              <Text style={styles.modalText}>• In workshop mode, this also marks your lesson complete.</Text>
            ) : null}
          </ScrollView>

          <Pressable style={styles.modalCloseBtn} onPress={() => setRulesVisible(false)}>
            <Text style={styles.modalCloseText}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>

    <Modal visible={previewVisible} animationType="fade" transparent onRequestClose={closePreview}>
      <View style={styles.modalOverlay}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={closePreview} />

        <View
          style={[
            styles.previewModal,
            isDesktopPreview ? styles.previewModalDesktop : styles.previewModalMobile,
          ]}
        >
          <View style={styles.previewTopRow}>
            <Text style={styles.previewTitle}>Preview</Text>
            <TouchableOpacity onPress={closePreview} activeOpacity={0.9} style={styles.previewHeaderCloseBtn}>
              <Text style={styles.previewHeaderCloseText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View
            style={[
              styles.previewVideoWrap,
              isDesktopPreview ? styles.previewVideoWrapDesktop : styles.previewVideoWrapMobile,
            ]}
          >
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
                      setPreviewError("Could not play this file. Try Retry or close it.");
                    }}
                    style={{
                      width: "100%",
                      height: "100%",
                      objectFit: "contain",
                      background: "#0B0B0B",
                      display: "block",
                      borderRadius: 16,
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
                      setPreviewError("Could not play this file. Try Retry or close it.");
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

          <Pressable style={styles.modalCloseBtn} onPress={closePreview}>
            <Text style={styles.modalCloseText}>Close Preview</Text>
          </Pressable>
        </View>
      </View>
    </Modal>

    <Modal visible={storyModeOpen} transparent animationType="fade" onRequestClose={closeStoryMode}>
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
                uri: storyModeItem?.thumbnailUrl || "https://picsum.photos/900/1600",
              }}
              style={styles.storyPosterImage}
              resizeMode="contain"
            />

            <LinearGradient
              colors={["rgba(0,0,0,0.04)", "rgba(0,0,0,0.10)", "rgba(0,0,0,0.28)"]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />

            <LinearGradient
              colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.0)", "rgba(0,0,0,0.72)"]}
              start={{ x: 0.5, y: 0.45 }}
              end={{ x: 0.5, y: 1 }}
              style={styles.storyBottomFade}
            />

            <View style={styles.storyBrandTop}>
              <Text style={styles.storyBrandText}>OVERLOOKED</Text>
            </View>

            <View style={styles.storyContent}>
              <Text style={styles.storyTitle} numberOfLines={3}>
                {storyModeItem?.title || "Untitled Film"}
              </Text>

              <Text style={styles.storyLink} numberOfLines={1}>
                {storyModeItem?.shareSlug ? buildSharedFilmUrl(storyModeItem.shareSlug) : ""}
              </Text>

              <TouchableOpacity onPress={copyCurrentStoryLink} activeOpacity={0.9} style={styles.storyCopyBtn}>
                <Text style={styles.storyCopyBtnText}>Copy Link</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>

    <UpgradeModal
      visible={upgradeVisible}
      context="challenge"
      onClose={() => setUpgradeVisible(false)}
    />
  </View>
);
  
}

function slugifyFilmTitle(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
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

  const base = slugifyFilmTitle(submission.title || "film");
  const slug = `${base || "film"}-${String(submission.id).slice(0, 6)}`;

  const { error } = await supabase.from("submissions").update({ share_slug: slug }).eq("id", submission.id);

  if (error) throw error;

  return slug;
}

async function copyFilmLink(opts: { shareSlug: string }) {
  const url = buildSharedFilmUrl(opts.shareSlug);

  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(url);
  } else {
    await Clipboard.setStringAsync(url);
  }

  return url;
}

/* -------------------------------- styles -------------------------------- */
const CINEMA = {
  bg: "#050506",
  panel: "#0B0C0F",
  panel2: "#111318",
  card: "#0D0F13",
  cardSoft: "#14171D",

  stroke: "rgba(255,255,255,0.06)",
  strokeSoft: "rgba(255,255,255,0.035)",

  text: "#F5F1E8",
  textSoft: "#BEB5A8",
  textDim: "#8F8578",

  brass: "#D3B06B",
  brassSoft: "rgba(211,176,107,0.12)",
  brassBorder: "rgba(211,176,107,0.28)",
  glow: "rgba(211,176,107,0.07)",

  redSoft: "rgba(140,58,58,0.16)",
  redBorder: "rgba(196,98,98,0.22)",

  greenSoft: "#123225",
  greenBorder: "rgba(104,186,132,0.18)",
};

const T = {
  bg: CINEMA.bg,
  card: CINEMA.card,
  text: CINEMA.text,
  sub: CINEMA.textSoft,
  mute: CINEMA.textDim,
  olive: CINEMA.brass,
  line: CINEMA.stroke,
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CINEMA.bg,
  },

  webScrollShell: {
    flex: 1,
    ...(Platform.OS === "web"
      ? ({
          height: "100dvh",
        } as any)
      : {}),
  },

  webScrollShellMobileWeb: {
    ...(Platform.OS === "web"
      ? ({
          height: "auto",
          overflow: "visible",
        } as any)
      : {}),
  },

  scrollView: {
    flex: 1,
    ...(Platform.OS === "web"
      ? ({
          height: "100dvh",
          overflowY: "auto",
          overflowX: "hidden",
          WebkitOverflowScrolling: "touch",
        } as any)
      : {}),
  },

  scrollViewMobileWeb: {
    ...(Platform.OS === "web"
      ? ({
          height: "auto",
          overflowY: "visible",
          overflowX: "visible",
        } as any)
      : {}),
  },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 0,
    paddingTop: 6,
    paddingBottom: 42,
    backgroundColor: CINEMA.bg,
  },

  scrollMobileWeb: {
    ...(Platform.OS === "web"
      ? ({
          minHeight: "auto",
        } as any)
      : {}),
  },

  pageWrap: {
    width: "100%",
    maxWidth: 1320,
    alignSelf: "center",
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: CINEMA.bg,
  },

  pageWrapWide: {
    paddingHorizontal: 28,
  },

  pageWrapPhone: {
  paddingHorizontal: 14,
  paddingTop: 14,
},

  topNavRow: {
  marginBottom: 14,
  marginTop: Platform.OS === "ios" ? 10 : 6,
  flexDirection: "row",
  alignItems: "center",
},

  backBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: CINEMA.panel,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },

  backBtnText: {
    color: CINEMA.text,
    fontWeight: "800",
    fontSize: 14,
    letterSpacing: 0.12,
  },

  heroHeader: {
    marginBottom: 18,
    paddingHorizontal: 2,
  },

  heroTitle: {
    color: CINEMA.text,
    fontSize: 48,
    lineHeight: 50,
    fontWeight: "900",
    letterSpacing: -1.2,
  },

  heroTitlePhone: {
    fontSize: 28,
    lineHeight: 31,
    letterSpacing: -0.6,
  },

  heroSubtitle: {
    color: CINEMA.brass,
    fontSize: 19,
    lineHeight: 25,
    fontWeight: "800",
    marginTop: 10,
    maxWidth: 760,
    letterSpacing: -0.1,
  },

  heroSubtitlePhone: {
    fontSize: 15,
    lineHeight: 21,
    marginTop: 8,
  },

  layoutShell: {
    gap: 18,
  },

  layoutShellWide: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 20,
  },

  layoutShellTablet: {
    gap: 18,
  },

  infoColumn: {
    width: "100%",
  },

  infoColumnWide: {
  flex: 0.36,
},

  formColumn: {
    width: "100%",
  },

  formColumnWide: {
  flex: 0.64,
},

  infoToggleCard: {
    backgroundColor: CINEMA.panel,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: 0.22,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },

  infoToggleLeft: {
    flex: 1,
    paddingRight: 12,
  },

  infoToggleKicker: {
    color: CINEMA.brass,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },

  infoToggleTitle: {
    color: CINEMA.text,
    fontSize: 19,
    fontWeight: "900",
    marginTop: 4,
    letterSpacing: -0.2,
  },

  infoToggleChevron: {
    color: CINEMA.text,
    fontSize: 30,
    fontWeight: "400",
  },

  card: {
    backgroundColor: CINEMA.panel,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    borderRadius: 30,
    shadowColor: "#000",
    shadowOpacity: 0.26,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
  },

  cardPhone: {
    borderRadius: 26,
  },

  infoCard: {
    padding: 22,
  },

  formCard: {
    padding: 0,
    overflow: "hidden",
    backgroundColor: "#090B0E",
  },

  infoSectionLabel: {
    color: CINEMA.brass,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 2,
    marginBottom: 10,
  },

  infoSectionTitle: {
    color: CINEMA.text,
    fontSize: 28,
    lineHeight: 31,
    fontWeight: "900",
    letterSpacing: -0.8,
    marginBottom: 8,
  },

  infoSectionBody: {
    color: CINEMA.textSoft,
    fontSize: 15,
    lineHeight: 24,
    letterSpacing: 0.04,
  },

  infoMiniTitle: {
    color: CINEMA.brass,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.35,
    marginBottom: 10,
  },

  infoList: {
    gap: 8,
  },

  infoBullet: {
    color: CINEMA.textSoft,
    fontSize: 15,
    lineHeight: 24,
    letterSpacing: 0.02,
  },

  softDivider: {
    height: 1,
    backgroundColor: CINEMA.strokeSoft,
    marginVertical: 18,
  },

  formHeaderClean: {
    paddingHorizontal: 26,
    paddingTop: 24,
    paddingBottom: 14,
    backgroundColor: "transparent",
  },

  formTitleLarge: {
    color: CINEMA.text,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "900",
    letterSpacing: -0.8,
  },

  formSubtitleClean: {
    color: CINEMA.textDim,
    fontSize: 15,
    marginTop: 5,
    lineHeight: 22,
    letterSpacing: 0.04,
  },

  formBodyLite: {
    gap: 18,
    paddingHorizontal: 26,
    paddingTop: 4,
    paddingBottom: 16,
  },

  formBodyLitePhone: {
    gap: 16,
    paddingHorizontal: 18,
  },

  fieldGroup: {
    gap: 8,
  },

  label: {
    color: CINEMA.text,
    fontSize: 16,
    fontWeight: "800",
    marginBottom: 2,
    letterSpacing: -0.1,
  },

  input: {
    minHeight: 60,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    backgroundColor: "#07080B",
    color: CINEMA.text,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
    fontSize: 16,
    ...(Platform.OS === "web"
      ? ({
          outlineStyle: "none",
          boxShadow: "none",
        } as any)
      : {}),
  },

  selectBtn: {
    minHeight: 76,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    backgroundColor: "#07080B",
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 16,
    justifyContent: "center",
  },

  selectBtnText: {
    color: CINEMA.text,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.1,
  },

  selectBtnHint: {
    color: CINEMA.textDim,
    fontSize: 13,
    marginTop: 5,
    letterSpacing: 0.03,
  },

  selectedRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },

  selectedChip: {
    backgroundColor: CINEMA.brassSoft,
    borderColor: CINEMA.brassBorder,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 999,
  },

  selectedChipText: {
    color: CINEMA.brass,
    fontWeight: "800",
    fontSize: 13,
  },

  clearChipBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    backgroundColor: CINEMA.panel2,
  },

  clearChipText: {
    color: CINEMA.textSoft,
    fontWeight: "700",
    fontSize: 13,
  },

  helperText: {
    color: CINEMA.textDim,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    letterSpacing: 0.04,
  },

  uploadBox: {
    marginTop: 2,
    gap: 12,
  },

  primaryBtn: {
    minHeight: 80,
    backgroundColor: CINEMA.brass,
    borderRadius: 24,
    paddingVertical: 16,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },

  primaryBtnText: {
    color: "#0A0A0B",
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: -0.2,
  },

  primaryBtnSub: {
    color: "#2B2317",
    fontSize: 13,
    fontWeight: "800",
    marginTop: 5,
    letterSpacing: 0.1,
  },

  fileActionsRow: {
    flexDirection: "row",
    gap: 12,
  },

  fileActionsRowPhone: {
    flexDirection: "column",
  },

  secondaryBtn: {
    flex: 1,
    minHeight: 58,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    backgroundColor: CINEMA.panel2,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },

  secondaryBtnText: {
    color: CINEMA.text,
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: -0.1,
  },

  secondaryBtnDanger: {
    flex: 1,
    minHeight: 58,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: CINEMA.redBorder,
    backgroundColor: CINEMA.redSoft,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },

  secondaryBtnDangerText: {
    color: "#F0B2B2",
    fontWeight: "800",
    fontSize: 15,
    letterSpacing: -0.1,
  },

  mediaSection: {
    gap: 10,
    marginTop: 2,
  },

  mediaSectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  mediaSectionTitle: {
    color: CINEMA.text,
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: -0.15,
  },

  thumbReqRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },

  thumbReqTitle: {
    color: CINEMA.text,
    fontWeight: "900",
    fontSize: 15,
  },

  thumbReqBadge: {
    color: "#EBC3C3",
    borderColor: "rgba(255,120,120,0.28)",
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    fontWeight: "800",
    fontSize: 12,
    backgroundColor: "rgba(110,35,35,0.18)",
  },

  thumbActionsRow: {
    flexDirection: "row",
    gap: 12,
  },

  thumbActionsRowPhone: {
    flexDirection: "column",
  },

  previewWrap: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: CINEMA.strokeSoft,
    backgroundColor: "#07090C",
    overflow: "hidden",
  },

  previewStage: {
    width: "100%",
    backgroundColor: "#07090C",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },

  previewImg: {
    width: "100%",
    height: "100%",
  },

  previewBadgeOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 14,
  },

  playPill: {
    backgroundColor: "rgba(0,0,0,0.56)",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },

  playPillText: {
    color: CINEMA.text,
    fontWeight: "800",
    fontSize: 13,
    letterSpacing: 0.04,
  },

  thumbLoading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 34,
  },

  thumbLoadingText: {
    color: CINEMA.textDim,
    marginTop: 8,
    fontSize: 13,
  },

  thumbFallback: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 40,
  },

  thumbFallbackText: {
    color: CINEMA.textDim,
    fontWeight: "800",
    fontSize: 14,
  },

  statusRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },

  statusText: {
    color: CINEMA.textSoft,
    fontSize: 13,
    flex: 1,
    lineHeight: 19,
  },

  progressWrap: {
    marginTop: 2,
  },

  progressBar: {
    height: 10,
    width: "100%",
    backgroundColor: CINEMA.panel2,
    borderRadius: 999,
    overflow: "hidden",
  },

  progressFill: {
    height: "100%",
    backgroundColor: CINEMA.brass,
    borderRadius: 999,
  },

  progressLabels: {
    marginTop: 7,
    flexDirection: "row",
    justifyContent: "flex-end",
  },

  progressText: {
    color: CINEMA.text,
    fontSize: 13,
    fontWeight: "800",
  },

  formFooter: {
    borderTopWidth: 1,
    borderTopColor: CINEMA.strokeSoft,
    paddingHorizontal: 26,
    paddingTop: 18,
    paddingBottom: 24,
    marginTop: 4,
  },

  agreeBlock: {
    marginTop: 0,
  },

  agreeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },

  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    backgroundColor: "#101216",
    alignItems: "center",
    justifyContent: "center",
  },

  checkboxChecked: {
    backgroundColor: CINEMA.brass,
    borderColor: CINEMA.brass,
  },

  checkGlyph: {
    color: "#0A0A0B",
    fontWeight: "900",
    fontSize: 15,
  },

  agreeText: {
    color: CINEMA.textSoft,
    flex: 1,
    lineHeight: 22,
    fontSize: 15,
  },

  termsLink: {
    color: CINEMA.brass,
    fontWeight: "900",
  },

  termsHintRow: {
    marginTop: 8,
    marginLeft: 40,
  },

  termsHintText: {
    color: CINEMA.textDim,
    textDecorationLine: "underline",
    fontSize: 13,
  },

  submitBtn: {
    marginTop: 18,
    minHeight: 72,
    backgroundColor: CINEMA.brass,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },

  submitText: {
    color: "#0A0A0B",
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: -0.2,
  },

 formFootnoteWrap: {
  marginTop: 12,
  alignItems: "center",
},

formFootnote: {
  color: CINEMA.textDim,
  fontSize: 13,
  textAlign: "center",
  lineHeight: 19,
},

processingNote: {
  color: CINEMA.brass,
  fontSize: 13,
  textAlign: "center",
  lineHeight: 19,
  marginTop: 8,
  maxWidth: 520,
},

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(4,4,6,0.86)",
    justifyContent: "center",
    padding: 18,
  },

  categoryModal: {
    backgroundColor: "#0C0E12",
    borderRadius: 30,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
  },

  categoryModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },

  modalTitle: {
    color: CINEMA.text,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.4,
  },

  modalIconClose: {
    width: 38,
    height: 38,
    borderRadius: 999,
    backgroundColor: "#15181D",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: CINEMA.strokeSoft,
  },

  modalIconCloseText: {
    color: CINEMA.text,
    fontSize: 17,
    fontWeight: "800",
  },

  modalSearch: {
    marginTop: 14,
    minHeight: 58,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    backgroundColor: "#07080B",
    color: CINEMA.text,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 15,
    ...(Platform.OS === "web"
      ? ({
          outlineStyle: "none",
          boxShadow: "none",
        } as any)
      : {}),
  },

  tagList: {
    marginTop: 12,
    gap: 8,
  },

  tagRow: {
    borderWidth: 1,
    borderColor: CINEMA.strokeSoft,
    backgroundColor: "#111318",
    borderRadius: 18,
    paddingHorizontal: 15,
    paddingVertical: 15,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  tagRowActive: {
    borderColor: CINEMA.brassBorder,
    backgroundColor: CINEMA.brassSoft,
  },

  tagRowText: {
    color: CINEMA.text,
    fontWeight: "800",
    fontSize: 14,
  },

  tagRowTextActive: {
    color: CINEMA.brass,
  },

  tagRowCheck: {
    color: CINEMA.brass,
    fontWeight: "900",
    fontSize: 16,
  },

  modalAltBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    backgroundColor: "#15181D",
    alignItems: "center",
    justifyContent: "center",
  },

  modalAltText: {
    color: CINEMA.text,
    fontWeight: "800",
    fontSize: 14,
  },

  modalPrimaryBtn: {
    flex: 1,
    minHeight: 52,
    borderRadius: 18,
    backgroundColor: CINEMA.brass,
    alignItems: "center",
    justifyContent: "center",
  },

  modalPrimaryText: {
    color: "#0A0A0B",
    fontWeight: "900",
    fontSize: 14,
  },

  modalContent: {
    backgroundColor: "#0C0E12",
    borderRadius: 30,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 10,
  },

  modalText: {
    color: CINEMA.textSoft,
    fontSize: 15,
    lineHeight: 24,
    marginBottom: 10,
    letterSpacing: 0.04,
  },

  modalCloseBtn: {
    backgroundColor: CINEMA.brass,
    borderRadius: 20,
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },

  modalCloseText: {
    color: "#0A0A0B",
    fontWeight: "900",
    fontSize: 15,
  },

  previewModal: {
    backgroundColor: "#0C0E12",
    borderRadius: 30,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.42,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
    elevation: 11,
  },

  previewModalDesktop: {
    width: "86%",
    maxWidth: 980,
    maxHeight: "88%",
    alignSelf: "center",
    marginTop: 32,
  },

  previewModalMobile: {
    width: "94%",
    maxWidth: 720,
    maxHeight: "78%",
    alignSelf: "center",
    marginTop: 16,
    padding: 14,
  },

  previewTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },

  previewTitle: {
    color: CINEMA.text,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.3,
  },

  previewHeaderCloseBtn: {
    width: 42,
    height: 42,
    borderRadius: 999,
    backgroundColor: "#15181D",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: CINEMA.strokeSoft,
  },

  previewHeaderCloseText: {
    color: CINEMA.text,
    fontSize: 18,
    fontWeight: "800",
  },

  previewVideoWrap: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: CINEMA.strokeSoft,
    backgroundColor: "#0A0A0A",
    overflow: "hidden",
  },

  previewVideoWrapDesktop: {
    width: "100%",
    height: 520,
  },

  previewVideoWrapMobile: {
    width: "100%",
  },

  previewVideoStage: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#0B0B0B",
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
    overflow: "hidden",
  },

  previewVideo: {
    width: "100%",
    height: "100%",
  },

  previewLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    alignItems: "center",
  },

  previewLoadingText: {
    color: CINEMA.text,
    marginTop: 10,
    fontWeight: "800",
    fontSize: 14,
  },

  previewErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.62)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 20,
  },

  previewErrorText: {
    color: CINEMA.text,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 14,
    fontSize: 14,
  },

  previewErrorActions: {
    flexDirection: "row",
    gap: 10,
  },

  previewRetryBtn: {
    backgroundColor: CINEMA.brass,
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },

  previewRetryText: {
    color: "#0A0A0B",
    fontWeight: "900",
  },

  previewAltBtn: {
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    backgroundColor: "#15181D",
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },

  previewAltText: {
    color: CINEMA.text,
    fontWeight: "800",
  },

  previewMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    marginBottom: 8,
    gap: 12,
    flexWrap: "wrap",
  },

  previewMeta: {
    color: CINEMA.textSoft,
    fontSize: 14,
  },

  previewMetaStrong: {
    color: CINEMA.text,
    fontWeight: "900",
  },

  storyOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },

  storyCard: {
    width: "100%",
    maxWidth: 420,
    alignItems: "center",
  },

  storyPoster: {
    width: "100%",
    aspectRatio: 9 / 16,
    borderRadius: 28,
    backgroundColor: "#050505",
    borderWidth: 1,
    borderColor: CINEMA.strokeSoft,
    position: "relative",
    overflow: "hidden",
  },

  storyPosterImage: {
    width: "100%",
    height: "100%",
    position: "absolute",
    opacity: 1,
  },

  storyCloseBtnFloating: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20,
  },

  storyCloseText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "900",
    lineHeight: 22,
    textAlign: "center",
  },

  storyBrandTop: {
    position: "absolute",
    top: 28,
    left: 24,
    right: 24,
    alignItems: "center",
  },

  storyBrandText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 18,
    letterSpacing: 3,
    textTransform: "uppercase",
  },

  storyBottomFade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "34%",
  },

  storyContent: {
    position: "absolute",
    left: 26,
    right: 26,
    bottom: 36,
    alignItems: "center",
  },

  storyTitle: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 24,
    lineHeight: 28,
    textAlign: "center",
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  storyLink: {
    marginTop: 18,
    color: "rgba(255,255,255,0.46)",
    fontWeight: "700",
    fontSize: 10,
    textAlign: "center",
  },

  storyCopyBtn: {
    marginTop: 14,
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },

  storyCopyBtnText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
});