import type { GameController } from '../app/GameController';
import type { ControllerSnapshot } from '../app/types';

/**
 * The single, plain-language status line: whose move it is, check, the game result, or an engine
 * problem. For engine-error states it also offers the retry/restart action.
 */
export function StatusBanner({ snapshot, controller }: { snapshot: ControllerSnapshot; controller: GameController }) {
  const banner = snapshot.ui.banner;
  if (!banner) return null;
  const isError = banner.kind === 'engine-load-failed' || banner.kind === 'engine-crashed';
  const thinking = banner.kind === 'engine-thinking';

  return (
    <div className={`status-banner status-banner--${banner.kind}`} role="status" aria-live="polite">
      {thinking && <span className="status-banner__spinner" aria-hidden />}
      <span className="status-banner__text">{banner.text}</span>
      {isError && (
        <button type="button" className="btn btn--small" onClick={() => void controller.retryEngine()}>
          {banner.kind === 'engine-load-failed' ? 'Retry' : 'Restart engine'}
        </button>
      )}
    </div>
  );
}
