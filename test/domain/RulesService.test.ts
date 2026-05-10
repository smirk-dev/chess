import { describe, expect, it } from 'vitest';
import { RulesService } from '../../src/domain/RulesService';

describe('RulesService', () => {
  it('reports 20 legal moves from the start position', () => {
    const r = new RulesService();
    expect(r.allLegalMoves()).toHaveLength(20);
    expect(r.turn()).toBe('w');
    expect(r.startColor()).toBe('w');
    expect(r.isGameOver()).toBe(false);
  });

  it('returns only legal moves for a selected square (respecting pins)', () => {
    // Black bishop b4 pins the white c3 knight to the e1 king (d2 is empty, so the pin is real).
    const r = new RulesService('rnbqk1nr/pppp1ppp/8/4p3/1b6/2N5/PPP1PPPP/R1BQKBNR w KQkq - 0 1');
    expect(r.legalMovesFrom('c3')).toHaveLength(0);
    // The g1 knight is free.
    expect(r.legalMovesFrom('g1').length).toBeGreaterThan(0);
  });

  it('applyMove returns the move on success and null on an illegal move', () => {
    const r = new RulesService();
    expect(r.applyMove({ from: 'e2', to: 'e4' })?.san).toBe('e4');
    expect(r.applyMove({ from: 'e2', to: 'e5' })).toBeNull(); // pawn already moved / illegal
    expect(r.applyUci('e7e5')?.san).toBe('e5');
    expect(r.applyUci('zz99')).toBeNull();
  });

  it('detects promotion only for a pawn reaching the last rank', () => {
    const r = new RulesService('8/P7/8/8/8/8/8/k1K5 w - - 0 1');
    expect(r.isPromotion('a7', 'a8')).toBe(true);
    const r2 = new RulesService();
    expect(r2.isPromotion('e2', 'e4')).toBe(false);
  });

  it('historyUci includes the promotion letter', () => {
    const r = new RulesService('8/P7/8/8/8/8/8/k1K5 w - - 0 1');
    r.applyMove({ from: 'a7', to: 'a8', promotion: 'q' });
    expect(r.historyUci()).toEqual(['a7a8q']);
  });

  it('undo round-trips the FEN', () => {
    const r = new RulesService();
    const before = r.fen();
    r.applyMove({ from: 'g1', to: 'f3' });
    expect(r.fen()).not.toBe(before);
    r.undo();
    expect(r.fen()).toBe(before);
    expect(r.undo()).toBeNull();
  });

  it("detects checkmate (fool's mate) and reports the winner", () => {
    const r = new RulesService();
    r.applyUci('f2f3');
    r.applyUci('e7e5');
    r.applyUci('g2g4');
    r.applyUci('d8h4'); // Qh4#
    expect(r.isGameOver()).toBe(true);
    expect(r.status().isCheckmate).toBe(true);
    expect(r.result()).toEqual({ winner: 'b', reason: 'checkmate', scoreText: '0-1' });
  });

  it('detects stalemate', () => {
    // Classic stalemate: black king a8, white king c7, white queen ... actually use a known FEN.
    const r = new RulesService('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
    expect(r.isGameOver()).toBe(true);
    expect(r.status().isStalemate).toBe(true);
    expect(r.result()).toEqual({ winner: null, reason: 'stalemate', scoreText: '½-½' });
  });

  it('detects insufficient material', () => {
    const r = new RulesService('8/8/8/4k3/8/8/3K4/8 w - - 0 1');
    expect(r.isGameOver()).toBe(true);
    expect(r.status().isInsufficientMaterial).toBe(true);
    expect(r.result()?.reason).toBe('insufficient-material');
  });

  it('detects the fifty-move rule via the halfmove clock', () => {
    const r = new RulesService('8/8/8/3k4/8/8/3K4/R7 w - - 100 80');
    expect(r.status().isFiftyMoveRule).toBe(true);
    expect(r.isGameOver()).toBe(true);
    expect(r.result()?.reason).toBe('fifty-move-rule');
  });

  it('sanLineFromUci converts an engine PV to SAN on a throwaway board', () => {
    const r = new RulesService();
    r.applyUci('e2e4');
    const before = r.fen();
    expect(r.sanLineFromUci(['e7e5', 'g1f3', 'b8c6'])).toEqual(['e5', 'Nf3', 'Nc6']);
    expect(r.fen()).toBe(before); // live game untouched
  });

  it('canSideWinOnMaterial: lone king cannot, K+R can', () => {
    const lone = new RulesService('8/8/8/3k4/8/8/3K4/8 w - - 0 1');
    expect(lone.canSideWinOnMaterial('w')).toBe(false);
    const withRook = new RulesService('8/8/8/3k4/8/8/3K4/R7 w - - 0 1');
    expect(withRook.canSideWinOnMaterial('w')).toBe(true);
  });
});
