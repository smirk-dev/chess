import type { GameController } from '../app/GameController';
import type { ControllerSnapshot } from '../app/types';
import { promotionPieceName, type PromotionPiece } from '../domain/san';

const GLYPH: Record<PromotionPiece, { w: string; b: string }> = {
  q: { w: '♕', b: '♛' },
  r: { w: '♖', b: '♜' },
  b: { w: '♗', b: '♝' },
  n: { w: '♘', b: '♞' },
};

/**
 * Modal shown when the user makes a promoting move. The move is NOT applied until a piece is chosen
 * (the rules layer never auto-promotes). Cancelling leaves the pawn where it was.
 */
export function PromotionDialog({ snapshot, controller }: { snapshot: ControllerSnapshot; controller: GameController }) {
  const pp = snapshot.ui.pendingPromotion;
  if (snapshot.ui.interactionLock !== 'awaiting-promotion' || !pp) return null;
  const color = snapshot.ui.userColor;

  return (
    <div className="modal-overlay" onClick={() => controller.cancelPromotion()}>
      <div className="modal promo-dialog" role="dialog" aria-label="Choose promotion piece" onClick={(e) => e.stopPropagation()}>
        <div className="promo-dialog__title">Promote pawn to…</div>
        <div className="promo-dialog__choices">
          {pp.pieces.map((piece) => (
            <button
              key={piece}
              type="button"
              className="promo-dialog__choice"
              onClick={() => controller.choosePromotion(piece)}
              title={promotionPieceName(piece)}
            >
              <span className="promo-dialog__glyph">{GLYPH[piece][color]}</span>
              <span className="promo-dialog__name">{promotionPieceName(piece)}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => controller.cancelPromotion()}>
          Cancel
        </button>
      </div>
    </div>
  );
}
