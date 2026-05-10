/**
 * The clean, protocol-aware interface the rest of the app uses to talk to the chess engine. It owns
 * a UciAdapter (the Worker channel) and a tiny serialized command queue, and translates UCI text
 * into promises and callbacks:
 *
 *   init()           boot worker, run  uci -> uciok -> isready -> readyok
 *   newGame(elo)     ucinewgame -> isready/readyok, then (re)apply strength options
 *   setStrength(elo) setoption UCI_LimitStrength true ; setoption UCI_Elo <elo>
 *   requestMove(req) position startpos moves ... ; go movetime <ms> ; resolve on `bestmove`
 *   cancel()         send `stop`; the in-flight requestMove rejects EngineCancelledError
 *   dispose()        terminate the worker; reject anything in flight
 *
 * Difficulty changes are applied here only at a clean boundary (newGame, or an explicit setStrength
 * call between searches) — never mid-search. The controller decides *when*; this just does it.
 */
import {
  ENGINE_BOOT_TIMEOUT_MS,
  ENGINE_DEBUG_LOGGING,
  ENGINE_MOVE_TIMEOUT_SLACK_MS,
  ENGINE_READY_TIMEOUT_MS,
  PV_THROTTLE_MS,
  clampElo,
} from '../config/engineConstants';
import { uciLogPush } from '../diagnostics/uciLog';
import { UciAdapter } from './UciAdapter';
import { defaultEngineWorkerFactory, type EngineWorkerFactory } from './engineWorkerLoader';
import {
  isReadyOk,
  isUciOk,
  parseBestMove,
  parseIdLine,
  parseInfoLine,
  parseOptionLine,
} from './uciParser';
import {
  EngineCancelledError,
  EngineFaultError,
  type EngineError,
  type EngineErrorCode,
  type EngineState,
  type MoveRequest,
  type MoveResult,
  type PvUpdate,
} from './types';

type StateListener = (state: EngineState) => void;
type ErrorListener = (err: EngineError) => void;
type PvListener = (pv: PvUpdate) => void;

interface PendingDeferred<T> {
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

interface PendingSearch {
  token: number;
  cancelled: boolean;
  resolve: (r: MoveResult) => void;
  reject: (e: unknown) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export interface EngineInfoSnapshot {
  state: EngineState;
  name: string | null;
  appliedElo: number | null;
  limitStrength: boolean;
  supportsEloLimiting: boolean;
  currentToken: number | null;
  error: EngineError | null;
}

export class EngineService {
  private readonly adapter: UciAdapter;

  private state: EngineState = 'uninitialized';
  private error: EngineError | null = null;

  private engineName: string | null = null;
  private seenOptions = new Set<string>();
  private appliedElo: number | null = null;
  private limitStrength = false;

  private chain: Promise<unknown> = Promise.resolve();

  private pendingUciok: PendingDeferred<void> | null = null;
  private pendingReadyok: PendingDeferred<void> | null = null;
  private pendingSearch: PendingSearch | null = null;

  private initPromise: Promise<void> | null = null;

  private readonly stateListeners = new Set<StateListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly pvListeners = new Set<PvListener>();

  // PV throttle (leading + trailing).
  private pvLastEmitAt = 0;
  private pvTrailing: PvUpdate | null = null;
  private pvTrailingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(factory: EngineWorkerFactory = defaultEngineWorkerFactory) {
    this.adapter = new UciAdapter(factory);
    this.adapter.onLine((line) => this.handleLine(line));
    this.adapter.onError(({ message }) => this.fault('crashed', message));
  }

  // ---- public API ---------------------------------------------------------

  getState(): EngineState {
    return this.state;
  }

  getInfo(): EngineInfoSnapshot {
    return {
      state: this.state,
      name: this.engineName,
      appliedElo: this.appliedElo,
      limitStrength: this.limitStrength,
      supportsEloLimiting: this.seenOptions.has('UCI_LimitStrength') && this.seenOptions.has('UCI_Elo'),
      currentToken: this.pendingSearch?.token ?? null,
      error: this.error,
    };
  }

  onStateChange(cb: StateListener): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  onError(cb: ErrorListener): () => void {
    this.errorListeners.add(cb);
    return () => this.errorListeners.delete(cb);
  }

  onPvUpdate(cb: PvListener): () => void {
    this.pvListeners.add(cb);
    return () => this.pvListeners.delete(cb);
  }

  /** Boot the worker and complete the UCI handshake. Idempotent; safe to await repeatedly. */
  init(): Promise<void> {
    if (this.state === 'disposed') return Promise.reject(this.faultError('disposed', 'engine disposed'));
    if (this.state === 'ready' || this.state === 'thinking') return Promise.resolve();
    if (this.initPromise) return this.initPromise;
    this.error = null;
    this.initPromise = this.enqueue(async () => {
      this.setState('booting');
      await this.adapter.start();
      await this.handshake();
      this.setState('ready');
    }).catch((e) => {
      // Failure during boot => "load failed" rather than "crashed".
      if (this.state !== 'error' && this.state !== 'disposed') this.fault('load-failed', errMsg(e));
      throw e instanceof EngineFaultError ? e : this.faultError('load-failed', errMsg(e));
    });
    return this.initPromise;
  }

  /** Start a fresh game in the engine (clears hash) and (re)apply the strength options. */
  newGame(targetElo: number): Promise<void> {
    return this.enqueue(async () => {
      this.assertOperable();
      this.adapter.send('ucinewgame');
      await this.waitForReadyok();
      await this.applyStrength(targetElo);
    });
  }

  /** Apply Elo-limited strength. Call this only between searches (e.g. before the next engine turn). */
  setStrength(targetElo: number): Promise<void> {
    return this.enqueue(async () => {
      this.assertOperable();
      await this.applyStrength(targetElo);
    });
  }

  /**
   * Ask the engine for a move. Resolves with the `bestmove` (tagged with `req.token`), or rejects
   * with `EngineCancelledError` if `cancel()` was called first, or `EngineFaultError` on a fault.
   */
  requestMove(req: MoveRequest): Promise<MoveResult> {
    return this.enqueue(
      () =>
        new Promise<MoveResult>((resolve, reject) => {
          this.assertOperable();
          if (this.state !== 'ready') {
            reject(this.faultError('protocol', `requestMove while state=${this.state}`));
            return;
          }
          // Reset PV throttle for the new search.
          this.flushPvTrailing(true);
          this.pvLastEmitAt = 0;

          const positionCmd =
            req.movesUci && req.movesUci.length > 0
              ? `position startpos moves ${req.movesUci.join(' ')}`
              : req.fen
                ? `position fen ${req.fen}`
                : 'position startpos';

          const timer = setTimeout(() => {
            if (this.pendingSearch && this.pendingSearch.token === req.token) {
              this.pendingSearch = null;
              this.fault('timeout', `no bestmove within ${req.movetimeMs + ENGINE_MOVE_TIMEOUT_SLACK_MS}ms`);
              reject(this.faultError('timeout', 'engine did not reply with a move in time'));
            }
          }, req.movetimeMs + ENGINE_MOVE_TIMEOUT_SLACK_MS);

          this.pendingSearch = { token: req.token, cancelled: false, resolve, reject, timer };
          this.setState('thinking');
          if (ENGINE_DEBUG_LOGGING) uciLogPush('event', `search start token=${req.token} movetime=${req.movetimeMs}`);
          this.adapter.send(positionCmd);
          this.adapter.send(`go movetime ${Math.max(1, Math.round(req.movetimeMs))}`);
        }),
    );
  }

  /** Request the engine stop searching. The in-flight `requestMove` will reject `EngineCancelledError`. */
  cancel(): void {
    const ps = this.pendingSearch;
    if (ps && !ps.cancelled) {
      ps.cancelled = true;
      if (ENGINE_DEBUG_LOGGING) uciLogPush('event', `search cancel token=${ps.token}`);
      this.adapter.send('stop');
    }
  }

  dispose(): void {
    if (this.state === 'disposed') return;
    this.clearPvTrailingTimer();
    const err = this.faultError('disposed', 'engine disposed');
    this.rejectPendingUciok(err);
    this.rejectPendingReadyok(err);
    this.rejectPendingSearch(err);
    this.adapter.dispose();
    this.setState('disposed');
    this.stateListeners.clear();
    this.errorListeners.clear();
    this.pvListeners.clear();
  }

  // ---- queue --------------------------------------------------------------

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    // Keep the chain alive regardless of individual task outcomes.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // ---- handshake / readiness ---------------------------------------------

  private async handshake(): Promise<void> {
    this.adapter.send('uci');
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingUciok = null;
        reject(this.faultError('timeout', 'no uciok within boot timeout'));
      }, ENGINE_BOOT_TIMEOUT_MS);
      this.pendingUciok = { resolve, reject, timer };
    });
    await this.waitForReadyok();
  }

  private waitForReadyok(): Promise<void> {
    this.adapter.send('isready');
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingReadyok = null;
        reject(this.faultError('timeout', 'no readyok within ready timeout'));
      }, ENGINE_READY_TIMEOUT_MS);
      this.pendingReadyok = { resolve, reject, timer };
    });
  }

  private async applyStrength(targetElo: number): Promise<void> {
    const elo = clampElo(targetElo);
    this.adapter.send('setoption name UCI_LimitStrength value true');
    this.adapter.send(`setoption name UCI_Elo value ${elo}`);
    this.limitStrength = true;
    this.appliedElo = elo;
    // A readyok round-trip guarantees the options are absorbed before the next `go`.
    await this.waitForReadyok();
    if (ENGINE_DEBUG_LOGGING) uciLogPush('event', `strength applied: UCI_Elo=${elo}`);
  }

  // ---- inbound line handling ---------------------------------------------

  private handleLine(line: string): void {
    // 1) During a search, bestmove / info take priority.
    if (this.pendingSearch) {
      if (line.startsWith('bestmove')) {
        this.handleBestMove(line);
        return;
      }
      if (line.startsWith('info')) {
        this.handleInfo(line);
        return;
      }
    }
    // 2) Handshake: collect id/option lines, then resolve on uciok.
    if (this.pendingUciok) {
      const id = parseIdLine(line);
      if (id) {
        if (id.kind === 'name') this.engineName = id.value;
        return;
      }
      const opt = parseOptionLine(line);
      if (opt) {
        this.seenOptions.add(opt.name);
        return;
      }
      if (isUciOk(line)) {
        const p = this.pendingUciok;
        this.pendingUciok = null;
        if (p.timer) clearTimeout(p.timer);
        if (!this.seenOptions.has('UCI_Elo') && ENGINE_DEBUG_LOGGING) {
          uciLogPush('event', 'WARNING: engine did not advertise UCI_Elo — strength limiting may not work');
        }
        p.resolve();
        return;
      }
    }
    // 3) readyok for whoever is waiting.
    if (this.pendingReadyok && isReadyOk(line)) {
      const p = this.pendingReadyok;
      this.pendingReadyok = null;
      if (p.timer) clearTimeout(p.timer);
      p.resolve();
      return;
    }
    // Anything else (stray info outside a search, comments) is ignored.
  }

  private handleInfo(line: string): void {
    const info = parseInfoLine(line);
    if (!info || info.isString) return;
    if (info.pvUci.length === 0 && !info.score) return; // currmove-style chatter
    const ps = this.pendingSearch;
    if (!ps) return;
    const update: PvUpdate = {
      token: ps.token,
      depth: info.depth ?? 0,
      pvUci: info.pvUci,
      ...(info.multipv !== undefined ? { multipv: info.multipv } : {}),
      ...(info.score ? { score: info.score } : {}),
      ...(info.nodes !== undefined ? { nodes: info.nodes } : {}),
      ...(info.nps !== undefined ? { nps: info.nps } : {}),
      ...(info.timeMs !== undefined ? { timeMs: info.timeMs } : {}),
    };
    this.emitPv(update);
  }

  private handleBestMove(line: string): void {
    const ps = this.pendingSearch;
    if (!ps) return;
    this.pendingSearch = null;
    if (ps.timer) clearTimeout(ps.timer);
    this.flushPvTrailing(true);

    const parsed = parseBestMove(line);
    // Engine is idle again regardless of what we do with the result.
    if (this.state === 'thinking') this.setState('ready');

    if (ps.cancelled) {
      ps.reject(new EngineCancelledError(ps.token));
      return;
    }
    if (!parsed || parsed.bestMove === null) {
      // We only ever search when the game is live, so `(none)` / garbage is a protocol fault.
      const err = this.faultError('protocol', `unexpected bestmove line: "${line}"`);
      this.fault('protocol', err.message);
      ps.reject(err);
      return;
    }
    const result: MoveResult = { token: ps.token, bestMove: parsed.bestMove };
    if (parsed.ponder) result.ponder = parsed.ponder;
    if (ENGINE_DEBUG_LOGGING) uciLogPush('event', `bestmove token=${ps.token} -> ${result.bestMove}`);
    ps.resolve(result);
  }

  // ---- PV throttle --------------------------------------------------------

  private emitPv(update: PvUpdate): void {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this.pvLastEmitAt >= PV_THROTTLE_MS) {
      this.pvLastEmitAt = now;
      this.deliverPv(update);
      return;
    }
    this.pvTrailing = update;
    if (this.pvTrailingTimer == null) {
      const wait = Math.max(0, PV_THROTTLE_MS - (now - this.pvLastEmitAt));
      this.pvTrailingTimer = setTimeout(() => {
        this.pvTrailingTimer = null;
        this.flushPvTrailing(false);
      }, wait);
    }
  }

  private flushPvTrailing(discard: boolean): void {
    this.clearPvTrailingTimer();
    if (discard) {
      this.pvTrailing = null;
      return;
    }
    if (this.pvTrailing) {
      this.pvLastEmitAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const u = this.pvTrailing;
      this.pvTrailing = null;
      this.deliverPv(u);
    }
  }

  private clearPvTrailingTimer(): void {
    if (this.pvTrailingTimer != null) {
      clearTimeout(this.pvTrailingTimer);
      this.pvTrailingTimer = null;
    }
  }

  private deliverPv(update: PvUpdate): void {
    for (const l of this.pvListeners) {
      try {
        l(update);
      } catch (err) {
        if (ENGINE_DEBUG_LOGGING) console.error('[engine] pv listener threw', err);
      }
    }
  }

  // ---- state / faults -----------------------------------------------------

  private setState(s: EngineState): void {
    if (this.state === s) return;
    this.state = s;
    for (const l of this.stateListeners) {
      try {
        l(s);
      } catch {
        /* ignore */
      }
    }
  }

  private assertOperable(): void {
    if (this.state === 'disposed') throw this.faultError('disposed', 'engine disposed');
    if (this.state === 'error') throw this.faultError(this.error?.code ?? 'crashed', this.error?.message ?? 'engine in error state');
    if (this.state === 'uninitialized') throw this.faultError('protocol', 'engine not initialized — call init() first');
  }

  private fault(code: EngineErrorCode, message: string): void {
    if (this.state === 'disposed') return;
    this.error = { code, message };
    uciLogPush('event', `FAULT ${code}: ${message}`);
    // Reject anything currently in flight.
    const err = new EngineFaultError(this.error);
    this.rejectPendingUciok(err);
    this.rejectPendingReadyok(err);
    this.rejectPendingSearch(err);
    this.setState('error');
    for (const l of this.errorListeners) {
      try {
        l(this.error);
      } catch {
        /* ignore */
      }
    }
  }

  private faultError(code: EngineErrorCode, message: string): EngineFaultError {
    return new EngineFaultError({ code, message });
  }

  private rejectPendingUciok(err: unknown): void {
    const p = this.pendingUciok;
    if (!p) return;
    this.pendingUciok = null;
    if (p.timer) clearTimeout(p.timer);
    p.reject(err);
  }

  private rejectPendingReadyok(err: unknown): void {
    const p = this.pendingReadyok;
    if (!p) return;
    this.pendingReadyok = null;
    if (p.timer) clearTimeout(p.timer);
    p.reject(err);
  }

  private rejectPendingSearch(err: unknown): void {
    const p = this.pendingSearch;
    if (!p) return;
    this.pendingSearch = null;
    if (p.timer) clearTimeout(p.timer);
    p.reject(err);
  }
}

function errMsg(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
