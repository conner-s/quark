// Pure query extraction for the compose-box autocompletes (emoji shortcodes
// and @mentions). Split out of keyboard.ts so this parsing — the bit most
// likely to drift on refactor — can be unit-tested without dragging in the
// keyboard module's IPC/DOM side-effects.

/**
 * Extract the active shortcode query from the input value.
 * Returns the query text (without the colon) if the cursor is in a `:query` span,
 * or null if no shortcode is being typed.
 */
export function extractShortcodeQuery(value: string): string | null {
  // Find the last unmatched colon
  const lastColon = value.lastIndexOf(":");
  if (lastColon < 0) return null;

  const query = value.slice(lastColon + 1);
  // Must have at least 1 character after the colon and no spaces
  if (query.length < 1 || /\s/.test(query)) return null;
  // Don't trigger if the colon is preceded by another colon (already closed like :foo:)
  // Check that this colon isn't the closing colon of a previous shortcode
  const beforeColon = value.slice(0, lastColon);
  const prevColon = beforeColon.lastIndexOf(":");
  if (prevColon >= 0) {
    const between = beforeColon.slice(prevColon + 1);
    // If the text between the two colons has no spaces, the last colon closes a shortcode
    if (between.length > 0 && !/\s/.test(between)) return null;
  }

  return query;
}

/**
 * Extract the active @mention query from the input value.
 * Returns the query text (without @) or null.
 */
export function extractMentionQuery(value: string): string | null {
  const lastAt = value.lastIndexOf("@");
  if (lastAt < 0) return null;
  // The character before @ must be a space or start of string
  if (lastAt > 0 && !/\s/.test(value[lastAt - 1])) return null;
  const query = value.slice(lastAt + 1);
  // Must have no spaces (a space ends the mention query)
  if (/\s/.test(query)) return null;
  return query;
}
