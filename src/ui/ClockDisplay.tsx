import type { Color } from 'chess.js';
import type { ControllerSnapshot } from '../app/types';

function formatClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  // Under 20s, show tenths for tension.
  if (ms < 20_000) {
    const tenths = Math.max(0, Math.floor((ms % 1000) / 100));
    return `${m}:${String(Math.floor((ms / 1000) % 60)).padStart(2, '0')}.${tenths}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

function ClockRow({ side, snapshot, who }: { side: Color; snapshot: ControllerSnapshot; who: string }) {
  const { clock } = snapshot;
  const active = clock.activeSide === side && clock.running;
  const ms = clock.remainingMs[side];
  const low = ms < 30_000;
  return (
    <div className={`clock-row${active ? ' clock-row--active' : ''}${low ? ' clock-row--low' : ''}`}>
      <span className="clock-row__who">{who}</span>
      <span className="clock-row__time">{formatClock(ms)}</span>
    </div>
  );
}

/** Two stacked clocks: opponent on top, the user on the bottom. Hidden entirely for Unlimited time. */
export function ClockDisplay({ snapshot }: { snapshot: ControllerSnapshot }) {
  if (snapshot.clock.unlimited) return null;
  const userColor = snapshot.ui.userColor;
  const engineColor: Color = userColor === 'w' ? 'b' : 'w';
  return (
    <div className="clocks">
      <ClockRow side={engineColor} snapshot={snapshot} who={`Computer (${engineColor === 'w' ? 'White' : 'Black'})`} />
      <ClockRow side={userColor} snapshot={snapshot} who={`You (${userColor === 'w' ? 'White' : 'Black'})`} />
    </div>
  );
}
