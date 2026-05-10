/**
 * Pure functions that turn raw UCI text lines into structured data. Nothing here ever throws — a
 * malformed line returns `null` (or sensible defaults) so the adapter can log it and carry on. Keep
 * all knowledge of UCI line syntax in this file.
 */
import type { EngineScore } from './types';

export interface IdLine {
  kind: 'name' | 'author';
  value: string;
}

export interface OptionLine {
  name: string;
  type: string; // 'spin' | 'check' | 'string' | 'combo' | 'button'
  raw: string;
}

export interface InfoLine {
  depth?: number;
  seldepth?: number;
  multipv?: number;
  score?: EngineScore;
  nodes?: number;
  nps?: number;
  timeMs?: number;
  /** PV as UCI move strings; empty if the line had no `pv`. */
  pvUci: string[];
  /** True for `info string ...` chatter (no structured data). */
  isString: boolean;
}

export interface BestMoveLine {
  /** The chosen move in UCI, or `null` for `bestmove (none)`. */
  bestMove: string | null;
  ponder?: string;
}

const trimLine = (line: string): string => line.replace(/\r$/, '').trim();

export function isUciOk(line: string): boolean {
  return trimLine(line) === 'uciok';
}

export function isReadyOk(line: string): boolean {
  return trimLine(line) === 'readyok';
}

export function parseIdLine(line: string): IdLine | null {
  const m = /^id\s+(name|author)\s+(.+)$/.exec(trimLine(line));
  if (!m) return null;
  return { kind: m[1] as IdLine['kind'], value: m[2]!.trim() };
}

export function parseOptionLine(line: string): OptionLine | null {
  const t = trimLine(line);
  const m = /^option\s+name\s+(.+?)\s+type\s+(\S+)/.exec(t);
  if (!m) return null;
  return { name: m[1]!.trim(), type: m[2]!, raw: t };
}

const UCI_MOVE_RE = /^[a-h][1-8][a-h][1-8][qrbnQRBN]?$/;

export function parseBestMove(line: string): BestMoveLine | null {
  const t = trimLine(line);
  if (!t.startsWith('bestmove')) return null;
  const parts = t.split(/\s+/);
  // parts[0] === 'bestmove'
  const move = parts[1];
  if (!move) return null;
  if (move === '(none)' || move === 'none' || move === '0000') {
    return { bestMove: null };
  }
  if (!UCI_MOVE_RE.test(move)) return null; // not something we recognize — caller treats as protocol fault
  const result: BestMoveLine = { bestMove: move.toLowerCase() };
  const ponderIdx = parts.indexOf('ponder');
  if (ponderIdx !== -1) {
    const p = parts[ponderIdx + 1];
    if (p && UCI_MOVE_RE.test(p)) result.ponder = p.toLowerCase();
  }
  return result;
}

/**
 * Parse an `info ...` line. Returns `null` only if the line doesn't start with `info`. `info string`
 * lines come back with `isString: true` and no structured fields. Unknown tokens are skipped.
 */
export function parseInfoLine(line: string): InfoLine | null {
  const t = trimLine(line);
  if (!t.startsWith('info')) return null;
  const tokens = t.split(/\s+/).slice(1); // drop leading 'info'

  if (tokens[0] === 'string') {
    return { pvUci: [], isString: true };
  }

  const info: InfoLine = { pvUci: [], isString: false };
  let score: EngineScore | undefined;

  const intAt = (i: number): number | undefined => {
    const v = tokens[i];
    if (v === undefined) return undefined;
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  };

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    switch (tok) {
      case 'depth':
        info.depth = intAt(i + 1);
        i += 1;
        break;
      case 'seldepth':
        info.seldepth = intAt(i + 1);
        i += 1;
        break;
      case 'multipv':
        info.multipv = intAt(i + 1);
        i += 1;
        break;
      case 'nodes':
        info.nodes = intAt(i + 1);
        i += 1;
        break;
      case 'nps':
        info.nps = intAt(i + 1);
        i += 1;
        break;
      case 'time':
        info.timeMs = intAt(i + 1);
        i += 1;
        break;
      case 'score': {
        const kind = tokens[i + 1];
        const val = intAt(i + 2);
        if (kind === 'cp' && val !== undefined) score = { cp: val };
        else if (kind === 'mate' && val !== undefined) score = { mateIn: val };
        i += 2;
        // 'lowerbound' / 'upperbound' may follow; just skip them (treated as approximate).
        if (tokens[i + 1] === 'lowerbound' || tokens[i + 1] === 'upperbound') i += 1;
        break;
      }
      case 'pv': {
        // Everything after `pv` is the move list; consume to end of line.
        for (let j = i + 1; j < tokens.length; j++) {
          const mv = tokens[j];
          if (mv && UCI_MOVE_RE.test(mv)) info.pvUci.push(mv.toLowerCase());
          else break; // PV is always last; stop at the first non-move just in case
        }
        i = tokens.length;
        break;
      }
      // 'currmove', 'currmovenumber', 'hashfull', 'tbhits', 'cpuload', 'refutation', 'wdl' ... ignored.
      default:
        break;
    }
  }

  if (score) info.score = score;
  return info;
}
