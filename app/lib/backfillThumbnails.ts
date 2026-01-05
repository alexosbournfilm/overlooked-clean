import { Platform } from "react-native";
import { supabase } from "./supabase";
import * as FileSystem from "expo-file-system";
import * as VideoThumbnails from "expo-video-thumbnails";
import { Buffer } from "buffer";

/**
 * Web thumbnail capture (first decodable frame)
 * NOTE: This requires CORS to be allowed on the signed URL (Supabase usually is).
 */
async function captureFirstFrameWeb(videoSrc: string): Promise<string | null> {
  try {
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

    const draw = (): string | null => {
      const w = video.videoWidth || 0;
      const h = video.videoHeight || 0;
      if (!w || !h) return null;

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;

      const ctx = canvas.getContext("2d");
      if (!ctx) return null;

      ctx.drawImage(video, 0, 0, w, h);
      return canvas.toDataURL("image/jpeg", 0.82);
    };

    const dataUrl = await new Promise<string | null>((resolve) => {
      let done = false;

      const finish = (val: string | null) => {
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
    return dataUrl;
  } catch {
    return null;
  }
}

async function blobFromDataUrl(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

async function uploadThumbnailToStorage(opts: {
  thumbUri: string; // file:// (native) OR data:image/... (web)
  objectName: string; // path without extension
  bucket?: string;
}): Promise<{ publicUrl: string; path: string }> {
  const { thumbUri, objectName, bucket = "thumbnails" } = opts;

  let blob: Blob;

  if (Platform.OS !== "web" && thumbUri.startsWith("file://")) {
    const base64 = await FileSystem.readAsStringAsync(thumbUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const bytes = Buffer.from(base64, "base64");
    blob = new Blob([bytes], { type: "image/jpeg" });
  } else if (thumbUri.startsWith("data:image/")) {
    blob = await blobFromDataUrl(thumbUri);
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

async function makeSignedFilmUrl(videoPath: string): Promise<string> {
  // films bucket is assumed PRIVATE. We generate a signed URL for thumbnail extraction.
  const { data, error } = await supabase.storage
    .from("films")
    .createSignedUrl(videoPath, 60 * 60); // 1 hour

  if (error) throw error;
  if (!data?.signedUrl) throw new Error("No signed URL returned");
  return data.signedUrl;
}

async function generateThumbFromSignedUrl(signedUrl: string): Promise<string | null> {
  if (Platform.OS === "web") {
    // returns data:image/jpeg;base64,...
    return await captureFirstFrameWeb(signedUrl);
  }

  // Native: download to cache first (more reliable than remote thumbnail)
  const tmp = `${FileSystem.cacheDirectory}ov_${Date.now()}.mp4`;
  try {
    await FileSystem.downloadAsync(signedUrl, tmp);
    const t = await VideoThumbnails.getThumbnailAsync(tmp, { time: 120 });
    return t?.uri ?? null;
  } catch (e) {
    // fallback: try thumbnail directly from remote (sometimes works)
    try {
      const t = await VideoThumbnails.getThumbnailAsync(signedUrl, { time: 120 });
      return t?.uri ?? null;
    } catch {
      return null;
    }
  } finally {
    try {
      const info = await FileSystem.getInfoAsync(tmp);
      if (info.exists) await FileSystem.deleteAsync(tmp, { idempotent: true });
    } catch {}
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Backfill thumbnails for submissions that have no thumbnail_url.
 *
 * - Fetches submissions where thumbnail_url is null/empty
 * - Creates signed URL for film (films bucket)
 * - Generates a thumbnail frame (web/native)
 * - Uploads to thumbnails bucket
 * - Updates submissions.thumbnail_url
 */
export async function backfillMissingSubmissionThumbnails(opts?: {
  batchSize?: number;       // default 25
  delayMs?: number;         // default 250 (gentle on storage)
  dryRun?: boolean;         // default false
  onLog?: (line: string) => void;
}) {
  const batchSize = opts?.batchSize ?? 25;
  const delayMs = opts?.delayMs ?? 250;
  const dryRun = opts?.dryRun ?? false;
  const log = opts?.onLog ?? (() => {});

  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) throw new Error("Not signed in");

  log(`Starting backfill… batchSize=${batchSize} dryRun=${dryRun}`);

  // Pull rows missing thumbnail_url.
  // Adjust fields if your schema differs (video_path/storage_path).
  const { data: rows, error } = await supabase
    .from("submissions")
    .select("id, user_id, video_path, storage_path, mime_type, thumbnail_url, submitted_at")
    .or("thumbnail_url.is.null,thumbnail_url.eq.")
    .order("submitted_at", { ascending: true })
    .limit(batchSize);

  if (error) throw error;
  if (!rows || rows.length === 0) {
    log("No rows found needing thumbnails.");
    return { processed: 0, updated: 0, failed: 0 };
  }

  let updated = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const s: any = rows[i];
    const id = s.id;
    const path = (s.video_path || s.storage_path || "").trim();

    if (!path) {
      failed++;
      log(`❌ ${id}: no video_path/storage_path`);
      continue;
    }

    try {
      log(`(${i + 1}/${rows.length}) ${id}: signing url…`);
      const signed = await makeSignedFilmUrl(path);

      log(`(${i + 1}/${rows.length}) ${id}: generating thumbnail…`);
      const thumbUri = await generateThumbFromSignedUrl(signed);

      if (!thumbUri) {
        failed++;
        log(`❌ ${id}: failed to generate thumbnail`);
        continue;
      }

      const objectName = `submissions/${s.user_id}/${id}_backfill_${Date.now()}`;

      log(`(${i + 1}/${rows.length}) ${id}: uploading thumbnail…`);
      if (dryRun) {
        log(`🟡 DRY RUN: would upload to thumbnails/${objectName}…`);
      } else {
        const { publicUrl } = await uploadThumbnailToStorage({
          thumbUri,
          objectName,
          bucket: "thumbnails",
        });

        log(`(${i + 1}/${rows.length}) ${id}: updating DB…`);
        const { error: upErr } = await supabase
          .from("submissions")
          .update({ thumbnail_url: publicUrl })
          .eq("id", id);

        if (upErr) throw upErr;

        updated++;
        log(`✅ ${id}: done`);
      }
    } catch (e: any) {
      failed++;
      log(`❌ ${id}: ${e?.message ?? String(e)}`);
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  log(`Backfill complete. updated=${updated} failed=${failed}`);
  return { processed: rows.length, updated, failed };
}
