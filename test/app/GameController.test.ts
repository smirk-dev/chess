import { describe, expect, it, vi } from 'vitest';
import { GameController } from '../../src/app/GameController';
import { EngineService } from '../../src/engine/EngineService';
import { getDifficultyById } from '../../src/config/difficulty';
import { mockEngineFactory, type MockEngineOptions } from '../mocks/MockEngineWorker';

const flush = async () => {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
};

function build(opts: { engineOpts?: MockEngineOptions; rng?: () => number } = {}) {
  const factory = mockEngineFactory(opts.engineOpts ?? {});
  const engine = new EngineService(factory);
  const requestMoveSpy = vi.spyOn(engine, 'requestMove');
  const setStrengthSpy = vi.spyOn(engine, 'setStrength');
  const controller = new GameController({ engine, engineFactory: factory, rng: opts.rng ?? (() => 0.4) });
  return { controller, engine, requestMoveSpy, setStrengthSpy };
}

describe('GameController', () => {
  it('boots the engine and starts a game with the user to move', async () => {
    const { controller } = build();
    await controller.start();
    const s = controller.getSnapshot();
    expect(s.engine.engineState).toBe('ready');
    expect(s.ui.userColor).toBe('w');
    expect(s.ui.boardOrientation).toBe('white');
    expect(s.ui.interactionLock).toBe('idle');
    expect(s.ui.banner?.kind).toBe('your-move');
    controller.dispose();
  });

  it('a legal human move triggers exactly one engine request with the right history, then the engine replies', async () => {
    const { controller, requestMoveSpy } = build();
    await controller.start();

    expect(controller.onPieceDrop('e2', 'e4')).toBe(true);
    let s = controller.getSnapshot();
    expect(s.game.history.map((m) => m.san)).toEqual(['e4']);
    expect(s.ui.interactionLock).toBe('awaiting-engine');

    await flush();
    s = controller.getSnapshot();
    expect(requestMoveSpy).toHaveBeenCalledTimes(1);
    expect(requestMoveSpy.mock.calls[0]![0].movesUci).toEqual(['e2e4']);
    expect(s.game.history.length).toBe(2); // engine replied
    expect(s.ui.interactionLock).toBe('idle');
    controller.dispose();
  });

  it('rejects moves while the engine is thinking (no double moves)', async () => {
    const { controller, requestMoveSpy } = build({ engineOpts: { latencyMs: 40 } });
    await controller.start();
    controller.onPieceDrop('e2', 'e4');
    expect(controller.getSnapshot().ui.interactionLock).toBe('awaiting-engine');
    // Spamming further moves does nothing.
    expect(controller.onPieceDrop('d2', 'd4')).toBe(false);
    expect(controller.onPieceDrop('g1', 'f3')).toBe(false);
    expect(controller.getSnapshot().game.history.length).toBe(1);
    await flush();
    await new Promise((r) => setTimeout(r, 60));
    await flush();
    expect(requestMoveSpy).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().game.history.length).toBe(2);
    controller.dispose();
  });

  it('a promoting move interrupts for the piece choice; the engine is only called after the choice', async () => {
    const { controller, requestMoveSpy } = build();
    await controller.start();
    await controller.newGame({ fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1', sideChoice: 'white' });

    expect(controller.onPieceDrop('a7', 'a8')).toBe(false); // promotion -> dialog, not committed
    let s = controller.getSnapshot();
    expect(s.ui.interactionLock).toBe('awaiting-promotion');
    expect(s.ui.pendingPromotion).toMatchObject({ from: 'a7', to: 'a8' });
    expect(s.game.history.length).toBe(0);
    expect(requestMoveSpy).not.toHaveBeenCalled();

    controller.choosePromotion('q');
    s = controller.getSnapshot();
    expect(s.game.history.map((m) => m.san)).toEqual(['a8=Q+']);
    expect(s.ui.interactionLock).toBe('awaiting-engine');

    await flush();
    expect(requestMoveSpy).toHaveBeenCalledTimes(1);
    expect(requestMoveSpy.mock.calls[0]![0]).toMatchObject({ fen: expect.stringContaining('Q') });
    controller.dispose();
  });

  it('cancelling a promotion leaves the pawn where it was', async () => {
    const { controller } = build();
    await controller.start();
    await controller.newGame({ fen: '4k3/P7/8/8/8/8/8/4K3 w - - 0 1', sideChoice: 'white' });
    controller.onPieceDrop('a7', 'a8');
    expect(controller.getSnapshot().ui.interactionLock).toBe('awaiting-promotion');
    controller.cancelPromotion();
    const s = controller.getSnapshot();
    expect(s.ui.interactionLock).toBe('idle');
    expect(s.ui.pendingPromotion).toBeNull();
    expect(s.game.history.length).toBe(0);
    expect(s.game.fen).toContain('P7'); // pawn still on a7
    controller.dispose();
  });

  it('New Game while the engine is thinking resets cleanly with no ghost move', async () => {
    const { controller } = build({ engineOpts: { latencyMs: 50 } });
    await controller.start();
    controller.onPieceDrop('e2', 'e4');
    expect(controller.getSnapshot().ui.interactionLock).toBe('awaiting-engine');
    // Reset before the (slow) engine reply arrives.
    await controller.newGame({ sideChoice: 'white' });
    // Now wait long enough for the *old* search's bestmove to arrive — it must be ignored.
    await new Promise((r) => setTimeout(r, 80));
    await flush();
    const s = controller.getSnapshot();
    expect(s.game.history.length).toBe(0);
    expect(s.ui.interactionLock).toBe('idle');
    controller.dispose();
  });

  it('a mid-game difficulty change is deferred to the engine’s next turn', async () => {
    const { controller, setStrengthSpy } = build();
    await controller.start();
    expect(controller.getSnapshot().ui.difficulty.id).toBe('intermediate');

    controller.onPieceDrop('e2', 'e4'); // engine thinking
    controller.selectDifficulty('expert');
    let s = controller.getSnapshot();
    expect(s.ui.pendingDifficulty?.id).toBe('expert');
    expect(s.ui.difficulty.id).toBe('intermediate'); // not applied yet
    expect(setStrengthSpy).not.toHaveBeenCalled();

    await flush(); // engine replies; still the user's turn now, change still pending
    s = controller.getSnapshot();
    expect(s.ui.pendingDifficulty?.id).toBe('expert');
    expect(s.ui.difficulty.id).toBe('intermediate');
    expect(setStrengthSpy).not.toHaveBeenCalled();

    controller.onPieceDrop('g1', 'f3'); // next human move -> next engine turn applies the change
    await flush();
    s = controller.getSnapshot();
    expect(setStrengthSpy).toHaveBeenCalledWith(getDifficultyById('expert').elo);
    expect(s.ui.difficulty.id).toBe('expert');
    expect(s.ui.pendingDifficulty).toBeNull();
    controller.dispose();
  });

  it('an illegal engine move puts the app in the engine-error state without touching the board', async () => {
    const { controller } = build({ engineOpts: { bestMoveFor: () => 'a1a8' } }); // illegal after 1.e4
    await controller.start();
    controller.onPieceDrop('e2', 'e4');
    await flush();
    const s = controller.getSnapshot();
    expect(s.game.history.length).toBe(1); // engine move NOT applied
    expect(s.ui.interactionLock).toBe('engine-error');
    expect(s.ui.banner?.kind).toBe('engine-crashed');
    controller.dispose();
  });

  it('checkmate delivered by the human ends the game and does not call the engine again', async () => {
    // Human plays Black; the (scripted) engine cooperates with fool's mate.
    const { controller, requestMoveSpy } = build({
      engineOpts: {
        bestMoveFor: (cmd) => {
          if (cmd === 'position startpos') return 'f2f3';
          if (cmd.endsWith('f2f3 e7e5')) return 'g2g4';
          return null;
        },
      },
    });
    await controller.start();
    await controller.newGame({ sideChoice: 'black' });
    await flush(); // engine plays f3
    expect(controller.getSnapshot().game.history.map((m) => m.san)).toEqual(['f3']);

    controller.onPieceDrop('e7', 'e5');
    await flush(); // engine plays g4
    expect(controller.getSnapshot().game.history.map((m) => m.san)).toEqual(['f3', 'e5', 'g4']);

    controller.onPieceDrop('d8', 'h4'); // Qh4#
    const s = controller.getSnapshot();
    expect(s.game.status).toBe('checkmate');
    expect(s.game.result).toMatchObject({ winner: 'b', reason: 'checkmate' });
    expect(s.ui.interactionLock).toBe('game-over');
    expect(requestMoveSpy).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('playing Black: the engine opens immediately and the board is flipped', async () => {
    const { controller, requestMoveSpy } = build();
    await controller.newGame({ sideChoice: 'black' });
    expect(controller.getSnapshot().ui.boardOrientation).toBe('black');
    await flush();
    const s = controller.getSnapshot();
    expect(s.game.history.length).toBe(1);
    expect(s.ui.interactionLock).toBe('idle');
    expect(requestMoveSpy).toHaveBeenCalled();
    controller.dispose();
  });

  it('Random side resolves via the injected RNG', async () => {
    const a = build({ rng: () => 0.2 }); // < 0.5 -> White
    const b = build({ rng: () => 0.8 }); // >= 0.5 -> Black
    await a.controller.newGame({ sideChoice: 'random' });
    await b.controller.newGame({ sideChoice: 'random' });
    expect(a.controller.getSnapshot().ui.userColor).toBe('w');
    expect(b.controller.getSnapshot().ui.userColor).toBe('b');
    a.controller.dispose();
    b.controller.dispose();
  });
});
