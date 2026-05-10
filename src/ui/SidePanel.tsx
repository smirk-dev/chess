import type { GameController } from '../app/GameController';
import type { ControllerSnapshot } from '../app/types';
import { AnalysisPanel } from './AnalysisPanel';
import { ClockDisplay } from './ClockDisplay';
import { EloBadge } from './EloBadge';
import { MoveList } from './MoveList';
import { NewGameControls } from './NewGameControls';

/** The information/controls column beside the board (drops below it on narrow screens). */
export function SidePanel({ snapshot, controller }: { snapshot: ControllerSnapshot; controller: GameController }) {
  return (
    <aside className="side-panel">
      <EloBadge snapshot={snapshot} />
      <ClockDisplay snapshot={snapshot} />
      <NewGameControls snapshot={snapshot} controller={controller} />
      <AnalysisPanel snapshot={snapshot} controller={controller} />
      <MoveList snapshot={snapshot} />
    </aside>
  );
}
