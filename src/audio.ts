import { TYPING_SOUND_WAV_B64, type TypingSoundSlot } from './typingSoundData';

const KEY_DOWN_SLOTS: readonly TypingSoundSlot[] = ['k0', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'k7'];
const KEY_UP_SLOTS: readonly TypingSoundSlot[] = ['up0', 'up1', 'up2', 'up3'];
const ALL_TYPING_SLOTS = Object.keys(TYPING_SOUND_WAV_B64) as TypingSoundSlot[];

class CatAudio {
  private ctx: AudioContext | null = null;
  private enabled = true;
  private typingSoundEnabled = false;
  private graphReady = false;
  private masterGain: GainNode | null = null;
  private warmFilter: BiquadFilterNode | null = null;
  private flutterLfo: OscillatorNode | null = null;
  private currentIntensity = 0;
  private currentPurrTone: 'normal' | 'chin' | 'knead' = 'normal';
  private sources: AudioScheduledSourceNode[] = [];
  private deviceWatcherAttached = false;
  private rebuildTimer: number | null = null;
  private typingBuffers: Map<TypingSoundSlot, AudioBuffer> | null = null;
  private typingDecodePromise: Promise<void> | null = null;
  private typingDecodeFailedCtx: AudioContext | null = null;
  private keyDownIndex = 0;
  private keyUpIndex = 0;
  private spaceIndex = 0;

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.setPurrIntensity(0);
    }
  }

  public setTypingSoundEnabled(enabled: boolean): void {
    const next = Boolean(enabled);
    if (this.typingSoundEnabled === next) {
      if (next && !this.typingBuffers && !this.typingDecodePromise) {
        this.prewarmTypingBuffers();
      }
      return;
    }
    this.typingSoundEnabled = next;
    if (next) {
      this.prewarmTypingBuffers();
    } else {
      this.typingBuffers = null;
      this.typingDecodePromise = null;
      this.typingDecodeFailedCtx = null;
    }
  }

  /**
   * Output device changes (headphones plugged in / Bluetooth headset connecting) kill the
   * WebView2 audio stream: the context keeps reporting `running` but renders into nothing.
   * Rebuilding the graph on the fresh default device brings audio back without a restart.
   */
  private attachDeviceWatcher(): void {
    if (this.deviceWatcherAttached) return;
    try {
      const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : undefined;
      if (!media || typeof media.addEventListener !== 'function') return;
      media.addEventListener('devicechange', () => this.scheduleRebuild());
      this.deviceWatcherAttached = true;
    } catch {
      // Restricted WebView environments may deny navigator.mediaDevices access
    }
  }

  private scheduleRebuild(): void {
    if (typeof window === 'undefined') return;
    // Bluetooth headsets fire several devicechange events while the profile settles (A2DP/HFP),
    // so coalesce them into a single rebuild.
    if (this.rebuildTimer !== null) return;
    this.rebuildTimer = window.setTimeout(() => {
      this.rebuildTimer = null;
      this.rebuild();
    }, 280);
  }

  private safeResume(ctx: AudioContext): void {
    if (ctx.state !== 'suspended') return;
    try {
      const res = ctx.resume();
      if (res && typeof res.catch === 'function') {
        void res.catch(() => {});
      }
    } catch {
      // Autoplay policy or unavailable audio hardware on macOS WKWebView / Linux WebKitGTK
    }
  }

  private teardownGraph(): void {
    const ctx = this.ctx;
    for (const src of this.sources) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
      try {
        src.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.sources = [];
    if (this.masterGain) {
      try {
        this.masterGain.disconnect();
      } catch {
        // already disconnected
      }
    }
    this.masterGain = null;
    this.warmFilter = null;
    this.flutterLfo = null;
    this.graphReady = false;
    this.typingBuffers = null;
    this.typingDecodePromise = null;
    this.typingDecodeFailedCtx = null;
    this.ctx = null;
    if (ctx) {
      try {
        ctx.onstatechange = null;
        const p = ctx.close();
        if (p && typeof p.catch === 'function') {
          void p.catch(() => {});
        }
      } catch {
        // already closed or invalid context
      }
    }
  }

  private rebuild(): void {
    if (!this.ctx) return;
    // Keep the level the user is petting at, so a mid-stroke device switch does not stutter the purr
    const keepIntensity = this.enabled ? this.currentIntensity : 0;
    const tone = this.currentPurrTone;
    this.teardownGraph();
    if (keepIntensity > 0.01 && this.ensurePurrGraph() && this.ctx && this.masterGain) {
      try {
        const now = this.ctx.currentTime;
        if (Number.isFinite(now)) {
          const gainScale = tone === 'chin' ? 0.30 : tone === 'knead' ? 0.16 : 0.26;
          this.masterGain.gain.setTargetAtTime(keepIntensity * gainScale, now, 0.05);
          if (this.warmFilter) {
            const freq = tone === 'chin' ? 158 : tone === 'knead' ? 175 : 190;
            this.warmFilter.frequency.setTargetAtTime(freq, now, 0.05);
          }
          if (this.flutterLfo) {
            const lfoHz = tone === 'chin' ? 22.0 : tone === 'knead' ? 23.5 : 24.5;
            this.flutterLfo.frequency.setTargetAtTime(lfoHz, now, 0.05);
          }
        }
      } catch {
        // Ignore scheduling errors if audio device vanished again mid-rebuild
      }
    }
    if (this.typingSoundEnabled) {
      this.prewarmTypingBuffers();
    }
  }

  private ensureAudioContext(): AudioContext | null {
    if ((!this.enabled && !this.typingSoundEnabled) || typeof window === 'undefined') return null;
    if (this.ctx && (this.ctx.state as string) === 'closed') {
      this.teardownGraph();
    }
    if (!this.ctx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        this.ctx = new AC();
      } catch {
        this.ctx = null;
        return null;
      }
      // Hard interruptions (device removed under us, OS audio reset) leave the context dead:
      // rebuild instead of staying silent until the next restart.
      const watched = this.ctx;
      watched.onstatechange = () => {
        if (this.ctx !== watched) return;
        const state = watched.state as string;
        if (state === 'closed' || state === 'interrupted') this.scheduleRebuild();
      };
      this.attachDeviceWatcher();
    }
    const ctx = this.ctx;
    if ((ctx.state as string) === 'closed') return null;
    if (!Number.isFinite(ctx.sampleRate) || ctx.sampleRate <= 0) {
      this.teardownGraph();
      return null;
    }
    this.safeResume(ctx);
    return ctx;
  }

  private ensurePurrGraph(): boolean {
    if (!this.enabled || typeof window === 'undefined') return false;
    const ctx = this.ensureAudioContext();
    if (!ctx) return false;
    if (this.graphReady) return (ctx.state as string) !== 'closed';

    try {
      const sampleRate = ctx.sampleRate;
      const bufLen = Math.max(1, Math.floor(sampleRate * 3.0));
      const noiseBuf = ctx.createBuffer(1, bufLen, sampleRate);
      const data = noiseBuf.getChannelData(0);
      // Smooth warm noise buffer for organic feline throat & breath texture
      for (let i = 0; i < bufLen; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      const noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuf;
      noiseSrc.loop = true;

      // Layer 1: Warm chest rumble (~190 Hz)
      const warmFilter = ctx.createBiquadFilter();
      warmFilter.type = 'bandpass';
      warmFilter.frequency.value = 190;
      warmFilter.Q.value = 1.15;
      const warmGain = ctx.createGain();
      warmGain.gain.value = 1.45;

      // Layer 2: Soft breathy throat resonance (~520 Hz)
      const breathFilter = ctx.createBiquadFilter();
      breathFilter.type = 'bandpass';
      breathFilter.frequency.value = 520;
      breathFilter.Q.value = 1.4;
      const breathGain = ctx.createGain();
      breathGain.gain.value = 0.34;

      // 24.5 Hz feline purr flutter amplitude modulation (0.30 .. 1.00)
      const flutterGain = ctx.createGain();
      flutterGain.gain.value = 0.65;
      const flutterLfo = ctx.createOscillator();
      flutterLfo.type = 'sine';
      flutterLfo.frequency.value = 24.5;
      const flutterDepth = ctx.createGain();
      flutterDepth.gain.value = 0.35;
      flutterLfo.connect(flutterDepth);
      flutterDepth.connect(flutterGain.gain);

      // Slow cozy breathing cadence (~0.68 Hz: inhale/exhale swell)
      const breathCycleGain = ctx.createGain();
      breathCycleGain.gain.value = 0.76;
      const breathLfo = ctx.createOscillator();
      breathLfo.type = 'sine';
      breathLfo.frequency.value = 0.68;
      const breathDepth = ctx.createGain();
      breathDepth.gain.value = 0.24;
      breathLfo.connect(breathDepth);
      breathDepth.connect(breathCycleGain.gain);

      // Soft lowpass polish so it sounds cozy on both speakers & headphones
      const polishFilter = ctx.createBiquadFilter();
      polishFilter.type = 'lowpass';
      polishFilter.frequency.value = 1400;

      // Master output gain (starts silent, ramps smoothly during petting)
      const master = ctx.createGain();
      master.gain.value = 0;

      noiseSrc.connect(warmFilter);
      warmFilter.connect(warmGain);
      warmGain.connect(flutterGain);

      noiseSrc.connect(breathFilter);
      breathFilter.connect(breathGain);
      breathGain.connect(flutterGain);

      flutterGain.connect(breathCycleGain);
      breathCycleGain.connect(polishFilter);
      polishFilter.connect(master);
      master.connect(ctx.destination);

      noiseSrc.start();
      flutterLfo.start();
      breathLfo.start();

      this.sources = [noiseSrc, flutterLfo, breathLfo];
      this.masterGain = master;
      this.warmFilter = warmFilter;
      this.flutterLfo = flutterLfo;
      this.graphReady = true;

      return true;
    } catch {
      this.teardownGraph();
      return false;
    }
  }

  private getReadyContext(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ensurePurrGraph() || !this.ctx) return null;
    const ctx = this.ctx;
    if ((ctx.state as string) === 'closed') return null;
    if (!Number.isFinite(ctx.currentTime) || !Number.isFinite(ctx.sampleRate) || ctx.sampleRate <= 0) {
      return null;
    }
    this.safeResume(ctx);
    return ctx;
  }

  private getTypingContext(): AudioContext | null {
    if (!this.typingSoundEnabled) return null;
    const ctx = this.ensureAudioContext();
    if (!ctx) return null;
    if (!Number.isFinite(ctx.currentTime)) return null;
    return ctx;
  }

  private static base64ToArrayBuffer(b64: string): ArrayBuffer {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
  }

  private static decodeAudioBuffer(ctx: AudioContext, ab: ArrayBuffer): Promise<AudioBuffer> {
    return new Promise<AudioBuffer>((resolve, reject) => {
      try {
        const maybePromise = ctx.decodeAudioData(
          ab,
          (decoded) => resolve(decoded),
          (err) => reject(err ?? new Error('decodeAudioData failed')),
        );
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve, reject);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  private prewarmTypingBuffers(): void {
    if (!this.typingSoundEnabled) return;
    const ctx = this.ensureAudioContext();
    if (!ctx) return;
    if (this.typingBuffers || this.typingDecodePromise || this.typingDecodeFailedCtx === ctx) return;

    const targetCtx = ctx;
    const decodeTask = (async () => {
      const decodedMap = new Map<TypingSoundSlot, AudioBuffer>();
      await Promise.all(
        ALL_TYPING_SLOTS.map(async (slot) => {
          if (this.ctx !== targetCtx || !this.typingSoundEnabled) return;
          try {
            const ab = CatAudio.base64ToArrayBuffer(TYPING_SOUND_WAV_B64[slot]);
            const buf = await CatAudio.decodeAudioBuffer(targetCtx, ab);
            if (this.ctx === targetCtx && this.typingSoundEnabled) {
              decodedMap.set(slot, buf);
            }
          } catch {
            // Ignore per-slot decode failure on restricted WebView backends
          }
        }),
      );
      if (this.ctx === targetCtx && this.typingSoundEnabled) {
        if (decodedMap.size > 0) {
          this.typingBuffers = decodedMap;
        } else {
          this.typingDecodeFailedCtx = targetCtx;
        }
      }
    })()
      .catch(() => {})
      .finally(() => {
        if (this.typingDecodePromise === decodeTask) {
          this.typingDecodePromise = null;
        }
      });

    this.typingDecodePromise = decodeTask;
  }

  private randRange(min: number, max: number): number {
    return min + Math.random() * (max - min);
  }

  private playTypingSlot(slot: TypingSoundSlot, gain: number, playbackRate: number, pan: number): void {
    if (!this.typingSoundEnabled) return;
    try {
      const ctx = this.getTypingContext();
      if (!ctx) return;
      if (!this.typingBuffers) {
        this.prewarmTypingBuffers();
        return;
      }
      const buf = this.typingBuffers.get(slot);
      if (!buf) return;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = playbackRate;

      const gainNode = ctx.createGain();
      gainNode.gain.value = gain;

      let panNode: StereoPannerNode | null = null;
      const clampedPan = Number.isFinite(pan) ? Math.max(-0.38, Math.min(0.38, pan)) : 0;
      if (Math.abs(clampedPan) > 0.001 && typeof ctx.createStereoPanner === 'function') {
        try {
          panNode = ctx.createStereoPanner();
          panNode.pan.value = clampedPan;
        } catch {
          panNode = null;
        }
      }

      src.connect(gainNode);
      if (panNode) {
        gainNode.connect(panNode);
        panNode.connect(ctx.destination);
      } else {
        gainNode.connect(ctx.destination);
      }

      src.onended = () => {
        try {
          src.disconnect();
          gainNode.disconnect();
          panNode?.disconnect();
        } catch {
          // ignore
        }
      };

      src.start();
    } catch {
      // Never throw on macOS WKWebView / Linux WebKitGTK / missing audio hardware
    }
  }

  public playKeyDown(vk: number, pan = 0): void {
    if (!this.typingSoundEnabled) return;
    try {
      let slot: TypingSoundSlot;
      if (vk === 0x20) {
        slot = this.spaceIndex++ % 2 === 0 ? 'space0' : 'space1';
      } else if (vk === 0x0d || vk === 0x10d) {
        slot = 'enter';
      } else if (vk === 0x08) {
        slot = 'backspace';
      } else {
        slot = KEY_DOWN_SLOTS[this.keyDownIndex++ % KEY_DOWN_SLOTS.length];
      }
      const gain = 0.58 * this.randRange(0.93, 1.05);
      const rate = this.randRange(0.985, 1.015);
      this.playTypingSlot(slot, gain, rate, pan);
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  public playKeyUp(vk: number, pan = 0): void {
    if (!this.typingSoundEnabled) return;
    try {
      let slot: TypingSoundSlot;
      if (vk === 0x20) {
        slot = 'space_up';
      } else if (vk === 0x0d || vk === 0x10d) {
        slot = 'enter_up';
      } else {
        slot = KEY_UP_SLOTS[this.keyUpIndex++ % KEY_UP_SLOTS.length];
      }
      const gain = 0.52 * this.randRange(0.93, 1.05);
      const rate = this.randRange(0.985, 1.015);
      this.playTypingSlot(slot, gain, rate, pan);
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  public playMouseDown(button: string): void {
    if (!this.typingSoundEnabled) return;
    try {
      const isAlt = button === 'right' || button === 'middle';
      const slot: TypingSoundSlot = isAlt ? 'mouse_down1' : 'mouse_down0';
      const rate = isAlt ? this.randRange(0.96, 0.99) : this.randRange(0.985, 1.015);
      const gain = 0.44 * this.randRange(0.94, 1.04);
      this.playTypingSlot(slot, gain, rate, 0.24);
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  public playMouseUp(_button: string): void {
    if (!this.typingSoundEnabled) return;
    try {
      const rate = this.randRange(0.985, 1.015);
      const gain = 0.48 * this.randRange(0.94, 1.04);
      this.playTypingSlot('mouse_up0', gain, rate, 0.24);
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  /**
   * Smoothly drives real-time organic cat purring (0 = silent, 1 = full cozy purr).
   * `tone`: 'normal' (head pet), 'chin' (deeper warm chest purr), 'knead' (gentle soft purr).
   */
  public setPurrIntensity(intensity: number, tone: 'normal' | 'chin' | 'knead' = 'normal'): void {
    const target = this.enabled ? Math.max(0, Math.min(1, intensity)) : 0;
    if (target <= 0.01 && !this.graphReady) return;
    if (Math.abs(target - this.currentIntensity) < 0.005 && tone === this.currentPurrTone) return;
    this.currentIntensity = target;
    this.currentPurrTone = tone;

    if (target > 0.01 && !this.ensurePurrGraph()) return;
    if (!this.ctx || !this.masterGain || (this.ctx.state as string) === 'closed') return;

    if (target > 0.01) {
      this.safeResume(this.ctx);
    }

    try {
      const now = this.ctx.currentTime;
      if (!Number.isFinite(now)) return;
      const gainScale = tone === 'chin' ? 0.30 : tone === 'knead' ? 0.16 : 0.26;
      const targetGain = target * gainScale;
      const timeConst = target > 0.01 ? 0.14 : 0.22;
      this.masterGain.gain.setTargetAtTime(targetGain, now, timeConst);

      if (this.warmFilter) {
        const freq = tone === 'chin' ? 158 : tone === 'knead' ? 175 : 190;
        this.warmFilter.frequency.setTargetAtTime(freq, now, 0.16);
      }
      if (this.flutterLfo) {
        const lfoHz = tone === 'chin' ? 22.0 : tone === 'knead' ? 23.5 : 24.5;
        this.flutterLfo.frequency.setTargetAtTime(lfoHz, now, 0.16);
      }
    } catch {
      // Ignore AudioParam errors on suspended/closed WebView audio backends
    }
  }

  /**
   * Cute soft nose-boop squeak + tiny kitten sneeze puff!
   */
  public playBoopSneeze(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      const t0 = ctx.currentTime + 0.008;

      // 1) Tiny soft rubbery "boop" tone
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, t0);
      osc.frequency.exponentialRampToValueAtTime(780, t0 + 0.045);
      osc.frequency.exponentialRampToValueAtTime(420, t0 + 0.11);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.075, t0 + 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.14);
      osc.onended = () => {
        try {
          osc.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
      };

      // 2) Delayed tiny kitten "pff-chu!" filtered air puff (~0.30s later)
      const sneezeT = t0 + 0.30;
      const bufLen = Math.max(1, Math.floor(ctx.sampleRate * 0.14));
      const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < bufLen; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufLen * 0.45));
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2400, sneezeT);
      bp.frequency.exponentialRampToValueAtTime(1100, sneezeT + 0.11);
      bp.Q.value = 1.4;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, sneezeT);
      ng.gain.linearRampToValueAtTime(0.085, sneezeT + 0.015);
      ng.gain.exponentialRampToValueAtTime(0.0001, sneezeT + 0.12);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(ctx.destination);
      src.start(sneezeT);
      src.stop(sneezeT + 0.14);
      src.onended = () => {
        try {
          src.disconnect();
          bp.disconnect();
          ng.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  /**
   * Quick playful "bzzp / flick" chirp when tail is poked!
   */
  public playTailFlick(escalated = false): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      const t0 = ctx.currentTime + 0.006;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = escalated ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(escalated ? 340 : 460, t0);
      osc.frequency.exponentialRampToValueAtTime(escalated ? 210 : 690, t0 + 0.085);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(escalated ? 0.09 : 0.06, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.105);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.12);
      osc.onended = () => {
        try {
          osc.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  /**
   * Soft mochi "boing" thump on scruff landing!
   */
  public playSoftLand(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      const t0 = ctx.currentTime + 0.005;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(165, t0);
      osc.frequency.exponentialRampToValueAtTime(88, t0 + 0.095);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.08, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.11);
      osc.connect(g);
      g.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.125);
      osc.onended = () => {
        try {
          osc.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  /**
   * Soft, cozy synthesized notification chime for AI Companion events (done / waiting / error).
   * Respects the global sound toggle and leaves zero persistent audio nodes behind.
   */
  public playAgentNotice(kind: 'done' | 'waiting' | 'error'): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    const notes: Array<{ freq: number; delay: number; dur: number; gain: number }> =
      kind === 'done'
        ? [
            { freq: 587.33, delay: 0.0, dur: 0.16, gain: 0.085 },
            { freq: 880.0, delay: 0.095, dur: 0.24, gain: 0.095 },
          ]
        : kind === 'waiting'
          ? [{ freq: 659.25, delay: 0.0, dur: 0.22, gain: 0.075 }]
          : [
              { freq: 311.13, delay: 0.0, dur: 0.14, gain: 0.075 },
              { freq: 246.94, delay: 0.11, dur: 0.20, gain: 0.075 },
            ];

    try {
      const t0 = ctx.currentTime + 0.01;
      for (const n of notes) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = kind === 'error' ? 'triangle' : 'sine';
        osc.frequency.setValueAtTime(n.freq, t0 + n.delay);
        g.gain.setValueAtTime(0.0001, t0 + n.delay);
        g.gain.linearRampToValueAtTime(n.gain, t0 + n.delay + 0.018);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.delay + n.dur);
        osc.connect(g);
        g.connect(ctx.destination);
        osc.start(t0 + n.delay);
        osc.stop(t0 + n.delay + n.dur + 0.02);
        osc.onended = () => {
          try {
            osc.disconnect();
            g.disconnect();
          } catch {
            // ignore
          }
        };
      }
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }
  /**
   * Gentle, low "mmmrrrow?" protest when the cat gets tired of non-stop typing.
   * Deliberately soft: low sine + soft triangle blend through a lowpass, no harsh highs.
   */
  public playAngryGrunt(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      const t0 = ctx.currentTime + 0.01;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(520, t0);
      lp.Q.value = 0.7;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.055, t0 + 0.06);
      g.gain.linearRampToValueAtTime(0.045, t0 + 0.42);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.62);

      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, t0);
      osc.frequency.linearRampToValueAtTime(178, t0 + 0.16);
      osc.frequency.linearRampToValueAtTime(132, t0 + 0.5);

      const sub = ctx.createOscillator();
      sub.type = 'triangle';
      sub.frequency.setValueAtTime(74, t0);
      sub.frequency.linearRampToValueAtTime(66, t0 + 0.5);

      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0.0001, t0);
      subGain.gain.linearRampToValueAtTime(0.028, t0 + 0.08);
      subGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);

      osc.connect(lp);
      sub.connect(subGain);
      lp.connect(g);
      subGain.connect(g);
      g.connect(ctx.destination);

      osc.start(t0);
      sub.start(t0);
      osc.stop(t0 + 0.64);
      sub.stop(t0 + 0.6);
      osc.onended = () => {
        try {
          osc.disconnect();
          sub.disconnect();
          lp.disconnect();
          g.disconnect();
          subGain.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  /** Soft sleepy inhale-then-sigh for a yawn (breathy noise + falling tone). */
  public playYawnBreath(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      const t0 = ctx.currentTime + 0.01;

      // 1) airy inhale
      const len = Math.max(1, Math.floor(ctx.sampleRate * 1.05));
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) {
        const k = i / len;
        data[i] = (Math.random() * 2 - 1) * Math.sin(Math.PI * Math.pow(k, 0.75));
      }
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(900, t0);
      bp.frequency.linearRampToValueAtTime(520, t0 + 0.95);
      bp.Q.value = 0.9;
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t0);
      ng.gain.linearRampToValueAtTime(0.032, t0 + 0.32);
      ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.0);
      src.connect(bp);
      bp.connect(ng);
      ng.connect(ctx.destination);

      // 2) sleepy downward sigh
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      const g = ctx.createGain();
      osc.frequency.setValueAtTime(330, t0 + 0.18);
      osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.95);
      g.gain.setValueAtTime(0.0001, t0 + 0.18);
      g.gain.linearRampToValueAtTime(0.022, t0 + 0.34);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.98);
      osc.connect(g);
      g.connect(ctx.destination);

      src.start(t0);
      src.stop(t0 + 1.02);
      osc.start(t0 + 0.18);
      osc.stop(t0 + 1.0);
      src.onended = () => {
        try {
          src.disconnect();
          bp.disconnect();
          ng.disconnect();
          osc.disconnect();
          g.disconnect();
        } catch {
          // ignore
        }
      };
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }

  /**
   * Warm happy chirp + purr swell when the cat is petted.
   * Two rising soft notes (like a contented "mrrp") with a gentle breath tail.
   */
  public playHappyPet(): void {
    const ctx = this.getReadyContext();
    if (!ctx) return;

    try {
      const t0 = ctx.currentTime + 0.01;
      const notes: Array<{ f0: number; f1: number; delay: number; dur: number; gain: number }> = [
        { f0: 620, f1: 780, delay: 0.0, dur: 0.15, gain: 0.05 },
        { f0: 780, f1: 940, delay: 0.12, dur: 0.19, gain: 0.045 },
      ];
      for (const n of notes) {
        const osc = ctx.createOscillator();
        const lp = ctx.createBiquadFilter();
        const g = ctx.createGain();
        osc.type = 'sine';
        lp.type = 'lowpass';
        lp.frequency.value = 2200;
        osc.frequency.setValueAtTime(n.f0, t0 + n.delay);
        osc.frequency.exponentialRampToValueAtTime(n.f1, t0 + n.delay + n.dur * 0.8);
        g.gain.setValueAtTime(0.0001, t0 + n.delay);
        g.gain.linearRampToValueAtTime(n.gain, t0 + n.delay + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.delay + n.dur);
        osc.connect(lp);
        lp.connect(g);
        g.connect(ctx.destination);
        osc.start(t0 + n.delay);
        osc.stop(t0 + n.delay + n.dur + 0.02);
        osc.onended = () => {
          try {
            osc.disconnect();
            lp.disconnect();
            g.disconnect();
          } catch {
            // ignore
          }
        };
      }
    } catch {
      // Never throw on blocked autoplay or missing audio hardware
    }
  }
}

export const catAudio = new CatAudio();
