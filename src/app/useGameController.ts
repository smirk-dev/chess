import { useEffect, useRef, useSyncExternalStore } from 'react';
import { GameController } from './GameController';
import type { ControllerSnapshot } from './types';

/**
 * Creates a single GameController for the component's lifetime, kicks off the engine + first game,
 * and subscribes the component to its immutable snapshot. The controller — not React — owns all the
 * game/engine/clock state; React just re-renders when the snapshot changes.
 */
export function useGameController(): { controller: GameController; snapshot: ControllerSnapshot } {
  const ref = useRef<GameController | null>(null);
  if (ref.current === null) ref.current = new GameController();
  const controller = ref.current;

  useEffect(() => {
    void controller.start();
    return () => controller.dispose();
    // controller is stable for the component's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { controller, snapshot };
}
