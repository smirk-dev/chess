import { useGameController } from './app/useGameController';
import { BoardPanel } from './ui/BoardPanel';
import { PromotionDialog } from './ui/PromotionDialog';
import { SidePanel } from './ui/SidePanel';
import { StatusBanner } from './ui/StatusBanner';
import { DiagnosticsPanel } from './diagnostics/DiagnosticsPanel';

export default function App() {
  const { controller, snapshot } = useGameController();

  return (
    <div className="app">
      <header className="app__header">
        <h1 className="app__title">Chess</h1>
        <p className="app__subtitle">Play against Stockfish — pick a difficulty and the engine plays at that Elo.</p>
      </header>

      <main className="app__main">
        <section className="app__board-col">
          <StatusBanner snapshot={snapshot} controller={controller} />
          <BoardPanel snapshot={snapshot} controller={controller} />
        </section>
        <SidePanel snapshot={snapshot} controller={controller} />
      </main>

      <PromotionDialog snapshot={snapshot} controller={controller} />
      <DiagnosticsPanel snapshot={snapshot} controller={controller} />

      <footer className="app__footer">
        Engine: Stockfish (WASM, single-threaded) in a Web Worker · rules &amp; legality: chess.js · Elo shown is the
        engine's configured target strength, not a universal human-equivalent rating.
      </footer>
    </div>
  );
}
