import { catAudio } from './audio';

export type AgentStatusKind = 'working' | 'thinking' | 'waiting' | 'done' | 'error' | 'idle';
export type AgentActionKind =
  | 'happy'
  | 'pet'
  | 'angry'
  | 'curious'
  | 'sleep'
  | 'wake'
  | 'tail_pat';

export interface AgentCompanionEvent {
  kind: 'status' | 'action' | 'bubble';
  status?: AgentStatusKind | string;
  action?: AgentActionKind | string;
  source?: string;
  text?: string;
  tool?: string;
  autoType?: boolean;
  sound?: boolean;
  ttlMs?: number;
  ts?: number;
}

export interface AgentCompanionTarget {
  onKeyDown(vk: number, repeat?: boolean): void;
  onKeyUp(vk: number): void;
  triggerCuriousDemo(duration?: number): void;
  triggerCrossDemo(): void;
  triggerSleepDemo(): void;
  triggerHappyDemo?(duration?: number): void;
  triggerWakeDemo?(): void;
  triggerTailPatDemo?(): void;
  /** 换岗 emotes: implementations are optional per renderer. */
  triggerSaluteDemo?(): void;
  triggerHissDemo?(): void;
  triggerIgnoreDemo?(): void;
  triggerHeartDemo?(): void;
}

// Natural coding keystroke VKs (home-row letters, symbols, space, enter, backspace)
const CODING_VKS: readonly number[] = [
  0x41, 0x43, 0x44, 0x45, 0x46, 0x47, 0x49, 0x4c, 0x4d, 0x4e,
  0x4f, 0x50, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x20,
  0x20, 0x0d, 0x08, 0xbc, 0xbe,
];

export interface AgentCompanionOptions {
  bubbleEl: HTMLDivElement | null;
  getTarget: () => AgentCompanionTarget | null;
  is3DTarget: () => boolean;
  allowSound: () => boolean;
}

export class AgentCompanionController {
  private readonly bubbleEl: HTMLDivElement | null;
  private readonly getTarget: () => AgentCompanionTarget | null;
  private readonly is3DTarget: () => boolean;
  private readonly allowSound: () => boolean;

  private activeStatus: AgentStatusKind = 'idle';
  private privacyPaused = false;
  private autoTyping = false;
  private realUserInputUntil = 0;
  private typeTimer: number | null = null;
  private releaseTimers = new Set<number>();
  private heldVirtualVks = new Set<number>();
  private ttlTimer: number | null = null;
  private burstRemaining = 0;
  private lastSoundAt = 0;

  constructor(opts: AgentCompanionOptions) {
    this.bubbleEl = opts.bubbleEl;
    this.getTarget = opts.getTarget;
    this.is3DTarget = opts.is3DTarget;
    this.allowSound = opts.allowSound;
  }

  public setPrivacyMode(active: boolean): void {
    this.privacyPaused = Boolean(active);
    if (this.privacyPaused) {
      this.releaseAllVirtualKeys();
      this.hideBubble();
    }
  }

  /** Pause synthetic coding keystrokes briefly so the user's real keyboard/mouse always wins. */
  public notifyRealUserInput(): void {
    if (!this.autoTyping) return;
    this.realUserInputUntil = performance.now() + 1800;
    this.releaseAllVirtualKeys();
  }

  public handleEvent(ev: AgentCompanionEvent): void {
    if (!ev || typeof ev !== 'object') return;
    if (this.privacyPaused) return;

    this.clearTtlTimer();
    const target = this.getTarget();
    const is3d = this.is3DTarget();
    const ttl = Math.max(1200, Math.min(300_000, ev.ttlMs ?? 6500));

    if (ev.kind === 'action' && ev.action) {
      this.stopAutoTyping();
      this.activeStatus = 'idle';
      this.dispatchAction(ev.action, target, is3d);
      if (ev.text) {
        this.showBubble(ev.source, ev.text, 'info');
        this.scheduleTtlClear(ttl);
      }
      if (ev.sound && this.allowSound()) {
        this.playNoticeThrottled(ev.action === 'angry' ? 'error' : 'done');
      }
      return;
    }

    if (ev.kind === 'bubble') {
      if (ev.text) {
        this.showBubble(ev.source, ev.text, 'info');
        this.scheduleTtlClear(ttl);
      } else {
        this.hideBubble();
      }
      return;
    }

    const status = (ev.status || 'idle').toLowerCase() as AgentStatusKind;
    this.activeStatus = status;

    switch (status) {
      case 'working': {
        if (ev.autoType !== false) {
          this.startAutoTyping();
        } else {
          this.stopAutoTyping();
        }
        this.showBubble(ev.source, ev.text || '写代码中…', 'working');
        this.scheduleTtlClear(ev.ttlMs ?? 45_000);
        break;
      }
      case 'thinking': {
        if (ev.autoType) {
          this.startAutoTyping();
        } else {
          this.stopAutoTyping();
        }
        target?.triggerCuriousDemo(is3d ? 2.6 : 2600);
        this.showBubble(ev.source, ev.text || '思考中…', 'thinking');
        this.scheduleTtlClear(ev.ttlMs ?? 35_000);
        break;
      }
      case 'waiting': {
        this.stopAutoTyping();
        target?.triggerCuriousDemo(is3d ? 4.2 : 4200);
        this.showBubble(ev.source, ev.text || '等你确认操作', 'waiting');
        this.scheduleTtlClear(ev.ttlMs ?? 90_000);
        if (ev.sound !== false && this.allowSound()) {
          this.playNoticeThrottled('waiting');
        }
        break;
      }
      case 'done': {
        this.stopAutoTyping();
        if (target?.triggerHappyDemo) {
          target.triggerHappyDemo(is3d ? 2.8 : 2800);
        } else {
          target?.triggerCuriousDemo(is3d ? 2.2 : 2200);
        }
        this.showBubble(ev.source, ev.text || '任务完成！', 'done');
        this.scheduleTtlClear(ev.ttlMs ?? 6_500);
        if (ev.sound !== false && this.allowSound()) {
          this.playNoticeThrottled('done');
        }
        break;
      }
      case 'error': {
        this.stopAutoTyping();
        target?.triggerCrossDemo();
        this.showBubble(ev.source, ev.text || '任务出错了', 'error');
        this.scheduleTtlClear(ev.ttlMs ?? 8_500);
        if (ev.sound !== false && this.allowSound()) {
          this.playNoticeThrottled('error');
        }
        break;
      }
      default: {
        this.stopAutoTyping();
        if (ev.text) {
          this.showBubble(ev.source, ev.text, 'info');
          this.scheduleTtlClear(ev.ttlMs ?? 3_200);
        } else {
          this.hideBubble();
        }
        break;
      }
    }
  }

  private dispatchAction(
    action: string,
    target: AgentCompanionTarget | null,
    is3d: boolean,
  ): void {
    if (!target) return;
    switch (action.toLowerCase()) {
      case 'happy':
      case 'pet':
        if (target.triggerHappyDemo) {
          target.triggerHappyDemo(is3d ? 2.8 : 2800);
        } else {
          target.triggerCuriousDemo(is3d ? 2.4 : 2400);
        }
        break;
      case 'angry':
        target.triggerCrossDemo();
        break;
      case 'curious':
        target.triggerCuriousDemo(is3d ? 3.5 : 3500);
        break;
      case 'sleep':
        target.triggerSleepDemo();
        break;
      case 'wake':
        if (target.triggerWakeDemo) {
          target.triggerWakeDemo();
        } else {
          target.triggerCuriousDemo(is3d ? 1.5 : 1500);
        }
        break;
      case 'tail_pat':
        if (target.triggerTailPatDemo) {
          target.triggerTailPatDemo();
        } else {
          target.onKeyDown(0x0d, false);
          window.setTimeout(() => target.onKeyUp(0x0d), 140);
        }
        break;
      case 'salute':
        target.triggerSaluteDemo?.();
        break;
      case 'hiss':
        target.triggerHissDemo?.();
        break;
      case 'ignore':
        target.triggerIgnoreDemo?.();
        break;
      case 'heart':
        target.triggerHeartDemo?.();
        break;
    }
  }

  /**
   * 换岗动效: pick a random emote when the user switches cats.
   * Renderers only implement the poses they can draw, so filter by presence
   * (the 3D engine has salute + heart only).
   */
  public playSwitchEmote(): void {
    const target = this.getTarget();
    if (!target) return;
    const pool = [
      {
        emoji: '🫡',
        text: '敬礼！',
        available: typeof target.triggerSaluteDemo === 'function',
        run: () => target.triggerSaluteDemo?.(),
      },
      {
        emoji: '😾',
        text: '哈——气！',
        available: typeof target.triggerHissDemo === 'function',
        run: () => target.triggerHissDemo?.(),
      },
      {
        emoji: '🥱',
        text: '谁理你。',
        available: typeof target.triggerIgnoreDemo === 'function',
        run: () => target.triggerIgnoreDemo?.(),
      },
      {
        emoji: '💚',
        text: '比个心',
        available: typeof target.triggerHeartDemo === 'function',
        run: () => target.triggerHeartDemo?.(),
      },
    ].filter((e) => e.available);
    if (pool.length === 0) return;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    if (pick) {
      pick.run();
      this.playEmote(pick.emoji, pick.text);
    }
  }

  /** Show a short reaction bubble (no status semantics attached). */
  public playEmote(emoji: string, text: string): void {
    const el = this.bubbleEl;
    if (!el) return;
    el.dataset.tone = 'info';
    el.textContent = `${emoji} ${text}`;
    el.classList.remove('hidden');
    this.scheduleTtlClear(2400);
  }

  private playNoticeThrottled(kind: 'done' | 'waiting' | 'error'): void {
    const now = performance.now();
    if (now - this.lastSoundAt < 1200) return;
    this.lastSoundAt = now;
    catAudio.playAgentNotice(kind);
  }

  private startAutoTyping(): void {
    if (this.autoTyping) return;
    this.autoTyping = true;
    this.burstRemaining = 5 + Math.floor(Math.random() * 7);
    this.scheduleNextVirtualKey(40);
  }

  private stopAutoTyping(): void {
    this.autoTyping = false;
    if (this.typeTimer !== null) {
      window.clearTimeout(this.typeTimer);
      this.typeTimer = null;
    }
    this.releaseAllVirtualKeys();
  }

  private releaseAllVirtualKeys(): void {
    for (const id of this.releaseTimers) {
      window.clearTimeout(id);
    }
    this.releaseTimers.clear();
    const target = this.getTarget();
    for (const vk of this.heldVirtualVks) {
      target?.onKeyUp(vk);
    }
    this.heldVirtualVks.clear();
  }

  private scheduleNextVirtualKey(delayMs: number): void {
    if (!this.autoTyping) return;
    if (this.typeTimer !== null) {
      window.clearTimeout(this.typeTimer);
    }
    this.typeTimer = window.setTimeout(() => {
      this.typeTimer = null;
      if (!this.autoTyping) return;

      const now = performance.now();
      if (this.privacyPaused || now < this.realUserInputUntil) {
        this.scheduleNextVirtualKey(260);
        return;
      }

      const target = this.getTarget();
      if (target) {
        const vk = CODING_VKS[Math.floor(Math.random() * CODING_VKS.length)];
        target.onKeyDown(vk, false);
        this.heldVirtualVks.add(vk);
        const holdMs = 55 + Math.floor(Math.random() * 55);
        const rid = window.setTimeout(() => {
          this.releaseTimers.delete(rid);
          if (this.heldVirtualVks.delete(vk)) {
            this.getTarget()?.onKeyUp(vk);
          }
        }, holdMs);
        this.releaseTimers.add(rid);
      }

      this.burstRemaining -= 1;
      if (this.burstRemaining <= 0) {
        this.burstRemaining = 5 + Math.floor(Math.random() * 8);
        this.scheduleNextVirtualKey(260 + Math.floor(Math.random() * 340));
      } else {
        this.scheduleNextVirtualKey(75 + Math.floor(Math.random() * 105));
      }
    }, delayMs);
  }

  private showBubble(
    source: string | undefined,
    text: string,
    tone: 'working' | 'thinking' | 'waiting' | 'done' | 'error' | 'info',
  ): void {
    const el = this.bubbleEl;
    if (!el) return;
    const prefix = source && source !== 'AI' && source !== 'MCP' ? `${source} · ` : '';
    const icon =
      tone === 'working'
        ? '💻'
        : tone === 'thinking'
          ? '🧠'
          : tone === 'waiting'
            ? '⏳'
            : tone === 'done'
              ? '✅'
              : tone === 'error'
                ? '❌'
                : '🐾';
    el.dataset.tone = tone;
    el.textContent = `${icon} ${prefix}${text}`;
    el.classList.remove('hidden');
  }

  private hideBubble(): void {
    if (!this.bubbleEl) return;
    this.bubbleEl.classList.add('hidden');
  }

  private clearTtlTimer(): void {
    if (this.ttlTimer !== null) {
      window.clearTimeout(this.ttlTimer);
      this.ttlTimer = null;
    }
  }

  private scheduleTtlClear(ms: number): void {
    this.clearTtlTimer();
    this.ttlTimer = window.setTimeout(() => {
      this.ttlTimer = null;
      this.activeStatus = 'idle';
      this.stopAutoTyping();
      this.hideBubble();
    }, ms);
  }

  public getStatus(): AgentStatusKind {
    return this.activeStatus;
  }

  public dispose(): void {
    this.clearTtlTimer();
    this.stopAutoTyping();
    this.hideBubble();
  }
}
