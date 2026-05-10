import type { GameController } from '../app/GameController';
import type { ControllerSnapshot, SideChoice } from '../app/types';

const SIDE_OPTIONS: { value: SideChoice; label: string }[] = [
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'random', label: 'Random' },
];

/**
 * New-game setup: which side to play, difficulty (= engine Elo), and time control. Difficulty stays
 * changeable mid-game (the controller defers it to the engine's next turn); time control / side only
 * apply at the next New Game, so those selects are disabled while a game is in progress.
 */
export function NewGameControls({ snapshot, controller }: { snapshot: ControllerSnapshot; controller: GameController }) {
  const { ui, game } = snapshot;
  const gameInProgress = game.status === 'in-progress' && ui.interactionLock !== 'engine-error';
  const presets = controller.getDifficultyPresets();
  const timeControls = controller.getTimeControls();
  const selectedPreset = ui.pendingDifficulty ?? ui.difficulty;

  return (
    <div className="newgame">
      <div className="control-row">
        <label htmlFor="side-select">I play</label>
        <select
          id="side-select"
          value={ui.sideChoice}
          disabled={gameInProgress}
          onChange={(e) => controller.selectSide(e.target.value as SideChoice)}
        >
          {SIDE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="control-row">
        <label htmlFor="difficulty-select">Difficulty</label>
        <select id="difficulty-select" value={selectedPreset.id} onChange={(e) => controller.selectDifficulty(e.target.value)}>
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label} — Elo {p.elo}
            </option>
          ))}
        </select>
      </div>
      <div className="control-hint">{selectedPreset.blurb}</div>

      <div className="control-row">
        <label htmlFor="time-select">Time</label>
        <select
          id="time-select"
          value={ui.timeControl.id}
          disabled={gameInProgress}
          onChange={(e) => controller.selectTimeControl(e.target.value)}
        >
          {timeControls.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="control-row control-row--actions">
        <button type="button" className="btn btn--primary" onClick={() => void controller.newGame()}>
          New Game
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={!gameInProgress}
          onClick={() => controller.resign()}
        >
          Resign
        </button>
      </div>
    </div>
  );
}
