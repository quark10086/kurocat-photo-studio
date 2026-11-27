// Prototype body renderers for the non-cat companions (snake / chicken).
//
// The cat rig is built around two front paws that reach the keyboard and the
// mouse. Snakes and chickens keep that contract but look completely different:
// a snake types with the tip of its tail, a chicken taps with its claws. Both
// renderers therefore receive the live limb anchors and draw their own bodies
// around them instead of shipping a second typing engine.

export type SpeciesKind = 'cat' | 'snake' | 'chicken';

export const SPECIES_IDS: SpeciesKind[] = ['cat', 'snake', 'chicken'];

export interface SpeciesPalette {
  fur: string;
  furDark: string;
  belly: string;
  outline: string;
  eye: string;
  pupil: string;
  accent: string;
}

export interface SpeciesAnchors {
  /** -1..1 breathing offset in pixels. */
  breath: number;
  centerX: number;
  headY: number;
  baseY: number;
  /** Relative size unit: 1 = the stock cat body height. */
  scale: number;
  /** Horizontal sway of the upper body while typing (pixels). */
  sway: number;
  /** Where the eyes look, in pixels. */
  lookX: number;
  lookY: number;
  /** 0 = eyes open, 1 = fully closed. */
  blink: number;
  squint: number;
  sleep: number;
  mouthOpen: number;
  /** Free-running phase used for the snake tongue flick. */
  tonguePhase: number;
  left: { x: number; y: number };
  right: { x: number; y: number };
}

const TAU = Math.PI * 2;

function mix(a: string, b: string, t: number): string {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return a;
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r}, ${g}, ${bl})`;
}

function parse(color: string): [number, number, number] | null {
  const value = color.trim();
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3) {
      return [
        parseInt(hex[0] + hex[0], 16),
        parseInt(hex[1] + hex[1], 16),
        parseInt(hex[2] + hex[2], 16),
      ];
    }
    if (hex.length >= 6) {
      return [
        parseInt(hex.slice(0, 2), 16),
        parseInt(hex.slice(2, 4), 16),
        parseInt(hex.slice(4, 6), 16),
      ];
    }
    return null;
  }
  const rgb = value.match(/rgba?\(([^)]+)\)/i);
  if (!rgb) return null;
  const parts = rgb[1].split(',').map((p) => Number.parseFloat(p.trim()));
  if (parts.length < 3 || parts.some((n) => Number.isFinite(n) === false)) return null;
  return [parts[0], parts[1], parts[2]];
}

/** Soft plush shading shared by both species. */
function shade(ctx: CanvasRenderingContext2D, color: string, x: number, y: number, r: number): CanvasGradient {
  const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.15, x, y, r);
  grad.addColorStop(0, mix(color, '#ffffff', 0.22));
  grad.addColorStop(0.62, color);
  grad.addColorStop(1, mix(color, '#000000', 0.16));
  return grad;
}

function taperedPath(
  ctx: CanvasRenderingContext2D,
  pts: Array<{ x: number; y: number }>,
  wStart: number,
  wEnd: number,
  color: string,
): void {
  if (pts.length < 2) return;
  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < pts.length; i += 1) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(pts.length - 1, i + 1)];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const w = (wStart + (wEnd - wStart) * (i / (pts.length - 1))) / 2;
    left.push({ x: pts[i].x - dy * w, y: pts[i].y + dx * w });
    right.push({ x: pts[i].x + dy * w, y: pts[i].y - dx * w });
  }
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i += 1) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i -= 1) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function ellipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  rx: number,
  ry: number,
  rotation = 0,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rotation, 0, TAU);
}

/**
 * Coiled snake: rings on the desk, an S-neck rising to the head, and a tail tip
 * that stretches to whichever limb anchor is currently typing or nudging the mouse.
 */
export function drawSnakeBody(
  ctx: CanvasRenderingContext2D,
  p: SpeciesPalette,
  a: SpeciesAnchors,
): void {
  const s = a.scale;
  const cx = a.centerX;
  const base = a.baseY + a.breath * 0.6;
  const headX = cx + a.sway * 0.55;
  const headY = a.headY + a.breath * 1.4;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // --- Coil: three stacked rings so the snake visibly rests on the desk.
  const rings: Array<[number, number, number, number]> = [
    [0, 16, 56, 1],
    [-7, -6, 47, 0.92],
    [6, -26, 39, 0.84],
  ];
  for (const [offX, offY, rx0, k] of rings) {
    const rx = rx0 * s * k;
    const ry = rx * 0.36;
    const x = cx + offX * s;
    const y = base + offY * s;
    ellipse(ctx, x, y, rx, ry);
    ctx.fillStyle = shade(ctx, p.fur, x, y, rx);
    ctx.fill();
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 2.4 * s;
    ctx.stroke();
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x, y + ry * 0.16, rx * 0.68, ry * 0.44, 0, 0, Math.PI);
    ctx.strokeStyle = mix(p.belly, p.fur, 0.3);
    ctx.lineWidth = 4.2 * s;
    ctx.stroke();
    ctx.restore();
  }

  // --- Tail tip reaching the keycaps / mouse (drawn above the coil).
  const drawTailTo = (to: { x: number; y: number }, weight: number): void => {
    if (weight <= 0.02) return;
    const startX = cx - 4 * s;
    const startY = base - 8 * s;
    const midX = (startX + to.x) / 2 - 22 * s;
    const midY = (startY + to.y) / 2 + 14 * s;
    const path: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= 18; i += 1) {
      const u = i / 18;
      const inv = 1 - u;
      path.push({
        x: inv * inv * startX + 2 * inv * u * midX + u * u * to.x,
        y: inv * inv * startY + 2 * inv * u * midY + u * u * (to.y - 5 * s),
      });
    }
    ctx.save();
    ctx.globalAlpha = Math.min(1, weight);
    taperedPath(ctx, path, 12 * s, 3.4 * s, p.outline);
    taperedPath(ctx, path, 9 * s, 2.2 * s, p.fur);
    ellipse(ctx, to.x, to.y - 5 * s, 4.6 * s, 4 * s);
    ctx.fillStyle = p.fur;
    ctx.fill();
    ctx.restore();
  };
  drawTailTo(a.left, 0.5);
  drawTailTo(a.right, 1);

  // --- Neck: tapered S curve from the coil to the head.
  const neckPts: Array<{ x: number; y: number }> = [];
  const c1 = { x: cx - 30 * s, y: base - 40 * s };
  const c2 = { x: headX + 24 * s, y: headY + 46 * s };
  const p0 = { x: cx - 2 * s, y: base - 22 * s };
  const p3 = { x: headX, y: headY + 16 * s };
  for (let i = 0; i <= 24; i += 1) {
    const u = i / 24;
    const inv = 1 - u;
    neckPts.push({
      x: inv * inv * inv * p0.x + 3 * inv * inv * u * c1.x + 3 * inv * u * u * c2.x + u * u * u * p3.x,
      y: inv * inv * inv * p0.y + 3 * inv * inv * u * c1.y + 3 * inv * u * u * c2.y + u * u * u * p3.y,
    });
  }
  taperedPath(ctx, neckPts, 32 * s, 19 * s, p.outline);
  taperedPath(ctx, neckPts, 28 * s, 15.5 * s, p.fur);
  // Belly stripe riding along the neck
  ctx.save();
  ctx.globalAlpha = 0.55;
  taperedPath(
    ctx,
    neckPts.map((pt) => ({ x: pt.x + 3 * s, y: pt.y })),
    13 * s,
    7 * s,
    mix(p.belly, p.fur, 0.35),
  );
  ctx.restore();

  // --- Head
  const headRx = 32 * s;
  const headRy = 27 * s;
  ellipse(ctx, headX, headY, headRx, headRy);
  ctx.fillStyle = shade(ctx, p.fur, headX, headY, headRx * 1.25);
  ctx.fill();
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 2.6 * s;
  ctx.stroke();

  // Jaw / snout wedge
  ctx.beginPath();
  ctx.moveTo(headX - 15 * s, headY + 10 * s);
  ctx.quadraticCurveTo(headX, headY + 30 * s, headX + 15 * s, headY + 10 * s);
  ctx.closePath();
  ctx.fillStyle = mix(p.belly, p.fur, 0.18);
  ctx.fill();

  // Eyes with vertical pupils
  const eyeY = headY - 4 * s;
  const open = Math.max(0.06, 1 - a.blink - a.sleep * 0.9);
  const squint = Math.max(0, Math.min(1, a.squint)) * 0.32;
  for (const side of [-1, 1]) {
    const ex = headX + side * 14 * s + a.lookX * 0.4 * s;
    ctx.save();
    ctx.translate(ex, eyeY);
    ctx.scale(1, Math.max(0.08, open * (1 - squint)));
    ellipse(ctx, 0, 0, 9.2 * s, 9.2 * s);
    ctx.fillStyle = p.eye;
    ctx.fill();
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 1.7 * s;
    ctx.stroke();
    ellipse(ctx, a.lookX * 0.5 * s, 0, 2.3 * s, 7 * s);
    ctx.fillStyle = p.pupil;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-3 * s, -3.2 * s, 1.8 * s, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fill();
    ctx.restore();
  }

  // Forked tongue flick
  const flick = Math.sin(a.tonguePhase) * 0.5 + 0.5;
  if (a.mouthOpen > 0.15 || flick > 0.7) {
    const reach = (7 + flick * 10) * s;
    ctx.save();
    ctx.strokeStyle = '#e0577a';
    ctx.lineWidth = 2.6 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(headX, headY + 24 * s);
    ctx.lineTo(headX, headY + 24 * s + reach * 0.6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(headX, headY + 24 * s + reach * 0.55);
    ctx.lineTo(headX - 5.5 * s, headY + 24 * s + reach);
    ctx.moveTo(headX, headY + 24 * s + reach * 0.55);
    ctx.lineTo(headX + 5.5 * s, headY + 24 * s + reach);
    ctx.stroke();
    ctx.restore();
  }

  // Nostril dots
  ctx.fillStyle = p.outline;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(headX + side * 6 * s, headY + 15 * s, 1.2 * s, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Chicken: round plush body, comb and beak, plus two clawed legs that plant on
 * the keys instead of paws.
 */
export function drawChickenBody(
  ctx: CanvasRenderingContext2D,
  p: SpeciesPalette,
  a: SpeciesAnchors,
): void {
  const s = a.scale;
  const cx = a.centerX;
  const base = a.baseY + a.breath * 0.8;
  const headX = cx + a.sway * 0.5;
  const headY = a.headY + a.breath * 1.6;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  // --- Legs first (behind the body)
  const leg = (to: { x: number; y: number }, kneeDir: number) => {
    const hipX = cx + kneeDir * 20 * s;
    const hipY = base - 16 * s;
    const kneeX = (hipX + to.x) / 2 + kneeDir * 10 * s;
    const kneeY = (hipY + to.y) / 2 - 6 * s;
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.quadraticCurveTo(kneeX, kneeY, to.x, to.y - 6 * s);
    ctx.strokeStyle = '#e8a33c';
    ctx.lineWidth = 6.4 * s;
    ctx.stroke();
    ctx.strokeStyle = '#c9862a';
    ctx.lineWidth = 2.2 * s;
    ctx.stroke();
    // Three-toe claw
    for (let i = -1; i <= 1; i += 1) {
      const toeAngle = Math.PI / 2 + i * 0.38;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y - 6 * s);
      ctx.lineTo(
        to.x + Math.cos(toeAngle) * 13 * s,
        to.y - 6 * s + Math.sin(toeAngle) * 13 * s,
      );
      ctx.strokeStyle = '#e8a33c';
      ctx.lineWidth = 4.6 * s;
      ctx.stroke();
    }
  };

  leg(a.left, -1);
  leg(a.right, 1);

  // --- Body (egg)
  const bodyRx = 58 * s;
  const bodyRy = 66 * s;
  const bodyCy = base - bodyRy * 0.92;
  ctx.beginPath();
  ctx.moveTo(cx, bodyCy - bodyRy);
  ctx.bezierCurveTo(
    cx + bodyRx * 1.05,
    bodyCy - bodyRy * 0.55,
    cx + bodyRx * 0.98,
    bodyCy + bodyRy * 0.75,
    cx,
    base - 6 * s,
  );
  ctx.bezierCurveTo(
    cx - bodyRx * 0.98,
    bodyCy + bodyRy * 0.75,
    cx - bodyRx * 1.05,
    bodyCy - bodyRy * 0.55,
    cx,
    bodyCy - bodyRy,
  );
  ctx.closePath();
  ctx.fillStyle = shade(ctx, p.fur, cx, bodyCy, bodyRy);
  ctx.fill();
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 2.6 * s;
  ctx.stroke();

  // Belly patch
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, bodyCy + bodyRy * 0.28, bodyRx * 0.6, bodyRy * 0.6, 0, 0, TAU);
  ctx.fillStyle = p.belly;
  ctx.globalAlpha = 0.9;
  ctx.fill();
  ctx.restore();

  // Wing nubs
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      cx + side * bodyRx * 0.78,
      bodyCy + bodyRy * 0.06,
      15 * s,
      26 * s,
      side * 0.32,
      0,
      TAU,
    );
    ctx.fillStyle = mix(p.fur, '#000000', 0.1);
    ctx.fill();
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 2 * s;
    ctx.stroke();
  }

  // --- Head
  const headR = 31 * s;
  ctx.beginPath();
  ctx.moveTo(headX, headY + headR * 1.1);
  ctx.bezierCurveTo(
    headX - headR * 1.15,
    headY + headR * 0.1,
    headX - headR * 0.9,
    headY - headR * 1.05,
    headX,
    headY - headR * 1.05,
  );
  ctx.bezierCurveTo(
    headX + headR * 0.9,
    headY - headR * 1.05,
    headX + headR * 1.15,
    headY + headR * 0.1,
    headX,
    headY + headR * 1.1,
  );
  ctx.closePath();
  ctx.fillStyle = shade(ctx, p.fur, headX, headY, headR);
  ctx.fill();
  ctx.strokeStyle = p.outline;
  ctx.lineWidth = 2.4 * s;
  ctx.stroke();

  // Comb (three bumps)
  ctx.beginPath();
  for (let i = -1; i <= 1; i += 1) {
    const bx = headX + i * 11 * s;
    const by = headY - headR * 1.02;
    ctx.moveTo(bx - 6 * s, by + 2 * s);
    ctx.quadraticCurveTo(bx, by - 13 * s, bx + 6 * s, by + 2 * s);
  }
  ctx.fillStyle = '#e0453a';
  ctx.fill();
  ctx.strokeStyle = '#a92c25';
  ctx.lineWidth = 1.6 * s;
  ctx.stroke();

  // Beak
  ctx.beginPath();
  ctx.moveTo(headX - 8 * s, headY + 6 * s);
  ctx.lineTo(headX + 8 * s, headY + 6 * s);
  ctx.lineTo(headX, headY + 6 * s + (8 + a.mouthOpen * 7) * s);
  ctx.closePath();
  ctx.fillStyle = '#f2b23a';
  ctx.fill();
  ctx.strokeStyle = '#c9862a';
  ctx.lineWidth = 1.6 * s;
  ctx.stroke();

  // Wattle
  ctx.beginPath();
  ctx.ellipse(headX, headY + 18 * s, 4.2 * s, 6.4 * s, 0, 0, TAU);
  ctx.fillStyle = '#d8413a';
  ctx.fill();

  // Eyes
  const eyeY = headY - 3 * s;
  const open = Math.max(0.08, 1 - a.blink - a.sleep * 0.9);
  const squint = Math.max(0, Math.min(1, a.squint)) * 0.3;
  for (const side of [-1, 1]) {
    const ex = headX + side * 12 * s + a.lookX * 0.4 * s;
    ctx.save();
    ctx.translate(ex, eyeY);
    ctx.scale(1, Math.max(0.08, open * (1 - squint)));
    ellipse(ctx, 0, 0, 6.6 * s, 7.4 * s);
    ctx.fillStyle = '#fdfdff';
    ctx.fill();
    ctx.strokeStyle = p.outline;
    ctx.lineWidth = 1.4 * s;
    ctx.stroke();
    ellipse(ctx, a.lookX * 0.55 * s + a.lookY * 0.1 * s, a.lookY * 0.5 * s, 3.3 * s, 3.9 * s);
    ctx.fillStyle = p.pupil;
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}
