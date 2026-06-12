/**
 * Registry of blob/data URLs that contain animated images (GIF, WEBP).
 * Populated at download time in actions.ts so UI components can mark
 * `data-gif="1"` on the correct img elements without knowing the MIME type.
 */
const _animated = new Set<string>();

export function registerAnimatedUrl(url: string): void {
  _animated.add(url);
}

export function isAnimatedUrl(url: string): boolean {
  if (_animated.has(url)) return true;
  // data: URLs embed the MIME type directly
  return url.startsWith("data:image/gif;") || url.startsWith("data:image/webp;");
}
