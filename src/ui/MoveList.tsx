import { useEffect, useRef } from 'react';
import type { ControllerSnapshot } from '../app/types';
import { toMovePairs } from '../domain/san';

/**
 * Move history in numbered pairs (White / Black). The list scrolls *within its own box* to keep the
 * latest move visible — it never calls scrollIntoView (that would yank the whole page), it only
 * nudges this element's own scrollTop.
 */
export function MoveList({ snapshot }: { snapshot: ControllerSnapshot }) {
  const { game } = snapshot;
  const rows = toMovePairs(game.history, game.startColor);
  const listRef = useRef<HTMLOListElement | null>(null);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    // Only auto-follow if the user is already near the bottom (don't fight them if they scrolled up).
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [game.history.length]);

  return (
    <div className="movelist">
      <div className="movelist__head">Moves</div>
      <ol className="movelist__body" ref={listRef}>
        {rows.length === 0 && <li className="movelist__empty">No moves yet.</li>}
        {rows.map((row) => (
          <li key={row.no} className="movelist__row">
            <span className="movelist__no">{row.no}.</span>
            <span className="movelist__ply">{row.white ? row.white.san : row.black ? '…' : ''}</span>
            <span className="movelist__ply">{row.black ? row.black.san : ''}</span>
          </li>
        ))}
      </ol>
      {game.result && <div className="movelist__result">{game.result.scoreText}</div>}
    </div>
  );
}
