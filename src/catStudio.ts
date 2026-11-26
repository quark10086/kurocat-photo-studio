/**
 * Cat Studio — photo → editable cat skin.
 *
 * Flow: pick a photo → local heuristic analysis (see photoCat.ts) → user
 * fine-tunes the 8 key knobs with a live 2D preview → save + apply.
 * The same CatSkinConfig drives the 2D canvas engine and the 3D three.js engine,
 * so one save updates both render modes.
 */
import { invoke } from '@tauri-apps/api/core';
import { KuroCatEngine } from './catEngine';
import type {
  CatEarShape,
  CatFaceShape,
  CatPattern,
  CatSkinConfig,
  CatSpot,
} from './catSkins';
import { t } from './i18n';
import { analyzePhoto, shiftLightness, type PhotoAnalysis, type PhotoSource } from './photoCat';

const PATTERNS: CatPattern[] = ['solid', 'bicolor', 'tuxedo', 'tabby', 'calico', 'siamese'];
const FACE_SHAPES: CatFaceShape[] = ['round', 'square', 'wide', 'fox', 'oval'];
const EAR_SHAPES: CatEarShape[] = ['cat', 'round', 'tall', 'small', 'wide'];

export interface CatStudioHandlers {
  /** Called after a successful save with the refreshed cat list and the new id. */
  onSaved: (cats: CatSkinConfig[], id: string) => void;
}

export interface CatStudio {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

/** Required element: throws (caught by the caller) when the markup is missing. */
function must<T extends HTMLElement>(id: string): T {
  const node = el<T>(id);
  if (!node) throw new Error(`[cat-studio] missing #${id}`);
  return node;
}

function patternSpots(
  pattern: CatPattern,
  patchColor: string | null,
  stripeColor: string | null,
): CatSpot[] {
  const color = patchColor || stripeColor;
  if (!color) return [];
  if (pattern === 'calico') {
    return [
      { part: 'head', x: -46, y: -34, rx: 26, ry: 20, rotation: -18, color, opacity: 0.92 },
      { part: 'body', x: 38, y: 26, rx: 34, ry: 30, rotation: 12, color, opacity: 0.85 },
      { part: 'body', x: -30, y: 52, rx: 22, ry: 18, rotation: -8, color, opacity: 0.8 },
    ];
  }
  if (pattern === 'tabby' && stripeColor) {
    return [
      { part: 'head', x: 0, y: -52, rx: 10, ry: 22, rotation: 0, color: stripeColor, opacity: 0.55 },
      { part: 'body', x: -14, y: 6, rx: 12, ry: 30, rotation: 6, color: stripeColor, opacity: 0.45 },
      { part: 'body', x: 20, y: 10, rx: 12, ry: 28, rotation: -6, color: stripeColor, opacity: 0.45 },
    ];
  }
  return [];
}

export function initCatStudio(handlers: CatStudioHandlers): CatStudio {
  const root = must<HTMLDivElement>('cat-studio');
  const fileInput = must<HTMLInputElement>('studio-file');
  const canvas = must<HTMLCanvasElement>('studio-canvas');
  const sourceImg = el<HTMLImageElement>('studio-source');
  const confidenceEl = el<HTMLSpanElement>('studio-confidence');
  const nameInput = must<HTMLInputElement>('studio-name');
  const furInput = must<HTMLInputElement>('studio-fur');
  const bellyInput = must<HTMLInputElement>('studio-belly');
  const eyeInput = must<HTMLInputElement>('studio-eye');
  const patternSel = must<HTMLSelectElement>('studio-pattern');
  const faceSel = must<HTMLSelectElement>('studio-face');
  const earSel = must<HTMLSelectElement>('studio-ear');
  const chubbyInput = must<HTMLInputElement>('studio-chubby');
  const squintInput = must<HTMLInputElement>('studio-squint');
  const statusEl = el<HTMLDivElement>('studio-status');
  const saveBtn = el<HTMLButtonElement>('studio-save');
  const repickBtn = el<HTMLButtonElement>('studio-repick');
  const closeBtn = el<HTMLButtonElement>('studio-close');

  let engine: KuroCatEngine | null = null;
  let bitmap: PhotoSource | null = null;
  let sourceUrl: string | null = null;
  let analysis: PhotoAnalysis | null = null;
  let config: CatSkinConfig | null = null;
  let open = false;
  let saveBusy = false;

  function setStatus(text: string, kind: 'info' | 'error' | 'ok' = 'info'): void {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.dataset.kind = kind;
  }

  function ensureEngine(): KuroCatEngine | null {
    if (engine) return engine;
    try {
      engine = new KuroCatEngine(canvas as HTMLCanvasElement, { embedded: true });
      engine.setHeadphones(false);
      engine.setFpsCap(30);
      engine.start();
    } catch (err) {
      console.error('[cat-studio] engine init failed:', err);
      engine = null;
    }
    return engine;
  }

  function pushPreview(): void {
    if (!config) return;
    const eng = ensureEngine();
    if (!eng) return;
    eng.setCatAppearance(config.id, config);
    eng.resize();
  }

  function syncControlsFromConfig(): void {
    if (!config) return;
    nameInput.value = config.name;
    furInput.value = config.furColor;
    const belly = config.bellyBibColor || config.calicoPatchColor || config.furSecondaryColor || config.furColor;
    bellyInput.value = belly;
    eyeInput.value = config.eyeColorTop;
    patternSel.value = config.pattern || 'solid';
    faceSel.value = config.faceShape || 'round';
    earSel.value = config.earShape || 'cat';
    chubbyInput.value = String(Math.round((config.bodyChubbiness ?? 1) * 100));
    squintInput.value = String(Math.round((config.eyeSquint ?? 0) * 100));
  }

  function applyPatternLook(pattern: CatPattern): void {
    if (!config || !analysis) return;
    config.pattern = pattern;
    const fur = config.furColor;
    const base = analysis;
    if (pattern === 'tuxedo') {
      config.bellyBibColor = base.bellyBibColor || '#faf9f5';
      config.calicoPatchColor = undefined;
      config.stripeColor = undefined;
      config.maskColor = undefined;
    } else if (pattern === 'tabby') {
      config.stripeColor = base.stripeColor || shiftLightness(fur, -0.14);
      config.calicoPatchColor = undefined;
      config.maskColor = undefined;
      config.bellyBibColor = base.bellyBibColor ?? undefined;
    } else if (pattern === 'calico') {
      config.calicoPatchColor = base.calicoPatchColor || shiftLightness(fur, -0.28);
      config.stripeColor = undefined;
      config.maskColor = undefined;
      config.bellyBibColor = base.bellyBibColor || '#faf9f5';
    } else if (pattern === 'siamese') {
      config.maskColor = base.maskColor || shiftLightness(fur, -0.34);
      config.stripeColor = undefined;
      config.calicoPatchColor = undefined;
      config.bellyBibColor = undefined;
    } else {
      config.maskColor = undefined;
      config.stripeColor = undefined;
      config.calicoPatchColor = undefined;
      config.bellyBibColor = pattern === 'bicolor' ? base.bellyBibColor ?? undefined : undefined;
    }
    config.spots = patternSpots(pattern, config.calicoPatchColor ?? null, config.stripeColor ?? null);
    if (config.bellyBibColor) bellyInput.value = config.bellyBibColor;
  }

  function releaseBitmap(): void {
    if (bitmap) {
      if (bitmap instanceof ImageBitmap) bitmap.close();
      bitmap = null;
    }
    if (sourceUrl) {
      URL.revokeObjectURL(sourceUrl);
      sourceUrl = null;
    }
  }

  /**
   * Decode the picked photo into something `analyzePhoto` can draw.
   * `createImageBitmap(Blob)` is missing on older WebKit (macOS 10.15–11 via
   * WKWebView), so fall back to an <img> element when it is unavailable or
   * throws for the given file.
   */
  async function loadPhoto(file: File): Promise<PhotoSource> {
    if (typeof createImageBitmap === 'function') {
      try {
        return await createImageBitmap(file);
      } catch {
        // fall through to the <img> path
      }
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('image decode failed'));
      image.src = url;
    });
    sourceUrl = url;
    return image;
  }

  async function analyzeFile(file: File): Promise<void> {
    setStatus(t('menu.studio_analyzing'));
    try {
      releaseBitmap();
      bitmap = await loadPhoto(file);
      const result = analyzePhoto(bitmap);
      analysis = result.analysis;
      const id = `photo-${Date.now().toString(36)}`;
      const name = file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 18) || t('menu.studio_default_name');
      config = {
        id,
        name,
        builtin: false,
        emoji: '📷',
        ...result.config,
      } as CatSkinConfig;
      if (sourceImg) sourceImg.src = result.analysis.thumbDataUrl;
      if (confidenceEl) {
        const pct = Math.round(result.analysis.confidence * 100);
        confidenceEl.textContent = `${result.analysis.pattern} · ${pct}%`;
        confidenceEl.dataset.pattern = result.analysis.pattern;
      }

      syncControlsFromConfig();
      pushPreview();
      setStatus(t('menu.studio_ready'), 'ok');
    } catch (err) {
      console.error('[cat-studio] analysis failed:', err);
      setStatus(t('menu.studio_error'), 'error');
    }
  }

  function wireInputs(): void {
    nameInput.addEventListener('input', () => {
      if (!config) return;
      config.name = nameInput.value;
    });

    furInput.addEventListener('input', () => {
      if (!config) return;
      config.furColor = furInput.value;
      config.eyeColorBottom = shiftLightness(config.eyeColorTop, 0.16);
      pushPreview();
    });

    bellyInput.addEventListener('input', () => {
      if (!config) return;
      const value = bellyInput.value;
      if (config.pattern === 'calico') config.calicoPatchColor = value;
      else if (config.pattern === 'tabby') config.stripeColor = value;
      else if (config.pattern === 'siamese') config.maskColor = value;
      else config.bellyBibColor = value;
      config.spots = patternSpots(
        config.pattern || 'solid',
        config.calicoPatchColor ?? null,
        config.stripeColor ?? null,
      );
      pushPreview();
    });

    eyeInput.addEventListener('input', () => {
      if (!config) return;
      config.eyeColorTop = eyeInput.value;
      config.eyeColorBottom = shiftLightness(eyeInput.value, 0.16);
      config.accentColor = eyeInput.value;
      config.accentSideColor = shiftLightness(eyeInput.value, -0.18);
      pushPreview();
    });

    patternSel.addEventListener('change', () => {
      const value = patternSel.value as CatPattern;
      if (!PATTERNS.includes(value) || !config) return;
      applyPatternLook(value);
      syncControlsFromConfig();
      pushPreview();
    });

    faceSel.addEventListener('change', () => {
      const value = faceSel.value as CatFaceShape;
      if (!FACE_SHAPES.includes(value) || !config) return;
      config.faceShape = value;
      pushPreview();
    });

    earSel.addEventListener('change', () => {
      const value = earSel.value as CatEarShape;
      if (!EAR_SHAPES.includes(value) || !config) return;
      config.earShape = value;
      pushPreview();
    });

    chubbyInput.addEventListener('input', () => {
      if (!config) return;
      config.bodyChubbiness = Number(chubbyInput.value) / 100;
      pushPreview();
    });

    squintInput.addEventListener('input', () => {
      if (!config) return;
      config.eyeSquint = Number(squintInput.value) / 100;
      pushPreview();
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      fileInput.value = '';
      if (file) void analyzeFile(file);
    });
  }

  async function save(): Promise<void> {
    if (!config || saveBusy) return;
    saveBusy = true;
    if (saveBtn) saveBtn.disabled = true;
    setStatus(t('menu.studio_saving'));
    try {
      config.name = (nameInput.value || config.name || '我的猫').slice(0, 24);
      const cats = await invoke<CatSkinConfig[]>('save_custom_cat', { cat: config });
      setStatus(t('menu.studio_saved'), 'ok');
      handlers.onSaved(cats, config.id);
      window.setTimeout(() => close(), 420);
    } catch (err) {
      console.error('[cat-studio] save failed:', err);
      setStatus(`${t('menu.studio_save_failed')} ${String(err)}`, 'error');
    } finally {
      saveBusy = false;
      if (saveBtn) saveBtn.disabled = false;
    }
  }

  function close(): void {
    if (!open) return;
    open = false;
    root?.classList.add('hidden');
    if (engine) {
      engine.stop();
      engine = null;
    }
    void invoke('set_cat_studio_open', { open: false }).catch(() => {});
    void invoke('set_menu_open', { open: false }).catch(() => {});
  }

  function openStudio(): void {
    if (open) return;
    open = true;
    root?.classList.remove('hidden');
    void invoke('set_cat_studio_open', { open: true }).catch(() => {});
    void invoke('set_menu_open', { open: true }).catch(() => {});
    setStatus(t('menu.studio_pick_hint'));
    // Let layout settle before the engine measures its canvas.
    window.requestAnimationFrame(() => {
      if (config) pushPreview();
    });
    fileInput.click();
  }

  wireInputs();

  saveBtn?.addEventListener('click', () => void save());
  repickBtn?.addEventListener('click', () => fileInput.click());
  closeBtn?.addEventListener('click', () => close());

  return {
    open: openStudio,
    close,
    isOpen: () => open,
  };
}
