import { useMemo } from 'react';
import { Chessboard } from 'react-chessboard';
import type { Square } from 'chess.js';
import type { GameController } from '../app/GameController';
import type { ControllerSnapshot } from '../app/types';
import { boardSquares, buildSquareStyles, findKingSquare } from './boardHighlights';

interface BoardPanelProps {
  snapshot: ControllerSnapshot;
  controller: GameController;
}

/**
 * The chessboard surface. All interaction is delegated to the controller — the board never decides
 * legality itself and is always re-rendered from the authoritative FEN. When the controller is
 * locked (engine thinking, game over, awaiting promotion), dragging is disabled.
 */
export function BoardPanel({ snapshot, controller }: BoardPanelProps) {
  const { game, ui } = snapshot;
  const interactive = ui.interactionLock === 'idle';

  const occupied = useMemo(() => boardSquares(game.fen), [game.fen]);
  const checkSquare = game.inCheck ? findKingSquare(game.fen, game.turn) : null;

  const squareStyles = useMemo(
    () =>
      buildSquareStyles({
        selectedSquare: ui.selectedSquare,
        legalTargets: ui.legalTargets,
        lastMove: game.lastMove,
        checkSquare,
        hasPiece: (sq) => occupied.has(sq),
      }),
    [ui.selectedSquare, ui.legalTargets, game.lastMove, checkSquare, occupied],
  );

  return (
    <div className="board-wrap" data-locked={!interactive}>
      <Chessboard
        options={{
          id: 'main-board',
          position: game.fen,
          boardOrientation: ui.boardOrientation,
          allowDragging: interactive,
          showAnimations: true,
          animationDurationInMs: 180,
          showNotation: true,
          squareStyles,
          // Aged ivory & warm walnut — a royal chess set.
          darkSquareStyle: { backgroundColor: '#6b4a26', backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(0,0,0,0.12))' },
          lightSquareStyle: { backgroundColor: '#e9d7ad', backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.18), rgba(120,90,40,0.10))' },
          darkSquareNotationStyle: { color: '#e9d7ad' },
          lightSquareNotationStyle: { color: '#7a5a2e' },
          dropSquareStyle: { boxShadow: 'inset 0 0 0 4px rgba(236,201,101,0.85)' },
          boardStyle: { borderRadius: '3px', overflow: 'hidden', boxShadow: 'inset 0 0 0 2px rgba(20,14,8,0.85)' },
          onPieceDrop: ({ sourceSquare, targetSquare }) => {
            if (!targetSquare) return false;
            return controller.onPieceDrop(sourceSquare as Square, targetSquare as Square);
          },
          onSquareClick: ({ square }) => controller.onSquareClick(square as Square),
          // Clicking a piece counts as clicking its square (so click-to-move works on occupied squares too).
          onPieceClick: ({ square }) => {
            if (square) controller.onSquareClick(square as Square);
          },
        }}
      />
    </div>
  );
}
