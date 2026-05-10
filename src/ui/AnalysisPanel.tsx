import type { GameController } from '../app/GameController';
import type { AnalysisLine, ControllerSnapshot } from '../app/types';

function formatEval(a: AnalysisLine): { text: string; sign: 'plus' | 'minus' | 'zero' } {
  if (a.mateIn !== undefined) {
    const sign = a.mateIn > 0 ? 'plus' : a.mateIn < 0 ? 'minus' : 'zero';
    return { text: `M${Math.abs(a.mateIn)}`, sign };
  }
  if (a.scoreCp !== undefined) {
    const pawns = a.scoreCp / 100;
    const sign = pawns > 0.05 ? 'plus' : pawns < -0.05 ? 'minus' : 'zero';
    return { text: `${pawns >= 0 ? '+' : ''}${pawns.toFixed(2)}`, sign };
  }
  return { text: '—', sign: 'zero' };
}

/**
 * Throttled view of what the engine is "seeing": evaluation (from White's POV), search depth, and
 * the principal variation in SAN. The underlying PV stream is rate-limited in EngineService, so this
 * updates a few times a second at most — no flicker. Collapsible.
 */
export function AnalysisPanel({ snapshot, controller }: { snapshot: ControllerSnapshot; controller: GameController }) {
  const { ui, engine } = snapshot;
  const thinking = engine.engineState === 'thinking';
  const a = ui.analysis;

  return (
    <div className="analysis">
      <button type="button" className="analysis__head" onClick={() => controller.toggleAnalysis()} aria-expanded={ui.showAnalysis}>
        <span>Engine analysis</span>
        <span className="analysis__toggle">{ui.showAnalysis ? '▾' : '▸'}</span>
      </button>
      {ui.showAnalysis && (
        <div className="analysis__body">
          {!a && <div className="analysis__placeholder">{thinking ? 'Thinking…' : 'No analysis yet.'}</div>}
          {a && (
            <>
              <div className="analysis__line1">
                <span className={`analysis__eval analysis__eval--${formatEval(a).sign}`}>{formatEval(a).text}</span>
                <span className="analysis__depth">depth {a.depth}</span>
                {thinking && <span className="analysis__spinner" aria-hidden />}
              </div>
              <div className="analysis__pv">{a.pvSan.length ? a.pvSan.join(' ') : a.pvUci.join(' ')}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
