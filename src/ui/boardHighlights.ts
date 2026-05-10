import type { Color } from 'chess.js';
import type { CSSProperties } from 'react';

/** Map every occupied square (e.g. "e1") to its FEN piece letter, parsed from a FEN string. */
export function boardSquares(fen: string): Map<string, string> {
  const out = new Map<string, string>();
  const board = fen.split(' ')[0];
  if (!board) return out;
  const ranks = board.split('/');
  for (let r = 0; r < ranks.length; r++) {
    const rank = ranks[r]!;
    let file = 0;
    for (const ch of rank) {
      if (ch >= '1' && ch <= '8') {
        file += Number(ch);
      } else {
        const fileLetter = String.fromCharCode('a'.charCodeAt(0) + file);
        const rankNumber = 8 - r;
        out.set(`${fileLetter}${rankNumber}`, ch);
        file += 1;
      }
    }
  }
  return out;
}

/** Find the square of `color`'s king from a FEN, or null. */
export function findKingSquare(fen: string, color: Color): string | null {
  const target = color === 'w' ? 'K' : 'k';
  for (const [sq, piece] of boardSquares(fen)) if (piece === target) return sq;
  return null;
}

export interface HighlightInput {
  selectedSquare: string | null;
  legalTargets: readonly string[];
  lastMove: { from: string; to: string } | null;
  checkSquare: string | null;
  /** Does the destination square hold a piece? (legal-target dots vs capture rings.) */
  hasPiece: (square: string) => boolean;
}

// Royal palette: gilt for selection/last move, ruby for check, bronze dots/rings for legal targets.
const SELECTED: CSSProperties = {
  boxShadow: 'inset 0 0 0 4px rgba(236, 201, 101, 0.9), inset 0 0 14px rgba(236, 201, 101, 0.35)',
};
const LAST_MOVE: CSSProperties = { backgroundColor: 'rgba(201, 162, 39, 0.32)' };
const CHECK: CSSProperties = {
  background: 'radial-gradient(circle, rgba(168,32,47,0.95) 0%, rgba(168,32,47,0.6) 42%, transparent 72%)',
};
const MOVE_DOT: CSSProperties = {
  background: 'radial-gradient(circle, rgba(74,52,18,0.55) 0%, rgba(74,52,18,0.55) 22%, transparent 24%)',
};
const CAPTURE_RING: CSSProperties = {
  background:
    'radial-gradient(circle, transparent 0%, transparent 58%, rgba(110,19,32,0.5) 60%, rgba(110,19,32,0.5) 76%, transparent 78%)',
};

/** Build the `squareStyles` map react-chessboard expects, layering the various cues sensibly. */
export function buildSquareStyles(input: HighlightInput): Record<string, CSSProperties> {
  const styles: Record<string, CSSProperties> = {};
  const merge = (sq: string, s: CSSProperties) => {
    styles[sq] = { ...(styles[sq] ?? {}), ...s };
  };

  if (input.lastMove) {
    merge(input.lastMove.from, LAST_MOVE);
    merge(input.lastMove.to, LAST_MOVE);
  }
  if (input.checkSquare) merge(input.checkSquare, CHECK);
  for (const sq of input.legalTargets) merge(sq, input.hasPiece(sq) ? CAPTURE_RING : MOVE_DOT);
  if (input.selectedSquare) merge(input.selectedSquare, SELECTED);
  return styles;
}
