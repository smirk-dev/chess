import type { Move, PieceSymbol } from 'chess.js';

export type PromotionPiece = Extract<PieceSymbol, 'q' | 'r' | 'b' | 'n'>;
export const PROMOTION_PIECES: readonly PromotionPiece[] = ['q', 'r', 'b', 'n'];

/** A long-algebraic UCI move string, e.g. `e2e4`, `e7e8q`, `e1g1` (castling is encoded king-move). */
export type UciMove = string;

/** Build the UCI string for a chess.js Move (`from` + `to` + lowercase promotion letter if any). */
export function moveToUci(move: Pick<Move, 'from' | 'to' | 'promotion'>): UciMove {
  return `${move.from}${move.to}${move.promotion ? move.promotion.toLowerCase() : ''}`;
}

export interface ParsedUci {
  from: string;
  to: string;
  promotion?: PromotionPiece;
}

/** Parse a UCI move string into its parts. Returns `null` if it isn't a well-formed UCI move. */
export function parseUci(uci: string): ParsedUci | null {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(uci.trim().toLowerCase());
  if (!m) return null;
  const out: ParsedUci = { from: m[1]!, to: m[2]! };
  if (m[3]) out.promotion = m[3] as PromotionPiece;
  return out;
}

/** Pretty piece name for the promotion dialog. */
export function promotionPieceName(piece: PromotionPiece): string {
  return { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[piece];
}

/**
 * Group a flat verbose-move list into numbered pairs for display:
 * `[{ no: 1, white: Move, black?: Move }, ...]`. If the game starts from a position where Black is
 * to move, the first pair has no white move.
 */
export interface MovePairRow {
  no: number;
  white?: Move;
  black?: Move;
}

export function toMovePairs(history: readonly Move[], startColor: 'w' | 'b' = 'w'): MovePairRow[] {
  const rows: MovePairRow[] = [];
  let i = 0;
  let no = 1;
  if (startColor === 'b' && history.length > 0) {
    rows.push({ no, black: history[0] });
    i = 1;
    no = 2;
  }
  for (; i < history.length; i += 2) {
    rows.push({ no, white: history[i], black: history[i + 1] });
    no += 1;
  }
  return rows;
}
