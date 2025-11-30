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
} from "react-native";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration";
import { useNavigation } from "@react-navigation/native";
import { supabase, giveXp, XP_VALUES } from "../lib/supabase"; // 🔥 include gamification helpers
import type { Session } from "@supabase/supabase-js";
import type { MonthlyChallenge } from "../types";
import { Video, ResizeMode } from "expo-av";
import * as DocumentPicker from "expo-document-picker";
import { Upload } from "tus-js-client";
import { LinearGradient } from "expo-linear-gradient";
import { useGamification } from "../context/GamificationContext"; // 🔥 pull gamification context
import { canSubmitToChallenge } from "../lib/membership";          // 🔐 tier + quota helper
import { UpgradeModal } from "../../components/UpgradeModal";      // ⭐ upgrade paywall modal

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});


dayjs.extend(duration);

/* ────────────────────────────────────────────────────────────
   CINEMATIC NOIR — black/white with gold accent
   ──────────────────────────────────────────────────────────── */
const GOLD = "#C6A664";
const T = {
  bg: "#000000",
  hero1: "#000000",
  hero2: "#000000",
  card: "#0A0A0A",
  card2: "#0E0E0E",
  text: "#FFFFFF",
  sub: "#DADADA",
  mute: "#9A9A9A",
  accent: "#FFFFFF",
  olive: GOLD,
};

// Cinzel for major headings
const FONT_CINEMATIC =
  Platform.select({ ios: "Cinzel", android: "Cinzel", default: "Cinzel" }) || "Cinzel";

/** OBLIVION-style (thin modern sans, wide tracking) */
const FONT_OBLIVION =
  Platform.select({
    ios: "Avenir Next",
    android: "sans-serif-light",
    default: "Avenir Next",
  }) || "Avenir Next";

type Category = "film" | "acting" | "music";

// Per-category caps (seconds)
const CAP: Record<Category, number> = {
  film: 5 * 60,
  acting: 2 * 60,
  music: 5 * 60,
};

const STORAGE_BUCKET = "films";

/** Reduced but consistent top offset to avoid excessive dead space */
const TOP_BAR_OFFSET = Platform.OS === "web" ? 24 : 12;

/* ---------------- Film Grain ---------------- */
const GRAIN_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIElEQVQYV2P8//8/AzGAiYGB4T8mGJgYhBmMCEwMDAwA1wQq1i3gN8QAAAAASUVORK5CYII=";

const Grain = ({ opacity = 0.06 }: { opacity?: number }) => (
  <View pointerEvents="none" style={[StyleSheet.absoluteFillObject, { opacity }]}>
    {Platform.OS === "web" ? (
      // @ts-ignore — allow CSS on web
      <View
        style={
          [
            StyleSheet.absoluteFillObject as any,
            {
              backgroundImage: `url(${GRAIN_PNG})`,
              backgroundRepeat: "repeat",
              backgroundSize: "auto",
            },
          ] as any
        }
      />
    ) : (
      <ImageBackground
        source={{ uri: GRAIN_PNG }}
        style={StyleSheet.absoluteFillObject}
        resizeMode={"repeat" as any}
      />
    )}
  </View>
);

/* ---------------- UX helpers ---------------- */
function notify(title: string, message?: string) {
  if (Platform.OS === "web") {
    window.alert(message ? `${title}\n\n${message}` : title);
  } else {
    Alert.alert(title, message);
  }
}

async function fetchCurrentChallenge() {
  try {
    await supabase.rpc("finalize_last_month_winner_if_needed");
  } catch {}
  try {
    await supabase.rpc("insert_monthly_challenge_if_not_exists");
  } catch {}

  const { data, error } = await supabase
    .from("monthly_challenges")
    .select("id, month_start, month_end, theme_word")
    .order("month_start", { ascending: false })
    .limit(1)
    .single();

  if (error) throw error;
  return data as MonthlyChallenge;
}

/** Build Supabase TUS endpoint without process.env */
async function getResumableEndpoint() {
  const probe = supabase.storage.from(STORAGE_BUCKET).getPublicUrl("__probe__");
  const url = new URL(probe.data.publicUrl);
  const projectRef = url.hostname.split(".")[0];
  return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
}

/** Resumable upload to Storage */
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
    type.includes("png") ? ".png" :
    type.includes("jpeg") || type.includes("jpg") ? ".jpg" :
    type.includes("webp") ? ".webp" :
    type.includes("gif") ? ".gif" :
    type.includes("mp4") ? ".mp4" :
    type.includes("quicktime") ? ".mov" :
    type.startsWith("audio/") ? ".mp3" :
    type.startsWith("video/") ? ".mp4" : "";

  const finalObjectName = objectName + ext;

  const { data: { session } } = await supabase.auth.getSession();
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

function mediaKindFromMime(mime: string | null | undefined): "file_audio" | "file_video" | "youtube" {
  if (!mime) return "file_video";
  if (mime.startsWith("audio/")) return "file_audio";
  if (mime.startsWith("video/")) return "file_video";
  return "file_video";
}

export default function ChallengeScreen() {
  const navigation = useNavigation();
  const { height: winH } = useWindowDimensions();

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

  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [rulesVisible, setRulesVisible] = useState(false);
  const [progressPct, setProgressPct] = useState(0);
  const [etaText, setEtaText] = useState("");

  const [upgradeVisible, setUpgradeVisible] = useState(false); // ⭐ membership paywall visibility

  const videoRef = useRef<Video>(null);
  const webDurationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 🔥 Gamification context (read-only here, plus refresh after XP updates)
  const {
    xp,
    level,
    levelTitle,
    currentLevelMinXp,
    nextLevelMinXp,
    loading: gamificationLoading,
    refresh: refreshGamification,
  } = useGamification();

  // XP reward for a valid challenge submission (fallback if constant missing)
  const SUBMIT_XP =
    (XP_VALUES && (XP_VALUES as any).CHALLENGE_SUBMISSION) || 50;

  // How much XP left to next level (if we have that data)
  const xpToNext =
    nextLevelMinXp && typeof xp === "number"
      ? Math.max(0, nextLevelMinXp - xp)
      : null;

  // Remove blue focus outline globally on web
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const style = document.createElement("style");
    style.innerHTML = `*:focus { outline: none !important; }`;
    document.head.appendChild(style);
    return () => {
      try { document.head.removeChild(style); } catch {}
    };
  }, []);

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
    const targetEnd = dayjs(challenge.month_start).add(1, "month").startOf("day");
    const updateCountdown = () => {
      const diffMs = targetEnd.diff(dayjs());
      if (diffMs <= 0) {
        setCountdown("This challenge has ended.");
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
    return () => clearInterval(t);
  }, [challenge]);

  // Reset file/duration/status when switching category
  useEffect(() => {
    setStatus("");
    setDurationSec(null);
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setLocalUri(null);
    setWebFile(null);
  }, [category]);

  const monthLabel = useMemo(
    () => (challenge ? dayjs(challenge.month_start).format("MMMM") : ""),
    [challenge]
  );

  const pickFile = async () => {
    try {
      setStatus("");
      setDurationSec(null);
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

      if (Platform.OS === "web" && asset.file) {
        const f: File = asset.file;
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        const objUrl = URL.createObjectURL(f);
        objectUrlRef.current = objUrl;
        setWebFile(f);
        setLocalUri(objUrl);
      } else {
        setWebFile(null);
        setLocalUri(asset.uri);
      }

      setStatus("Loaded file. Checking duration…");
    } catch (e) {
      console.warn("pickFile failed:", (e as any)?.message ?? e);
      notify("Could not open picker", "Try again.");
    }
  };

  // Web: duration via temp <video>
  useEffect(() => {
    if (Platform.OS !== "web" || !localUri) return;

    try {
      const videoEl = document.createElement("video");
      videoEl.preload = "metadata";
      videoEl.muted = true;
      videoEl.src = localUri;

      const onLoaded = () => {
        const d = Number.isFinite(videoEl.duration) ? Math.round(videoEl.duration) : 0;
        if (d > 0) setDurationSec(Math.max(0, d));
        setStatus(
          d
            ? `Media ready • duration ${Math.floor(d / 60)}:${String(d % 60).padStart(2, "0")}`
            : "Media ready (duration unknown)"
        );
        cleanup();
      };
      const onError = () => {
        setDurationSec(null);
        setStatus("Media ready (duration unknown)");
        cleanup();
      };
      const cleanup = () => {
        videoEl.removeEventListener("loadedmetadata", onLoaded);
        videoEl.removeEventListener("error", onError);
        if (webDurationTimer.current) {
          clearTimeout(webDurationTimer.current);
          webDurationTimer.current = null;
        }
      };

      videoEl.addEventListener("loadedmetadata", onLoaded);
      videoEl.addEventListener("error", onError);
      webDurationTimer.current = setTimeout(onError, 7000);
    } catch {
      setDurationSec(null);
      setStatus("Media ready (duration unknown)");
    }

    return () => {
      if (webDurationTimer.current) {
        clearTimeout(webDurationTimer.current);
        webDurationTimer.current = null;
      }
    };
  }, [localUri]);

  // Native: duration via hidden expo-av instance (videos only).
  const onVideoLoaded = (payload: any) => {
    const dMs = payload?.durationMillis ?? 0;
    const dSec = Math.max(0, Math.round(dMs / 1000));
    if (dSec > 0) setDurationSec(dSec);

    if (dSec > 0) {
      setStatus(
        `Media ready • duration ${Math.floor(dSec / 60)}:${String(dSec % 60).padStart(2, "0")}`
      );
    } else {
      setStatus("Media ready (duration unknown)");
    }
  };

  const handleSubmit = async () => {
    // Normal form validations first (cheap)
    if (!agreed)
      return notify("Agreement required", "You must agree to the rules before submitting.");
    if (!session) return notify("Please sign in", "You must be logged in to submit.");
    if (!title.trim() || !description.trim()) return notify("Please complete all fields.");
    if (!localUri && !webFile)
      return notify("No file selected", "Pick a file first.");

    const capSec = CAP[category];
    if (durationSec != null && durationSec > capSec) {
      const capLabel = `${Math.floor(capSec / 60)} minutes`;
      return notify(
        "Media too long",
        category === "acting"
          ? "Acting monologues must be 2 minutes or less."
          : `Maximum allowed length is ${capLabel}.`
      );
    }

    // 🔐 Membership + quota gate
    try {
      const gate = await canSubmitToChallenge();
      if (!gate.allowed) {
        if (gate.reason === "not_logged_in") {
          notify("Please sign in", "You must be logged in to submit.");
        } else if (gate.reason === "tier_too_low") {
          notify(
            "Upgrade required",
            "Submitting to the monthly challenge is available on the Artist and Tommy tiers."
          );
          setUpgradeVisible(true);
        } else if (gate.reason === "no_submissions_left") {
          notify(
            "Submission limit reached",
            "You’ve used all of your submissions for this month."
          );
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

    // ✅ Passed gating — continue with upload + insert
    setLoading(true);
    setStatus("Uploading file…");
    setProgressPct(0);
    setEtaText("");

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      const { path, contentType } = await uploadResumable({
        userId: user.id,
        fileBlob: Platform.OS === "web" ? (webFile as File | Blob | null) ?? undefined : undefined,
        localUri: Platform.OS !== "web" ? (localUri as string) : undefined,
        onProgress: (pct) => setProgressPct(pct),
        onPhase: (label) => setStatus(label),
        objectName: `submissions/${user.id}/${Date.now()}`,
        bucket: STORAGE_BUCKET,
      });

      setProgressPct(100);
      setStatus("Creating submission…");

      const media_kind = mediaKindFromMime(contentType);

      const payload: any = {
        user_id: session.user.id,
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

      // 🔥 Gamification: award XP for successful challenge submission.
      try {
        await giveXp(user.id, SUBMIT_XP, "challenge_submission");
      } catch (xpErr) {
        console.warn("giveXp challenge_submission failed:", xpErr);
      }

      // 🔥 Immediately refresh gamification context so top bar animates XP gain
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
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = null;
      }
      setLocalUri(null);
      setWebFile(null);
      setDurationSec(null);
      setAgreed(false);
      setProgressPct(0);
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
        <ActivityIndicator size="large" color={T.accent} />
        <Text style={styles.loadingText}>Loading this month&apos;s challenge…</Text>
      </View>
    );
  }

  const headerTitle = `${monthLabel} ${
    category === "film" ? "Film" : category === "acting" ? "Acting" : "Music"
  } Challenge`.toUpperCase();

  const capText = category === "acting" ? "Max length: 2 minutes." : "Max length: 5 minutes.";
  const helperForPicker =
    category === "music" ? "Pick an MP3 or a video file." : "Pick a video file.";

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
          { paddingTop: TOP_BAR_OFFSET, minHeight: winH + 1 },
        ]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        {/* HERO */}
        <View style={styles.cardWrapper}>
          <LinearGradient
            colors={[T.hero1, T.hero2]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardBorder}
          >
            <View style={[styles.card, styles.cardHero]}>
              {/* Title + Theme Row */}
              <View style={styles.heroHeader}>
                <Text style={styles.headerOblivion}>{headerTitle}</Text>

                {/* THEME */}
                <View style={styles.themeWrap}>
                  <View style={styles.themeDivider} />
                  <Text style={styles.themeLabel}>THEME:</Text>
                  <Text style={styles.themeValue}>
                    {(challenge.theme_word ?? "—").toUpperCase()}
                  </Text>
                  <View style={styles.themeDivider} />
                </View>

                <View style={styles.countdownBadge}>
                  <Text style={styles.countdownText}>TIME LEFT: {countdown}</Text>
                </View>
              </View>

              {/* 🔥 Challenge info banner (XP) */}
              <View style={styles.gamifyBanner}>
                <Text style={styles.gamifyLine}>
                  Submit a qualifying piece this month to earn
                  <Text style={styles.gamifyStrong}> +{SUBMIT_XP} XP</Text>.
                </Text>
                <Text style={styles.gamifyLine}>
                  If you win this month’s challenge, you’ll gain
                  <Text style={styles.gamifyStrong}> +500 XP</Text>.
                </Text>
                {!gamificationLoading && typeof level === "number" && (
                  <Text style={styles.gamifyLineSub} numberOfLines={1}>
                    You are <Text style={styles.gamifyStrong}>Lv {level}</Text>
                    {levelTitle ? (
                      <>
                        {" "}
                        · <Text style={styles.gamifyTitle}>{levelTitle}</Text>
                      </>
                    ) : null}
                    {xpToNext !== null && xpToNext > 0 && (
                      <>
                        {" "}
                        ·{" "}
                        <Text style={styles.gamifySoft}>{xpToNext} XP to your next title</Text>
                      </>
                    )}
                  </Text>
                )}
              </View>

              {/* Category selector */}
              <View style={styles.catRow}>
                {(["film", "acting", "music"] as Category[]).map((c) => {
                  const active = category === c;
                  const label = c === "film" ? "FILM" : c === "acting" ? "ACTING" : "MUSIC";
                  return (
                    <TouchableOpacity
                      key={c}
                      onPress={() => setCategory(c)}
                      activeOpacity={0.9}
                      style={[styles.catTap, styles.noOutline]}
                    >
                      <Text style={[styles.catText, active && styles.catTextActive]}>
                        {label}
                      </Text>
                      {active ? (
                        <View style={[styles.catUnderline, { backgroundColor: T.olive }]} />
                      ) : (
                        <View style={{ height: 3 }} />
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.topExplainer}>
                {category === "film" &&
                  "Make a short film. ALL levels of work welcome — beginner to pro (low, high, etc.). Upload your video directly here."}
                {category === "acting" &&
                  "Perform a monologue (max 2 minutes). ALL levels of work welcome — beginner to pro. Upload your video directly here."}
                {category === "music" &&
                  "Create a track inspired by the theme. ALL levels of work welcome — beginner to pro. Upload an MP3 or a performance video."}
              </Text>

              {/* Rules snippet */}
              <View style={styles.noticeCard}>
                <Text style={styles.noticeItem}>
                  • You can submit{" "}
                  <Text style={{ fontWeight: "900", color: T.text }}>
                    multiple entries
                  </Text>{" "}
                  each month.
                </Text>
                <Text style={styles.noticeItem}>• {capText}</Text>
                <Text style={styles.noticeItem}>
                  • The theme is optional—use it if it sparks something.
                </Text>
                <Text style={styles.noticeItem}>
                  • Use only copyright-free or properly licensed assets.
                </Text>
              </View>

              {/* Culture / category clarity */}
              <View style={[styles.noticeCard, { marginTop: 10 }]}>
                <Text style={[styles.noticeItemStrong]}>
                  This is a platform for{" "}
                  <Text style={{ fontWeight: "900", color: T.text }}>art</Text>, not
                  “content”.
                </Text>
                <Text style={styles.noticeItem}>
                  • This is <Text style={styles.boldCaps}>NOT</Text> Instagram or TikTok.
                </Text>
                <Text style={styles.noticeItem}>
                  • Submit <Text style={styles.boldCaps}>short films only</Text> on the
                  Film page.
                </Text>
                <Text style={styles.noticeItem}>
                  • Submit{" "}
                  <Text style={styles.boldCaps}>
                    acting monologues/performances only
                  </Text>{" "}
                  on the Acting page.
                </Text>
                <Text style={styles.noticeItem}>
                  • Submit <Text style={styles.boldCaps}>music only</Text> on the Music
                  page.
                </Text>
                <Text style={styles.noticeItemDanger}>
                  • “Brain-rot” style content may result in a ban.
                </Text>
              </View>

              <TouchableOpacity
                onPress={() => setRulesVisible(true)}
                activeOpacity={0.92}
                style={styles.noOutline}
              >
                <Text style={styles.rulesLink}>View full rules & terms</Text>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>

        {/* AGREEMENT */}
        <View style={styles.cardWrapper}>
          <LinearGradient
            colors={["#0F0F0F", "#080808"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardBorder}
          >
            <View style={styles.card}>
              <View style={styles.agreeRow}>
                <TouchableOpacity
                  style={[
                    styles.checkbox,
                    agreed && styles.checkboxChecked,
                    styles.noOutline,
                  ]}
                  onPress={() => setAgreed(!agreed)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: agreed }}
                  activeOpacity={0.9}
                >
                  {agreed ? <Text style={styles.checkGlyph}>✓</Text> : null}
                </TouchableOpacity>
                <Text style={styles.agreeText}>I agree to the rules & terms</Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* FORM */}
        <View style={styles.cardWrapper}>
          <LinearGradient
            colors={["#0F0F0F", "#080808"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.cardBorder}
          >
            <View style={styles.card}>
              <View style={styles.form}>
                <Text style={styles.label}>TITLE</Text>
                <TextInput
                  style={[styles.input, styles.noOutline]}
                  placeholder={
                    category === "music" ? "e.g. QUIET FIRE" : "e.g. FLICKER IN THE DARK"
                  }
                  placeholderTextColor={T.mute}
                  value={title}
                  onChangeText={setTitle}
                />

                <Text style={styles.label}>SHORT DESCRIPTION (MAX 100)</Text>
                <TextInput
                  style={[styles.input, styles.noOutline]}
                  placeholder={
                    category === "music"
                      ? "ONE SENTENCE ABOUT YOUR TRACK"
                      : category === "acting"
                      ? "ONE SENTENCE ABOUT YOUR MONOLOGUE"
                      : "ONE SENTENCE ABOUT YOUR FILM"
                  }
                  placeholderTextColor={T.mute}
                  value={description}
                  onChangeText={(t) => setDescription(t.slice(0, 100))}
                  maxLength={100}
                />
                <Text style={styles.helperText}>{description.length}/100</Text>

                <TouchableOpacity
                  style={[styles.pickBtn, styles.noOutline]}
                  onPress={pickFile}
                  activeOpacity={0.92}
                >
                  <Text style={styles.pickBtnText}>
                    {localUri ? "PICK A DIFFERENT FILE" : helperForPicker.toUpperCase()}
                  </Text>
                </TouchableOpacity>

                {localUri && category !== "music" ? (
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
                      setStatus("Media ready (duration unknown)");
                    }}
                  />
                ) : null}

                {!!status && (
                  <View style={styles.statusRow}>
                    {status.toLowerCase().includes("checking") ? (
                      <ActivityIndicator size="small" color={T.accent} />
                    ) : null}
                    <Text style={styles.statusText}>{status}</Text>
                  </View>
                )}

                {loading ? (
                  <View style={styles.progressWrap}>
                    <View style={styles.progressBar}>
                      <View
                        style={[styles.progressFill, { width: `${progressPct}%` }]}
                      />
                    </View>
                    <View style={styles.progressLabels}>
                      <Text style={styles.progressText}>{progressPct}%</Text>
                      <Text style={styles.progressEta}>{etaText}</Text>
                    </View>
                  </View>
                ) : null}

                <TouchableOpacity
                  style={[
                    styles.submitBtn,
                    styles.noOutline,
                    (!agreed || loading) && { opacity: 0.8 },
                  ]}
                  onPress={handleSubmit}
                  disabled={loading || !agreed}
                  activeOpacity={0.92}
                >
                  <Text style={styles.submitText}>
                    {loading ? "SUBMITTING…" : "UPLOAD & SUBMIT"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </LinearGradient>
        </View>

        {/* RULES MODAL */}
        <Modal visible={rulesVisible} animationType="fade" transparent>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Challenge Rules & Terms</Text>
              <ScrollView style={{ marginBottom: 16 }}>
                <Text style={styles.modalText}>
                  • Keep it under the time limit ({capText.toLowerCase()}).
                </Text>
                <Text style={styles.modalText}>
                  • No inappropriate, offensive, or harmful material.
                </Text>
                <Text style={styles.modalText}>
                  • Use only copyright-free music/sounds and assets.
                </Text>
                <Text style={styles.modalText}>
                  • You may submit multiple entries, but each must be unique.
                </Text>
                <Text style={styles.modalText}>
                  • The monthly theme word is optional inspiration.
                </Text>
              </ScrollView>
              <Pressable
                style={[styles.modalClose, styles.noOutline]}
                onPress={() => setRulesVisible(false)}
              >
                <Text style={styles.modalCloseText}>Close</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      </ScrollView>

      {/* ⭐ Membership Upgrade Modal */}
      <UpgradeModal
        visible={upgradeVisible}
        context="challenge"
        onClose={() => setUpgradeVisible(false)}
        onSelectArtist={() => {
          setUpgradeVisible(false);
          // You can later swap this to a dedicated checkout route or sheet
          try {
            navigation.navigate("Workshop" as never);
          } catch {
            // ignore if route not found
          }
        }}
        onSelectTommy={() => {
          setUpgradeVisible(false);
          try {
            navigation.navigate("Workshop" as never);
          } catch {
            // ignore if route not found
          }
        }}
      />
    </View>
  );
}

/* ────────────────────────────────────────────────────────────
   Styles — minimal, sharp
   ──────────────────────────────────────────────────────────── */
const RADIUS_XL = 18;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  scroll: { paddingHorizontal: 16, paddingBottom: 40 },

  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: T.bg,
  },
  loadingText: { marginTop: 10, color: T.sub },

  cardWrapper: {
    maxWidth: 1240,
    width: "100%",
    alignSelf: "center",
    marginBottom: 14,
  },
  cardBorder: { padding: 1, borderRadius: RADIUS_XL + 1 },
  card: {
    backgroundColor: T.card,
    borderRadius: RADIUS_XL,
    borderWidth: 1,
    borderColor: "#ffffff12",
    alignItems: "stretch",
    overflow: "hidden",
  },
  cardHero: { borderColor: "#ffffff1a", padding: 16 },

  heroHeader: {
    alignItems: "center",
    gap: 10,
    paddingTop: 2,
    paddingBottom: 6,
  },
  headerOblivion: {
    color: T.text,
    fontFamily: FONT_OBLIVION,
    letterSpacing: 6.5,
    fontSize: 22,
    textAlign: "center",
    fontWeight: Platform.OS === "android" ? ("300" as any) : "400",
  },

  themeWrap: {
    marginTop: 2,
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  themeDivider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: T.olive,
  },
  themeLabel: {
    color: T.olive,
    fontFamily: FONT_CINEMATIC,
    fontWeight: "700",
    letterSpacing: 5.5,
    fontSize: 13,
    marginRight: 4,
  },
  themeValue: {
    color: T.olive,
    fontFamily: FONT_CINEMATIC,
    fontWeight: "700",
    letterSpacing: 6.5,
    fontSize: 13,
  },

  countdownBadge: {
    marginTop: 4,
    alignSelf: "center",
    paddingHorizontal: 0,
    paddingVertical: 2,
  },
  countdownText: {
    color: T.text,
    fontFamily: FONT_OBLIVION,
    letterSpacing: 6.5,
    fontSize: 12,
    fontWeight: Platform.OS === "android" ? ("300" as any) : "400",
  },

  /* 🔥 Gamification banner */
  gamifyBanner: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "#050505",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#ffffff22",
    alignSelf: "stretch",
  },
  gamifyKicker: {
    fontSize: 9,
    color: GOLD,
    fontWeight: "900",
    letterSpacing: 2,
    marginBottom: 2,
  },
  gamifyLine: {
    fontSize: 11,
    color: T.sub,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  gamifyLineSub: {
    marginTop: 2,
    fontSize: 10,
    color: "#9A9A9A",
    letterSpacing: 0.2,
  },
  gamifyStrong: {
    color: T.text,
    fontWeight: "900",
  },
  gamifyTitle: {
    color: T.text,
    fontWeight: "800",
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  gamifySoft: {
    color: "#B8B8B8",
    fontWeight: "600",
  },

  catRow: {
    marginTop: 8,
    flexDirection: "row",
    alignSelf: "center",
    gap: 22,
    flexWrap: "wrap",
    justifyContent: "center",
  },
  catTap: { alignItems: "center" },
  catText: {
    color: "#CFCFCF",
    fontFamily: FONT_OBLIVION,
    letterSpacing: 6.5,
    textTransform: "uppercase",
    fontSize: 13,
    fontWeight: Platform.OS === "android" ? ("300" as any) : "400",
  },
  catTextActive: { color: T.olive },
  catUnderline: {
    marginTop: 6,
    height: 3,
    width: 42,
    backgroundColor: T.olive,
    borderRadius: 2,
  },

  topExplainer: {
    fontSize: 14,
    color: "#E2E2E2",
    marginTop: 10,
    textAlign: "center",
    lineHeight: 20,
    paddingHorizontal: 8,
  },

  noticeCard: {
    marginTop: 12,
    backgroundColor: T.card2,
    borderWidth: 1,
    borderColor: "#ffffff14",
    borderRadius: 10,
    padding: 12,
  },
  noticeItem: { color: T.sub, fontSize: 13, marginBottom: 4 },
  noticeItemStrong: {
    color: T.sub,
    fontSize: 13,
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  noticeItemDanger: {
    color: "#FF6B6B",
    fontSize: 13,
    marginTop: 6,
    fontWeight: "800",
  },
  boldCaps: {
    fontWeight: "900",
    color: T.text,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  rulesLink: {
    color: "#ffffff",
    textDecorationLine: "underline",
    marginTop: 10,
    alignSelf: "center",
    fontWeight: "800",
    letterSpacing: 0.3,
  },

  agreeRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: 10,
    paddingVertical: 14,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderWidth: 2,
    borderColor: T.olive,
    borderRadius: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  checkboxChecked: { backgroundColor: T.olive, borderColor: T.olive },
  checkGlyph: { color: "#000", fontWeight: "800", lineHeight: 18 },
  agreeText: {
    fontSize: 13,
    color: T.sub,
    fontWeight: "800",
    letterSpacing: 0.2,
  },

  form: { padding: 16, gap: 6 },
  label: {
    fontSize: 11,
    color: T.text,
    marginTop: 10,
    marginBottom: 4,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  input: {
    backgroundColor: "#121212",
    borderWidth: 1,
    borderColor: "#262626",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
    color: T.text,
    // @ts-ignore
    outlineStyle: "none",
  },
  helperText: { fontSize: 12, color: T.mute, marginTop: 4 },

  pickBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: T.accent,
    backgroundColor: "transparent",
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 10,
    marginBottom: 12,
  },
  pickBtnText: {
    fontWeight: "900",
    color: T.text,
    fontSize: 13,
    letterSpacing: 2,
  },

  statusRow: {
    marginTop: 6,
    marginBottom: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "center",
  },
  statusText: {
    fontSize: 12,
    color: T.sub,
    textAlign: "center",
    fontWeight: "900",
    letterSpacing: 0.3,
  },

  progressWrap: { marginBottom: 12, marginTop: 6 },
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
    backgroundColor: T.accent,
    borderRadius: 999,
  },
  progressLabels: {
    marginTop: 6,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  progressText: {
    fontSize: 12,
    color: T.text,
    fontWeight: "900",
    letterSpacing: 0.3,
  },
  progressEta: { fontSize: 12, color: T.mute },

  submitBtn: {
    width: "100%",
    borderRadius: 8,
    backgroundColor: T.accent,
    borderWidth: 1,
    borderColor: T.accent,
    paddingVertical: 12,
    alignItems: "center",
    marginTop: 6,
  },
  submitText: {
    fontWeight: "900",
    fontSize: 15,
    color: "#000",
    letterSpacing: 2,
    textTransform: "uppercase",
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalContent: {
    backgroundColor: T.card,
    borderRadius: 12,
    padding: 18,
    width: "100%",
    maxWidth: 560,
    maxHeight: "80%",
    borderWidth: 1,
    borderColor: "#ffffff14",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "900",
    marginBottom: 10,
    color: T.text,
    letterSpacing: 2.2,
  },
  modalText: {
    fontSize: 14,
    marginBottom: 10,
    color: T.sub,
    lineHeight: 20,
  },
  modalClose: {
    backgroundColor: T.accent,
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 8,
    borderWidth: 1,
    borderColor: T.accent,
  },
  modalCloseText: {
    color: "#000",
    fontWeight: "900",
    letterSpacing: 1.5,
  },

  // @ts-ignore
  noOutline: { outlineStyle: "none" },
});
