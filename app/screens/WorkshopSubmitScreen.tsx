// app/screens/WorkshopSubmitScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Buffer } from "buffer";
import { useGamification } from "../context/GamificationContext";
import { useMonthlyStreak } from "../lib/useMonthlyStreak";
import { UpgradeModal } from "../../components/UpgradeModal";
import dayjs from "dayjs";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { useAppRefresh } from "../context/AppRefreshContext";
import { getCurrentUserTierOrFree } from "../lib/membership";
import { Ionicons } from "@expo/vector-icons";
import { useAppTheme } from "../context/ThemeContext";
import { useAppLanguage } from "../context/LanguageContext";
import { translateTrustedText } from "../i18n/translations";
import { schedulePersonalizedReengagementNotifications } from "../lib/reengagementNotifications";

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

type CollaboratorUser = {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
  level?: number | null;
};

type CollaboratorDraft = {
  user: CollaboratorUser;
  role: string;
};

type CollaboratorCreditSnapshot = {
  submission_id?: string;
  user_id: string;
  role: string;
  sort_order: number;
  users: {
    id: string;
    full_name?: string | null;
    avatar_url?: string | null;
  };
};

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // 5GB
const STORAGE_BUCKET = "films";
const THUMB_BUCKET = "thumbnails";
const MUX_METADATA_TITLE_MAX_CHARS = 16;

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

function compactMuxMetadataText(value: string | null | undefined, maxChars: number) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length > maxChars ? text.slice(0, maxChars) : text;
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

async function saveSubmissionCollaborators(
  submissionId: string,
  collaborators: CollaboratorDraft[]
) {
  const snapshots = buildCollaboratorCreditSnapshots(collaborators, submissionId);

  const cleanRows = snapshots.map(({ users, ...row }) => row);

  if (cleanRows.length === 0) return [];

  let tableSaved = false;
  let snapshotSaved = false;

  const { error } = await supabase.from("submission_collaborators").insert(cleanRows);

  if (error) {
    console.log("Submission collaborators table save unavailable:", error.message);
  } else {
    tableSaved = true;
  }

  const { error: snapshotError } = await supabase
    .from("submissions")
    .update({ collaborator_credits: snapshots })
    .eq("id", submissionId);

  if (snapshotError) {
    console.log("Submission collaborator snapshot save unavailable:", snapshotError.message);
  } else {
    snapshotSaved = true;
  }

  if (!tableSaved && !snapshotSaved) {
    throw new Error(
      "Collaborator credits could not be saved. Please apply the latest Supabase migration, then upload again."
    );
  }

  return snapshots;
}

function buildCollaboratorCreditSnapshots(
  collaborators: CollaboratorDraft[],
  submissionId?: string
) {
  return collaborators
    .map((draft, index) => {
      const role = draft.role.trim();
      return {
        ...(submissionId ? { submission_id: submissionId } : {}),
        user_id: draft.user.id,
        role,
        sort_order: index,
        users: {
          id: draft.user.id,
          full_name: draft.user.full_name ?? null,
          avatar_url: draft.user.avatar_url ?? null,
        },
      };
    })
    .filter((row) => row.user_id && row.role);
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
  const body: Record<string, any> = {
    userId: input.userId,
    title: compactMuxMetadataText(input.title, MUX_METADATA_TITLE_MAX_CHARS) || "Untitled",
    mimeType: input.mimeType ?? "video/mp4",
    category: input.category ?? "film",
  };

  if (input.challengeId != null) body.challengeId = input.challengeId;
  if (input.workshopPath) body.workshopPath = input.workshopPath;
  if (typeof input.workshopStep === "number") body.workshopStep = input.workshopStep;

  const { data, error } = await supabase.functions.invoke("mux-create-upload", {
    body,
  });

  if (error) {
    let detail = error.message || "Unknown Edge Function error";

    try {
      const context = (error as any)?.context;

      if (context) {
        const cloned = context.clone?.() ?? context;

        try {
          const json = await cloned.json();
          detail = JSON.stringify(json, null, 2);
        } catch {
          try {
            detail = await cloned.text();
          } catch {}
        }
      }
    } catch {}

    console.warn("mux-create-upload failed:", detail);

    throw new Error(`Mux upload setup failed: ${detail}`);
  }

  if (!data?.uploadUrl || !data?.uploadId) {
    console.warn("mux-create-upload missing fields:", data);

    throw new Error(
      `Mux upload setup failed: Edge Function did not return uploadUrl/uploadId. Response: ${JSON.stringify(
        data,
        null,
        2
      )}`
    );
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
  const { colors, isLight } = useAppTheme();
  const { language } = useAppLanguage();
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<WorkshopSubmitRouteParams, "WorkshopSubmit">>();
  const insets = useSafeAreaInsets();
  const { triggerAppRefresh } = useAppRefresh();
  const { width } = useWindowDimensions();
  const isMobileWeb = Platform.OS === "web" && width < 768;
  const isWide = width >= 1100;
  const isDesktopPreview = width >= 900;
  const isPhone = width < 520;
  const isTablet = width >= 768 && width < 1100;
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const tt = useCallback(
    (value: string) => translateTrustedText(value, language),
    [language]
  );
  const T = useMemo(
    () => ({
      bg: colors.background,
      card: colors.card,
      text: colors.textPrimary,
      sub: colors.textSecondary,
      mute: colors.textMuted,
      olive: colors.primary,
      line: colors.border,
      surface: colors.mutedCard,
      surfaceSoft: colors.backgroundAlt,
      input: colors.input,
      shadow: colors.shadow,
      cardAlt: colors.cardAlt,
      accent: colors.accent,
      textOnPrimary: colors.textOnPrimary,
    }),
    [colors]
  );

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
  const [collaboratorQuery, setCollaboratorQuery] = useState("");
  const [collaboratorRole, setCollaboratorRole] = useState("");
  const [collaboratorResults, setCollaboratorResults] = useState<CollaboratorUser[]>([]);
  const [collaboratorSearching, setCollaboratorSearching] = useState(false);
  const [collaborators, setCollaborators] = useState<CollaboratorDraft[]>([]);

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

// Web picker needs this preloaded.
// Do not run async Supabase checks immediately before opening the web file picker.
const [uploadAllowed, setUploadAllowed] = useState<boolean | null>(null);
const [uploadLimitLoading, setUploadLimitLoading] = useState(false);
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
        .from("users")
        .select("id, full_name, avatar_url, level")
        .ilike("full_name", `%${q}%`)
        .order("full_name", { ascending: true })
        .limit(10);

      if (cancelled) return;

      if (error) {
        console.log("Collaborator search error:", error.message);
        setCollaboratorResults([]);
      } else {
        const existingIds = new Set(collaborators.map((item) => item.user.id));
        setCollaboratorResults(((data || []) as CollaboratorUser[]).filter((item) => !existingIds.has(item.id)));
      }

      setCollaboratorSearching(false);
    }, 260);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [collaboratorQuery, collaborators]);

  const addCollaborator = (user: CollaboratorUser) => {
    const role = collaboratorRole.trim();

    if (!role) {
      notify("Add their role", "Write a role first, like DP, Actor, Editor, or Producer.", setStatus);
      return;
    }

    setCollaborators((prev) => {
      if (prev.some((item) => item.user.id === user.id)) return prev;
      return [...prev, { user, role }];
    });
    setCollaboratorQuery("");
    setCollaboratorRole("");
    setCollaboratorResults([]);
  };

  const removeCollaborator = (userIdToRemove: string) => {
    setCollaborators((prev) => prev.filter((item) => item.user.id !== userIdToRemove));
  };

  const refreshUploadLimit = async () => {
  try {
    setUploadLimitLoading(true);

    const sessionResult: any = await withTimeout<any>(
      supabase.auth.getSession() as any,
      6000,
      "Session check"
    );

    const session = sessionResult?.data?.session ?? null;

    if (!session?.user) {
      setUserTier(null);
      setUploadAllowed(false);
      return;
    }

    const tierNorm = await withTimeout(
      getCurrentUserTierOrFree({ force: true }),
      6000,
      "Membership check"
    );

    setUserTier(tierNorm || null);

    const canUpload = await canUserSubmitLifetimeFilm(session.user.id, tierNorm);
    setUploadAllowed(canUpload.allowed);
  } catch (e: any) {
    console.warn("refreshUploadLimit failed:", e?.message ?? e);
    setUploadAllowed(null);
  } finally {
    setUploadLimitLoading(false);
  }
};

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
          const tierNorm = await getCurrentUserTierOrFree({ force: true });

          if (alive) {
            setUserTier(tierNorm || null);
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
  refreshUploadLimit();
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
  // Important:
  // The browser file picker must open directly from the click.
  // So we use the preloaded uploadAllowed state instead of doing async checks here.

  if (uploadLimitLoading || uploadAllowed === null) {
    setStatus("Checking your upload limit…");
    refreshUploadLimit();
    return notify(
      "Please wait",
      "We’re still checking your upload limit. Try again in a moment.",
      setStatus
    );
  }

  if (uploadAllowed === false) {
    setUpgradeVisible(true);
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

const tierNorm = await getCurrentUserTierOrFree({ force: true });
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

setStatus("Opening video picker…");

const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

if (!permission.granted) {
  notify("Permission needed", "Please allow video library access.", setStatus);
  return;
}

const result = await ImagePicker.launchImageLibraryAsync({
  mediaTypes: ImagePicker.MediaTypeOptions.Videos,
  allowsEditing: false,
  quality: 1,
  selectionLimit: 1,
});

if (result.canceled) {
  setStatus("No file selected.");
  return;
}

const asset: any = result.assets?.[0];

if (!asset?.uri) {
  notify("No file", "Please choose a video file.", setStatus);
  return;
}

setStatus(alreadyCompleted ? "Already completed — You already completed this workshop lesson." : "");

setDurationSec(null);
setThumbUri(null);
setThumbAspect(16 / 9);
setThumbLoading(false);

removeCustomThumbnail();
closePreview();

setWebFile(null);
setProgressPct(0);

let bytes: number | null = null;

if (typeof asset.fileSize === "number") {
  bytes = asset.fileSize;
}

if (bytes == null && typeof asset.size === "number") {
  bytes = asset.size;
}

if (bytes == null) {
  try {
    const info = await FileSystem.getInfoAsync(asset.uri, { size: true } as any);

    if (info?.exists && typeof (info as any)?.size === "number") {
      bytes = (info as any).size;
    }
  } catch {}
}

if (bytes != null && bytes > MAX_UPLOAD_BYTES) {
  notify(
    "File too large",
    `This file is ${formatBytes(bytes)}. Max allowed is ${formatBytes(MAX_UPLOAD_BYTES)}.`,
    setStatus
  );
  resetSelectedFile();
  return;
}

setLocalUri(asset.uri);
setFileSizeBytes(bytes);

if (typeof asset.duration === "number") {
  const rawDuration = asset.duration;

  // Expo ImagePicker duration can be milliseconds on some platforms.
  const dSec = rawDuration > 10000 ? Math.round(rawDuration / 1000) : Math.round(rawDuration);

  if (dSec > 0) {
    setDurationSec(dSec);
  }
}

setStatus(`Loaded file • ${formatBytes(bytes)}. Now add a thumbnail and continue.`);

return;
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

    if (!title.trim()) {
      return notify("Add a title", "Give your film a title before uploading.", setStatus);
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

    let lastSubmitStep = isWorkshopMode
      ? "Checking workshop + monthly eligibility…"
      : "Checking monthly eligibility…";
    const setSubmitStatus = (next: string) => {
      lastSubmitStep = next;
      setStatus(next);
    };

    setLoading(true);
    setSubmitStatus(lastSubmitStep);
    setProgressPct(0);

    try {
      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr) throw userErr;
      if (!user) throw new Error("Not signed in");

      const tierNorm = await getCurrentUserTierOrFree({ force: true });
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

      setSubmitStatus("Preparing upload…");

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

setSubmitStatus("Creating submission…");

const media_kind = mediaKindFromMime(contentType);
const initialCollaboratorCredits = buildCollaboratorCreditSnapshots(collaborators);

const submissionInsert = await insertSubmissionRobust(
  {
    user_id: user.id,
    title: title.trim(),
    description: description.trim() || null,
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
    collaborator_credits: initialCollaboratorCredits,
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

await saveSubmissionCollaborators(createdSubmission.id, collaborators);

setSubmitStatus(
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

setSubmitStatus("Uploading thumbnail…");

const thumbRes = await uploadThumbnailToStorage({
  userId: user.id,
  thumbUri: customThumbUri,
  objectName: `${uploadPrefix}/${Date.now()}`,
  bucket: THUMB_BUCKET,
});

setProgressPct(100);
setSubmitStatus("Finalizing submission…");

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
  setSubmitStatus("Marking lesson complete…");

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

try {
  triggerAppRefresh();
} catch {}

void schedulePersonalizedReengagementNotifications(user.id);

if (isWorkshopMode) {
  setAlreadyCompleted(true);
}

setSubmitStatus("Submitted! 🎉");
await refreshUploadLimit();

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
      const errorMessage = e?.message ?? "Please try again.";
      const stepMessage = lastSubmitStep
        ? `Last step: ${lastSubmitStep}\n\n${errorMessage}`
        : errorMessage;
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
  const rightTitle = "Upload film";
  const rightSubtitle = isWorkshopMode
    ? "Complete the workshop step and enter this month’s challenge."
    : "Choose a title, category, file, and thumbnail.";

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
  <View style={[styles.container, { backgroundColor: T.bg }]}>
    <LinearGradient
      colors={[T.bg, T.bg]}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
      style={StyleSheet.absoluteFill}
    />

    <View style={[styles.webScrollShell, { backgroundColor: T.bg }, isMobileWeb && styles.webScrollShellMobileWeb]}>
      <ScrollView
  style={[styles.scrollView, { backgroundColor: T.bg }, isMobileWeb && styles.scrollViewMobileWeb]}
  contentContainerStyle={[styles.scroll, { backgroundColor: T.bg }, isMobileWeb && styles.scrollMobileWeb]}
  contentInsetAdjustmentBehavior="never"
  showsVerticalScrollIndicator={true}
  keyboardShouldPersistTaps="always"
  bounces={Platform.OS !== "web"}
  scrollEventThrottle={16}
  decelerationRate={Platform.OS === "ios" ? "fast" : 0.985}
  overScrollMode="always"
  scrollEnabled
  nestedScrollEnabled
>
          <View
            style={[
              styles.pageWrap,
              isWide && styles.pageWrapWide,
              isPhone && styles.pageWrapPhone,
              {
                paddingTop: Math.max(12, insets.top + 10),
                paddingBottom: Math.max(64, insets.bottom + 42),
                backgroundColor: T.bg,
              },
            ]}
          >
          <View style={styles.topNavRow}>
            <TouchableOpacity
              activeOpacity={0.9}
              onPress={() => navigation.goBack()}
              style={[
                styles.backBtn,
                {
                  backgroundColor: T.card,
                  borderColor: T.line,
                  shadowColor: T.shadow,
                },
              ]}
            >
              <Text style={[styles.backBtnText, { color: T.text }]}>← Back</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.heroHeader}>
            <Text style={[styles.heroTitle, { color: T.text }, isPhone && styles.heroTitlePhone]}>
              {headerTitle}
            </Text>
            <Text style={[styles.heroSubtitle, { color: T.accent }, isPhone && styles.heroSubtitlePhone]}>
              {headerSub}
            </Text>
          </View>

          {!isWide ? (
            <Pressable
              onPress={() => setShowInfoPanel((v) => !v)}
              style={({ pressed }) => [
                styles.infoToggleCard,
                {
                  backgroundColor: T.card,
                  borderColor: T.line,
                  shadowColor: T.shadow,
                },
                pressed && { opacity: 0.94 },
              ]}
            >
              <View style={styles.infoToggleLeft}>
                <Text style={[styles.infoToggleKicker, { color: T.accent }]}>Before you upload</Text>
                <Text style={[styles.infoToggleTitle, { color: T.text }]}>
                  {showInfoPanel ? "Hide checklist" : "Checklist & rules"}
                </Text>
              </View>
              <Text style={[styles.infoToggleChevron, { color: T.text }]}>
                {showInfoPanel ? "−" : "+"}
              </Text>
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
                <View
                  style={[
                    styles.card,
                    styles.infoCard,
                    {
                      backgroundColor: T.card,
                      borderColor: T.line,
                      shadowColor: T.shadow,
                    },
                    isPhone && styles.cardPhone,
                  ]}
                >
                  <Text style={[styles.infoSectionLabel, { color: T.accent }]}>{tt("How it works")}</Text>
                  <Text style={[styles.infoSectionTitle, { color: T.text }]}>{tt("Quick checklist")}</Text>
                  <Text style={[styles.infoSectionBody, { color: T.sub }]}>
                    {tt("Add a title, choose a category, upload your film and thumbnail, then submit it to Featured and this month’s challenge.")}
                  </Text>

                  <View style={[styles.softDivider, { backgroundColor: T.line }]} />

                  <Text style={[styles.infoMiniTitle, { color: T.accent }]}>{tt("Steps")}</Text>
                  <View style={styles.infoList}>
                    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Add a title")}</Text>
                    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Choose 1 category")}</Text>
                    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Upload your film + thumbnail")}</Text>
                    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Agree to the rules")}</Text>
                    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Submit your upload")}</Text>
                  </View>

                  <View style={[styles.softDivider, { backgroundColor: T.line }]} />

                  <Text style={[styles.infoMiniTitle, { color: T.accent }]}>{tt("What happens after upload")}</Text>
<View style={styles.infoList}>
  <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Your film is uploaded and entered into this month’s challenge")}</Text>
  <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Your lesson is completed straight away after upload")}</Text>
  <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Featured can take a little time to process your film before it appears")}</Text>
  <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Once processing finishes, it will show on Featured and play normally")}</Text>
  <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Other users can then watch and vote on it")}</Text>
  {isWorkshopMode ? (
    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• This lesson is marked complete automatically")}</Text>
  ) : null}
</View>

                  <View style={[styles.softDivider, { backgroundColor: T.line }]} />

                  <Text style={[styles.infoMiniTitle, { color: T.accent }]}>{tt("Rules")}</Text>
                  <View style={styles.infoList}>
                    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• File size must be 5GB or under")}</Text>
                    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Your first film upload is free")}</Text>
                    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Pro is required for additional uploads")}</Text>
                    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Your film must be original")}</Text>
                    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• No stolen, hateful, or harmful content")}</Text>
                    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• Thumbnail is required")}</Text>
                    <Text style={[styles.infoBullet, { color: T.sub }]}>{tt("• You must choose 1 category")}</Text>
                  </View>
                </View>
              </View>
            )}

            <View style={[styles.formColumn, isWide && styles.formColumnWide]}>
              <View
                style={[
                  styles.card,
                  styles.formCard,
                  {
                    backgroundColor: T.card,
                    borderColor: T.line,
                    shadowColor: T.shadow,
                  },
                  isPhone && styles.cardPhone,
                ]}
              >
                <View style={styles.formHeaderClean}>
                  <Text style={[styles.formTitleLarge, { color: T.text }]}>{rightTitle}</Text>
                  <Text style={[styles.formSubtitleClean, { color: T.mute }]}>{rightSubtitle}</Text>
                </View>

                <View style={[styles.formBodyLite, isPhone && styles.formBodyLitePhone]}>
                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: T.text }]}>Title</Text>
                    <TextInput
                      style={[
                        styles.input,
                        {
                          backgroundColor: T.input,
                          borderColor: T.line,
                          color: T.text,
                        },
                      ]}
                      placeholder="e.g. Static Hour"
                      placeholderTextColor={T.mute}
                      value={title}
                      onChangeText={setTitle}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: T.text }]}>Category</Text>

                    <Pressable
                      onPress={() => {
                        setTagQuery("");
                        setTagModalVisible(true);
                      }}
                      style={({ pressed }) => [
                        styles.selectBtn,
                        {
                          backgroundColor: T.input,
                          borderColor: T.line,
                        },
                        pressed && { opacity: 0.92 },
                      ]}
                    >
                      <Text style={[styles.selectBtnText, { color: T.text }]}>
                        {selectedTags[0] ? selectedTags[0] : "Choose a category"}
                      </Text>
                      <Text style={[styles.selectBtnHint, { color: T.mute }]}>
                        {selectedTags[0] ? "Tap to change" : "Tap to select"}
                      </Text>
                    </Pressable>

                    {selectedTags[0] ? (
                      <View style={styles.selectedRow}>
                        <View
                          style={[
                            styles.selectedChip,
                            {
                              backgroundColor: isLight ? '#F6ECD8' : CINEMA.brassSoft,
                              borderColor: isLight ? colors.borderStrong : CINEMA.brassBorder,
                            },
                          ]}
                        >
                          <Text style={[styles.selectedChipText, { color: T.accent }]}>
                            {selectedTags[0]}
                          </Text>
                        </View>
                        <Pressable
                          onPress={() => setSelectedTags([])}
                          style={({ pressed }) => [
                            styles.clearChipBtn,
                            {
                              backgroundColor: T.surfaceSoft,
                              borderColor: T.line,
                            },
                            pressed && { opacity: 0.9 },
                          ]}
                        >
                          <Text style={[styles.clearChipText, { color: T.sub }]}>Clear</Text>
                        </Pressable>
                      </View>
                    ) : (
                      <Text style={[styles.helperText, { color: T.mute }]}>
                        Pick 1 category so Featured can sort your film.
                      </Text>
                    )}
                  </View>

                  <View style={styles.uploadBox}>
                    <TouchableOpacity
                      style={[styles.primaryBtn, { backgroundColor: T.olive, shadowColor: T.shadow }]}
                      onPress={pickFile}
                      activeOpacity={0.92}
                    >
                      <View style={styles.primaryBtnMainRow}>
                        <Ionicons
                          name={localUri ? "swap-horizontal-outline" : "cloud-upload-outline"}
                          size={18}
                          color={T.textOnPrimary}
                        />
                        <Text style={[styles.primaryBtnText, { color: T.textOnPrimary }]}>
                          {localUri ? "Change file" : "Choose film file"}
                        </Text>
                      </View>
                      <Text style={[styles.primaryBtnSub, { color: T.textOnPrimary, opacity: 0.72 }]}>
                        First upload free · max 5GB
                      </Text>
                    </TouchableOpacity>

                    {localUri ? (
                      <View style={[styles.fileActionsRow, isPhone && styles.fileActionsRowPhone]}>
                        <Pressable
                          onPress={pickFile}
                          style={({ pressed }) => [
                            styles.secondaryBtn,
                            {
                              backgroundColor: T.surfaceSoft,
                              borderColor: T.line,
                            },
                            pressed && { opacity: 0.9 },
                          ]}
                        >
                          <Text style={[styles.secondaryBtnText, { color: T.text }]}>Change file</Text>
                        </Pressable>

                        <Pressable
                          onPress={resetSelectedFile}
                          style={({ pressed }) => [
                            styles.secondaryBtnDanger,
                            {
                              backgroundColor: isLight ? '#F8E9E6' : CINEMA.redSoft,
                              borderColor: isLight ? '#E4B6AF' : CINEMA.redBorder,
                            },
                            pressed && { opacity: 0.9 },
                          ]}
                        >
                          <Text style={[styles.secondaryBtnDangerText, { color: colors.danger }]}>Remove</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>

                  {localUri ? (
                    <View style={styles.mediaSection}>
                      <View style={styles.mediaSectionHeader}>
                        <Text style={[styles.mediaSectionTitle, { color: T.text }]}>Thumbnail</Text>
                        {!customThumbUri ? (
                          <Text
                            style={[
                              styles.thumbReqBadge,
                              {
                                backgroundColor: isLight ? '#F8E9E6' : 'rgba(110,35,35,0.18)',
                                borderColor: isLight ? '#E4B6AF' : 'rgba(255,120,120,0.28)',
                                color: colors.danger,
                              },
                            ]}
                          >
                            Missing
                          </Text>
                        ) : (
                          <Text
                            style={[
                              styles.thumbReqBadge,
                              {
                                backgroundColor: isLight ? '#E8F2EA' : 'rgba(60,200,120,0.13)',
                                borderColor: isLight ? '#BBD7C3' : 'rgba(60,200,120,0.35)',
                                color: colors.success,
                              },
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
                            {
                              flex: 1,
                              alignItems: "center",
                              backgroundColor: T.surfaceSoft,
                              borderColor: T.line,
                            },
                          ]}
                        >
                          <Text style={[styles.secondaryBtnText, { color: T.text }]}>
                            {customThumbUri ? "Change thumbnail" : "Add thumbnail"}
                          </Text>
                        </Pressable>

                        {customThumbUri ? (
                          <Pressable
                            onPress={removeCustomThumbnail}
                            style={({ pressed }) => [
                              styles.secondaryBtnDanger,
                              pressed && { opacity: 0.9 },
                              {
                                flex: 1,
                                alignItems: "center",
                                backgroundColor: isLight ? '#F8E9E6' : CINEMA.redSoft,
                                borderColor: isLight ? '#E4B6AF' : CINEMA.redBorder,
                              },
                            ]}
                          >
                            <Text style={[styles.secondaryBtnDangerText, { color: colors.danger }]}>Remove</Text>
                          </Pressable>
                        ) : null}
                      </View>

                      {!customThumbUri ? (
                        <Text style={[styles.helperText, { color: T.mute }]}>
                          You must add a thumbnail before submitting.
                        </Text>
                      ) : (
                        <Text style={[styles.helperText, { color: T.mute }]}>
                          This is the image that will show on Featured.
                        </Text>
                      )}
                    </View>
                  ) : null}

                  {localUri ? (
                    <View style={styles.mediaSection}>
                      <Text style={[styles.mediaSectionTitle, { color: T.text }]}>Preview</Text>

                      <Pressable
                        onPress={openPreview}
                        style={({ pressed }) => [
                          styles.previewWrap,
                          {
                            backgroundColor: T.surfaceSoft,
                            borderColor: T.line,
                          },
                          pressed && { opacity: 0.92 },
                        ]}
                      >
                        <View
                          style={[
                            styles.previewStage,
                            { aspectRatio: thumbAspect || 16 / 9, backgroundColor: T.surfaceSoft },
                          ]}
                        >
                          {thumbLoading ? (
                            <View style={styles.thumbLoading}>
                              <ActivityIndicator size="small" color={T.olive} />
                              <Text style={[styles.thumbLoadingText, { color: T.mute }]}>
                                Generating preview…
                              </Text>
                            </View>
                          ) : previewThumbToShow ? (
                            <Image
                              source={{ uri: previewThumbToShow }}
                              style={styles.previewImg}
                              resizeMode={customThumbUri ? "cover" : "contain"}
                            />
                          ) : (
                            <View style={styles.thumbFallback}>
                              <Text style={[styles.thumbFallbackText, { color: T.mute }]}>Watch preview</Text>
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

                  <View style={styles.fieldGroup}>
                    <Text style={[styles.label, { color: T.text }]}>Collaborators</Text>
                    <Text style={[styles.helperText, { color: T.mute }]}>
                      Optional: add people who worked on this film and credit their role.
                    </Text>

                    <View style={[styles.collaboratorInputsRow, isPhone && styles.collaboratorInputsRowPhone]}>
                      <TextInput
                        style={[
                          styles.input,
                          styles.collaboratorSearchInput,
                          {
                            backgroundColor: T.input,
                            borderColor: T.line,
                            color: T.text,
                          },
                        ]}
                        placeholder="Search users..."
                        placeholderTextColor={T.mute}
                        value={collaboratorQuery}
                        onChangeText={setCollaboratorQuery}
                      />
                      <TextInput
                        style={[
                          styles.input,
                          styles.collaboratorRoleInput,
                          {
                            backgroundColor: T.input,
                            borderColor: T.line,
                            color: T.text,
                          },
                        ]}
                        placeholder="Role, e.g. DP"
                        placeholderTextColor={T.mute}
                        value={collaboratorRole}
                        onChangeText={setCollaboratorRole}
                      />
                    </View>

                    {collaboratorSearching ? (
                      <View style={styles.collaboratorSearchState}>
                        <ActivityIndicator color={T.olive} size="small" />
                        <Text style={[styles.collaboratorSearchStateText, { color: T.mute }]}>
                          Searching...
                        </Text>
                      </View>
                    ) : null}

                    {collaboratorResults.length > 0 ? (
                      <View style={styles.collaboratorResults}>
                        {collaboratorResults.map((item) => (
                          <TouchableOpacity
                            key={item.id}
                            activeOpacity={0.9}
                            onPress={() => addCollaborator(item)}
                            style={[
                              styles.collaboratorResultRow,
                              {
                                backgroundColor: T.surfaceSoft,
                                borderColor: T.line,
                              },
                            ]}
                          >
                            {item.avatar_url ? (
                              <Image source={{ uri: item.avatar_url }} style={styles.collaboratorAvatar} />
                            ) : (
                              <View
                                style={[
                                  styles.collaboratorAvatarFallback,
                                  {
                                    backgroundColor: isLight ? '#F6ECD8' : CINEMA.brassSoft,
                                    borderColor: isLight ? colors.borderStrong : CINEMA.brassBorder,
                                  },
                                ]}
                              >
                                <Text style={[styles.collaboratorAvatarInitial, { color: T.accent }]}>
                                  {(item.full_name || "U").slice(0, 1).toUpperCase()}
                                </Text>
                              </View>
                            )}
                            <View style={styles.collaboratorResultText}>
                              <Text style={[styles.collaboratorName, { color: T.text }]} numberOfLines={1}>
                                {item.full_name || "Unknown creator"}
                              </Text>
                              <Text style={[styles.collaboratorHint, { color: T.mute }]} numberOfLines={1}>
                                Tap to add as {collaboratorRole.trim() || "collaborator"}
                              </Text>
                            </View>
                            <Ionicons name="add-circle-outline" size={20} color={T.accent} />
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}

                    {collaborators.length > 0 ? (
                      <View style={styles.collaboratorChips}>
                        {collaborators.map((item) => (
                          <View
                            key={item.user.id}
                            style={[
                              styles.collaboratorChip,
                              {
                                backgroundColor: isLight ? '#F6ECD8' : CINEMA.brassSoft,
                                borderColor: isLight ? colors.borderStrong : CINEMA.brassBorder,
                              },
                            ]}
                          >
                            {item.user.avatar_url ? (
                              <Image source={{ uri: item.user.avatar_url }} style={styles.collaboratorChipAvatar} />
                            ) : (
                              <View
                                style={[
                                  styles.collaboratorChipAvatarFallback,
                                  { backgroundColor: isLight ? '#EAD6A8' : 'rgba(198,166,100,0.20)' },
                                ]}
                              >
                                <Text style={[styles.collaboratorChipInitial, { color: T.accent }]}>
                                  {(item.user.full_name || "U").slice(0, 1).toUpperCase()}
                                </Text>
                              </View>
                            )}
                            <View style={styles.collaboratorChipTextWrap}>
                              <Text style={[styles.collaboratorChipName, { color: T.text }]} numberOfLines={1}>
                                {item.user.full_name || "Unknown"}
                              </Text>
                              <Text style={[styles.collaboratorChipRole, { color: T.accent }]} numberOfLines={1}>
                                {item.role}
                              </Text>
                            </View>
                            <Pressable
                              onPress={() => removeCollaborator(item.user.id)}
                              style={({ pressed }) => [
                                styles.collaboratorRemoveBtn,
                                {
                                  backgroundColor: isLight ? 'rgba(20,17,13,0.08)' : 'rgba(0,0,0,0.26)',
                                },
                                pressed && { opacity: 0.75 },
                              ]}
                            >
                              <Ionicons name="close" size={14} color={T.sub} />
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                  

                  {!!status && (
                    <View style={styles.statusRow}>
                      {status.toLowerCase().includes("upload") || status.toLowerCase().includes("checking") ? (
                        <ActivityIndicator size="small" color={T.olive} />
                      ) : null}
                      <Text style={[styles.statusText, { color: T.sub }]}>{status}</Text>
                    </View>
                  )}

                  {loading ? (
                    <View style={styles.progressWrap}>
                      <View style={[styles.progressBar, { backgroundColor: T.surfaceSoft }]}>
                        <View style={[styles.progressFill, { width: `${progressPct}%`, backgroundColor: T.olive }]} />
                      </View>
                      <View style={styles.progressLabels}>
                        <Text style={[styles.progressText, { color: T.text }]}>{progressPct}%</Text>
                      </View>
                    </View>
                  ) : null}
                </View>

                <View style={[styles.formFooter, { borderTopColor: T.line }]}>
                  <View style={styles.agreeBlock}>
                    <Pressable
                      onPress={() => setAgreed(!agreed)}
                      style={({ pressed }) => [styles.agreeRow, pressed && { opacity: 0.9 }]}
                    >
                      <View
                        style={[
                          styles.checkbox,
                          {
                            backgroundColor: T.input,
                            borderColor: T.line,
                          },
                          agreed && { backgroundColor: T.olive, borderColor: T.olive },
                        ]}
                      >
                        {agreed ? <Text style={[styles.checkGlyph, { color: T.textOnPrimary }]}>✓</Text> : null}
                      </View>

                      <Text style={[styles.agreeText, { color: T.sub }]}>
                        I agree to{" "}
                        <Text
                          style={[styles.termsLink, { color: T.accent }]}
                          onPress={() => setRulesVisible(true)}
                          suppressHighlighting
                        >
                          the rules & terms
                        </Text>
                      </Text>
                    </Pressable>

                    <Pressable onPress={() => setRulesVisible(true)} style={styles.termsHintRow}>
                      <Text style={[styles.termsHintText, { color: T.mute }]}>View rules</Text>
                    </Pressable>
                  </View>

                  <TouchableOpacity
  style={[
    styles.submitBtn,
    {
      backgroundColor: T.olive,
      shadowColor: T.shadow,
    },
    (loading || (isWorkshopMode && alreadyCompleted)) && {
      opacity: 0.6,
    },
  ]}
  onPress={handleSubmit}
  disabled={loading || (isWorkshopMode && alreadyCompleted)}
  activeOpacity={0.92}
>
  <Text style={[styles.submitText, { color: T.textOnPrimary }]}>{submitButtonText}</Text>
</TouchableOpacity>

                  <View style={styles.formFootnoteWrap}>
  <Text style={[styles.formFootnote, { color: T.mute }]}>{footnoteText}</Text>
  <Text style={[styles.processingNote, { color: T.accent }]}>
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
      <View
        style={[
          styles.modalOverlay,
          { backgroundColor: isLight ? 'rgba(20,17,13,0.28)' : 'rgba(4,4,6,0.86)' },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setTagModalVisible(false)} />
        <View
          style={[
            styles.categoryModal,
            {
              backgroundColor: T.card,
              borderColor: T.line,
              shadowColor: T.shadow,
            },
          ]}
        >
          <View style={styles.categoryModalHeader}>
            <Text style={[styles.modalTitle, { color: T.text }]}>Choose a category</Text>
            <Pressable
              onPress={() => setTagModalVisible(false)}
              style={[
                styles.modalIconClose,
                {
                  backgroundColor: T.surfaceSoft,
                  borderColor: T.line,
                },
              ]}
            >
              <Text style={[styles.modalIconCloseText, { color: T.text }]}>✕</Text>
            </Pressable>
          </View>

          <TextInput
            value={tagQuery}
            onChangeText={setTagQuery}
            placeholder="Search categories…"
            placeholderTextColor={T.mute}
            style={[
              styles.modalSearch,
              {
                backgroundColor: T.input,
                borderColor: T.line,
                color: T.text,
              },
            ]}
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
                      {
                        backgroundColor: active
                          ? isLight
                            ? '#F6ECD8'
                            : CINEMA.brassSoft
                          : T.surfaceSoft,
                        borderColor: active
                          ? isLight
                            ? colors.borderStrong
                            : CINEMA.brassBorder
                          : T.line,
                      },
                      pressed && { opacity: 0.9 },
                    ]}
                  >
                    <Text style={[styles.tagRowText, { color: active ? T.accent : T.text }]}>{tag}</Text>
                    {active ? <Text style={[styles.tagRowCheck, { color: T.accent }]}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
            <Pressable
              onPress={() => setSelectedTags([])}
              style={({ pressed }) => [
                styles.modalAltBtn,
                {
                  backgroundColor: T.surfaceSoft,
                  borderColor: T.line,
                },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={[styles.modalAltText, { color: T.text }]}>Clear</Text>
            </Pressable>
            <Pressable
              onPress={() => setTagModalVisible(false)}
              style={({ pressed }) => [
                styles.modalPrimaryBtn,
                { backgroundColor: T.olive },
                pressed && { opacity: 0.9 },
              ]}
            >
              <Text style={[styles.modalPrimaryText, { color: T.textOnPrimary }]}>Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>

    <Modal visible={rulesVisible} animationType="fade" transparent onRequestClose={() => setRulesVisible(false)}>
      <View
        style={[
          styles.modalOverlay,
          { backgroundColor: isLight ? 'rgba(20,17,13,0.28)' : 'rgba(4,4,6,0.86)' },
        ]}
      >
        <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setRulesVisible(false)} />
        <View
          style={[
            styles.modalContent,
            {
              backgroundColor: T.card,
              borderColor: T.line,
              shadowColor: T.shadow,
            },
          ]}
        >
          <Text style={[styles.modalTitle, { color: T.text }]}>{tt(rulesTitle)}</Text>

          <ScrollView style={{ marginBottom: 16 }}>
            <Text style={[styles.modalText, { color: T.sub }]}>{tt("• File size: max 5GB.")}</Text>
            <Text style={[styles.modalText, { color: T.sub }]}>{tt("• Your first film upload is free.")}</Text>
            <Text style={[styles.modalText, { color: T.sub }]}>{tt("• Pro is required for additional uploads.")}</Text>
            <Text style={[styles.modalText, { color: T.sub }]}>{tt("• Keep it original. No stolen footage or unlicensed material.")}</Text>
            <Text style={[styles.modalText, { color: T.sub }]}>
              {tt("• Keep it appropriate. No hate, harassment, or explicit harmful content.")}
            </Text>
            <Text style={[styles.modalText, { color: T.sub }]}>{tt("• Thumbnail is required.")}</Text>
            <Text style={[styles.modalText, { color: T.sub }]}>{tt("• You must choose a category.")}</Text>
            <Text style={[styles.modalText, { color: T.sub }]}>{tt("• This upload will become a Featured submission.")}</Text>
            <Text style={[styles.modalText, { color: T.sub }]}>{tt("• This upload will be entered into the current monthly challenge.")}</Text>
            {isWorkshopMode ? (
              <Text style={[styles.modalText, { color: T.sub }]}>{tt("• In workshop mode, this also marks your lesson complete.")}</Text>
            ) : null}
          </ScrollView>

          <Pressable
            style={[styles.modalCloseBtn, { backgroundColor: T.olive }]}
            onPress={() => setRulesVisible(false)}
          >
            <Text style={[styles.modalCloseText, { color: T.textOnPrimary }]}>Close</Text>
          </Pressable>
        </View>
      </View>
    </Modal>

    <Modal visible={previewVisible} animationType="fade" transparent onRequestClose={closePreview}>
      <View style={[styles.modalOverlay, { backgroundColor: colors.overlay }]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={closePreview} />

        <View
          style={[
            styles.previewModal,
            isDesktopPreview ? styles.previewModalDesktop : styles.previewModalMobile,
            { backgroundColor: T.card, borderColor: T.line, shadowColor: T.shadow },
          ]}
        >
          <View style={styles.previewTopRow}>
            <Text style={[styles.previewTitle, { color: T.text }]}>Preview</Text>
            <TouchableOpacity
              onPress={closePreview}
              activeOpacity={0.9}
              style={[styles.previewHeaderCloseBtn, { backgroundColor: T.surfaceSoft, borderColor: T.line }]}
            >
              <Text style={[styles.previewHeaderCloseText, { color: T.text }]}>✕</Text>
            </TouchableOpacity>
          </View>

          <View
            style={[
              styles.previewVideoWrap,
              isDesktopPreview ? styles.previewVideoWrapDesktop : styles.previewVideoWrapMobile,
              {
                backgroundColor: isLight ? T.surfaceSoft : "#0A0A0A",
                borderColor: T.line,
              },
            ]}
          >
            <View style={[styles.previewVideoStage, { backgroundColor: isLight ? T.surfaceSoft : "#0B0B0B" }]}>
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
                      background: isLight ? T.surfaceSoft : "#0B0B0B",
                      display: "block",
                      borderRadius: 16,
                    }}
                  />
                ) : (
                  <Video
                    key={`native-preview-${previewNonce}-${localUri}`}
                    ref={previewPlayerRef}
                    source={{ uri: localUri }}
                    style={[styles.previewVideo, { backgroundColor: isLight ? T.surfaceSoft : "#0B0B0B" }]}
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
                <View
                  style={[
                    styles.previewLoadingOverlay,
                    { backgroundColor: isLight ? "rgba(248,243,234,0.72)" : "rgba(0,0,0,0.45)" },
                  ]}
                  pointerEvents="none"
                >
                  <ActivityIndicator size="large" color={T.olive} />
                  <Text style={[styles.previewLoadingText, { color: T.text }]}>Loading preview…</Text>
                </View>
              ) : null}

              {previewError ? (
                <View
                  style={[
                    styles.previewErrorOverlay,
                    { backgroundColor: isLight ? "rgba(248,243,234,0.9)" : "rgba(0,0,0,0.62)" },
                  ]}
                >
                  <Text style={[styles.previewErrorText, { color: T.text }]}>{previewError}</Text>
                  <View style={styles.previewErrorActions}>
                    <Pressable style={[styles.previewRetryBtn, { backgroundColor: T.olive }]} onPress={retryPreview}>
                      <Text style={[styles.previewRetryText, { color: T.textOnPrimary }]}>Retry</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.previewAltBtn, { backgroundColor: T.surfaceSoft, borderColor: T.line }]}
                      onPress={closePreview}
                    >
                      <Text style={[styles.previewAltText, { color: T.text }]}>Close</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
            </View>
          </View>

          <View style={styles.previewMetaRow}>
            <Text style={[styles.previewMeta, { color: T.sub }]}>
              Duration: <Text style={[styles.previewMetaStrong, { color: T.text }]}>{formatDur(durationSec)}</Text>
            </Text>
            <Text style={[styles.previewMeta, { color: T.sub }]}>
              Size: <Text style={[styles.previewMetaStrong, { color: T.text }]}>{formatBytes(fileSizeBytes)}</Text>
            </Text>
          </View>

          <Pressable style={[styles.modalCloseBtn, { backgroundColor: T.olive }]} onPress={closePreview}>
            <Text style={[styles.modalCloseText, { color: T.textOnPrimary }]}>Close Preview</Text>
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
  bg: "#050505",
  panel: "#0D0D0F",
  panel2: "#111114",
  card: "#111114",
  cardSoft: "#16161A",

  stroke: "rgba(255,255,255,0.10)",
  strokeSoft: "rgba(255,255,255,0.06)",

  text: "#F4EFE6",
  textSoft: "#D8D2C8",
  textDim: "#9F927F",

  brass: "#C6A664",
  brassSoft: "rgba(198,166,100,0.12)",
  brassBorder: "rgba(198,166,100,0.28)",
  glow: "rgba(198,166,100,0.07)",

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
    ...(Platform.OS === "web"
      ? ({
          height: "100dvh",
          maxHeight: "100dvh",
          overflow: "hidden",
        } as any)
      : {}),
  },

  webScrollShell: {
    flex: 1,
    width: "100%",
    ...(Platform.OS === "web"
      ? ({
          height: "100dvh",
          maxHeight: "100dvh",
          overflow: "hidden",
        } as any)
      : {}),
  },

  webScrollShellMobileWeb: {
    ...(Platform.OS === "web"
      ? ({
          height: "100dvh",
          maxHeight: "100dvh",
          overflow: "hidden",
        } as any)
      : {}),
  },

  scrollView: {
    flex: 1,
    width: "100%",
    ...(Platform.OS === "web"
      ? ({
          height: "100%",
          maxHeight: "100%",
          overflowY: "auto",
          overflowX: "hidden",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-y",
        } as any)
      : {}),
  },

  scrollViewMobileWeb: {
    ...(Platform.OS === "web"
      ? ({
          height: "100%",
          maxHeight: "100%",
          overflowY: "auto",
          overflowX: "hidden",
          WebkitOverflowScrolling: "touch",
          touchAction: "pan-y",
        } as any)
      : {}),
  },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 0,
    paddingTop: 0,
    paddingBottom: 0,
    backgroundColor: CINEMA.bg,
  },

  scrollMobileWeb: {
    ...(Platform.OS === "web"
      ? ({
          flexGrow: 1,
          paddingBottom: 140,
        } as any)
      : {}),
  },

  pageWrap: {
    width: "100%",
    maxWidth: 1320,
    alignSelf: "center",
    paddingHorizontal: 20,
    backgroundColor: CINEMA.bg,
  },

  pageWrapWide: {
    paddingHorizontal: 28,
  },

  pageWrapPhone: {
    paddingHorizontal: 16,
  },

  topNavRow: {
    marginBottom: 12,
    marginTop: 0,
    flexDirection: "row",
    alignItems: "center",
  },

  backBtn: {
    minHeight: 38,
    paddingHorizontal: 14,
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
    marginBottom: 14,
    paddingHorizontal: 2,
  },

  heroTitle: {
    color: CINEMA.text,
    fontSize: 42,
    lineHeight: 44,
    fontWeight: "900",
    letterSpacing: -1.2,
  },

  heroTitlePhone: {
    fontSize: 27,
    lineHeight: 30,
    letterSpacing: -0.6,
  },

  heroSubtitle: {
    color: CINEMA.brass,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "800",
    marginTop: 10,
    maxWidth: 760,
    letterSpacing: -0.1,
  },

  heroSubtitlePhone: {
    fontSize: 14,
    lineHeight: 19,
    marginTop: 6,
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
    borderRadius: 22,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
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
    fontSize: 10,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },

  infoToggleTitle: {
    color: CINEMA.text,
    fontSize: 17,
    fontWeight: "900",
    marginTop: 4,
    letterSpacing: -0.2,
  },

  infoToggleChevron: {
    color: CINEMA.text,
    fontSize: 26,
    fontWeight: "400",
  },

  card: {
    backgroundColor: CINEMA.panel,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    borderRadius: 24,
    shadowColor: "#000",
    shadowOpacity: 0.26,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
  },

  cardPhone: {
    borderRadius: 22,
  },

  infoCard: {
    padding: 18,
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
    paddingHorizontal: 22,
    paddingTop: 20,
    paddingBottom: 10,
    backgroundColor: "transparent",
  },

  formTitleLarge: {
    color: CINEMA.text,
    fontSize: 27,
    lineHeight: 30,
    fontWeight: "900",
    letterSpacing: -0.8,
  },

  formSubtitleClean: {
    color: CINEMA.textDim,
    fontSize: 14,
    marginTop: 5,
    lineHeight: 20,
    letterSpacing: 0.04,
  },

  formBodyLite: {
    gap: 14,
    paddingHorizontal: 22,
    paddingTop: 2,
    paddingBottom: 14,
  },

  formBodyLitePhone: {
    gap: 13,
    paddingHorizontal: 16,
  },

  fieldGroup: {
    gap: 7,
  },

  label: {
    color: CINEMA.text,
    fontSize: 14,
    fontWeight: "800",
    marginBottom: 2,
    letterSpacing: -0.1,
  },

  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    backgroundColor: "#07080B",
    color: CINEMA.text,
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 15,
    ...(Platform.OS === "web"
      ? ({
          outlineStyle: "none",
          boxShadow: "none",
        } as any)
      : {}),
  },

  selectBtn: {
    minHeight: 62,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    backgroundColor: "#07080B",
    borderRadius: 18,
    paddingHorizontal: 16,
    paddingVertical: 12,
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
    marginTop: 3,
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
    marginTop: 6,
    letterSpacing: 0.04,
  },

  collaboratorInputsRow: {
    flexDirection: "row",
    gap: 10,
  },

  collaboratorInputsRowPhone: {
    flexDirection: "column",
  },

  collaboratorSearchInput: {
    flex: 1.4,
  },

  collaboratorRoleInput: {
    flex: 1,
  },

  collaboratorSearchState: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 3,
  },

  collaboratorSearchStateText: {
    color: CINEMA.textDim,
    fontSize: 12,
    fontWeight: "700",
  },

  collaboratorResults: {
    gap: 8,
    marginTop: 2,
  },

  collaboratorResultRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    backgroundColor: CINEMA.panel2,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  collaboratorAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#050506",
  },

  collaboratorAvatarFallback: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CINEMA.brassSoft,
    borderWidth: 1,
    borderColor: CINEMA.brassBorder,
  },

  collaboratorAvatarInitial: {
    color: CINEMA.brass,
    fontSize: 13,
    fontWeight: "900",
  },

  collaboratorResultText: {
    flex: 1,
    minWidth: 0,
  },

  collaboratorName: {
    color: CINEMA.text,
    fontSize: 14,
    fontWeight: "900",
  },

  collaboratorHint: {
    color: CINEMA.textDim,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },

  collaboratorChips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  },

  collaboratorChip: {
    maxWidth: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: CINEMA.brassBorder,
    backgroundColor: CINEMA.brassSoft,
    paddingVertical: 7,
    paddingLeft: 8,
    paddingRight: 7,
  },

  collaboratorChipAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#050506",
  },

  collaboratorChipAvatarFallback: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(198,166,100,0.20)",
  },

  collaboratorChipInitial: {
    color: CINEMA.brass,
    fontSize: 10,
    fontWeight: "900",
  },

  collaboratorChipTextWrap: {
    maxWidth: 150,
  },

  collaboratorChipName: {
    color: CINEMA.text,
    fontSize: 12,
    fontWeight: "900",
  },

  collaboratorChipRole: {
    color: CINEMA.brass,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 1,
  },

  collaboratorRemoveBtn: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.26)",
  },

  uploadBox: {
    marginTop: 2,
    gap: 10,
  },

  primaryBtn: {
    minHeight: 62,
    backgroundColor: CINEMA.brass,
    borderRadius: 18,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.24,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },

  primaryBtnMainRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },

  primaryBtnText: {
    color: "#0A0A0B",
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: -0.2,
  },

  primaryBtnSub: {
    color: "#2B2317",
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
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
    minHeight: 48,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    backgroundColor: CINEMA.panel2,
    paddingVertical: 11,
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
    minHeight: 48,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: CINEMA.redBorder,
    backgroundColor: CINEMA.redSoft,
    paddingVertical: 11,
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
    gap: 8,
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
    borderRadius: 22,
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
    paddingHorizontal: 22,
    paddingTop: 16,
    paddingBottom: 20,
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
    marginTop: 14,
    minHeight: 58,
    backgroundColor: CINEMA.brass,
    borderRadius: 18,
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
    fontSize: 16,
    letterSpacing: -0.2,
  },

  formFootnoteWrap: {
    marginTop: 10,
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
