// Config IPC calls

import { invoke } from "./invoke.js";
import type { Theme } from "../theme/loader.js";
import type { ParsedRc } from "./types.js";

export type { ParsedRc };

export interface CustomThemeEntry {
  name: string;
  path: string;
}

/**
 * Load a theme from a file path on disk.
 * The Rust backend parses the TOML leniently — only valid TOML syntax is
 * required; any subset of Theme fields is accepted. Missing fields simply
 * fall back to the CSS defaults in vars.css.
 * Matches the Rust `load_theme` command.
 */
export async function loadTheme(themePath: string): Promise<Theme> {
  return invoke<Theme>("load_theme", { themePath });
}

/**
 * Scan ~/.config/quark/themes/ for *.toml files and return name/path pairs.
 * Matches the Rust `list_custom_themes` command.
 */
export async function listCustomThemes(): Promise<CustomThemeEntry[]> {
  return invoke<CustomThemeEntry[]>("list_custom_themes");
}

/**
 * Parse the contents of a quarkrc file.
 * Matches the Rust `parse_quarkrc` command.
 */
export async function parseQuarkrc(content: string): Promise<ParsedRc> {
  return invoke<ParsedRc>("parse_quarkrc", { content });
}

/**
 * Load and parse the user's quarkrc from the XDG config dir.
 * Returns an empty ParsedRc if the file does not exist.
 * Matches the Rust `load_quarkrc` command.
 */
export async function loadQuarkrc(): Promise<ParsedRc> {
  return invoke<ParsedRc>("load_quarkrc");
}
