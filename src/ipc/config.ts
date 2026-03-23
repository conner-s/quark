// Config IPC calls

import { invoke } from "@tauri-apps/api/core";
import type { Theme } from "../theme/loader.js";
import type { ParsedRc } from "./types.js";

export type { ParsedRc };

/**
 * Load and validate a theme from a file path on disk.
 * Matches the Rust `load_theme` command.
 */
export async function loadTheme(themePath: string): Promise<Theme> {
  return invoke<Theme>("load_theme", { themePath });
}

/**
 * Parse the contents of a quarkrc file.
 * Matches the Rust `parse_quarkrc` command.
 */
export async function parseQuarkrc(content: string): Promise<ParsedRc> {
  return invoke<ParsedRc>("parse_quarkrc", { content });
}
