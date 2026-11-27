/**
 * Photo → CatSkinConfig (local heuristic analysis).
 *
 * Everything here runs in the webview with the Canvas 2D API only: no extra
 * Rust crates, no upload, no cloud vision API. The goal is a *first draft* of
 * the ~40 cat skin parameters; the user then fine-tunes the 8 key knobs in the
 * Cat Studio panel, and an AI agent can refine the rest through MCP.
 */
import type {
  CatEarShape,
  CatFaceShape,
  CatPattern,
  CatSkinConfig,
  CatSpot,
} from './catSkins';
import { matchBreeds, type BreedFeatures, type BreedMatch } from './catBreeds';

export interface PhotoPaletteEntry {
  hex: string;
  weight: number;
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
  /** Share of this colour that sat in the outer border band (background hint). */
  ringShare: number;
}

/** Dominant colour of a body part, or null when the photo cannot show it. */
export interface PhotoRegionColors {
  head: string | null;
  body: string | null;
  belly: string | null;
  limbs: string | null;
  tail: string | null;
}

export interface PhotoAnalysis {
  palette: PhotoPaletteEntry[];
  /** Per-part colours, used to fill the advanced colour panel. */
  regions: PhotoRegionColors;
  /** Best matching breed profiles, highest score first. */
  breeds: BreedMatch[];
  furColor: string;
  bellyBibColor: string | null;
  stripeColor: string | null;
  calicoPatchColor: string | null;
  maskColor: string | null;
  eyeColor: string;
  noseColor: string | null;
  pattern: CatPattern;
  faceShape: CatFaceShape;
  earShape: CatEarShape;
  bodyChubbiness: number;
  isDarkBase: boolean;
  /** 0..1 — how confident the heuristics are, purely advisory for the UI copy. */
  confidence: number;
  /** Small thumbnail of the *source photo* for side-by-side comparison. */
  thumbDataUrl: string;
}

const MAX_ANALYSIS_SIDE = 168;

/**
 * Split the subject into rough body bands and report the dominant cluster of
 * each one. A mean colour would smear a tabby's stripes into mud, so every band
 * votes for an existing palette cluster instead.
 */
function sampleRegions(
  width: number,
  samples: Sample[],
  clusters: Cluster[],
  stats: { minX: number; maxX: number; minY: number; maxY: number },
): PhotoRegionColors {
  const bboxW = Math.max(1, stats.maxX - stats.minX + 1);
  const bboxH = Math.max(1, stats.maxY - stats.minY + 1);
  const cx = stats.minX + bboxW / 2;
  const minVotes = Math.max(20, Math.round(samples.length * 0.008));

  const votes = new Int32Array(clusters.length);
  const nearest = (r: number, g: number, b: number): number => {
    let best = 0;
    let bestD = Infinity;
    for (let c = 0; c < clusters.length; c += 1) {
      const cl = clusters[c];
      const d = Math.abs(cl.r - r) + Math.abs(cl.g - g) + Math.abs(cl.b - b);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  };

  const sampleRegion = (
    test: (x: number, y: number) => boolean,
  ): string | null => {
    votes.fill(0);
    let n = 0;
    for (const s of samples) {
      const x = s.idx % width;
      const y = (s.idx - x) / width;
      if (!test(x, y)) continue;
      votes[nearest(s.r, s.g, s.b)] += 1;
      n += 1;
    }
    if (n < minVotes) return null;
    let best = -1;
    for (let c = 0; c < clusters.length; c += 1) {
      if (best < 0 || votes[c] > votes[best]) best = c;
    }
    if (best < 0 || votes[best] / n < 0.34) return null;
    const cl = clusters[best];
    return toHex(cl.r, cl.g, cl.b);
  };

  const headBand = stats.minY + bboxH * 0.36;
  const bodyBand = stats.minY + bboxH * 0.74;

  return {
    head: sampleRegion((_x, y) => y < headBand),
    body: sampleRegion((_x, y) => y >= headBand && y < bodyBand),
    belly: sampleRegion(
      (x, y) => y >= headBand && y < bodyBand && Math.abs(x - cx) < bboxW * 0.24,
    ),
    limbs: sampleRegion((_x, y) => y >= bodyBand),
    tail: sampleRegion((x) => x > stats.maxX - bboxW * 0.15),
  };
}

/* ---------------------------------------------------------------- colours */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function toHex(r: number, g: number, b: number): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [128, 128, 128];
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d < 1e-6) return { h: 0, s: 0, l };
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360 / 360;
  const ss = clamp01(s);
  const ll = clamp01(l);
  if (ss < 1e-6) {
    const v = ll * 255;
    return toHex(v, v, v);
  }
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const channel = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return toHex(channel(hh + 1 / 3) * 255, channel(hh) * 255, channel(hh - 1 / 3) * 255);
}

export function shiftLightness(hex: string, delta: number): string {
  const [r, g, b] = hexToRgb(hex);
  const { h, s, l } = rgbToHsl(r, g, b);
  return hslToHex(h, s, clamp01(l + delta));
}

export function withSaturation(hex: string, s: number): string {
  const [r, g, b] = hexToRgb(hex);
  const hsl = rgbToHsl(r, g, b);
  return hslToHex(hsl.h, s, hsl.l);
}

function hueDistance(a: Cluster, b: Cluster): number {
  // A near-grey colour has a meaningless hue: treat it as neutral so a grey cat
  // and its white bib still read as a two-tone pattern.
  if (a.s < 0.18 || b.s < 0.18) return 0;
  const d = Math.abs(a.h - b.h) % 360;
  return d > 180 ? 360 - d : d;
}

/* ------------------------------------------------------------------ image */

/**
 * Anything we can draw into a 2D canvas. WKWebView (macOS) only gained
 * `createImageBitmap(Blob)` in Safari 15, so the app may hand us an
 * HTMLImageElement instead — both are accepted here.
 */
export type PhotoSource = ImageBitmap | HTMLImageElement;

function sourceSize(source: PhotoSource): { width: number; height: number } {
  if (source instanceof HTMLImageElement) {
    return {
      width: source.naturalWidth || source.width,
      height: source.naturalHeight || source.height,
    };
  }
  return { width: source.width, height: source.height };
}

function drawScaled(
  source: PhotoSource,
  maxSide: number,
): { canvas: HTMLCanvasElement; width: number; height: number } {
  const src = sourceSize(source);
  const scale = Math.min(1, maxSide / Math.max(src.width, src.height));
  const width = Math.max(1, Math.round(src.width * scale));
  const height = Math.max(1, Math.round(src.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(source, 0, 0, width, height);
  return { canvas, width, height };
}

interface Sample {
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
  /** Pixel index inside the scaled analysis canvas (used to rebuild the mask). */
  idx: number;
  /** True for the outer border band — backgrounds live here, cats usually do not. */
  ring: boolean;
}

interface CornerEstimate {
  r: number;
  g: number;
  b: number;
  uniform: boolean;
}

function collectSamples(
  width: number,
  height: number,
  data: Uint8ClampedArray,
): { samples: Sample[]; corner: CornerEstimate } {
  // Background estimate from the four corners (a cat photo is usually framed
  // against a floor, sofa or wall that stays fairly flat near the edges).
  const patch = Math.max(2, Math.round(Math.min(width, height) * 0.08));
  const corners: Array<[number, number]> = [
    [0, 0],
    [width - patch, 0],
    [0, height - patch],
    [width - patch, height - patch],
  ];
  let cr = 0;
  let cg = 0;
  let cb = 0;
  let cn = 0;
  let spread = 0;
  for (const [cx, cy] of corners) {
    for (let y = cy; y < cy + patch; y += 1) {
      for (let x = cx; x < cx + patch; x += 1) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 200) continue;
        cr += data[i];
        cg += data[i + 1];
        cb += data[i + 2];
        cn += 1;
      }
    }
  }
  const bgR = cn ? cr / cn : 128;
  const bgG = cn ? cg / cn : 128;
  const bgB = cn ? cb / cn : 128;
  for (const [cx, cy] of corners) {
    for (let y = cy; y < cy + patch; y += 1) {
      for (let x = cx; x < cx + patch; x += 1) {
        const i = (y * width + x) * 4;
        if (data[i + 3] < 200) continue;
        spread +=
          Math.abs(data[i] - bgR) + Math.abs(data[i + 1] - bgG) + Math.abs(data[i + 2] - bgB);
      }
    }
  }
  const uniformBg = cn > 0 && spread / Math.max(1, cn * 3) < 26;

  // Keep every opaque pixel: the background is decided later by which colour
  // clusters actually live on the border, which survives busy backgrounds
  // (grass, wallpaper, rooms) far better than a flat corner threshold.
  const ringX = Math.max(1, Math.round(width * 0.15));
  const ringY = Math.max(1, Math.round(height * 0.15));
  const samples: Sample[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = y * width + x;
      const i = idx * 4;
      if (data[i + 3] < 200) continue;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const { h, s, l } = rgbToHsl(r, g, b);
      samples.push({
        r,
        g,
        b,
        h,
        s,
        l,
        idx,
        ring: x < ringX || x >= width - ringX || y < ringY || y >= height - ringY,
      });
    }
  }
  return { samples, corner: { r: bgR, g: bgG, b: bgB, uniform: uniformBg } };
}

/* ----------------------------------------------------------------- kmeans */

interface ColorPoint {
  r: number;
  g: number;
  b: number;
  h: number;
  s: number;
  l: number;
}

interface Cluster {
  r: number;
  g: number;
  b: number;
  weight: number;
  h: number;
  s: number;
  l: number;
  /** Share of this cluster's pixels that sit in the outer border band. */
  ringShare: number;
}

function kmeans(
  samples: Sample[],
  k: number,
  iterations = 14,
): { clusters: Cluster[]; assign: Int32Array } {
  const assign = new Int32Array(samples.length);
  if (samples.length === 0) return { clusters: [], assign };
  const kk = Math.max(1, Math.min(k, samples.length));
  // Deterministic seeding: farthest-point sampling starting from the brightest
  // sample (stable across runs, no Math.random).
  let brightest: ColorPoint = samples[0];
  for (const s of samples) {
    if (s.l > brightest.l) brightest = s;
  }
  const centers: ColorPoint[] = [brightest];
  while (centers.length < kk) {
    let best: ColorPoint | null = null;
    let bestDist = -1;
    for (const s of samples) {
      let min = Infinity;
      for (const c of centers) {
        const d = (s.r - c.r) ** 2 + (s.g - c.g) ** 2 + (s.b - c.b) ** 2;
        if (d < min) min = d;
      }
      if (min > bestDist) {
        bestDist = min;
        best = s;
      }
    }
    if (!best) break;
    centers.push(best);
  }

  let sums: Array<[number, number, number, number]> = [];
  for (let iter = 0; iter < iterations; iter += 1) {
    sums = centers.map(() => [0, 0, 0, 0] as [number, number, number, number]);
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i];
      let bi = 0;
      let bd = Infinity;
      for (let c = 0; c < centers.length; c += 1) {
        const ct = centers[c];
        const d = (s.r - ct.r) ** 2 + (s.g - ct.g) ** 2 + (s.b - ct.b) ** 2;
        if (d < bd) {
          bd = d;
          bi = c;
        }
      }
      assign[i] = bi;
      const acc = sums[bi];
      acc[0] += s.r;
      acc[1] += s.g;
      acc[2] += s.b;
      acc[3] += 1;
    }
    for (let c = 0; c < centers.length; c += 1) {
      const acc = sums[c];
      if (acc[3] === 0) continue;
      centers[c] = {
        r: acc[0] / acc[3],
        g: acc[1] / acc[3],
        b: acc[2] / acc[3],
        h: 0,
        s: 0,
        l: 0,
      };
    }
  }

  const ringCounts = new Array<number>(centers.length).fill(0);
  for (let i = 0; i < samples.length; i += 1) {
    if (samples[i].ring) ringCounts[assign[i]] += 1;
  }

  const clusters: Cluster[] = [];
  for (let c = 0; c < centers.length; c += 1) {
    const acc = sums[c];
    if (!acc || acc[3] === 0) continue;
    const r = acc[0] / acc[3];
    const g = acc[1] / acc[3];
    const b = acc[2] / acc[3];
    const { h, s, l } = rgbToHsl(r, g, b);
    clusters.push({
      r,
      g,
      b,
      weight: acc[3] / samples.length,
      h,
      s,
      l,
      ringShare: ringCounts[c] / acc[3],
    });
  }
  // Deliberately NOT re-sorted: the cluster index must stay aligned with
  // `assign` so the caller can rebuild a subject mask from the clusters it kept.
  return { clusters, assign };
}

/* -------------------------------------------------------------- heuristics */

function isNearWhite(c: Cluster): boolean {
  return c.l > 0.72 && c.s < 0.2;
}

function isOrange(c: Cluster): boolean {
  return c.h > 12 && c.h < 58 && c.s > 0.22 && c.l > 0.2;
}

function isDark(c: Cluster): boolean {
  return c.l < 0.34;
}

function pickEyeColor(samples: Sample[], isDarkBase: boolean, fur: Cluster): string {
  // Eyes are rare but vivid; rank by saturation × midtone-ness and average the
  // top sliver. Falls back to a sensible accent for dark / light cats.
  // A vivid orange cat is full of its own colour: skip samples that sit in the
  // fur's hue family, otherwise the eyes simply copy the coat.
  const furIsVivid = fur.s > 0.25;
  const vivid = (s: Sample): boolean => s.s > 0.42 && s.l > 0.16 && s.l < 0.78;
  const offFur = (s: Sample): boolean => {
    const d = Math.abs(s.h - fur.h) % 360;
    return (d > 180 ? 360 - d : d) > 30;
  };
  let pool = samples.filter(vivid);
  const distinct = pool.filter(offFur);
  if (furIsVivid && distinct.length >= 12) pool = distinct;
  const ranked = pool
    .map((s) => ({ s, score: s.s * (1 - Math.abs(s.l - 0.45)) }))
    .sort((a, b) => b.score - a.score);
  if (ranked.length < 12) return isDarkBase ? '#d4f044' : '#5a94d6';
  const take = Math.max(12, Math.round(ranked.length * 0.02));
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < take; i += 1) {
    r += ranked[i].s.r;
    g += ranked[i].s.g;
    b += ranked[i].s.b;
  }
  const hex = toHex(r / take, g / take, b / take);
  const { h, s, l } = rgbToHsl(r / take, g / take, b / take);
  // Keep eyes readable on the body colour: bump value if they are too dark.
  if (l < 0.32) return hslToHex(h, Math.max(0.55, s), 0.42);
  return hex;
}

function pickNoseColor(samples: Sample[]): string | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (const s of samples) {
    const pinkish = (s.h > 320 || s.h < 20) && s.s > 0.22 && s.l > 0.55 && s.l < 0.92;
    if (!pinkish) continue;
    r += s.r;
    g += s.g;
    b += s.b;
    n += 1;
  }
  if (n < samples.length * 0.002) return null;
  return toHex(r / n, g / n, b / n);
}

function maskStats(
  width: number,
  height: number,
  mask: Uint8Array,
): { minX: number; minY: number; maxX: number; maxY: number; area: number } {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let area = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      area += 1;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return { minX: 0, minY: 0, maxX: width - 1, maxY: height - 1, area };
  return { minX, minY, maxX, maxY, area };
}

function topBandWidth(width: number, mask: Uint8Array, yFrom: number, yTo: number): number {
  let minX = width;
  let maxX = -1;
  for (let y = yFrom; y <= yTo; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!mask[y * width + x]) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  return maxX < 0 ? 0 : maxX - minX + 1;
}

function buildSpots(
  pattern: CatPattern,
  patchColor: string | null,
  stripeColor: string | null,
): CatSpot[] {
  if (!patchColor && !stripeColor) return [];
  const color = (patchColor || stripeColor) as string;
  if (pattern === 'calico') {
    return [
      { part: 'head', x: -46, y: -34, rx: 26, ry: 20, rotation: -18, color, opacity: 0.92 },
      { part: 'body', x: 38, y: 26, rx: 34, ry: 30, rotation: 12, color, opacity: 0.85 },
      { part: 'body', x: -30, y: 52, rx: 22, ry: 18, rotation: -8, color, opacity: 0.8 },
    ];
  }
  if (pattern === 'tabby' && stripeColor) {
    return [
      { part: 'head', x: 0, y: -52, rx: 10, ry: 22, rotation: 0, color: stripeColor, opacity: 0.6 },
      { part: 'body', x: -14, y: 6, rx: 12, ry: 30, rotation: 6, color: stripeColor, opacity: 0.5 },
      { part: 'body', x: 20, y: 10, rx: 12, ry: 28, rotation: -6, color: stripeColor, opacity: 0.5 },
    ];
  }
  return [];
}

export function analyzePhoto(
  source: PhotoSource,
): { analysis: PhotoAnalysis; config: Omit<CatSkinConfig, 'id' | 'name'> } {
  const { canvas, width, height } = drawScaled(source, MAX_ANALYSIS_SIDE);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('canvas 2d context unavailable');
  const image = ctx.getImageData(0, 0, width, height);
  const { samples, corner } = collectSamples(width, height, image.data);
  if (samples.length === 0) throw new Error('photo appears to be empty');

  const { clusters: rawClusters, assign } = kmeans(samples, 6);

  // --- background removal ---------------------------------------------------
  // A colour that mostly lives on the border is the photo's background, no
  // matter how busy it is (grass, wallpaper, a room). Drop it before picking
  // fur and pattern colours, but never eat more than the clear majority of the
  // frame, so a cat that fills the picture still keeps its own colours.
  const bg = new Uint8Array(rawClusters.length);
  const byRingLikelihood = rawClusters
    .map((c, i) => ({ c, i, score: c.ringShare * c.weight }))
    .sort((a, b) => b.score - a.score);
  let removed = 0;
  let removedCount = 0;
  // Background clusters are the ones that mostly live on the border. A wide
  // photo (wall above, table below) can put two of them there, so allow up to
  // three removals but never eat the whole frame.
  for (const cand of byRingLikelihood) {
    if (removedCount >= 3) break;
    if (cand.c.ringShare < 0.42) break;
    if (cand.c.weight < 0.15) continue;
    if (1 - removed - cand.c.weight < 0.22) break;
    bg[cand.i] = 1;
    removed += cand.c.weight;
    removedCount += 1;
  }
  // A flat corner colour is an extra hint; use it when the ring rule missed.
  if (corner.uniform && rawClusters.length > 2) {
    let bestI = -1;
    let bestD = Infinity;
    for (let i = 0; i < rawClusters.length; i += 1) {
      if (bg[i]) continue;
      const c = rawClusters[i];
      const d =
        Math.abs(c.r - corner.r) + Math.abs(c.g - corner.g) + Math.abs(c.b - corner.b);
      if (d < bestD) {
        bestD = d;
        bestI = i;
      }
    }
    if (bestI >= 0 && bestD < 90 && 1 - removed - rawClusters[bestI].weight >= 0.22) {
      bg[bestI] = 1;
      removed += rawClusters[bestI].weight;
    }
  }

  const mask = new Uint8Array(width * height);
  let subjectSamples: Sample[] = [];
  let keptWeight = 0;
  for (let i = 0; i < samples.length; i += 1) {
    mask[samples[i].idx] = bg[assign[i]] ? 0 : 1;
  }
  for (let i = 0; i < samples.length; i += 1) {
    if (!bg[assign[i]]) subjectSamples.push(samples[i]);
  }
  let clusters: Cluster[] = [];
  for (let i = 0; i < rawClusters.length; i += 1) {
    if (bg[i]) continue;
    keptWeight += rawClusters[i].weight;
    clusters.push(rawClusters[i]);
  }
  // Nothing survived (or almost nothing): fall back to the whole frame.
  if (clusters.length < 2 || keptWeight < 0.18 || subjectSamples.length < samples.length * 0.12) {
    clusters = rawClusters.slice();
    subjectSamples = samples;
    mask.fill(0);
    for (const s of samples) mask[s.idx] = 1;
    keptWeight = 1;
  }
  clusters.sort((a, b) => b.weight - a.weight);
  clusters = clusters.map((c) => ({ ...c, weight: c.weight / (keptWeight || 1) }));

  const primary = clusters[0];
  const isDarkBase = primary.l < 0.48;

  const nearWhite = clusters.find((c) => isNearWhite(c) && c.weight > 0.06) || null;
  const darkCluster = clusters.find((c) => isDark(c) && c.weight > 0.06) || null;
  const orange = clusters.find((c) => isOrange(c) && c.weight > 0.07) || null;

  const stats = maskStats(width, height, mask);
  const bboxW = Math.max(1, stats.maxX - stats.minX + 1);
  const bboxH = Math.max(1, stats.maxY - stats.minY + 1);
  const fill = stats.area / (bboxW * bboxH);

  // --- pattern -------------------------------------------------------------
  let pattern: CatPattern = 'solid';
  let confidence = 0.55;
  const second = clusters[1] || null;
  const twoTone =
    second !== null &&
    second.weight > 0.16 &&
    Math.abs(second.l - primary.l) > 0.2 &&
    hueDistance(second, primary) < 55;

  if (orange && nearWhite && darkCluster && darkCluster.weight > 0.09) {
    pattern = 'calico';
    confidence = 0.62;
  } else if (twoTone) {
    const lightSide = primary.l > second.l ? primary : second;
    const darkSide = primary.l > second.l ? second : primary;
    pattern = isNearWhite(lightSide) && darkSide.l < 0.42 ? 'tuxedo' : 'bicolor';
    confidence = 0.6;
  } else if (
    primary.l > 0.7 &&
    darkCluster &&
    darkCluster.weight > 0.07 &&
    hueDistance(darkCluster, primary) > 8
  ) {
    pattern = 'siamese';
    confidence = 0.5;
  } else if (
    second !== null &&
    second.weight > 0.12 &&
    hueDistance(second, primary) < 30 &&
    second.l < primary.l - 0.06
  ) {
    pattern = 'tabby';
    confidence = 0.52;
  }

  // A clearly dark cluster next to a white patch is the classic tuxedo read,
  // even when the dark side is not the largest area of the photo.
  if (pattern !== 'calico' && pattern !== 'siamese' && nearWhite && darkCluster) {
    if (darkCluster.l < 0.3 && darkCluster.weight > 0.1) {
      pattern = 'tuxedo';
      confidence = Math.max(confidence, 0.6);
    }
  }

  let furCluster = pattern === 'tuxedo' && darkCluster ? darkCluster : primary;
  // A washed-out primary is usually a bright backdrop (white stairs, a sheet).
  // When a clearly darker colour of the same family covers enough of the frame,
  // that one is the cat.
  if (pattern !== 'tuxedo' && furCluster.l > 0.72) {
    const richer = clusters.find(
      (c) =>
        c !== furCluster &&
        c.l < 0.64 &&
        c.weight >= 0.08 &&
        Math.abs(c.h - furCluster.h) < 30,
    );
    if (richer) furCluster = richer;
  }
  const furColor = toHex(furCluster.r, furCluster.g, furCluster.b);
  const bellyBibColor = nearWhite ? toHex(nearWhite.r, nearWhite.g, nearWhite.b) : null;
  const stripeColor = pattern === 'tabby' ? shiftLightness(furColor, -0.14) : null;
  const calicoPatchColor = pattern === 'calico' && orange ? toHex(orange.r, orange.g, orange.b) : null;
  const maskColor = pattern === 'siamese' && darkCluster ? toHex(darkCluster.r, darkCluster.g, darkCluster.b) : null;

  const eyeColor = pickEyeColor(subjectSamples, isDarkBase, furCluster);
  const noseColor = isDarkBase ? null : pickNoseColor(subjectSamples);

  // --- silhouette ----------------------------------------------------------
  const aspect = bboxW / bboxH;
  const faceShape: CatFaceShape = aspect > 1.22 ? 'wide' : aspect < 0.88 ? 'oval' : 'round';
  const bandTop = stats.minY + Math.round(bboxH * 0.16);
  const bandWidth = topBandWidth(width, mask, stats.minY, Math.min(stats.maxY, bandTop));
  const earRatio = bandWidth / bboxW;
  const earShape: CatEarShape = earRatio < 0.5 ? 'tall' : earRatio > 0.86 ? 'round' : 'cat';
  const bodyChubbiness = Math.max(0.84, Math.min(1.2, 0.82 + (fill - 0.45) * 0.95));

  const palette: PhotoPaletteEntry[] = clusters.map((c) => ({
    hex: toHex(c.r, c.g, c.b),
    weight: Number(c.weight.toFixed(3)),
    ringShare: Number(c.ringShare.toFixed(3)),
    r: Math.round(c.r),
    g: Math.round(c.g),
    b: Math.round(c.b),
    h: Math.round(c.h),
    s: Number(c.s.toFixed(3)),
    l: Number(c.l.toFixed(3)),
  }));

  // --- per-part colours + breed hint ---------------------------------------
  const regions = sampleRegions(width, subjectSamples, clusters, stats);
  const [fr, fg, fb] = hexToRgb(furColor);
  const [er, eg, eb] = hexToRgb(eyeColor);
  const furHsl = rgbToHsl(fr, fg, fb);
  const eyeHsl = rgbToHsl(er, eg, eb);
  const features: BreedFeatures = {
    hue: furHsl.h,
    light: furHsl.l,
    sat: furHsl.s,
    pattern,
    faceShape,
    earShape,
    eyeHue: eyeHsl.h,
    eyeSat: eyeHsl.s,
    hasWhite: Boolean(nearWhite && nearWhite.weight > 0.05),
    hasDark: Boolean(darkCluster && darkCluster.weight > 0.07),
  };
  const breeds = matchBreeds(features, 3);

  const analysis: PhotoAnalysis = {
    palette,
    regions,
    breeds,
    furColor,
    bellyBibColor,
    stripeColor,
    calicoPatchColor,
    maskColor,
    eyeColor,
    noseColor,
    pattern,
    faceShape,
    earShape,
    bodyChubbiness: Number(bodyChubbiness.toFixed(3)),
    isDarkBase,
    confidence,
    thumbDataUrl: canvas.toDataURL('image/jpeg', 0.72),
  };

  const config: Omit<CatSkinConfig, 'id' | 'name'> = {
    furColor,
    pattern,
    bellyBibColor: bellyBibColor ?? undefined,
    stripeColor: stripeColor ?? undefined,
    calicoPatchColor: calicoPatchColor ?? undefined,
    maskColor: maskColor ?? undefined,
    eyeColorTop: eyeColor,
    eyeColorBottom: shiftLightness(eyeColor, 0.16),
    noseColor: noseColor ?? undefined,
    faceShape,
    earShape,
    bodyChubbiness: analysis.bodyChubbiness,
    eyeSquint: 0,
    spots: buildSpots(pattern, calicoPatchColor, stripeColor),
    accentColor: eyeColor,
    accentSideColor: shiftLightness(eyeColor, -0.18),
    // Per-part colours measured above; the advanced panel exposes them so the
    // user can nudge ears / limbs / tail away from the auto guess.
    earOuterColor: regions.head ?? undefined,
    earInnerColor: regions.belly ? shiftLightness(regions.belly, -0.05) : undefined,
    armColor: regions.limbs ?? undefined,
    pawColor: regions.limbs ? shiftLightness(regions.limbs, 0.1) : undefined,
    tailColor: regions.tail ?? undefined,
  };

  return { analysis, config };
}
