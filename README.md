# Chess — play against Stockfish

A production-style, single-page chess app where a human plays the computer. The opponent is a real
chess engine (**Stockfish**, compiled to WebAssembly, running in a dedicated Web Worker and driven
over the **UCI** protocol). Difficulty is honest: every level limits the engine via Stockfish's
documented `UCI_LimitStrength` + `UCI_Elo` options — weaker play comes from the engine's own
strength limiting, never from random or deliberately bad move selection. The UI always shows the
engine's **configured target Elo**.

Stack: **React 18/19 + TypeScript + Vite**, `react-chessboard` for the board, `chess.js` for rules
and move history, `stockfish` (npm) for the engine. Tests: **Vitest** + Testing Library.

---

## Quick start

```bash
npm install          # postinstall is fine; the engine files are copied on predev/prebuild
npm run dev          # http://localhost:5173  (copies the Stockfish files into public/engine first)
```

Other scripts:

| command | what it does |
| --- | --- |
| `npm run dev` | dev server (runs `copy-engine` first) |
| `npm run build` | typecheck + production build to `dist/` (runs `copy-engine` first) |
| `npm run preview` | serve the production build locally |
| `npm test` | run the Vitest suites once |
| `npm run test:watch` | watch mode |
| `npm run typecheck` | `tsc -b` with no emit |
| `npm run lint` | ESLint |
| `npm run copy-engine` | (re)copy the Stockfish engine files into `public/engine/` |

`public/engine/` is **git-ignored** — `scripts/copy-engine.mjs` copies the single-threaded "lite"
Stockfish build (`stockfish-18-lite-single.js` + `.wasm`, ~7 MB) out of `node_modules/stockfish/`
and writes an `engine-manifest.json` the app reads to find the worker entry filename. This runs
automatically before `dev`/`build`.

---

## Architecture

Strict dependency direction: **`ui → app → { domain, engine, clock, config }`**. The `domain`,
`engine`, `clock`, and `config` layers never import React; the `engine` layer only talks to the
Worker. The board never decides legality itself and is always re-rendered from the authoritative FEN.

| layer | path | responsibility |
| --- | --- | --- |
| **Presentation** | `src/ui/`, `src/App.tsx` | board, Elo badge, clocks, status banner, move list, analysis panel, new-game controls, promotion dialog. Dumb: props in, callbacks out. |
| **Application / controller** | `src/app/` | `GameController` owns the three state objects (`GameState` / `UIState` / `EngineSessionState`) + the clock snapshot, runs the move lifecycle, manages request tokens & stale-result rejection, wires Rules + Engine + Clock, and exposes one immutable `ControllerSnapshot` via `useSyncExternalStore` (`useGameController`). |
| **Rules service** | `src/domain/` | `RulesService` — a thin wrapper over one `chess.js` instance. The single source of truth for legality, move history, FEN, and game-end detection. |
| **Engine integration** | `src/engine/` | `EngineService` (the clean engine API) over `UciAdapter` (owns the Worker, runs the UCI state machine) + a pure `uciParser` + `engineWorkerLoader` (the only place that knows the engine URL — also the test seam). |
| **Clock** | `src/clock/` | `ClockService` — two-sided countdown + Fischer increment, time computed from real wall-clock deltas (injectable), runs for whichever side is to move (including while the engine thinks). |
| **Diagnostics** | `src/diagnostics/` | dev-only panel: live UCI traffic, engine lifecycle, controller tokens/state. Gated to `import.meta.env.DEV`. |
| **Config** | `src/config/` | difficulty presets (label → Elo + think-time band), time controls, engine constants. |

### Engine communication flow (UCI)

1. **Boot** — `EngineService.init()` creates the Worker, sends `uci`, collects `id`/`option` lines,
   waits for `uciok`, sends `isready`, waits for `readyok`. State → `ready`. (A boot timeout →
   "engine failed to load".)
2. **New game** — `ucinewgame` → `isready`/`readyok` (clears the engine hash) → `setoption name
   UCI_LimitStrength value true` → `setoption name UCI_Elo value <elo>`.
3. **A move** — `position startpos moves <uci…>` (so the engine has full repetition context; a game
   started from a custom FEN sends `position fen <fen>` instead) → `go movetime <ms>` (time-based,
   not depth-based — depth-to-time is unpredictable at limited Elo). State → `thinking`.
4. **Replies** — `info … pv …` lines are parsed and forwarded as throttled PV updates; `bestmove
   <uci>` resolves the move request. The result is tagged with a **request token**; the controller
   ignores any reply whose token isn't current (a New Game / newer request / difficulty change has
   happened since). `cancel()` sends `stop` and the in-flight request rejects.

### Key invariants

- Every applied move goes through `RulesService` — the board, the move history, and the position
  sent to the engine never diverge.
- The engine never mutates UI/game state directly; replies are interpreted by the controller,
  validated against the current token, then applied.
- **New Game** is always allowed (even mid-think): it cancels the in-flight search, bumps the token,
  and resets — a stale `bestmove` arriving afterwards is ignored, so no "ghost move".
- A **mid-game difficulty change** is applied to the engine only at the next engine-turn boundary,
  never mid-search. The Elo badge keeps showing the *applied* Elo with a "→ N (next engine turn)"
  hint until then. Changing difficulty (or time control / side) with no game in progress just stores
  it for the next New Game.
- Promotions are never auto-resolved — a promoting move pops the dialog and isn't committed until a
  piece is chosen; cancelling leaves the pawn where it was.

### What the displayed Elo means

The badge shows the engine's **configured target strength** — the value passed to Stockfish's
`UCI_Elo` (with `UCI_LimitStrength` enabled). Stockfish calibrates Elo-limited strength against a
specific benchmark setting; treat the number as "roughly this strength", not a guaranteed
human-equivalent tournament rating across every time control. We ship the single-threaded "lite"
build (`ENGINE_VARIANT` in `src/config/engineConstants.ts`) so the page needs **no `SharedArrayBuffer`
and no COOP/COEP cross-origin-isolation headers**; it's still far above human strength, so an
Elo-limited opponent is well served. Switching to a multi-threaded build is a one-line change there
plus adding those headers to the dev server (`vite.config.ts`) and your static host.

---

## Difficulty & time-control presets

Difficulty (`src/config/difficulty.ts`): **Beginner 1320 · Casual 1600 · Intermediate 1900 (default)
· Advanced 2200 · Expert 2600 · Maximum (limited) 3190** — Elo is clamped to Stockfish's documented
range. Each level has a think-time band (`go movetime`) that scales with strength so stronger
settings actually use their strength and weaker ones stay snappy; the band midpoint is used with a
small jitter purely so the opponent's timing isn't robotic (it never changes which move is chosen
beyond what Stockfish does within that budget). With a clock on, the engine's `movetime` is also
capped well under its remaining time.

Time controls (`src/config/timeControls.ts`): **Unlimited (default, clock hidden) · 5+0 · 3+2 ·
10+5**. Clocks run for the side to move, including the engine; flag-fall ends the game (a draw if the
side that flagged the opponent has insufficient mating material).

---

## Testing

`npm test` runs (Vitest, jsdom):

- `test/domain/RulesService.test.ts` — legality, pins, promotion detection, `historyUci`,
  checkmate/stalemate/insufficient-material/fifty-move, PV→SAN, time-out material check.
- `test/engine/uciParser.test.ts` — `id`/`option`/`uciok`/`readyok`, `info … pv …`, mate scores,
  `lowerbound`/`upperbound`, `info string`, `bestmove … ponder …`, `bestmove (none)`/`0000`, never
  throws on garbage.
- `test/clock/ClockService.test.ts` — only the active side counts down, increments on `switchTurn`,
  `onFlag` fires once, pause/resume, Unlimited is a no-op.
- `test/engine/EngineService.test.ts` — handshake on `init()`, idempotence, boot-timeout → error,
  `setStrength` clamps + sends both `setoption` lines, `newGame` re-applies strength, `requestMove`
  sends `position` + `go movetime` and resolves with a tagged `bestmove`, `cancel()` →
  `EngineCancelledError`, PV throttling + token tagging, `bestmove (none)` → fault, `dispose()`.
- `test/app/GameController.test.ts` — start; a human move triggers exactly one engine request with
  the right history; moves rejected while thinking; promotion interrupt → dialog → engine called
  only after the choice; cancel-promotion leaves the pawn; New Game mid-think resets with no ghost
  move; mid-game difficulty change is deferred to the next engine turn; an illegal engine move →
  engine-error without touching the board; human checkmate ends the game with no further engine
  call; playing Black → engine opens immediately, board flipped; Random side resolves via the RNG.
- `test/integration/humanThenEngine.test.tsx` — renders `<App/>` with a scripted mock Worker, boots
  the engine through React, checks the Elo badge / empty move list, plays `e2→e4`, and asserts the
  engine's `…e5` reply shows up in the move list and it's the user's turn again.

The Worker is faked by `test/mocks/MockEngineWorker.ts` (a scriptable UCI brain) injected through the
`engineWorkerLoader` seam.

### Manual QA checklist

Fresh load shows the Elo badge + "engine ready" + "Your move"; play White (engine replies within the
band each move); play Black (engine opens, board flipped); Random over a few games gives both colors
with matching orientation; a forced promotion pops the dialog (incl. knight underpromotion); New Game
mid-think → instant reset, no ghost move later; difficulty change mid-think → badge shows "pending",
applies at the next engine move; clocks (run a clock low → time-out loss; increment added each move;
Unlimited hides the clocks); analysis panel updates smoothly (throttled, no flicker), eval flips
sign, shows `M3` near mate; all game-over states lock the board to "New Game" only; remove
`public/engine/*.wasm` in a dev build → "engine failed to load" banner, no crash, "Retry" re-attempts
init; spamming moves while the engine is thinking is harmless (no double moves); narrow viewport →
board stays the priority, controls move below it.
