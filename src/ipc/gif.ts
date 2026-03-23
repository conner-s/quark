// GIF search IPC calls

import { invoke } from "./invoke.js";
import type { GifResult } from "./types.js";

export type { GifResult };

export type GifProvider = "tenor" | "giphy";

/**
 * Search for GIFs using the specified provider.
 * Matches the Rust `search_gifs` command.
 *
 * @param query   Search query string.
 * @param provider  "tenor" | "giphy" (defaults to "tenor").
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
