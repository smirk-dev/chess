import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Replace the real engine-Worker factory with a scripted mock BEFORE App is imported.
vi.mock('../../src/engine/engineWorkerLoader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/engine/engineWorkerLoader')>();
  const { MockEngineWorker } = await import('../mocks/MockEngineWorker');
  return {
    ...actual,
    defaultEngineWorkerFactory: async () =>
      new MockEngineWorker({
        bestMoveFor: (cmd) => (cmd.endsWith('e2e4') ? 'e7e5' : null),
      }),
  };
});

import App from '../../src/App';

afterEach(() => cleanup());

function square(name: string): Element {
  const el = document.querySelector(`[data-square="${name}"]`);
  if (!el) throw new Error(`square ${name} not found in the board`);
  return el;
}

describe('integration: human move → engine reply (App + controller + engine)', () => {
  it('boots the engine through React, shows the Elo badge, and plays a full round', async () => {
    render(<App />);

    // Engine handshake completes and the first game starts.
    await waitFor(() => expect(screen.getByText(/your move/i)).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByText('Elo 1900')).toBeInTheDocument(); // Intermediate default, shown in the badge
    expect(screen.getByText(/no moves yet/i)).toBeInTheDocument();

    // Click-to-move: e2 -> e4.
    fireEvent.click(square('e2'));
    fireEvent.click(square('e4'));

    // The engine (scripted) replies ...e5; the move list shows "1. e4 e5" and it's the user's turn again.
    await waitFor(() => expect(screen.getAllByText('e5').length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
    expect(screen.getByText('e4')).toBeInTheDocument();
    expect(screen.getByText('1.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/your move/i)).toBeInTheDocument());
    // Elo badge is unchanged.
    expect(screen.getByText('Elo 1900')).toBeInTheDocument();
  });
});
