import type { ControllerSnapshot } from '../app/types';

/**
 * Persistent display of the engine's *configured target* Elo. Stays visible at all times (including
 * while the engine is thinking or in an error state). When the user has picked a new difficulty
 * mid-game, the badge keeps showing the Elo that's actually in effect and adds a small hint that the
 * change applies at the engine's next turn.
 */
export function EloBadge({ snapshot }: { snapshot: ControllerSnapshot }) {
  const { ui } = snapshot;
  const active = ui.difficulty;
  const pending = ui.pendingDifficulty;

  return (
    <div className="elo-badge" title="The engine's configured strength target (UCI_Elo). Not a universal human-equivalent rating.">
      <span className="elo-badge__icon" aria-hidden>♚</span>
      <span className="elo-badge__label">Computer</span>
      <span className="elo-badge__elo">Elo {active.elo}</span>
      <span className="elo-badge__level">{active.label}</span>
      {pending && (
        <span className="elo-badge__pending" title="Takes effect on the computer's next turn">
          → {pending.elo} ({pending.label})
        </span>
      )}
    </div>
  );
}
