import type { UciMove } from '../domain/san';

/** Lifecycle state of the engine session, surfaced to the UI. */
export type EngineState =
  | 'uninitialized'
  | 'booting' // worker created, handshake in progress
  | 'ready' // idle, ready to accept a search
  | 'thinking' // a `go` is outstanding
  | 'error' // failed to load / crashed / protocol fault
  | 'disposed';

export type EngineErrorCode =
  | 'load-failed' // worker couldn't be created or `uciok` never arrived
  | 'crashed' // worker.onerror after a successful boot
  | 'timeout' // expected response never arrived
  | 'protocol' // engine said something we can't reconcile (e.g. `bestmove (none)` mid-game)
  | 'disposed'; // operation attempted after dispose()

export interface EngineError {
  code: EngineErrorCode;
  message: string;
}

/** A score from the engine's point of view (side to move). Exactly one of the fields is set. */
export interface EngineScore {
  cp?: number; // centipawns
  mateIn?: number; // plies to mate; sign = who's mating (positive = side to move)
}

export interface PvUpdate {
  /** Which `requestMove` call this info belongs to (for stale-rejection upstream). */
  token: number;
  depth: number;
  multipv?: number;
  score?: EngineScore;
  /** Principal variation as UCI moves (possibly truncated). */
  pvUci: UciMove[];
  nodes?: number;
  nps?: number;
  /** Search time so far, ms. */
  timeMs?: number;
}

export interface MoveRequest {
  token: number;
  /** Full game history as UCI moves; rebuilds the position from `startpos`. Preferred over `fen`. */
  movesUci?: readonly UciMove[];
  /** Alternative: a raw FEN. Used only if `movesUci` isn't available. */
  fen?: string;
  /** Search budget for `go movetime` (ms). */
  movetimeMs: number;
}

export interface MoveResult {
  token: number;
  bestMove: UciMove;
  ponder?: UciMove;
}

/** Thrown (as a rejection) from `requestMove` when the search was cancelled before `bestmove`. */
export class EngineCancelledError extends Error {
  constructor(public readonly token: number) {
    super(`Engine search cancelled (token ${token})`);
    this.name = 'EngineCancelledError';
  }
}

export class EngineFaultError extends Error {
  constructor(public readonly engineError: EngineError) {
    super(`Engine ${engineError.code}: ${engineError.message}`);
    this.name = 'EngineFaultError';
  }
}
