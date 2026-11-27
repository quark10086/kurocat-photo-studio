/**
 * InteractionDirector — time-based micro-reactions for the desktop pet.
 *
 * Three behaviours, all driven by measurable input instead of random flavour:
 *
 *  1. **Typing fatigue / anger** — if the user keeps typing (gaps < PAUSE_MS)
 *     for `typingAngerMs`, the cat protests. After that it stays quiet for
 *     `angerCooldownMs` so it never becomes nagging.
 *  2. **Sleepy yawn** — after `idleYawnMs` with no keyboard/mouse activity the
 *     cat yawns, then again only after another full idle window.
 *  3. **Petting hearts** — hovering over the cat continuously for
 *     `hoverHeartMs` counts as petting: hearts + happy sound, re-triggered at
 *     most once per `petCooldownMs`.
 *
 * The director owns no rendering: callbacks let the host decide how each event
 * looks and sounds (2D engine, 3D engine, audio, bubble text).
 */

export interface InteractionHooks {
  /** Protest: annoyed face / hiss pose + gentle grumble. */
  onTypingAnger: () => void;
  /** Sleepy yawn + breathy sound. */
  onIdleYawn: () => void;
  /** Happy reaction to petting: hearts + warm chirp. */
  onPetHeart: () => void;
  /** Optional guard: return false to mute reactions (e.g. pet menu open). */
  canReact?: () => boolean;
}

export interface InteractionOptions {
  /** Continuous typing needed before the cat complains (default 25 s). */
  typingAngerMs?: number;
  /** How long the cat sulks before it can complain again (default 3 min). */
  angerCooldownMs?: number;
  /** Idle time before a yawn (default 90 s). */
  idleYawnMs?: number;
  /** Minimum gap between two heart bursts while petting (default 6 s). */
  petCooldownMs?: number;
  /** Hover time that counts as petting (default 1.5 s). */
  hoverHeartMs?: number;
  /** A pause longer than this splits a typing streak (default 1.2 s). */
  typingPauseMs?: number;
  /** Tick period in ms (default 250). */
  tickMs?: number;
}

const DEFAULTS: Required<Omit<InteractionOptions, never>> = {
  typingAngerMs: 25_000,
  angerCooldownMs: 180_000,
  idleYawnMs: 90_000,
  petCooldownMs: 6_000,
  hoverHeartMs: 1_500,
  typingPauseMs: 1_200,
  tickMs: 250,
};

export class InteractionDirector {
  private readonly opts: typeof DEFAULTS;
  private timer: number | null = null;

  private typingSince: number | null = null;
  private lastKeyAt = 0;
  private lastAngerAt = 0;

  private lastActivityAt = Date.now();
  private lastYawnAt = 0;

  private hoverSince: number | null = null;
  private lastHeartAt = 0;

  constructor(
    private readonly hooks: InteractionHooks,
    options: InteractionOptions = {},
  ) {
    this.opts = { ...DEFAULTS, ...options };
  }

  public start(): void {
    if (this.timer !== null) return;
    this.lastActivityAt = Date.now();
    this.timer = window.setInterval(() => this.tick(), this.opts.tickMs);
  }

  public dispose(): void {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Feed every real key press the pet already listens to. */
  public notifyKey(): void {
    const now = Date.now();
    const gap = now - this.lastKeyAt;
    if (this.typingSince === null || gap > this.opts.typingPauseMs) {
      this.typingSince = now;
    }
    this.lastKeyAt = now;
    this.lastActivityAt = now;
  }

  /** Feed mouse movement / clicks so idle detection stays honest. */
  public notifyActivity(): void {
    const now = Date.now();
    this.lastActivityAt = now;
    if (this.typingSince !== null && now - this.lastKeyAt > this.opts.typingPauseMs) {
      this.typingSince = null;
    }
  }

  /** Pointer entered / left the cat silhouette. */
  public setHover(overCat: boolean): void {
    if (overCat) {
      if (this.hoverSince === null) this.hoverSince = Date.now();
      this.lastActivityAt = Date.now();
    } else {
      this.hoverSince = null;
    }
  }

  private allowed(): boolean {
    return this.hooks.canReact ? this.hooks.canReact() : true;
  }

  private tick(): void {
    const now = Date.now();

    // 1) typing fatigue
    if (
      this.typingSince !== null &&
      now - this.typingSince >= this.opts.typingAngerMs &&
      now - this.lastAngerAt >= this.opts.angerCooldownMs &&
      this.allowed()
    ) {
      this.lastAngerAt = now;
      this.typingSince = now; // restart the window, cooldown keeps it quiet
      this.hooks.onTypingAnger();
    }

    // 2) idle yawn
    if (
      now - this.lastActivityAt >= this.opts.idleYawnMs &&
      now - this.lastYawnAt >= this.opts.idleYawnMs &&
      this.allowed()
    ) {
      this.lastYawnAt = now;
      this.hooks.onIdleYawn();
    }

    // 3) petting hearts
    if (
      this.hoverSince !== null &&
      now - this.hoverSince >= this.opts.hoverHeartMs &&
      now - this.lastHeartAt >= this.opts.petCooldownMs &&
      this.allowed()
    ) {
      this.lastHeartAt = now;
      this.hooks.onPetHeart();
    }
  }
}
