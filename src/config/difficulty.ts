import { clampElo } from './engineConstants';

/**
 * Difficulty is implemented honestly: every level limits the engine via `UCI_LimitStrength=true` +
 * `UCI_Elo`. Weak play comes from the engine's own strength-limiting, never from substituting
 * random or deliberately bad moves. The `movetime` band scales with level so stronger settings
 * actually get to use their strength while weaker ones still feel snappy; we pick the band midpoint
 * by default with a small jitter purely so the opponent's timing isn't robotic (it never changes
 * which move is chosen beyond what Stockfish does within that time budget).
 */
export interface DifficultyPreset {
  id: string;
  label: string;
  /** Target engine Elo (clamped to Stockfish's documented range). This is what the EloBadge shows. */
  elo: number;
  /** Inclusive [min, max] think-time band in milliseconds for `go movetime`. */
  movetimeBandMs: readonly [number, number];
  /** Short blurb for the difficulty selector. */
  blurb: string;
}

function preset(
  id: string,
  label: string,
  elo: number,
  band: readonly [number, number],
  blurb: string,
): DifficultyPreset {
  return { id, label, elo: clampElo(elo), movetimeBandMs: band, blurb };
}

export const DIFFICULTY_PRESETS: readonly DifficultyPreset[] = [
  preset('beginner', 'Beginner', 1320, [150, 300], 'Gentle. Good for learning the moves.'),
  preset('casual', 'Casual', 1600, [200, 400], 'Club-newcomer strength.'),
  preset('intermediate', 'Intermediate', 1900, [300, 600], 'Solid club player. Punishes blunders.'),
  preset('advanced', 'Advanced', 2200, [500, 900], 'Strong club / candidate-master level.'),
  preset('expert', 'Expert', 2600, [800, 1400], 'Master strength. Tough.'),
  preset('maximum', 'Maximum (limited)', 3190, [1200, 2000], 'Top of the engine’s Elo-limited range.'),
];

export const DEFAULT_DIFFICULTY_ID = 'intermediate';

export function getDifficultyById(id: string): DifficultyPreset {
  return DIFFICULTY_PRESETS.find((p) => p.id === id) ?? getDefaultDifficulty();
}

export function getDefaultDifficulty(): DifficultyPreset {
  return DIFFICULTY_PRESETS.find((p) => p.id === DEFAULT_DIFFICULTY_ID) ?? DIFFICULTY_PRESETS[2]!;
}

/**
 * Pick a think time for one engine move from a preset's band. Defaults to the midpoint with a small
 * ±25% jitter; `rng` is injectable for deterministic tests (pass `() => 0.5` for the exact midpoint).
 */
export function pickMovetimeMs(preset: DifficultyPreset, rng: () => number = Math.random): number {
  const [lo, hi] = preset.movetimeBandMs;
  const mid = (lo + hi) / 2;
  const jitterSpan = (hi - lo) / 2; // full band width / 2 -> midpoint ± up to half-band, but we damp it
  const jittered = mid + (rng() * 2 - 1) * jitterSpan * 0.5;
  return Math.round(Math.max(lo, Math.min(hi, jittered)));
}
