import { afterEach, describe, expect, it, vi } from 'vitest';
import { EngineService } from '../../src/engine/EngineService';
import { EngineCancelledError, EngineFaultError, type PvUpdate } from '../../src/engine/types';
import { MockEngineWorker, type MockEngineOptions } from '../mocks/MockEngineWorker';
import type { WorkerLike } from '../../src/engine/engineWorkerLoader';

/** Build an EngineService whose worker is a MockEngineWorker we keep a handle to. */
function buildEngine(opts: MockEngineOptions = {}): { engine: EngineService; getWorker: () => MockEngineWorker } {
  let worker: MockEngineWorker | null = null;
  const factory = async (): Promise<WorkerLike> => {
    worker = new MockEngineWorker(opts);
    return worker;
  };
  const engine = new EngineService(factory);
  return { engine, getWorker: () => worker! };
}

describe('EngineService', () => {
  afterEach(() => vi.useRealTimers());

  it('completes the UCI handshake on init() and records engine facts', async () => {
    const { engine, getWorker } = buildEngine();
    expect(engine.getState()).toBe('uninitialized');
    await engine.init();
    expect(engine.getState()).toBe('ready');
    const info = engine.getInfo();
    expect(info.name).toBe('MockFish 1.0');
    expect(info.supportsEloLimiting).toBe(true);
    expect(getWorker().sent).toEqual(expect.arrayContaining(['uci', 'isready']));
  });

  it('init() is idempotent', async () => {
    const { engine } = buildEngine();
    await Promise.all([engine.init(), engine.init()]);
    await engine.init();
    expect(engine.getState()).toBe('ready');
  });

  it('rejects init() and goes to error state when the engine never replies', async () => {
    vi.useFakeTimers();
    const { engine } = buildEngine({ autoBoot: false });
    const initPromise = engine.init();
    // Attach the rejection handler *before* advancing timers so the rejection is never "unhandled".
    const expectation = expect(initPromise).rejects.toBeInstanceOf(EngineFaultError);
    await vi.advanceTimersByTimeAsync(13_000);
    await expectation;
    expect(engine.getState()).toBe('error');
    expect(engine.getInfo().error?.code).toBe('load-failed');
  });

  it('setStrength clamps the Elo and sends both setoption lines', async () => {
    const { engine, getWorker } = buildEngine();
    await engine.init();
    await engine.setStrength(99_999);
    const sent = getWorker().sent;
    expect(sent).toContain('setoption name UCI_LimitStrength value true');
    expect(sent).toContain('setoption name UCI_Elo value 3190');
    expect(engine.getInfo().appliedElo).toBe(3190);
    expect(engine.getInfo().limitStrength).toBe(true);

    await engine.setStrength(100); // below the floor
    expect(getWorker().sent).toContain('setoption name UCI_Elo value 1320');
    expect(engine.getInfo().appliedElo).toBe(1320);
  });

  it('newGame sends ucinewgame and re-applies strength', async () => {
    const { engine, getWorker } = buildEngine();
    await engine.init();
    await engine.newGame(1800);
    const sent = getWorker().sent;
    expect(sent).toContain('ucinewgame');
    expect(sent).toContain('setoption name UCI_Elo value 1800');
    expect(engine.getInfo().appliedElo).toBe(1800);
  });

  it('requestMove sends position + go movetime and resolves with a tagged bestmove', async () => {
    const { engine, getWorker } = buildEngine();
    await engine.init();
    const result = await engine.requestMove({ token: 7, movesUci: ['e2e4', 'e7e5'], movetimeMs: 120 });
    expect(result.token).toBe(7);
    expect(result.bestMove).toMatch(/^[a-h][1-8][a-h][1-8][qrbn]?$/);
    const sent = getWorker().sent;
    expect(sent).toContain('position startpos moves e2e4 e7e5');
    expect(sent).toContain('go movetime 120');
    expect(engine.getState()).toBe('ready');
  });

  it('cancel() makes the in-flight requestMove reject with EngineCancelledError', async () => {
    const { engine, getWorker } = buildEngine({ latencyMs: 25 });
    await engine.init();
    const p = engine.requestMove({ token: 11, movesUci: [], movetimeMs: 1000 });
    // Let the queued search task actually start (so `stop` reaches the engine while it's thinking).
    await new Promise((r) => setTimeout(r, 5));
    expect(engine.getState()).toBe('thinking');
    engine.cancel();
    expect(getWorker().sent).toContain('stop');
    await expect(p).rejects.toBeInstanceOf(EngineCancelledError);
    expect(engine.getState()).toBe('ready');
  });

  it('throttles PV updates and tags them with the request token', async () => {
    const { engine } = buildEngine();
    await engine.init();
    const updates: PvUpdate[] = [];
    engine.onPvUpdate((u) => updates.push(u));
    await engine.requestMove({ token: 3, movesUci: [], movetimeMs: 100 });
    expect(updates.length).toBeGreaterThanOrEqual(1);
    expect(updates.length).toBeLessThanOrEqual(2); // 2 info lines, back-to-back -> throttled to ~1
    for (const u of updates) expect(u.token).toBe(3);
  });

  it('faults when the engine returns no move (bestmove (none)) during a live game', async () => {
    const { engine } = buildEngine({ bestMoveFor: () => '(none)' });
    await engine.init();
    await expect(engine.requestMove({ token: 1, movesUci: [], movetimeMs: 50 })).rejects.toBeInstanceOf(EngineFaultError);
    expect(engine.getState()).toBe('error');
    expect(engine.getInfo().error?.code).toBe('protocol');
  });

  it('dispose() terminates and rejects subsequent operations', async () => {
    const { engine } = buildEngine();
    await engine.init();
    engine.dispose();
    expect(engine.getState()).toBe('disposed');
    await expect(engine.requestMove({ token: 1, movesUci: [], movetimeMs: 50 })).rejects.toBeTruthy();
  });
});
