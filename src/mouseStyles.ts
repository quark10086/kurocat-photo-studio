// Randomized mouse shells. Every cat gets its own deterministic shell, and the
// user can re-roll it from the settings panel without touching the cat itself.
export interface MouseStyle {
  id: string;
  name: string;
  emoji: string;
  /** Body tint multiplied onto the procedural dome (3D) and used as the 2D shell. */
  tint: string;
  /** Rubber skirt / rim under the shell. */
  skirt: string;
  /** Wheel + seam accent. */
  accent: string;
}

export const MOUSE_STYLES: MouseStyle[] = [
  { id: 'classic', name: '经典白', emoji: '🖱️', tint: '#f4f4f0', skirt: '#c8cac4', accent: '#8e9099' },
  { id: 'obsidian', name: '曜石黑', emoji: '⚫', tint: '#2b2d34', skirt: '#1b1c21', accent: '#6f7480' },
  { id: 'sakura', name: '樱花粉', emoji: '🌸', tint: '#f6c9d6', skirt: '#d99cb0', accent: '#b9708c' },
  { id: 'mint', name: '薄荷绿', emoji: '🌿', tint: '#bfe8d2', skirt: '#8cc4ad', accent: '#5f9b83' },
  { id: 'violet', name: '电光紫', emoji: '💜', tint: '#c3b6f2', skirt: '#8f83c4', accent: '#6d5fa8' },
  { id: 'latte', name: '奶茶棕', emoji: '☕', tint: '#dcc3a2', skirt: '#b99b74', accent: '#8d7455' },
  { id: 'glacier', name: '冰川蓝', emoji: '🧊', tint: '#c6e2f2', skirt: '#93bdd4', accent: '#6797b0' },
  { id: 'ember', name: '余烬橙', emoji: '🔥', tint: '#f7c9a6', skirt: '#d29e74', accent: '#a8764d' },
];

/** Stable string hash (FNV-1a) so the same cat + seed always yields the same shell. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mouseStyleFor(catId: string, seed: number): MouseStyle {
  const index = hashString(`${catId}:${Math.trunc(seed) || 0}`) % MOUSE_STYLES.length;
  return MOUSE_STYLES[index];
}

function parseHex(hex: string): [number, number, number] {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const num = Number.parseInt(full, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function toHex(rgb: [number, number, number]): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${[clamp(rgb[0]), clamp(rgb[1]), clamp(rgb[2])]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** Linear mix of two hex colors; `t = 0` keeps `a`, `t = 1` yields `b`. */
export function mixHex(a: string, b: string, t: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  const k = Math.max(0, Math.min(1, t));
  return toHex([
    ca[0] + (cb[0] - ca[0]) * k,
    ca[1] + (cb[1] - ca[1]) * k,
    ca[2] + (cb[2] - ca[2]) * k,
  ]);
}

export function lightenHex(hex: string, amount: number): string {
  return mixHex(hex, '#ffffff', amount);
}

export function darkenHex(hex: string, amount: number): string {
  return mixHex(hex, '#000000', amount);
}
