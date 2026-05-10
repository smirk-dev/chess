import type { Color } from 'chess.js';
import type { TimeControl } from '../config/timeControls';

export type ClockSide = Color;

export interface ClockSnapshot {
  /** Remaining milliseconds per side. */
  remainingMs: Record<ClockSide, number>;
  /** Side whose clock is currently ticking, or `null` if paused / unlimited / not started. */
  activeSide: ClockSide | null;
  running: boolean;
  /** `true` when this game has no clock (Unlimited time control) — the UI hides the clock display. */
  unlimited: boolean;
  incrementMs: number;
}

export type { TimeControl };
