import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClockService } from '../../src/clock/ClockService';
import { getTimeControlById } from '../../src/config/timeControls';

const blitz5 = getTimeControlById('blitz-5-0'); // 300000 / 0
const inc3plus2 = getTimeControlById('blitz-3-2'); // 180000 / 2000
const unlimited = getTimeControlById('unlimited');

describe('ClockService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function make(onFlag?: (s: 'w' | 'b') => void): ClockService {
    return new ClockService({
      now: () => Date.now(),
      scheduler: { setInterval: (cb, ms) => setInterval(cb, ms), clearInterval: (h) => clearInterval(h) },
      onFlag,
    });
  }

  it('counts down only the active side', async () => {
    const c = make();
    c.reset(blitz5);
    c.start('w');
    await vi.advanceTimersByTimeAsync(3000);
    const s = c.getSnapshot();
    expect(s.remainingMs.w).toBeLessThanOrEqual(297_000);
    expect(s.remainingMs.w).toBeGreaterThan(296_000);
    expect(s.remainingMs.b).toBe(300_000);
  });

  it('adds the increment to the side that just moved on switchTurn', async () => {
    const c = make();
    c.reset(inc3plus2); // 180000 base, +2000 increment
    c.start('w');
    await vi.advanceTimersByTimeAsync(5000);
    c.switchTurn(); // white moved -> +2000 to white, now black ticks
    const afterSwitch = c.getSnapshot();
    expect(afterSwitch.activeSide).toBe('b');
    // white spent ~5s of 180s then got +2s back => ~177s
    expect(afterSwitch.remainingMs.w).toBeGreaterThan(176_000);
    expect(afterSwitch.remainingMs.w).toBeLessThanOrEqual(177_000);
    expect(afterSwitch.remainingMs.b).toBe(180_000);
    await vi.advanceTimersByTimeAsync(2000);
    expect(c.getSnapshot().remainingMs.b).toBeLessThanOrEqual(178_000);
    expect(c.getSnapshot().remainingMs.b).toBeGreaterThan(177_000);
  });

  it('fires onFlag exactly once when a side runs out', async () => {
    const flags: Array<'w' | 'b'> = [];
    const c = make((s) => flags.push(s));
    c.reset({ id: 't', label: 't', baseMs: 1000, incrementMs: 0 });
    c.start('w');
    await vi.advanceTimersByTimeAsync(5000);
    expect(flags).toEqual(['w']);
    const s = c.getSnapshot();
    expect(s.remainingMs.w).toBe(0);
    expect(s.running).toBe(false);
    expect(s.activeSide).toBeNull();
  });

  it('pause/resume freezes the active side', async () => {
    const c = make();
    c.reset(blitz5);
    c.start('w');
    await vi.advanceTimersByTimeAsync(2000);
    c.pause();
    const paused = c.getSnapshot().remainingMs.w;
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.getSnapshot().remainingMs.w).toBe(paused);
    c.resume();
    await vi.advanceTimersByTimeAsync(1000);
    expect(c.getSnapshot().remainingMs.w).toBeLessThan(paused);
  });

  it('Unlimited time control is a no-op', async () => {
    const c = make();
    c.reset(unlimited);
    expect(c.getSnapshot().unlimited).toBe(true);
    c.start('w');
    await vi.advanceTimersByTimeAsync(10_000);
    const s = c.getSnapshot();
    expect(s.unlimited).toBe(true);
    expect(s.running).toBe(false);
    expect(s.activeSide).toBeNull();
    expect(s.remainingMs.w).toBe(0);
  });
});
