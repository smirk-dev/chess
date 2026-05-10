/**
 * A fake Web Worker that speaks just enough UCI to exercise EngineService / GameController without a
 * real engine. It auto-completes the handshake (`uci` -> id/option/uciok, `isready` -> readyok) and,
 * on `go`, emits a couple of `info` lines and a `bestmove`. The chosen move defaults to "the first
 * legal move in the resulting position" (computed with chess.js) so tests that only need *a* legal
 * engine reply don't have to script anything; pass `bestMoveFor` to control it.
 *
 * Messages are delivered asynchronously (microtask by default; `latencyMs` uses real `setTimeout`)
 * to mimic a real worker. Inject it via the `EngineWorkerFactory` seam.
 */
import { Chess } from 'chess.js';
import type { WorkerLike } from '../../src/engine/engineWorkerLoader';

export interface MockEngineOptions {
  /** Decide the reply for a given `position ...` command. Return a UCI move or a richer object. */
  bestMoveFor?: (positionCmd: string, history: string[]) => string | { bestMove: string; info?: string[] } | null;
  /** Delay (ms, real timers) before emitting `bestmove` after `go`. Default 0 => next microtask. */
  latencyMs?: number;
  /** If false, the worker ignores `uci`/`isready` (simulates a dead/incompatible engine). */
  autoBoot?: boolean;
  /** If false, omit `UCI_LimitStrength` / `UCI_Elo` from the advertised options. */
  advertiseEloOptions?: boolean;
  /** If set, throw from `postMessage` / never respond (simulates a crash) after this many `go`s. */
  crashAfterGoes?: number;
}

type Listener = (ev: { data: unknown }) => void;

function legalMovesFromPosition(positionCmd: string): { chess: Chess; history: string[] } {
  const chess = new Chess();
  const history: string[] = [];
  const fenMatch = /^position\s+fen\s+(.+?)(?:\s+moves\s+(.*))?$/.exec(positionCmd);
  if (fenMatch) {
    try {
      chess.load(fenMatch[1]!.trim());
    } catch {
      /* leave at startpos */
    }
    if (fenMatch[2]) for (const mv of fenMatch[2].trim().split(/\s+/)) applyUci(chess, mv, history);
    return { chess, history };
  }
  const startMatch = /^position\s+startpos(?:\s+moves\s+(.*))?$/.exec(positionCmd);
  if (startMatch?.[1]) for (const mv of startMatch[1].trim().split(/\s+/)) applyUci(chess, mv, history);
  return { chess, history };
}

function applyUci(chess: Chess, uci: string, history: string[]): void {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci);
  if (!m) return;
  try {
    chess.move({ from: m[1]!, to: m[2]!, promotion: m[3] as 'q' | 'r' | 'b' | 'n' | undefined });
    history.push(uci);
  } catch {
    /* ignore illegal in the mock */
  }
}

export class MockEngineWorker implements WorkerLike {
  readonly sent: string[] = [];
  private readonly messageListeners = new Set<Listener>();
  private readonly errorListeners = new Set<(ev: unknown) => void>();
  private lastPositionCmd = 'position startpos';
  private terminated = false;
  private goCount = 0;

  constructor(private readonly opts: MockEngineOptions = {}) {}

  postMessage(message: unknown): void {
    if (this.terminated) return;
    const line = String(message).trim();
    this.sent.push(line);
    const autoBoot = this.opts.autoBoot !== false;

    if (line === 'uci') {
      if (!autoBoot) return;
      this.emitMany([
        'id name MockFish 1.0',
        'id author Vitest',
        ...(this.opts.advertiseEloOptions === false
          ? []
          : ['option name UCI_LimitStrength type check default false', 'option name UCI_Elo type spin default 1320 min 1320 max 3190']),
        'option name Hash type spin default 16 min 1 max 1024',
        'uciok',
      ]);
      return;
    }
    if (line === 'isready') {
      if (!autoBoot) return;
      this.emitMany(['readyok']);
      return;
    }
    if (line === 'ucinewgame' || line.startsWith('setoption ')) return;
    if (line.startsWith('position ')) {
      this.lastPositionCmd = line;
      return;
    }
    if (line.startsWith('go')) {
      this.goCount += 1;
      if (this.opts.crashAfterGoes !== undefined && this.goCount > this.opts.crashAfterGoes) {
        // Simulate a crash: surface an error and never reply.
        this.emitError('mock engine crashed');
        return;
      }
      this.scheduleBestMove();
      return;
    }
    if (line === 'stop') {
      // A real engine replies with its best move so far. The pending scheduled reply will do.
      return;
    }
  }

  terminate(): void {
    this.terminated = true;
    this.messageListeners.clear();
    this.errorListeners.clear();
  }

  addEventListener(type: 'message', listener: Listener): void;
  addEventListener(type: 'error' | 'messageerror', listener: (ev: unknown) => void): void;
  addEventListener(type: string, listener: (ev: never) => void): void {
    if (type === 'message') this.messageListeners.add(listener as unknown as Listener);
    else this.errorListeners.add(listener as unknown as (ev: unknown) => void);
  }

  removeEventListener(_type: string, listener: (ev: never) => void): void {
    this.messageListeners.delete(listener as unknown as Listener);
    this.errorListeners.delete(listener as unknown as (ev: unknown) => void);
  }

  // ---- internals ----------------------------------------------------------

  private scheduleBestMove(): void {
    const fire = () => {
      if (this.terminated) return;
      const { chess, history } = legalMovesFromPosition(this.lastPositionCmd);
      let bestMove: string | null = null;
      let info: string[] | undefined;
      const scripted = this.opts.bestMoveFor?.(this.lastPositionCmd, history);
      if (typeof scripted === 'string') bestMove = scripted;
      else if (scripted && typeof scripted === 'object') {
        bestMove = scripted.bestMove;
        info = scripted.info;
      }
      if (!bestMove) {
        const legal = chess.moves({ verbose: true });
        bestMove = legal.length ? `${legal[0]!.from}${legal[0]!.to}${legal[0]!.promotion ?? ''}` : '(none)';
      }
      const lines = info ?? [
        `info depth 8 seldepth 10 multipv 1 score cp 21 nodes 12345 nps 200000 time 30 pv ${bestMove}`,
        `info depth 12 seldepth 16 multipv 1 score cp 18 nodes 54321 nps 240000 time 60 pv ${bestMove}`,
      ];
      this.emitMany([...lines, `bestmove ${bestMove}`]);
    };
    const latency = this.opts.latencyMs ?? 0;
    if (latency > 0) setTimeout(fire, latency);
    else queueMicrotask(fire);
  }

  private emitMany(lines: string[]): void {
    queueMicrotask(() => {
      if (this.terminated) return;
      for (const line of lines) for (const l of this.messageListeners) l({ data: line });
    });
  }

  private emitError(message: string): void {
    queueMicrotask(() => {
      if (this.terminated) return;
      for (const l of this.errorListeners) l({ message });
    });
  }
}

/** Convenience: build an `EngineWorkerFactory` that yields a fresh MockEngineWorker each call. */
export function mockEngineFactory(opts: MockEngineOptions = {}): () => Promise<WorkerLike> {
  return async () => new MockEngineWorker(opts);
}
