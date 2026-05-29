// Media actions: pasting/picking files, the message hover-action event
// handlers (react/reply/thread/profile/file/video), and file saving.

import { AppState } from "../state.js";

import {
  downloadMedia,
  saveMediaToPath,
  getDefaultSaveDir,
  openMediaExternally,
  sendPastedImage,
  sendFile,
  sendVideo,
} from "../../ipc/index.js";

import { showProgressToast, showError, showSuccess } from "../../ui/NotificationToast.js";
import { promptSaveFilePath } from "../../ui/SaveFileDialog.js";

import { getComponents } from "./context.js";
import { openQuickReactPicker } from "./reactions.js";
import { startReply } from "./messages.js";
import { openThread } from "./threads.js";
import { openProfileForUser } from "./profile.js";

/**
 * Handle a pasted image from the clipboard.
 * Uploads to the homeserver and sends as an m.image event.
 */
export async function handleImagePaste(blob: Blob): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  try {
    // Convert blob to base64
    const arrayBuffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const dataBase64 = btoa(binary);

    const ext = blob.type.split("/")[1] ?? "png";
    const filename = `pasted-image-${Date.now()}.${ext}`;

    const progress = showProgressToast("Uploading image…");
    try {
      await sendPastedImage(roomId, dataBase64, blob.type, filename);
      progress.succeed("Image sent");
    } catch (err) {
      progress.fail(`Failed to send image: ${err instanceof Error ? err.message : String(err)}`);
    }
  } catch (err) {
    showError(`Failed to send image: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Handle a file selected from the file picker.
 * Images are sent as m.image; everything else as m.file.
 */
export async function handleFilePick(file: File): Promise<void> {
  const roomId = AppState.get("currentRoomId");
  if (!roomId) return;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const dataBase64 = btoa(binary);

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    const noun = isImage ? "image" : isVideo ? "video" : "file";
    const progress = showProgressToast(`Uploading ${isImage ? "image" : file.name}…`);
    try {
      if (isImage) {
        await sendPastedImage(roomId, dataBase64, file.type, file.name);
      } else if (isVideo) {
        // Send as m.video (not m.file) so it renders as a playable embed. Probe
        // dimensions/duration up front so the timeline can reserve the right
        // aspect ratio before the video is downloaded.
        const meta = await probeVideoMetadata(file);
        await sendVideo(
          roomId,
          dataBase64,
          file.type,
          file.name,
          meta?.width,
          meta?.height,
          meta?.durationMs,
          file.size,
        );
      } else {
        await sendFile(roomId, dataBase64, file.type || "application/octet-stream", file.name, file.size);
      }
      progress.succeed(`${noun.charAt(0).toUpperCase()}${noun.slice(1)} sent`);
    } catch (err) {
      progress.fail(`Failed to send ${noun}: ${err instanceof Error ? err.message : String(err)}`);
    }
  } catch (err) {
    showError(`Failed to send file: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Wire the hover action bar buttons (react / reply) that bubble custom events
 * from message elements. Must be called once after components are set.
 */
export function setupMessageActionHandlers(): void {
  document.addEventListener("quark:msg-react" as keyof DocumentEventMap, (e: Event) => {
    const { eventId } = (e as CustomEvent<{ eventId: string }>).detail;
    if (eventId) openQuickReactPicker(eventId);
  });

  document.addEventListener("quark:msg-reply" as keyof DocumentEventMap, (e: Event) => {
    const { eventId } = (e as CustomEvent<{ eventId: string }>).detail;
    if (!eventId) return;
    const events = AppState.get("currentTimeline");
    const evt = events.find((ev) => ev.event_id === eventId);
    if (evt) {
      const { input } = getComponents();
      startReply(eventId, evt.sender, evt.body.slice(0, 80));
      input.focus();
    }
  });

  document.addEventListener("quark:open-thread" as keyof DocumentEventMap, (e: Event) => {
    const { eventId } = (e as CustomEvent<{ eventId: string }>).detail;
    if (eventId) void openThread(eventId);
  });

  document.addEventListener("quark:open-profile" as keyof DocumentEventMap, (e: Event) => {
    const { userId } = (e as CustomEvent<{ userId: string }>).detail;
    if (!userId) return;
    void openProfileForUser(userId);
  });

  document.addEventListener("quark:open-file" as keyof DocumentEventMap, (e: Event) => {
    const { mxcUrl, filename, encryptionInfo } =
      (e as CustomEvent<{ mxcUrl?: string; filename?: string; encryptionInfo?: string }>).detail;
    if (!mxcUrl) return;
    void saveFileWithDialog(mxcUrl, filename, encryptionInfo).catch((err) => {
      console.error("[file] save failed:", err);
      showError(`Failed to save file: ${err instanceof Error ? err.message : String(err)}`);
    });
  });

  document.addEventListener("quark:open-video" as keyof DocumentEventMap, (e: Event) => {
    const { mxcUrl, filename, mimeType, encryptionInfo } =
      (e as CustomEvent<{ mxcUrl?: string; filename?: string; mimeType?: string; encryptionInfo?: string }>).detail;
    if (!mxcUrl) return;

    // Determine the message element so we can call showInlineVideo later.
    const target = e.target as HTMLElement | null;
    const msgEl = target?.closest<HTMLElement>("[data-message-id]");
    const eventId = msgEl?.dataset.messageId;

    // canPlayType on a detached video element is safe — it only queries codec
    // support, never initialises the GStreamer pipeline.
    const testVideo = document.createElement("video");
    const canPlay = mimeType
      ? testVideo.canPlayType(mimeType) !== ""
      : testVideo.canPlayType("video/mp4") !== "" || testVideo.canPlayType("video/webm") !== "";

    // Mark the affordance as loading so CSS can show a progress animation.
    const affordanceEl = (e.target as HTMLElement | null)?.closest<HTMLElement>(".message__video-affordance");
    affordanceEl?.classList.add("message__video-affordance--loading");
    const stopLoading = () => affordanceEl?.classList.remove("message__video-affordance--loading");

    if (canPlay && eventId) {
      // Download and play inline
      const { timeline } = getComponents();
      void downloadMedia(mxcUrl, encryptionInfo).then((dl) => {
        stopLoading();
        const dataUrl = `data:${dl.mime_type};base64,${dl.data_base64}`;
        timeline.showInlineVideo(eventId, dataUrl, dl.mime_type);
      }).catch((err) => {
        stopLoading();
        console.error("[video] inline playback download failed:", err);
        // Fall through to external player
        void _openVideoExternally(mxcUrl, encryptionInfo, filename);
      });
    } else {
      void _openVideoExternally(mxcUrl, encryptionInfo, filename).finally(stopLoading);
    }
  });
}

/**
 * Probe a video file's intrinsic dimensions and duration via a detached
 * <video> element. Best-effort: resolves to undefined if metadata can't be
 * read (unsupported codec, etc.) so the send still goes through without info.
 */
function probeVideoMetadata(
  file: File,
): Promise<{ width: number; height: number; durationMs: number } | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    let settled = false;
    const finish = (result: { width: number; height: number; durationMs: number } | undefined) => {
      if (settled) return;
      settled = true;
      URL.revokeObjectURL(url);
      resolve(result);
    };
    video.onloadedmetadata = () => {
      const durationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : 0;
      finish({ width: video.videoWidth, height: video.videoHeight, durationMs });
    };
    video.onerror = () => finish(undefined);
    // Guard against metadata that never fires (e.g. codec the webview can't parse).
    setTimeout(() => finish(undefined), 3000);
    video.src = url;
  });
}

async function _openVideoExternally(mxcUrl: string, encryptionInfo?: string, filename?: string): Promise<void> {
  try {
    await openMediaExternally(mxcUrl, encryptionInfo, filename);
  } catch (err) {
    showError(`Failed to open video: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Prompt the user for a save destination via the in-app save modal, then
 * download the file from the homeserver and write it to the chosen path.
 *
 * Uses an HTML modal rather than a native picker because rfd/xdg-portal
 * crashes on some Linux setups with "No GSettings schemas are installed".
 */
async function saveFileWithDialog(
  mxcUrl: string,
  filename?: string,
  encryptionInfo?: string,
): Promise<void> {
  // Resolve the default downloads dir up front (failures fall back to "~/").
  let defaultDir = "~/Downloads";
  try {
    defaultDir = await getDefaultSaveDir();
  } catch {
    /* keep fallback */
  }

  const dest = await promptSaveFilePath({
    suggestedFilename: filename,
    defaultDir,
  });
  if (!dest) return; // user cancelled

  const writtenPath = await saveMediaToPath(mxcUrl, dest, encryptionInfo);
  showSuccess(`Saved to ${writtenPath}`);
}
