/**
 * Engine-wide constants. Keeping these in one place makes it obvious which knobs are "configured
 * target strength" (the user-facing Elo) versus internal protocol details.
 */

/**
 * Stockfish's documented `UCI_Elo` range. Setting `UCI_LimitStrength=true` is required for
 * `UCI_Elo` to take effect at all; outside this band Stockfish clamps internally — we clamp too so
 * the displayed Elo and the value actually sent never drift apart.
 */
export const STOCKFISH_MIN_ELO = 1320;
export const STOCKFISH_MAX_ELO = 3190;

export function clampElo(elo: number): number {
  if (!Number.isFinite(elo)) return STOCKFISH_MIN_ELO;
  return Math.max(STOCKFISH_MIN_ELO, Math.min(STOCKFISH_MAX_ELO, Math.round(elo)));
}

/**
 * Which Stockfish build the app drives. We ship the single-threaded "lite" build so the page needs
 * no SharedArrayBuffer and therefore no COOP/COEP cross-origin-isolation headers. A multi-threaded
 * build is faster at a given depth but requires those headers (and the full build's .wasm is
 * >100 MB). Switching is a one-line change here plus adding the headers to the dev server / host;
 * see vite.config.ts and scripts/copy-engine.mjs.
 */
export const ENGINE_VARIANT = 'single-threaded-lite' as const;

/** Where the engine worker glue + wasm live (relative to the app base URL). */
export const ENGINE_DIR = 'engine';
/** The copy-engine script writes this manifest; the loader reads it to find the entry filename. */
export const ENGINE_MANIFEST_PATH = `${ENGINE_DIR}/engine-manifest.json`;
/** Used only if the manifest is missing/unreadable. */
export const ENGINE_FALLBACK_ENTRY = `${ENGINE_DIR}/stockfish-18-lite-single.js`;

/** How long to wait for `uciok` before declaring the engine failed to load (ms). */
export const ENGINE_BOOT_TIMEOUT_MS = 12_000;
/** How long to wait for `readyok` after `isready` (ms). */
export const ENGINE_READY_TIMEOUT_MS = 12_000;
/** Safety cap: if `bestmove` never arrives within movetime + this slack, treat as an engine fault. */
export const ENGINE_MOVE_TIMEOUT_SLACK_MS = 8_000;

/** PV/info updates are throttled to at most one callback per this interval (leading + trailing). */
export const PV_THROTTLE_MS = 180;

/** Toggle verbose engine lifecycle logging. Defaults to dev only. */
export const ENGINE_DEBUG_LOGGING = import.meta.env.DEV;
