import { Platform } from "react-native";
import * as FileSystem from "expo-file-system";
import { supabase } from "../lib/supabase";

/* Progress type */
export type UploadProgress = {
  loaded: number;
  total: number;
  etaSeconds?: number;
  phase?: string;
};

type Args = {
  title: string;
  word?: string;
  fileUri: string;              // REQUIRED
  webFile?: Blob | File | null; // pass the real File on web (from DocumentPicker)
  onProgress?: (p: UploadProgress) => void;
};

const step = (phase: string, onProgress?: (p: UploadProgress) => void) =>
  onProgress?.({ loaded: 0, total: 0, phase });

/** Optional native 1080p downscale (no-op on web) */
async function tryDownscaleTo1080pNative(inputUri: string): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { FFmpegKit, ReturnCode } = require("ffmpeg-kit-react-native");
    const out = inputUri.replace(/(\.\w+)?$/, "-1080p.mp4");
    const cmd =
      `-y -i "${inputUri}" ` +
      `-vf "scale='min(1920,iw)':'min(1080,ih)':force_original_aspect_ratio=decrease" ` +
      `-c:v libx264 -preset veryfast -crf 23 -c:a aac -movflags +faststart "${out}"`;
    const session = await FFmpegKit.run(cmd);
    const rc = await session.getReturnCode();
    if (!ReturnCode.isSuccess(rc)) return inputUri;
    return out;
  } catch {
    return inputUri;
  }
}

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
function makeEta(total: number) {
  let last = { t: Date.now(), sent: 0 };
  return (sent: number): number | undefined => {
    const now = Date.now();
    const dt = (now - last.t) / 1000;
    const ds = sent - last.sent;
    last = { t: now, sent };
    if (!total || dt <= 0 || ds <= 0) return;
    const rate = ds / dt;
    return Math.max(0, total - sent) / rate;
  };
}

/**
 * Upload using a **signed upload URL** (PUT). This works cleanly in Safari
 * when you send the actual File/Blob from the picker on web.
 */
export async function uploadFilm({
  title,
  word,
  fileUri,
  webFile,
  onProgress,
}: Args): Promise<{ videoId: string; storagePath: string }> {
  if (!fileUri) throw new Error("No video file selected.");

  // Must be logged in (RLS insert policy)
  const { data: sess, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) throw sessErr;
  if (!sess?.session?.access_token) throw new Error("You must be signed in to upload.");

  const bucket = "films";
  const videoId = makeId();
  const storagePath = `uploads/${videoId}/source.mp4`;

  // 1) Prepare (downscale native only)
  step("Preparing video…", onProgress);
  let toUploadUri = fileUri;
  if (Platform.OS !== "web") {
    step("Ensuring max 1080p…", onProgress);
    toUploadUri = await tryDownscaleTo1080pNative(fileUri);
  } else {
    step("Uploading original (web downscale not enabled)…", onProgress);
  }

  // 2) Get signed upload URL
  step("Requesting upload URL…", onProgress);
  const { data: signed, error: signedErr } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(storagePath);
  if (signedErr || !signed?.signedUrl) {
    throw new Error(signedErr?.message ?? "Failed to get upload URL.");
  }
  const signedUrl = signed.signedUrl;

  // Size for progress/ETA
  let total = 0;
  if (Platform.OS === "web") {
    if (webFile && typeof (webFile as any).size === "number") {
      total = (webFile as any).size as number;
    }
  } else {
    try {
      const info: any = await FileSystem.getInfoAsync(toUploadUri, { size: true });
      if (typeof info?.size === "number" && info.size > 0) total = info.size;
    } catch {}
  }
  const etaOf = makeEta(total);

  // 3) Upload to signed URL (PUT)
  step("Uploading…", onProgress);
  if (Platform.OS === "web") {
    // Use the picker File/Blob so Safari doesn’t choke on blob:file URIs
    const blobToSend =
      webFile instanceof Blob
        ? webFile
        : await fetch(toUploadUri).then((r) => r.blob());

    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();

      xhr.upload.onprogress = (evt) => {
        const expected = evt.lengthComputable ? evt.total : total;
        onProgress?.({
          loaded: evt.loaded,
          total: expected,
          etaSeconds: etaOf(evt.loaded),
          phase: "Uploading…",
        });
      };
      xhr.onerror = () => reject(new Error("Network error during upload."));
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 4) {
          // Signed PUT returns 200 on success
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            const body = xhr.responseText || "";
            reject(new Error(`Upload failed with status ${xhr.status}${body ? ` — ${body}` : ""}`));
          }
        }
      };

      xhr.open("PUT", signedUrl);
      // Set the file content type if available
      if ((blobToSend as any).type) {
        xhr.setRequestHeader("Content-Type", (blobToSend as any).type as string);
      } else {
        xhr.setRequestHeader("Content-Type", "video/mp4");
      }
      xhr.send(blobToSend);
    });
  } else {
    // Native: stream with UploadTask (PUT, binary)
    const uploadTask = FileSystem.createUploadTask(
      signedUrl,
      toUploadUri,
      {
        httpMethod: "PUT",
        headers: { "content-type": "video/mp4" },
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      },
      (evt) => {
        const loaded = evt.totalBytesSent ?? 0;
        const expected = evt.totalBytesExpectedToSend ?? total;
        onProgress?.({
          loaded,
          total: expected,
          etaSeconds: etaOf(loaded),
          phase: "Uploading…",
        });
      }
    );

    const result = await uploadTask.uploadAsync();
    if (!result || result.status < 200 || result.status >= 300) {
      const code = result ? result.status : "unknown";
      const body = result ? result.body : "";
      throw new Error(`Upload failed with status ${code}${body ? ` — ${body}` : ""}`);
    }
  }

  // 4) Done
  step("Finalizing…", onProgress);
  return { videoId, storagePath };
}
