import type { CatEarShape, CatFaceShape, CatPattern, CatSkinConfig } from './catSkins';

/**
 * Breed presets.
 *
 * The photo pipeline never guesses a breed from a neural net — it measures a
 * handful of numbers (base colour, pattern family, eye colour, silhouette) and
 * then scores them against these hand-written profiles. The score is only a
 * hint: the user can always pick a different preset or ignore all of them.
 */
export interface BreedPreset {
  id: string;
  /** zh-CN label; other locales fall back to this unless a translation exists. */
  name: string;
  emoji: string;
  pattern: CatPattern;
  faceShape: CatFaceShape;
  earShape: CatEarShape;
  /** Expected base fur hue in degrees, and how far off it may be. */
  hue: [number, number];
  /** Expected HSL lightness / saturation windows. */
  light: [number, number];
  sat: [number, number];
  /** Palette the preset uses when the photo cannot supply one. */
  furColor: string;
  eyeColor: string;
  bellyBibColor?: string;
  accentHint?: string;
  /** True for the blue-eyed pointed breeds (ragdoll / siamese). */
  blueEyes?: boolean;
  /** Filled in by the profile so switching presets keeps the photo's texture. */
  note: string;
}

function wrapHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

export function hueDelta(a: number, b: number): number {
  const d = Math.abs(wrapHue(a) - wrapHue(b));
  return d > 180 ? 360 - d : d;
}

export const BREED_PRESETS: readonly BreedPreset[] = [
  {
    id: 'tabby-cn',
    name: '中华田园猫（狸花）',
    emoji: '🐈',
    pattern: 'tabby',
    faceShape: 'round',
    earShape: 'cat',
    hue: [25, 45],
    light: [0.32, 0.6],
    sat: [0.12, 0.5],
    furColor: '#8f7a5f',
    eyeColor: '#c8d24a',
    note: '灰褐虎斑、额头 M 纹',
  },
  {
    id: 'orange',
    name: '橘猫',
    emoji: '🍊',
    pattern: 'tabby',
    faceShape: 'round',
    earShape: 'cat',
    hue: [20, 42],
    light: [0.45, 0.75],
    sat: [0.38, 0.9],
    furColor: '#e08a3c',
    eyeColor: '#d8c24a',
    note: '橙黄虎斑，越胖越像',
  },
  {
    id: 'tuxedo',
    name: '奶牛猫',
    emoji: '🐄',
    pattern: 'tuxedo',
    faceShape: 'round',
    earShape: 'cat',
    hue: [0, 360],
    light: [0.05, 0.4],
    sat: [0, 0.35],
    furColor: '#22242b',
    eyeColor: '#d4f044',
    bellyBibColor: '#f2f2ee',
    note: '黑底白胸白手套',
  },
  {
    id: 'calico',
    name: '三花猫',
    emoji: '🌸',
    pattern: 'calico',
    faceShape: 'round',
    earShape: 'cat',
    hue: [30, 70],
    light: [0.6, 0.92],
    sat: [0.03, 0.25],
    furColor: '#efeadf',
    eyeColor: '#d8c24a',
    bellyBibColor: '#fbf8f1',
    note: '白底橙黑斑块',
  },
  {
    id: 'british-blue',
    name: '英短蓝猫',
    emoji: '🩶',
    pattern: 'solid',
    faceShape: 'round',
    earShape: 'small',
    hue: [195, 240],
    light: [0.4, 0.66],
    sat: [0.04, 0.24],
    furColor: '#8a95a3',
    eyeColor: '#d8b04a',
    note: '全身蓝灰、圆脸小耳',
  },
  {
    id: 'silver-tabby',
    name: '美短银渐层',
    emoji: '🥈',
    pattern: 'tabby',
    faceShape: 'round',
    earShape: 'cat',
    hue: [190, 250],
    light: [0.62, 0.88],
    sat: [0.02, 0.18],
    furColor: '#cdd3d6',
    eyeColor: '#8fc7c8',
    note: '银白底深灰纹',
  },
  {
    id: 'ragdoll',
    name: '布偶猫',
    emoji: '🤍',
    pattern: 'bicolor',
    faceShape: 'wide',
    earShape: 'tall',
    hue: [20, 60],
    light: [0.82, 0.98],
    sat: [0.02, 0.16],
    furColor: '#f4ece1',
    eyeColor: '#5a94d6',
    bellyBibColor: '#fbf7f0',
    blueEyes: true,
    note: '奶白长毛 + 深色重点 + 蓝眼',
  },
  {
    id: 'siamese',
    name: '暹罗猫',
    emoji: '🧋',
    pattern: 'siamese',
    faceShape: 'oval',
    earShape: 'tall',
    hue: [25, 60],
    light: [0.78, 0.97],
    sat: [0.02, 0.2],
    furColor: '#f3e9d6',
    eyeColor: '#4f8fd0',
    bellyBibColor: '#f7efdf',
    blueEyes: true,
    note: '浅奶油身 + 黑脸黑耳',
  },
];

export interface BreedMatch {
  preset: BreedPreset;
  /** 0..1 */
  score: number;
}

export interface BreedFeatures {
  /** Base fur hue in degrees (0..360). */
  hue: number;
  /** Base fur HSL lightness 0..1. */
  light: number;
  /** Base fur HSL saturation 0..1. */
  sat: number;
  pattern: CatPattern;
  faceShape: CatFaceShape;
  earShape: CatEarShape;
  /** Eye colour hue + saturation, already resolved by the photo pipeline. */
  eyeHue: number;
  eyeSat: number;
  /** True when the photo shows a white patch big enough to matter. */
  hasWhite: boolean;
  /** True when the photo shows a dark patch big enough to matter. */
  hasDark: boolean;
}

const PATTERN_AFFINITY: Record<CatPattern, Partial<Record<CatPattern, number>>> = {
  solid: { solid: 1, tabby: 0.55, bicolor: 0.4, tuxedo: 0.25, calico: 0.1, siamese: 0.2 },
  tabby: { tabby: 1, solid: 0.45, bicolor: 0.3, tuxedo: 0.2, calico: 0.15, siamese: 0.3 },
  bicolor: { bicolor: 1, tuxedo: 0.6, solid: 0.35, calico: 0.3, tabby: 0.25, siamese: 0.2 },
  tuxedo: { tuxedo: 1, bicolor: 0.7, solid: 0.25, calico: 0.2, tabby: 0.15, siamese: 0.1 },
  calico: { calico: 1, bicolor: 0.55, tuxedo: 0.4, tabby: 0.25, solid: 0.15, siamese: 0.1 },
  siamese: { siamese: 1, bicolor: 0.4, solid: 0.25, tuxedo: 0.2, tabby: 0.15, calico: 0.05 },
};

function rangeScore(value: number, range: [number, number], span: number): number {
  const [lo, hi] = range;
  if (value >= lo && value <= hi) return 1;
  const dist = value < lo ? lo - value : value - hi;
  return Math.max(0, 1 - dist / span);
}

/**
 * Score every preset against the measured features and return the best three.
 * Deliberately cheap: a few dozen arithmetic operations, no table lookups into
 * anything the photo pipeline has not already computed.
 */
export function matchBreeds(features: BreedFeatures, limit = 3): BreedMatch[] {
  const matches: BreedMatch[] = [];
  for (const preset of BREED_PRESETS) {
    const affinity =
      PATTERN_AFFINITY[features.pattern]?.[preset.pattern] ??
      (features.pattern === preset.pattern ? 1 : 0.2);
    // Achromatic or near-black furs carry no usable hue information, so do not
    // punish a blue/grey preset for a photo of a black cat.
    const hueKnown = features.sat > 0.12;
    const hueScore = hueKnown ? 1 - Math.min(1, hueDelta(features.hue, preset.hue[0]) / 180) : 0.7;
    const inHueWindow = hueKnown
      ? rangeScore(wrapHue(features.hue), [preset.hue[0] - preset.hue[1], preset.hue[0] + preset.hue[1]], 70)
      : 0.6;
    const lightScore = rangeScore(features.light, preset.light, 0.3);
    const satScore = rangeScore(features.sat, preset.sat, 0.35);
    const shapeScore =
      (features.faceShape === preset.faceShape ? 1 : 0.55) * 0.5 +
      (features.earShape === preset.earShape ? 1 : 0.6) * 0.5;
    let eyeScore = 0.6;
    if (preset.blueEyes) {
      eyeScore = features.eyeSat > 0.35 && features.eyeHue > 170 && features.eyeHue < 260 ? 1 : 0.3;
    } else if (features.eyeSat > 0.3 && (features.eyeHue < 120 || features.eyeHue > 300)) {
      eyeScore = 0.85;
    }
    let patchScore = 0.6;
    if (preset.pattern === 'tuxedo') patchScore = features.hasWhite && features.hasDark ? 1 : 0.25;
    if (preset.pattern === 'calico') patchScore = features.hasWhite && features.hasDark ? 0.9 : 0.2;
    if (preset.pattern === 'siamese') patchScore = features.hasDark ? 0.8 : 0.3;

    const score =
      affinity * 0.34 +
      inHueWindow * 0.18 +
      hueScore * 0.06 +
      lightScore * 0.16 +
      satScore * 0.08 +
      shapeScore * 0.08 +
      eyeScore * 0.05 +
      patchScore * 0.05;

    matches.push({ preset, score: Math.max(0, Math.min(1, score)) });
  }
  matches.sort((a, b) => b.score - a.score || a.preset.id.localeCompare(b.preset.id));
  return matches.slice(0, limit);
}

/**
 * Apply a preset on top of an existing configuration: the preset dictates the
 * silhouette and pattern family, the photo keeps its measured colours unless
 * the preset knows better (a tuxedo's white bib, for example).
 */
export function applyBreedPreset(
  config: Omit<CatSkinConfig, 'id' | 'name'>,
  preset: BreedPreset,
): Omit<CatSkinConfig, 'id' | 'name'> {
  const next: Omit<CatSkinConfig, 'id' | 'name'> = {
    ...config,
    pattern: preset.pattern,
    faceShape: preset.faceShape,
    earShape: preset.earShape,
    eyeColorTop: preset.eyeColor,
    eyeColorBottom: preset.eyeColor,
  };
  if (preset.pattern === 'tuxedo') {
    next.furColor = preset.furColor;
    next.bellyBibColor = preset.bellyBibColor ?? '#f2f2ee';
    next.stripeColor = undefined;
    next.calicoPatchColor = undefined;
    next.maskColor = undefined;
  } else if (preset.pattern === 'calico') {
    next.furColor = preset.furColor;
    next.bellyBibColor = preset.bellyBibColor ?? '#fbf8f1';
    next.calicoPatchColor = next.calicoPatchColor ?? '#e0913c';
    next.stripeColor = undefined;
    next.maskColor = undefined;
  } else if (preset.pattern === 'siamese') {
    next.furColor = preset.furColor;
    next.maskColor = next.maskColor ?? '#463328';
    next.bellyBibColor = preset.bellyBibColor ?? '#f7efdf';
    next.stripeColor = undefined;
    next.calicoPatchColor = undefined;
  } else if (preset.pattern === 'solid') {
    next.furColor = preset.furColor;
    next.stripeColor = undefined;
    next.calicoPatchColor = undefined;
    next.maskColor = undefined;
  } else if (preset.pattern === 'tabby') {
    next.stripeColor = next.stripeColor ?? '#00000026';
  }
  return next;
}
