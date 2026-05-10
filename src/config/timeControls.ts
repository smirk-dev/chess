/**
 * Time-control presets. `Unlimited` is a sentinel meaning "no clock at all" — the ClockDisplay is
 * hidden and ClockService becomes a no-op.
 */
export interface TimeControl {
  id: string;
  label: string;
  /** Starting time per side, in ms. `null` => unlimited (no clock). */
  baseMs: number | null;
  /** Fischer increment added to a side's clock after it moves, in ms. */
  incrementMs: number;
}

export const TIME_CONTROLS: readonly TimeControl[] = [
  { id: 'unlimited', label: 'Unlimited',  baseMs: null,        incrementMs: 0 },
  { id: 'blitz-5-0', label: '5 + 0',      baseMs: 5 * 60_000,  incrementMs: 0 },
  { id: 'blitz-3-2', label: '3 + 2',      baseMs: 3 * 60_000,  incrementMs: 2_000 },
  { id: 'rapid-10-5', label: '10 + 5',    baseMs: 10 * 60_000, incrementMs: 5_000 },
];

export const DEFAULT_TIME_CONTROL_ID = 'unlimited';

export function getTimeControlById(id: string): TimeControl {
  return TIME_CONTROLS.find((t) => t.id === id) ?? TIME_CONTROLS[0]!;
}

export function isUnlimited(tc: TimeControl): boolean {
  return tc.baseMs === null;
}
