import { Chess, type Color, type Move, type Piece, type Square } from 'chess.js';
import { makeResult, type GameResult } from './result';
import { moveToUci, parseUci, type PromotionPiece, type UciMove } from './san';

export interface MoveIntent {
  from: Square;
  to: Square;
  /** Required only when the move is a pawn promotion. */
  promotion?: PromotionPiece;
}

export interface RulesStatus {
  inCheck: boolean;
  isCheckmate: boolean;
  isStalemate: boolean;
  isDraw: boolean;
  isInsufficientMaterial: boolean;
  isThreefoldRepetition: boolean;
  isFiftyMoveRule: boolean;
}

/**
 * The single source of truth for chess legality, move history, and game-end detection. A thin,
 * deliberately boring wrapper around one `chess.js` instance — the engine layer and the UI both
 * defer to this; no move is ever applied that doesn't pass through here.
 */
export class RulesService {
  private chess: Chess;
  /** Color to move at the *start* of the current game (for move-pair numbering). */
  private startColorValue: Color = 'w';

  constructor(fen?: string) {
    this.chess = new Chess(fen);
    this.startColorValue = this.chess.turn();
  }

  /** Reset to a fresh game (start position by default, or an arbitrary legal FEN). */
  newGame(fen?: string): void {
    if (fen) this.chess.load(fen);
    else this.chess.reset();
    this.startColorValue = this.chess.turn();
  }

  /** Replay a game from the start position through a list of UCI moves. Throws on an illegal move. */
  loadFromUciMoves(moves: readonly UciMove[]): void {
    this.chess.reset();
    this.startColorValue = this.chess.turn();
    for (const uci of moves) {
      if (this.applyUci(uci) == null) throw new Error(`loadFromUciMoves: illegal move "${uci}"`);
    }
  }

  fen(): string {
    return this.chess.fen();
  }

  turn(): Color {
    return this.chess.turn();
  }

  startColor(): Color {
    return this.startColorValue;
  }

  pieceAt(square: Square): Piece | undefined {
    return this.chess.get(square);
  }

  /** Verbose legal moves originating from `square` (empty if none / not that side's piece). */
  legalMovesFrom(square: Square): Move[] {
    try {
      return this.chess.moves({ square, verbose: true });
    } catch {
      return [];
    }
  }

  /** All verbose legal moves in the current position. */
  allLegalMoves(): Move[] {
    return this.chess.moves({ verbose: true });
  }

  /** True if a piece moving `from -> to` would be a pawn promotion (i.e. a `promotion` is required). */
  isPromotion(from: Square, to: Square): boolean {
    return this.legalMovesFrom(from).some((m) => m.to === to && !!m.promotion);
  }

  /**
   * Apply a move. Returns the resulting `Move` (with SAN/LAN/etc.) on success, or `null` if the move
   * is illegal in the current position — the game state is left untouched on failure.
   */
  applyMove(intent: MoveIntent): Move | null {
    try {
      return this.chess.move({ from: intent.from, to: intent.to, promotion: intent.promotion });
    } catch {
      return null;
    }
  }

  /** Apply a UCI move string (e.g. from the engine's `bestmove`). Returns the `Move` or `null`. */
  applyUci(uci: UciMove): Move | null {
    const parsed = parseUci(uci);
    if (!parsed) return null;
    return this.applyMove({
      from: parsed.from as Square,
      to: parsed.to as Square,
      promotion: parsed.promotion,
    });
  }

  /** Undo the last ply. Returns the undone `Move`, or `null` if there was nothing to undo. */
  undo(): Move | null {
    return this.chess.undo();
  }

  historyVerbose(): Move[] {
    return this.chess.history({ verbose: true });
  }

  historyUci(): UciMove[] {
    return this.historyVerbose().map(moveToUci);
  }

  /**
   * Convert a line of UCI moves (e.g. an engine PV) starting from the *current* position into SAN,
   * on a throwaway board so the live game is never touched. Stops at the first illegal move.
   */
  sanLineFromUci(uciMoves: readonly UciMove[]): string[] {
    const tmp = new Chess(this.chess.fen());
    const out: string[] = [];
    for (const uci of uciMoves) {
      const parsed = parseUci(uci);
      if (!parsed) break;
      try {
        const m = tmp.move({ from: parsed.from as Square, to: parsed.to as Square, promotion: parsed.promotion });
        out.push(m.san);
      } catch {
        break;
      }
    }
    return out;
  }

  isGameOver(): boolean {
    return this.chess.isGameOver();
  }

  status(): RulesStatus {
    return {
      inCheck: this.chess.isCheck(),
      isCheckmate: this.chess.isCheckmate(),
      isStalemate: this.chess.isStalemate(),
      isDraw: this.chess.isDraw(),
      isInsufficientMaterial: this.chess.isInsufficientMaterial(),
      isThreefoldRepetition: this.chess.isThreefoldRepetition(),
      isFiftyMoveRule: this.halfMoveClock() >= 100,
    };
  }

  /**
   * The natural ("over-the-board") result if the game has ended by chess rules. Clocks/resignation
   * are decided by the controller, not here. Returns `null` while the game is in progress.
   */
  result(): GameResult | null {
    if (!this.chess.isGameOver()) return null;
    if (this.chess.isCheckmate()) {
      // The side to move is the one that's been mated; the other side won.
      const winner: Color = this.chess.turn() === 'w' ? 'b' : 'w';
      return makeResult(winner, 'checkmate');
    }
    if (this.chess.isStalemate()) return makeResult(null, 'stalemate');
    if (this.chess.isInsufficientMaterial()) return makeResult(null, 'insufficient-material');
    if (this.chess.isThreefoldRepetition()) return makeResult(null, 'threefold-repetition');
    // Anything else chess.js calls a draw is the fifty-move rule.
    return makeResult(null, 'fifty-move-rule');
  }

  /** Does the given side have enough material to deliver checkmate at all? (Used for time-out rules.) */
  canSideWinOnMaterial(side: Color): boolean {
    // If the *other* side were stripped to a bare king, could `side` still mate?
    // Heuristic mirrors FIDE: a lone king + king, or K+N / K+B vs lone K, cannot win.
    const fenBoard = this.chess.fen().split(' ')[0] ?? '';
    const mine = side === 'w' ? /[PNBRQ]/g : /[pnbrq]/g;
    const myPieces = fenBoard.match(mine) ?? [];
    const counts = myPieces.reduce<Record<string, number>>((acc, p) => {
      const k = p.toLowerCase();
      acc[k] = (acc[k] ?? 0) + 1;
      return acc;
    }, {});
    if ((counts.p ?? 0) > 0 || (counts.r ?? 0) > 0 || (counts.q ?? 0) > 0) return true;
    const minors = (counts.n ?? 0) + (counts.b ?? 0);
    if (minors >= 2) return true; // K+2 minors can (generally) mate; treat as winnable
    return false; // bare king, or K + single minor: cannot force mate
  }

  private halfMoveClock(): number {
    const field = this.chess.fen().split(' ')[4];
    const n = field ? Number.parseInt(field, 10) : 0;
    return Number.isFinite(n) ? n : 0;
  }
}
