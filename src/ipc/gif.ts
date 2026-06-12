// GIF search IPC calls

import { invoke } from "./invoke.js";
import type { GifResult } from "./types.js";

export type { GifResult };

export type GifProvider = "tenor" | "giphy" | "klipy";

/**
 * Search for GIFs using the specified provider.
 * Matches the Rust `search_gifs` command.
 *
 * @param query   Search query string.
 * @param provider  "tenor" | "giphy" | "klipy" (defaults to "tenor").
 * @param apiKey  Provider API key.
 * @param limit   Max results (defaults to 20 in Rust).
 * @param rating  Content rating filter (defaults to "pg" in Rust).
 */
export async function searchGifs(
  query: string,
  provider: GifProvider = "tenor",
  apiKey: string,
  limit?: number,
  rating?: string,
): Promise<GifResult[]> {
  return invoke<GifResult[]>("search_gifs", {
    query,
    provider,
    apiKey,
    limit,
    rating,
  });
}

/**
 * Download a GIF from an external URL, upload it to the homeserver,
 * and send it as an m.image event in the given room.
 * Matches the Rust `send_gif` command.
 */
export async function sendGif(
  roomId: string,
  gifUrl: string,
  title: string,
  width: number,
  height: number,
): Promise<string> {
  return invoke<string>("send_gif", { roomId, gifUrl, title, width, height });
}
