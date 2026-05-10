/**
 * A simple two-sided chess clock with Fischer increment. Time is computed from real wall-clock
 * deltas (`now()` — injectable), not by counting ticks, so a throttled / backgrounded tab still
 * accounts time correctly. The clock runs for whichever side is *to move* — including while the
 * engine is thinking, mirroring real play. `Unlimited` time control makes everything a no-op.
 *
 * Both the timer source and `now()` are injectable so tests can drive it deterministically.
 */
import { isUnlimited, type TimeControl } from '../config/timeControls';
import type { ClockSide, ClockSnapshot } from './types';

type Now = () => number;
type Scheduler = {
  setInterval: (cb: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearInterval: (handle: ReturnType<typeof setInterval>) => void;
};

const realScheduler: Scheduler = {
  setInterval: (cb, ms) => setInterval(cb, ms),
  clearInterval: (h) => clearInterval(h),
};

const TICK_MS = 200;

export interface ClockServiceOptions {
  now?: Now;
  scheduler?: Scheduler;
  /** Called once when a side's clock reaches zero. */
  onFlag?: (side: ClockSide) => void;
  /** Called (throttled to ~tick rate) whenever the displayed time changes. */
  onChange?: (snapshot: ClockSnapshot) => void;
}

export class ClockService {
  private readonly now: Now;
  private readonly scheduler: Scheduler;
  private onFlag: ((side: ClockSide) => void) | undefined;
  private onChange: ((snapshot: ClockSnapshot) => void) | undefined;

  private unlimited = true;
  private incrementMs = 0;
  private remaining: Record<ClockSide, number> = { w: 0, b: 0 };
  private activeSide: ClockSide | null = null;
  private running = false;
  private lastTickAt = 0;
  private handle: ReturnType<typeof setInterval> | null = null;
  private flagged = false;

  constructor(opts: ClockServiceOptions = {}) {
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.scheduler = opts.scheduler ?? realScheduler;
    this.onFlag = opts.onFlag;
    this.onChange = opts.onChange;
  }

  setHandlers(handlers: { onFlag?: (side: ClockSide) => void; onChange?: (s: ClockSnapshot) => void }): void {
    if (handlers.onFlag) this.onFlag = handlers.onFlag;
    if (handlers.onChange) this.onChange = handlers.onChange;
  }

  /** Configure for a new game. Stops any running clock. Does not start ticking. */
  reset(tc: TimeControl): void {
    this.stopTicking();
    this.unlimited = isUnlimited(tc);
    this.incrementMs = this.unlimited ? 0 : tc.incrementMs;
    const base = this.unlimited ? 0 : (tc.baseMs ?? 0);
    this.remaining = { w: base, b: base };
    this.activeSide = null;
    this.running = false;
    this.flagged = false;
    this.lastTickAt = 0;
    this.emit();
  }

  /** Begin counting down for `side` (e.g. White at the start of the game). */
  start(side: ClockSide): void {
    if (this.unlimited || this.flagged) return;
    this.settle();
    this.activeSide = side;
    this.running = true;
    this.lastTickAt = this.now();
    this.ensureTicking();
    this.emit();
  }

  /**
   * The side that just moved gets its increment; the clock then switches to the other side. Call
   * once per applied ply (human or engine).
   */
  switchTurn(): void {
    if (this.unlimited || this.flagged) return;
    this.settle();
    const moved = this.activeSide;
    if (moved) this.remaining[moved] += this.incrementMs;
    this.activeSide = moved ? (moved === 'w' ? 'b' : 'w') : null;
    this.lastTickAt = this.now();
    this.running = this.activeSide != null;
    if (this.running) this.ensureTicking();
    else this.stopTicking();
    this.emit();
  }

  /** Pause without changing whose turn it is (e.g. game over). */
  pause(): void {
    if (!this.running) return;
    this.settle();
    this.running = false;
    this.stopTicking();
    this.emit();
  }

  resume(): void {
    if (this.unlimited || this.flagged || this.running || this.activeSide == null) return;
    this.running = true;
    this.lastTickAt = this.now();
    this.ensureTicking();
    this.emit();
  }

  getSnapshot(): ClockSnapshot {
    return {
      remainingMs: { w: Math.max(0, this.remaining.w), b: Math.max(0, this.remaining.b) },
      activeSide: this.activeSide,
      running: this.running,
      unlimited: this.unlimited,
      incrementMs: this.incrementMs,
    };
  }

  dispose(): void {
    this.stopTicking();
    this.onFlag = undefined;
    this.onChange = undefined;
  }

  // ---- internals ----------------------------------------------------------

  /** Apply the elapsed real time since the last settle to the active side; handle flag-fall. */
  private settle(): void {
    if (!this.running || this.activeSide == null) return;
    const t = this.now();
    const elapsed = Math.max(0, t - this.lastTickAt);
    this.lastTickAt = t;
    const side = this.activeSide;
    this.remaining[side] -= elapsed;
    if (this.remaining[side] <= 0 && !this.flagged) {
      this.remaining[side] = 0;
      this.flagged = true;
      this.running = false;
      const flaggedSide = side;
      this.activeSide = null;
      this.stopTicking();
      this.emit();
      this.onFlag?.(flaggedSide);
    }
  }

  private ensureTicking(): void {
    if (this.handle != null || this.unlimited) return;
    this.handle = this.scheduler.setInterval(() => {
      this.settle();
      if (!this.flagged) this.emit();
    }, TICK_MS);
  }

  private stopTicking(): void {
    if (this.handle != null) {
      this.scheduler.clearInterval(this.handle);
      this.handle = null;
    }
  }

  private emit(): void {
    this.onChange?.(this.getSnapshot());
  }
}
