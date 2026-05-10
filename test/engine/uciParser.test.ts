import { describe, expect, it } from 'vitest';
import {
  isReadyOk,
  isUciOk,
  parseBestMove,
  parseIdLine,
  parseInfoLine,
  parseOptionLine,
} from '../../src/engine/uciParser';

describe('uciParser', () => {
  it('recognizes uciok / readyok (and ignores junk)', () => {
    expect(isUciOk('uciok')).toBe(true);
    expect(isUciOk(' uciok\r')).toBe(true);
    expect(isUciOk('readyok')).toBe(false);
    expect(isReadyOk('readyok')).toBe(true);
    expect(isReadyOk('uciok')).toBe(false);
  });

  it('parses id lines', () => {
    expect(parseIdLine('id name Stockfish 18')).toEqual({ kind: 'name', value: 'Stockfish 18' });
    expect(parseIdLine('id author the Stockfish developers')).toEqual({ kind: 'author', value: 'the Stockfish developers' });
    expect(parseIdLine('not an id line')).toBeNull();
  });

  it('parses option lines', () => {
    expect(parseOptionLine('option name UCI_Elo type spin default 1320 min 1320 max 3190')).toEqual({
      name: 'UCI_Elo',
      type: 'spin',
      raw: 'option name UCI_Elo type spin default 1320 min 1320 max 3190',
    });
    expect(parseOptionLine('option name UCI_LimitStrength type check default false')?.name).toBe('UCI_LimitStrength');
    expect(parseOptionLine('garbage')).toBeNull();
  });

  it('parses an info line with depth/score/pv', () => {
    const info = parseInfoLine('info depth 12 seldepth 16 multipv 1 score cp 34 nodes 54321 nps 240000 time 60 pv e2e4 e7e5 g1f3');
    expect(info).not.toBeNull();
    expect(info!.isString).toBe(false);
    expect(info!.depth).toBe(12);
    expect(info!.multipv).toBe(1);
    expect(info!.score).toEqual({ cp: 34 });
    expect(info!.nodes).toBe(54321);
    expect(info!.timeMs).toBe(60);
    expect(info!.pvUci).toEqual(['e2e4', 'e7e5', 'g1f3']);
  });

  it('parses a mate score (negative)', () => {
    const info = parseInfoLine('info depth 20 score mate -3 pv a2a3 b7b6 a3a4');
    expect(info!.score).toEqual({ mateIn: -3 });
    expect(info!.pvUci).toEqual(['a2a3', 'b7b6', 'a3a4']);
  });

  it('skips lowerbound/upperbound after the score', () => {
    const info = parseInfoLine('info depth 9 score cp 120 lowerbound nodes 100 pv e2e4');
    expect(info!.score).toEqual({ cp: 120 });
    expect(info!.nodes).toBe(100);
    expect(info!.pvUci).toEqual(['e2e4']);
  });

  it('flags `info string` lines and returns no structured data', () => {
    const info = parseInfoLine('info string NNUE evaluation using nn-foo.nnue');
    expect(info).toEqual({ pvUci: [], isString: true });
  });

  it('returns a structured-but-empty result for currmove-style info (no pv/score)', () => {
    const info = parseInfoLine('info depth 1 currmove e2e4 currmovenumber 1');
    expect(info!.depth).toBe(1);
    expect(info!.pvUci).toEqual([]);
    expect(info!.score).toBeUndefined();
  });

  it('parses bestmove with and without ponder, plus (none)', () => {
    expect(parseBestMove('bestmove e2e4 ponder e7e5')).toEqual({ bestMove: 'e2e4', ponder: 'e7e5' });
    expect(parseBestMove('bestmove e7e8q')).toEqual({ bestMove: 'e7e8q' });
    expect(parseBestMove('bestmove (none)')).toEqual({ bestMove: null });
    expect(parseBestMove('bestmove 0000')).toEqual({ bestMove: null });
  });

  it('never throws on garbage lines', () => {
    for (const line of ['', '   ', 'hello world', 'info', 'bestmove', 'bestmove not-a-move', 'info depth', 'option', 'id']) {
      expect(() => {
        parseInfoLine(line);
        parseBestMove(line);
        parseIdLine(line);
        parseOptionLine(line);
        isUciOk(line);
        isReadyOk(line);
      }).not.toThrow();
    }
    expect(parseBestMove('bestmove not-a-move')).toBeNull();
  });
});
