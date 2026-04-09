// Shared avatar color palette — deterministic color assignment based on name hash
export const AVATAR_COLORS = [
  "#00ff41", "#00aaff", "#ff4466", "#ffaa00",
  "#aa44ff", "#00ffcc", "#ff6600", "#44ccff",
];

export function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffff;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
