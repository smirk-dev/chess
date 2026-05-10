import type { Color } from 'chess.js';

/** Why a game ended. `timeout` / `resignation` / `aborted` are decided outside chess.js. */
export type GameOverReason =
  | 'checkmate'
  | 'stalemate'
  | 'insufficient-material'
  | 'threefold-repetition'
  | 'fifty-move-rule'
  | 'timeout'
  | 'resignation'
  | 'aborted';

export interface GameResult {
  /** Winning color, or `null` for any kind of draw. */
  winner: Color | null;
  reason: GameOverReason;
  /** Standard PGN-style score string. */
  scoreText: '1-0' | '0-1' | '½-½';
}

const SCORE: Record<'w' | 'b' | 'draw', GameResult['scoreText']> = {
  w: '1-0',
  b: '0-1',
  draw: '½-½',
};

export function makeResult(winner: Color | null, reason: GameOverReason): GameResult {
  return { winner, reason, scoreText: winner ? SCORE[winner] : SCORE.draw };
}

export function describeResult(result: GameResult): string {
  const who = result.winner === 'w' ? 'White' : result.winner === 'b' ? 'Black' : null;
  switch (result.reason) {
    case 'checkmate':
      return `${who} wins by checkmate`;
    case 'stalemate':
      return 'Draw — stalemate';
    case 'insufficient-material':
      return 'Draw — insufficient material';
    case 'threefold-repetition':
      return 'Draw — threefold repetition';
    case 'fifty-move-rule':
      return 'Draw — fifty-move rule';
    case 'timeout':
      return who ? `${who} wins on time` : 'Draw — time out (insufficient material to win)';
    case 'resignation':
      return who ? `${who} wins by resignation` : 'Game aborted';
    case 'aborted':
      return 'Game aborted';
  }
}
