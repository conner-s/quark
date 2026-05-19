// Media IPC calls

import { invoke } from "./invoke.js";
import type { MediaDownload, UrlPreview } from "./types.js";

export type { MediaDownload, UrlPreview };

// ─── Cache Stats ─────────────────────────────────────────────────────────────

export interface CacheStats {
  total_size_bytes: number;
  entry_count: number;
  max_size_bytes: number;
  usage_percent: number;
}

/** Get media cache statistics. */
export async function getCacheStats(): Promise<CacheStats> {
  return invoke<CacheStats>("get_cache_stats");
}

/** Clear all entries from the media cache. */
export async function clearMediaCache(): Promise<void> {
  return invoke<void>("clear_media_cache");
}

/** Set the maximum media cache size in megabytes. */
export async function setCacheSizeLimit(limitMb: number): Promise<void> {
  return invoke<void>("set_cache_size_limit", { sizeMb: limitMb });
}

/**
 * Download media from an mxc:// URL.
 * Returns a MediaDownload containing base64-encoded content and MIME type.
 * Pass `encryptionInfo` (JSON-serialized EncryptedFile) for E2EE media so the
 * backend can decrypt the content before returning it.
 * Matches the Rust `download_media` command.
 */
export async function downloadMedia(mxcUrl: string, encryptionInfo?: string | null): Promise<MediaDownload> {
  return invoke<MediaDownload>("download_media", {
    mxcUrl,
    thumbnail: false,
    thumbnailWidth: null,
    thumbnailHeight: null,
    encryptionInfo: encryptionInfo ?? null,
  });
}

/**
 * Download a thumbnail for an mxc:// URL.
 * Returns a MediaDownload with the thumbnail's base64 content.
 * Matches the Rust `download_media` command with thumbnail=true.
 */
export async function getThumbnail(
  mxcUrl: string,
  width: number,
  height: number,
): Promise<MediaDownload> {
  return invoke<MediaDownload>("download_media", {
    mxcUrl,
    thumbnail: true,
    thumbnailWidth: width,
    thumbnailHeight: height,
  });
}

/**
 * Upload a file from disk and return its mxc:// URL.
 * Matches the Rust `upload_media` command.
 */
export async function uploadMedia(filePath: string): Promise<string> {
  return invoke<string>("upload_media", { filePath });
}

/**
 * Upload base64-encoded file bytes and send as an m.file event.
 * Used for the file picker attach flow.
 */
export async function sendFile(
  roomId: string,
  dataBase64: string,
  mimeType: string,
  filename: string,
  fileSize?: number,
): Promise<string> {
  return invoke<string>("send_file", { roomId, dataBase64, mimeType, filename, fileSize: fileSize ?? null });
}

/**
 * Download media to a temp file on disk and return the absolute path.
 */
export async function saveMediaToTemp(
  mxcUrl: string,
  encryptionInfo?: string | null,
  filename?: string | null,
): Promise<string> {
  return invoke<string>("save_media_to_temp", {
    mxcUrl,
    encryptionInfo: encryptionInfo ?? null,
    filename: filename ?? null,
  });
}

/**
 * Download media from the homeserver and write it to a caller-supplied path.
 * The frontend should first prompt the user for a destination via the dialog
 * plugin's save() call; this command just performs the download + write.
 */
export async function saveMediaToPath(
  mxcUrl: string,
  destPath: string,
  encryptionInfo?: string | null,
): Promise<string> {
  return invoke<string>("save_media_to_path", {
    mxcUrl,
    destPath,
    encryptionInfo: encryptionInfo ?? null,
  });
}

/**
 * Download a video/audio file and open it in the system's default media player
 * (xdg-open on Linux, open on macOS). Uses a direct process spawn rather than
 * plugin:shell|open, which only handles http/https URLs in Tauri's scope.
 */
export async function openMediaExternally(
  mxcUrl: string,
  encryptionInfo?: string | null,
  filename?: string | null,
): Promise<void> {
  return invoke<void>("open_media_externally", {
    mxcUrl,
    encryptionInfo: encryptionInfo ?? null,
    filename: filename ?? null,
  });
}

/**
 * Upload base64-encoded image bytes and send as an m.image event.
 * Used for clipboard paste.
 */
export async function sendPastedImage(
  roomId: string,
  dataBase64: string,
  mimeType: string,
  filename: string,
): Promise<string> {
  return invoke<string>("send_pasted_image", { roomId, dataBase64, mimeType, filename });
}

// ─── URL Preview ─────────────────────────────────────────────────────────────

/**
 * Fetch OpenGraph-like metadata for a URL from the homeserver preview API.
 * Returns null if the homeserver returns no preview data.
 */
export async function getUrlPreview(url: string): Promise<UrlPreview | null> {
  return invoke<UrlPreview | null>("get_url_preview", { url });
}
