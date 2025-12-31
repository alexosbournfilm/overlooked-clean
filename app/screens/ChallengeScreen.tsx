// app/screens/ChallengeScreen.tsx
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
import { canSubmitToChallenge } from "../lib/membership";
import { UpgradeModal } from "../../components/UpgradeModal";

import * as FileSystem from "expo-file-system";
import * as VideoThumbnails from "expo-video-thumbnails";

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

const CAP: Record<Category, number> = {
  film: 5 * 60,
  acting: 2 * 60,
  music: 5 * 60,
};

const STORAGE_BUCKET = "films";

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
function notify(title: string, message?: string) {
  if (Platform.OS === "web") {
    // @ts-ignore
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
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

  // Try exact DATE match first (best if your columns are DATE)
  const exact = await supabase
    .from("monthly_challenges")
    .select("id, month_start, month_end, theme_word")
    .eq("month_start", startDateOnly)
    .eq("month_end", endDateOnly)
    .limit(1)
    .single();

  if (!exact.error && exact.data) return exact.data as MonthlyChallenge;

  // Try timestamp range (best if your columns are TIMESTAMPTZ)
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

  return fallback.data as MonthlyChallenge;
}

async function getResumableEndpoint() {
  const probe = supabase.storage.from(STORAGE_BUCKET).getPublicUrl("__probe__");
  const url = new URL(probe.data.publicUrl);
  const projectRef = url.hostname.split(".")[0];
  return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
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

/* -------------------------------- Screen -------------------------------- */

export default function ChallengeScreen() {
  const navigation = useNavigation<any>();
  const { width, height: winH } = useWindowDimensions();

  const isWide = width >= 1100;

  const [challenge, setChallenge] = useState<MonthlyChallenge | null>(null);
  const [countdown, setCountdown] = useState("");
  const [session, setSession] = useState<Session | null>(null);

  const [category, setCategory] = useState<Category>("film");
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

  const [previewVisible, setPreviewVisible] = useState(false);

  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [rulesVisible, setRulesVisible] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [etaText, setEtaText] = useState("");

  const [upgradeVisible, setUpgradeVisible] = useState(false);

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

  const resetSelectedFile = () => {
    if (objectUrlRef.current) {
      try {
        URL.revokeObjectURL(objectUrlRef.current);
      } catch {}
      objectUrlRef.current = null;
    }
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
    })();
  }, []);

  useEffect(() => {
  if (!challenge) return;

  let alive = true;

  const updateCountdown = async () => {
    // ✅ If DB row is wrong/outdated, fall back to real current month end.
    const fallbackEnd = dayjs().startOf("month").add(1, "month");

    const dbEnd = challenge?.month_end ? dayjs(challenge.month_end) : null;

    // If dbEnd is invalid OR already in the past, use fallbackEnd
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

  // Optional: refresh challenge row occasionally so it flips month automatically
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
    resetSelectedFile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  useEffect(() => {
    return () => {
      clearPreviewTimer();
      if (webDurationTimer.current) {
        clearTimeout(webDurationTimer.current);
        webDurationTimer.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthLabel = dayjs().format("MMMM");

  const capSec = CAP[category];
  const capText = category === "acting" ? "Max length: 2 minutes." : "Max length: 5 minutes.";

  const headerTitle = `${monthLabel} ${
    category === "film" ? "Film" : category === "acting" ? "Acting" : "Music"
  } Challenge`;

  const explainer =
    category === "film"
      ? "Make a short film. All levels welcome — upload your video directly here."
      : category === "acting"
      ? "Perform a monologue (max 2 minutes). All levels welcome — upload your video here."
      : "Create a track inspired by the theme. Upload an MP3 or a performance video.";

  const pickFile = async () => {
    try {
      setStatus("");
      setDurationSec(null);

      setThumbUri(null);
      setThumbAspect(16 / 9);
      setThumbLoading(false);

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

      if (Platform.OS === "web" && asset.file) {
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
      }

      setFileSizeBytes(bytes);

      const shouldTryThumb = category !== "music";
      if (shouldTryThumb) {
        setThumbLoading(true);

        if (Platform.OS === "web") {
          const src = objectUrlRef.current ?? asset.uri;
          const thumb = await captureFirstFrameWeb(src);

          if (thumb?.dataUrl) {
            setThumbUri(thumb.dataUrl);
            setThumbAspect(thumb.aspect || 16 / 9);
          } else {
            setThumbUri(null);
          }

          setThumbLoading(false);
        } else {
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
      const videoEl = document.createElement("video");
      videoEl.preload = "metadata";
      videoEl.muted = true;
      videoEl.playsInline = true;
      videoEl.src = localUri;

      const sizeText = formatBytes(fileSizeBytes);

      const cleanup = () => {
        videoEl.onloadedmetadata = null;
        videoEl.ontimeupdate = null;
        videoEl.onerror = null;
        try {
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

      videoEl.onloadedmetadata = () => {
        if (Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
          applyDuration(videoEl.duration);
          cleanup();
          return;
        }

        try {
          videoEl.ontimeupdate = () => {
            if (Number.isFinite(videoEl.duration) && videoEl.duration > 0) {
              applyDuration(videoEl.duration);
              cleanup();
            }
          };
          videoEl.currentTime = 1e101;
        } catch {
          applyDuration(null);
          cleanup();
        }
      };

      videoEl.onerror = () => {
        applyDuration(null);
        cleanup();
      };

      webDurationTimer.current = setTimeout(() => {
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
      return notify("Agreement required", "You must agree to the rules before submitting.");
    if (!session) return notify("Please sign in", "You must be logged in to submit.");
    if (!title.trim() || !description.trim()) return notify("Please complete all fields.");
    if (!localUri && !webFile) return notify("No file selected", "Pick a file first.");

    if (durationSec != null && durationSec > capSec) {
      const capLabel = `${Math.floor(capSec / 60)} minutes`;
      return notify(
        "Media too long",
        category === "acting"
          ? "Acting monologues must be 2 minutes or less."
          : `Maximum allowed length is ${capLabel}.`
      );
    }

    // Membership gate
    try {
      const gate = await canSubmitToChallenge();
      if (!gate.allowed) {
        if (gate.reason === "not_logged_in") {
          notify("Please sign in", "You must be logged in to submit.");
        } else if (gate.reason === "tier_too_low") {
          // ✅ UPDATED COPY (Pro)
          notify("Upgrade required", "Submitting to the monthly challenge is available on the Pro tier.");
          setUpgradeVisible(true);
        } else if (gate.reason === "no_submissions_left") {
          notify("Submission limit reached", "You’ve used all of your submissions for this month.");
          setUpgradeVisible(true);
        }
        return;
      }
    } catch (err) {
      console.warn("canSubmitToChallenge failed:", err);
      notify(
        "Please try again",
        "We couldn’t verify your submission limit just now. Try again in a moment."
      );
      return;
    }

    setLoading(true);
    setStatus("Uploading file…");
    setProgressPct(0);
    setEtaText("");

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { path, contentType } = await uploadResumable({
        userId: user.id,
        fileBlob:
          Platform.OS === "web" ? ((webFile as File | Blob | null) ?? undefined) : undefined,
        localUri: Platform.OS !== "web" ? (localUri as string) : undefined,
        onProgress: (pct) => setProgressPct(pct),
        onPhase: (label) => setStatus(label),
        objectName: `submissions/${user.id}/${Date.now()}`,
        bucket: STORAGE_BUCKET,
      });

      setProgressPct(100);
      setStatus("Creating submission…");

      const media_kind = mediaKindFromMime(contentType);

      // ✅ Avoid TS “session possibly null” by using the authenticated user id we already have
      const payload: any = {
        user_id: user.id,
        title: title.trim(),
        description: description.trim(),
        submitted_at: new Date().toISOString(),
        word: challenge?.theme_word ?? null,
        storage_path: path,
        video_path: path,
        mime_type: contentType,
        media_kind,
        duration_seconds: durationSec ?? null,
        category,
      };

      const { error } = await supabase.from("submissions").insert(payload);
      if (error) throw error;

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
        `Thanks for entering this month’s challenge. You just earned +${SUBMIT_XP} XP. Your submission will appear on Featured shortly.`
      );

      setTitle("");
      setDescription("");
      resetSelectedFile();
      setAgreed(false);
    } catch (e: any) {
      console.warn("Submit failed:", e?.message ?? e);
      notify("Submission failed", e?.message ?? "Please try again.");
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
                              THEME · {(challenge.theme_word ?? "—").toUpperCase()}
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
                    <Text style={styles.hypeTitle}>WHY UPLOAD MONTHLY?</Text>
                    <Text style={styles.hypeBody}>
                      Consistency builds creative credit. Uploading every month becomes your public proof of work —
                      you grow faster, get sharper, and your profile starts to speak for you.
                    </Text>
                    <Text style={styles.hypeBody}>
                      Over time, your submissions become a portfolio people actually watch.
                    </Text>
                  </View>

                  <View style={styles.segmentWrap}>
                    {(["film", "acting", "music"] as Category[]).map((c) => {
                      const active = category === c;
                      const label = c === "film" ? "Film" : c === "acting" ? "Acting" : "Music";
                      return (
                        <TouchableOpacity
                          key={c}
                          onPress={() => setCategory(c)}
                          activeOpacity={0.92}
                          style={[styles.segment, active && styles.segmentActive]}
                        >
                          <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                            {label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={styles.xpBanner}>
                    <Text style={styles.xpLine}>
                      Submit this month to earn <Text style={styles.xpStrong}>+{SUBMIT_XP} XP</Text>. Win the month and gain{" "}
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

                    <TouchableOpacity style={styles.pickBtn} onPress={pickFile} activeOpacity={0.92}>
                      <Text style={styles.pickBtnText}>{localUri ? "PICK A DIFFERENT FILE" : "PICK A FILE"}</Text>
                      <Text style={styles.pickBtnSub}>{category === "acting" ? "Max 2 minutes" : "Max 5 minutes"}</Text>
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
                          ) : thumbUri ? (
                            <Image source={{ uri: thumbUri }} style={styles.previewImg} resizeMode="contain" />
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

                    <Pressable
                      onPress={() => setAgreed(!agreed)}
                      style={({ pressed }) => [styles.agreeRow, pressed && { opacity: 0.9 }]}
                    >
                      <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
                        {agreed ? <Text style={styles.checkGlyph}>✓</Text> : null}
                      </View>
                      <Text style={styles.agreeText}>I agree to the rules & terms</Text>
                    </Pressable>

                    <TouchableOpacity
                      style={[styles.submitBtn, (!agreed || loading) && { opacity: 0.78 }]}
                      onPress={handleSubmit}
                      disabled={loading || !agreed}
                      activeOpacity={0.92}
                    >
                      <Text style={styles.submitText}>{loading ? "SUBMITTING…" : "UPLOAD & SUBMIT"}</Text>
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

        {/* RULES MODAL */}
        <Modal visible={rulesVisible} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Challenge Rules & Terms</Text>
              <ScrollView style={{ marginBottom: 16 }}>
                <Text style={styles.modalText}>• Keep it under the time limit ({capText.toLowerCase()}).</Text>
                <Text style={styles.modalText}>• No inappropriate, offensive, or harmful material.</Text>
                <Text style={styles.modalText}>• Use only copyright-free music/sounds and assets.</Text>
                <Text style={styles.modalText}>• You may submit multiple entries, but each must be unique.</Text>
                <Text style={styles.modalText}>• The monthly theme word is optional inspiration.</Text>
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
    marginBottom: 8,
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

  statusRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
  },
  statusText: {
    fontSize: 12,
    color: T.sub,
    textAlign: "center",
    fontWeight: "800",
    fontFamily: SYSTEM_SANS,
  },

  progressWrap: { marginTop: 14 },
  progressBar: {
    height: 8,
    width: "100%",
    backgroundColor: "#0E0E0E",
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ffffff14",
  },
  progressFill: {
    height: "100%",
    backgroundColor: T.olive,
    borderRadius: 999,
  },
  progressLabels: {
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressText: {
    fontSize: 12,
    color: T.text,
    fontWeight: "900",
    fontFamily: SYSTEM_SANS,
  },
  progressEta: { fontSize: 12, color: T.mute, fontFamily: SYSTEM_SANS },

  agreeRow: {
    marginTop: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 10,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: T.olive,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  // ✅ keep (even if not used directly)
  checkboxChecked: { backgroundColor: T.olive, borderColor: T.olive },
  checkGlyph: { color: "#000", fontWeight: "900", lineHeight: 18, fontFamily: SYSTEM_SANS },
  agreeText: {
    fontSize: 12,
    color: T.sub,
    fontWeight: "800",
    letterSpacing: 0.3,
    fontFamily: SYSTEM_SANS,
  },

  submitBtn: {
    marginTop: 10,
    width: "100%",
    borderRadius: 16,
    backgroundColor: T.olive,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#000000",
  },
  submitText: {
    fontWeight: "900",
    fontSize: 13,
    color: "#0B0B0B",
    letterSpacing: 2.4,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  formFootnote: {
    marginTop: 12,
    fontSize: 12,
    color: "#7E7E7E",
    textAlign: "center",
    fontFamily: SYSTEM_SANS,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.62)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalContent: {
    backgroundColor: T.card,
    borderRadius: 16,
    padding: 18,
    width: "100%",
    maxWidth: 560,
    maxHeight: "80%",
    borderWidth: 1,
    borderColor: "#ffffff14",
  },
  modalTitle: {
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 12,
    color: T.text,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  modalText: {
    fontSize: 13,
    marginBottom: 10,
    color: T.sub,
    lineHeight: 20,
    fontFamily: SYSTEM_SANS,
  },
  modalClose: {
    backgroundColor: T.olive,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#000000",
  },
  modalCloseText: {
    color: "#0B0B0B",
    fontWeight: "900",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },

  previewModal: {
    backgroundColor: T.card,
    borderRadius: 16,
    padding: 18,
    width: "100%",
    maxWidth: 720,
    borderWidth: 1,
    borderColor: "#ffffff14",
  },
  previewTitle: {
    fontSize: 14,
    fontWeight: "900",
    marginBottom: 12,
    color: T.text,
    letterSpacing: 1.8,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  previewVideoWrap: {
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#ffffff14",
    backgroundColor: "#0B0B0B",
  },
  previewVideoStage: {
    width: "100%",
    height: 420,
    backgroundColor: "#0B0B0B",
    position: "relative",
  },
  previewVideo: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
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
    letterSpacing: 1.0,
    textTransform: "uppercase",
    fontFamily: SYSTEM_SANS,
  },
  previewErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "rgba(0,0,0,0.55)",
  },
  previewErrorText: {
    color: T.text,
    fontSize: 12.5,
    fontWeight: "800",
    textAlign: "center",
    lineHeight: 18,
    fontFamily: SYSTEM_SANS,
    marginBottom: 12,
  },
  previewErrorActions: {
    flexDirection: "row",
    gap: 10,
  },
  previewRetryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#000000",
    backgroundColor: T.olive,
  },
  previewRetryText: {
    color: "#0B0B0B",
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontSize: 10,
    fontFamily: SYSTEM_SANS,
  },
  previewAltBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ffffff22",
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  previewAltText: {
    color: T.text,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontSize: 10,
    fontFamily: SYSTEM_SANS,
  },

  previewMetaRow: {
    marginTop: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  previewMeta: {
    fontSize: 12,
    color: "#B8B8B8",
    fontFamily: SYSTEM_SANS,
    fontWeight: "700",
  },
  previewMetaStrong: {
    color: T.text,
    fontWeight: "900",
    fontFamily: SYSTEM_SANS,
  },
});
