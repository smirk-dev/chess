import { useEffect, useState } from 'react';
import type { GameController } from '../app/GameController';
import type { ControllerSnapshot } from '../app/types';
import { uciLogClear, uciLogSubscribe, type UciLogEntry } from './uciLog';

/**
 * Developer-only panel: live UCI traffic, engine lifecycle, and the controller's token/state. Gated
 * to `import.meta.env.DEV` so it never ships in production builds. Invaluable for engine bring-up
 * ("did we send the right position?", "was the engine ready before we searched?", "was a stale
 * bestmove ignored?").
 */
export function DiagnosticsPanel({ snapshot, controller }: { snapshot: ControllerSnapshot; controller: GameController }) {
  const [lines, setLines] = useState<readonly UciLogEntry[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => uciLogSubscribe(setLines), []);

  if (!import.meta.env.DEV) return null;
  const info = controller.getEngineInfo();
  const { engine, ui, game } = snapshot;

  return (
    <div className={`diagnostics${open ? ' diagnostics--open' : ''}`}>
      <button type="button" className="diagnostics__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '× diagnostics' : '⚙ diagnostics'}
      </button>
      {open && (
        <div className="diagnostics__body">
          <div className="diagnostics__facts">
            <div>engine: <b>{info.name ?? '—'}</b> · state <b>{engine.engineState}</b></div>
            <div>UCI_LimitStrength: <b>{String(info.limitStrength)}</b> · UCI_Elo applied: <b>{info.appliedElo ?? '—'}</b> · supports Elo-limit: <b>{String(info.supportsEloLimiting)}</b></div>
            <div>token (engine reply): <b>{engine.currentToken ?? '—'}</b> · lastBestMove: <b>{engine.lastBestMove ?? '—'}</b></div>
            <div>lock: <b>{ui.interactionLock}</b> · status: <b>{game.status}</b> · difficulty: <b>{ui.difficulty.id}</b>{ui.pendingDifficulty ? <> → <b>{ui.pendingDifficulty.id}</b></> : null}</div>
            {engine.engineError && <div className="diagnostics__err">error: {engine.engineError.code} — {engine.engineError.message}</div>}
            <div className="diagnostics__actions">
              <button type="button" className="btn btn--small" onClick={() => uciLogClear()}>clear log</button>
              <button type="button" className="btn btn--small" onClick={() => void controller.retryEngine()}>restart engine</button>
            </div>
          </div>
          <pre className="diagnostics__log">
            {lines
              .slice(-160)
              .map((l) => `${l.dir === 'in' ? '«' : l.dir === 'out' ? '»' : '·'} ${l.text}`)
              .join('\n')}
          </pre>
        </div>
      )}
    </div>
  );
}
