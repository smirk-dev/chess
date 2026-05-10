/**
 * The application/controller layer. It owns the three state objects (GameState / UIState /
 * EngineSessionState) plus the clock snapshot, wires together RulesService + EngineService +
 * ClockService, runs the full move lifecycle, and exposes ONE immutable `ControllerSnapshot` that
 * React subscribes to via `useSyncExternalStore`.
 *
 * Invariants this layer enforces:
 *  - The board position, move history, and the position sent to the engine never diverge — every
 *    applied move goes through RulesService, which is the single source of truth.
 *  - The engine never mutates UI/game state directly; its replies are interpreted here, validated
 *    against the current request token, and only then applied.
 *  - Starting a New Game invalidates any in-flight engine search (cancel + token bump); a stale
 *    `bestmove` arriving afterwards is ignored.
 *  - A mid-game difficulty change is applied to the engine only at the next engine turn boundary,
 *    never mid-search; the EloBadge shows the *applied* Elo with a "pending" hint until then.
 */
import type { Color, Square } from 'chess.js';
import { ClockService } from '../clock/ClockService';
import type { ClockSide, ClockSnapshot } from '../clock/types';
import {
  DIFFICULTY_PRESETS,
  getDefaultDifficulty,
  getDifficultyById,
  pickMovetimeMs,
  type DifficultyPreset,
} from '../config/difficulty';
import { getTimeControlById, isUnlimited, TIME_CONTROLS, type TimeControl } from '../config/timeControls';
import { RulesService } from '../domain/RulesService';
import { describeResult, makeResult, type GameResult } from '../domain/result';
import { PROMOTION_PIECES, type PromotionPiece } from '../domain/san';
import { EngineService } from '../engine/EngineService';
import { defaultEngineWorkerFactory, type EngineWorkerFactory } from '../engine/engineWorkerLoader';
import { EngineCancelledError, type EngineError, type MoveResult, type PvUpdate } from '../engine/types';
import { RequestTokenSource } from './requestToken';
import type {
  AnalysisLine,
  Banner,
  ControllerSnapshot,
  EngineSessionState,
  GameState,
  GameStatus,
  PendingPromotion,
  SideChoice,
  UIState,
} from './types';

export interface GameControllerOptions {
  engineFactory?: EngineWorkerFactory;
  /** Injected RNG for deterministic tests (side-on-Random, movetime jitter). */
  rng?: () => number;
  /** Pre-built collaborators (tests inject fakes/spies). */
  rules?: RulesService;
  engine?: EngineService;
  clock?: ClockService;
  /** Auto-start a game when `start()` is called (default true). */
  autoStart?: boolean;
}

const OTHER: Record<Color, Color> = { w: 'b', b: 'w' };
const STANDARD_START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export class GameController {
  private readonly rules: RulesService;
  private engine: EngineService;
  private readonly clock: ClockService;
  private readonly engineFactory: EngineWorkerFactory;
  private readonly rng: () => number;
  private readonly tokens = new RequestTokenSource();

  private game: GameState;
  private ui: UIState;
  private session: EngineSessionState;
  private clockSnap: ClockSnapshot;

  private snapshot: ControllerSnapshot;
  private readonly listeners = new Set<() => void>();

  private started = false;
  private disposed = false;
  private unwireEngine: Array<() => void> = [];
  /** The FEN the current game started from; `STANDARD_START_FEN` for a normal game. */
  private startFen: string = STANDARD_START_FEN;

  constructor(opts: GameControllerOptions = {}) {
    this.engineFactory = opts.engineFactory ?? defaultEngineWorkerFactory;
    this.rng = opts.rng ?? Math.random;
    this.rules = opts.rules ?? new RulesService();
    this.engine = opts.engine ?? new EngineService(this.engineFactory);
    this.clock = opts.clock ?? new ClockService();

    const difficulty = getDefaultDifficulty();
    const timeControl = getTimeControlById('unlimited');

    this.rules.newGame();
    this.game = this.deriveGameState();
    this.ui = {
      userColor: 'w',
      sideChoice: 'white',
      boardOrientation: 'white',
      interactionLock: 'awaiting-engine',
      pendingPromotion: null,
      selectedSquare: null,
      legalTargets: [],
      analysis: null,
      difficulty,
      pendingDifficulty: null,
      timeControl,
      banner: { kind: 'engine-loading', text: 'Loading the chess engine…' },
      showAnalysis: true,
    };
    this.session = {
      engineState: this.engine.getState(),
      appliedElo: null,
      currentToken: null,
      lastBestMove: null,
      supportsEloLimiting: false,
      engineError: null,
    };
    this.clock.reset(timeControl);
    this.clockSnap = this.clock.getSnapshot();
    this.clock.setHandlers({
      onFlag: (side) => this.handleFlagFall(side),
      onChange: (snap) => {
        this.clockSnap = snap;
        this.rebuildAndEmit();
      },
    });

    this.wireEngine();
    this.snapshot = this.buildSnapshot();
  }

  // ---- external store ----------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ControllerSnapshot => this.snapshot;

  // ---- lifecycle ---------------------------------------------------------

  /** Boot the engine and (unless disabled) start the first game with the current settings. */
  async start(opts: { autoStartGame?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    if (this.started) return;
    this.started = true;
    const ok = await this.ensureEngineReady();
    if (!ok) return; // engine-error state already set + emitted
    if (opts.autoStartGame === false) return;
    await this.newGame();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const off of this.unwireEngine) off();
    this.unwireEngine = [];
    this.engine.dispose();
    this.clock.dispose();
    this.listeners.clear();
  }

  // ---- user actions ------------------------------------------------------

  /** Start a fresh game. Always allowed — even while the engine is thinking. */
  async newGame(
    opts: { sideChoice?: SideChoice; difficultyId?: string; timeControlId?: string; fen?: string } = {},
  ): Promise<void> {
    if (this.disposed) return;

    // Invalidate any in-flight engine search before touching anything.
    if (this.engine.getState() === 'thinking') this.engine.cancel();
    this.tokens.bump();
    this.session = { ...this.session, currentToken: null };

    const sideChoice = opts.sideChoice ?? this.ui.sideChoice;
    const userColor: Color = sideChoice === 'white' ? 'w' : sideChoice === 'black' ? 'b' : this.rng() < 0.5 ? 'w' : 'b';
    const difficulty = opts.difficultyId ? getDifficultyById(opts.difficultyId) : this.ui.difficulty;
    const timeControl = opts.timeControlId ? getTimeControlById(opts.timeControlId) : this.ui.timeControl;

    this.startFen = opts.fen ?? STANDARD_START_FEN;
    this.rules.newGame(opts.fen);
    this.game = this.deriveGameState();
    this.clock.reset(timeControl);
    this.clockSnap = this.clock.getSnapshot();

    this.ui = {
      ...this.ui,
      userColor,
      sideChoice,
      boardOrientation: userColor === 'w' ? 'white' : 'black',
      interactionLock: 'awaiting-engine', // until the engine is configured / first move handled
      pendingPromotion: null,
      selectedSquare: null,
      legalTargets: [],
      analysis: null,
      difficulty,
      pendingDifficulty: null,
      timeControl,
      banner: { kind: 'engine-loading', text: 'Preparing…' },
    };
    this.rebuildAndEmit();

    const ok = await this.ensureEngineReady();
    if (!ok) return;
    try {
      await this.engine.newGame(difficulty.elo);
    } catch (e) {
      // ensureEngineReady / onError will have set engine-error; make sure state is synced.
      this.syncEngineInfo();
      if (this.ui.interactionLock !== 'engine-error') this.faultEngine({ code: 'crashed', message: errMessage(e) });
      return;
    }
    this.syncEngineInfo();

    // Start the clock for whoever is to move (usually White from the start position).
    this.clock.start(this.rules.turn());
    this.clockSnap = this.clock.getSnapshot();

    if (this.engineToMove()) {
      this.ui = { ...this.ui, interactionLock: 'awaiting-engine', banner: bannerThinking() };
      this.rebuildAndEmit();
      void this.requestEngineMove();
    } else {
      this.ui = { ...this.ui, interactionLock: 'idle', banner: bannerYourMove(this.game.inCheck) };
      this.rebuildAndEmit();
    }
  }

  /**
   * Drag-and-drop entry point (react-chessboard). Returns `true` if the move was accepted (the board
   * keeps it), `false` to snap the piece back. Promotions return `false` and pop the dialog.
   */
  onPieceDrop = (from: Square, to: Square): boolean => {
    if (this.ui.interactionLock !== 'idle') return false;
    if (this.rules.turn() !== this.ui.userColor) return false;
    if (this.rules.isPromotion(from, to)) {
      this.beginPromotion(from, to);
      return false;
    }
    const move = this.rules.applyMove({ from, to });
    if (!move) return false;
    this.afterHumanMove();
    return true;
  };

  /** Click-to-move (mobile-friendly): select a piece, then a destination. */
  onSquareClick = (square: Square): void => {
    if (this.ui.interactionLock !== 'idle') return;
    const selected = this.ui.selectedSquare;
    if (selected) {
      if (square === selected) {
        this.setSelection(null);
        return;
      }
      if (this.ui.legalTargets.includes(square)) {
        if (this.rules.isPromotion(selected, square)) {
          this.beginPromotion(selected, square);
          return;
        }
        const move = this.rules.applyMove({ from: selected, to: square });
        if (move) {
          this.afterHumanMove();
          return;
        }
      }
      // Not a legal target: maybe the user is re-selecting another of their pieces.
      if (this.isOwnMovablePiece(square)) this.setSelection(square);
      else this.setSelection(null);
      return;
    }
    if (this.isOwnMovablePiece(square)) this.setSelection(square);
  };

  /** Resolve a pending promotion with the chosen piece. */
  choosePromotion = (piece: PromotionPiece): void => {
    if (this.ui.interactionLock !== 'awaiting-promotion' || !this.ui.pendingPromotion) return;
    const pp = this.ui.pendingPromotion;
    this.ui = { ...this.ui, pendingPromotion: null };
    const move = this.rules.applyMove({ from: pp.from, to: pp.to, promotion: piece });
    if (!move) {
      // Shouldn't happen, but never get stuck.
      this.ui = { ...this.ui, interactionLock: 'idle', banner: bannerYourMove(this.game.inCheck) };
      this.rebuildAndEmit();
      return;
    }
    this.afterHumanMove();
  };

  /** Abandon a pending promotion; the pawn stays where it was. */
  cancelPromotion = (): void => {
    if (this.ui.interactionLock !== 'awaiting-promotion') return;
    this.ui = { ...this.ui, pendingPromotion: null, interactionLock: 'idle', banner: bannerYourMove(this.game.inCheck) };
    this.rebuildAndEmit();
  };

  /** Pick a difficulty. Mid-game it's deferred to the engine's next turn (never mid-search). */
  selectDifficulty = (difficultyId: string): void => {
    const preset = getDifficultyById(difficultyId);
    if (!this.started || this.game.status !== 'in-progress') {
      // No game in progress: apply to the badge now; it'll be sent at the next New Game.
      this.ui = { ...this.ui, difficulty: preset, pendingDifficulty: null };
      this.rebuildAndEmit();
      return;
    }
    this.ui = { ...this.ui, pendingDifficulty: preset.id === this.ui.difficulty.id ? null : preset };
    this.rebuildAndEmit();
  };

  /** Pick a time control. Takes effect at the next New Game. */
  selectTimeControl = (timeControlId: string): void => {
    const tc = getTimeControlById(timeControlId);
    this.ui = { ...this.ui, timeControl: tc };
    if (!this.started || this.game.status !== 'in-progress') {
      this.clock.reset(tc);
      this.clockSnap = this.clock.getSnapshot();
    }
    this.rebuildAndEmit();
  };

  /** Pick which side to play. Takes effect at the next New Game. */
  selectSide = (sideChoice: SideChoice): void => {
    this.ui = { ...this.ui, sideChoice };
    this.rebuildAndEmit();
  };

  toggleAnalysis = (): void => {
    this.ui = { ...this.ui, showAnalysis: !this.ui.showAnalysis };
    this.rebuildAndEmit();
  };

  /** The human resigns the current game. */
  resign = (): void => {
    if (!this.started || this.game.status !== 'in-progress') return;
    this.endGame(makeResult(OTHER[this.ui.userColor], 'resignation'));
  };

  /** Recreate the engine after a fault and either resume the game or start a fresh one. */
  retryEngine = async (): Promise<void> => {
    if (this.disposed) return;
    this.recreateEngine();
    this.ui = { ...this.ui, banner: { kind: 'engine-loading', text: 'Restarting the chess engine…' } };
    this.rebuildAndEmit();

    const ok = await this.ensureEngineReady();
    if (!ok) return;
    try {
      await this.engine.newGame(this.ui.difficulty.elo);
    } catch (e) {
      this.faultEngine({ code: 'crashed', message: errMessage(e) });
      return;
    }
    this.syncEngineInfo();
    this.ui = { ...this.ui, pendingDifficulty: null };

    if (this.game.status !== 'in-progress') {
      await this.newGame();
      return;
    }
    // Resume mid-game.
    if (this.engineToMove()) {
      this.ui = { ...this.ui, interactionLock: 'awaiting-engine', banner: bannerThinking() };
      this.rebuildAndEmit();
      void this.requestEngineMove();
    } else {
      this.ui = { ...this.ui, interactionLock: 'idle', banner: bannerYourMove(this.game.inCheck) };
      this.rebuildAndEmit();
    }
  };

  // expose static option lists for the UI (kept here so the UI doesn't import config directly)
  getDifficultyPresets(): readonly DifficultyPreset[] {
    return DIFFICULTY_PRESETS;
  }
  getTimeControls(): readonly TimeControl[] {
    return TIME_CONTROLS;
  }
  getEngineInfo() {
    return this.engine.getInfo();
  }

  // ---- move lifecycle internals ------------------------------------------

  private afterHumanMove(): void {
    this.game = this.deriveGameState();
    this.clock.switchTurn();
    this.clockSnap = this.clock.getSnapshot();
    this.ui = { ...this.ui, selectedSquare: null, legalTargets: [] };

    if (this.rules.isGameOver()) {
      this.endGame(this.rules.result()!);
      return;
    }
    this.ui = { ...this.ui, interactionLock: 'awaiting-engine', banner: bannerThinking() };
    this.rebuildAndEmit();
    void this.requestEngineMove();
  }

  private async requestEngineMove(): Promise<void> {
    if (this.disposed) return;
    if (this.game.status !== 'in-progress' || this.ui.interactionLock !== 'awaiting-engine') return;
    if (!this.engineToMove()) return;

    // Apply a pending difficulty change here — the next-engine-turn boundary, never mid-search.
    if (this.ui.pendingDifficulty) {
      const next = this.ui.pendingDifficulty;
      try {
        await this.engine.setStrength(next.elo);
        this.ui = { ...this.ui, difficulty: next, pendingDifficulty: null };
        this.syncEngineInfo();
        this.rebuildAndEmit();
      } catch (e) {
        this.faultEngine({ code: 'crashed', message: errMessage(e) });
        return;
      }
      if (this.disposed || this.game.status !== 'in-progress' || this.ui.interactionLock !== 'awaiting-engine') return;
    }

    const token = this.tokens.next();
    this.session = { ...this.session, currentToken: token };
    this.rebuildAndEmit();

    const engineColor = this.rules.turn();
    let movetimeMs = pickMovetimeMs(this.ui.difficulty, this.rng);
    if (!isUnlimited(this.ui.timeControl)) {
      const remaining = this.clockSnap.remainingMs[engineColor as ClockSide];
      movetimeMs = Math.max(50, Math.min(movetimeMs, Math.floor(remaining * 0.05)));
    }

    // For a normal game, send `position startpos moves …` so the engine has full repetition context;
    // for a game started from a custom FEN, send the current position directly.
    const moveReq =
      this.startFen === STANDARD_START_FEN
        ? { token, movesUci: this.rules.historyUci(), movetimeMs }
        : { token, fen: this.rules.fen(), movetimeMs };

    try {
      const result = await this.engine.requestMove(moveReq);
      this.onEngineMove(result);
    } catch (e) {
      if (e instanceof EngineCancelledError) return; // superseded by New Game / game over — already handled
      this.faultEngine({ code: 'crashed', message: errMessage(e) });
    }
  }

  private onEngineMove(result: MoveResult): void {
    if (this.disposed) return;
    // Stale-rejection: anything not tagged with the live token is from a superseded request.
    if (result.token !== this.session.currentToken) return;
    this.session = { ...this.session, currentToken: null, lastBestMove: result.bestMove };

    const move = this.rules.applyUci(result.bestMove);
    if (!move) {
      this.faultEngine({ code: 'protocol', message: `engine returned an illegal move: ${result.bestMove}` });
      return;
    }
    this.game = this.deriveGameState();
    this.clock.switchTurn();
    this.clockSnap = this.clock.getSnapshot();

    if (this.rules.isGameOver()) {
      this.endGame(this.rules.result()!);
      return;
    }
    this.ui = {
      ...this.ui,
      interactionLock: 'idle',
      selectedSquare: null,
      legalTargets: [],
      banner: bannerYourMove(this.game.inCheck),
    };
    this.rebuildAndEmit();
  }

  private endGame(result: GameResult): void {
    const status = statusFromResult(result);
    this.game = { ...this.deriveGameState(), status, result };

    if (this.engine.getState() === 'thinking') this.engine.cancel();
    this.tokens.bump();
    this.session = { ...this.session, currentToken: null };

    this.clock.pause();
    this.clockSnap = this.clock.getSnapshot();

    this.ui = {
      ...this.ui,
      interactionLock: 'game-over',
      selectedSquare: null,
      legalTargets: [],
      pendingPromotion: null,
      banner: { kind: 'game-over', text: describeResult(result) },
    };
    this.rebuildAndEmit();
  }

  private handleFlagFall(side: ClockSide): void {
    if (this.game.status !== 'in-progress') return;
    const winner: Color | null = this.rules.canSideWinOnMaterial(OTHER[side]) ? OTHER[side] : null;
    this.endGame(makeResult(winner, 'timeout'));
  }

  private beginPromotion(from: Square, to: Square): void {
    const pieces = this.rules
      .legalMovesFrom(from)
      .filter((m) => m.to === to && m.promotion)
      .map((m) => m.promotion as PromotionPiece);
    const promo: PendingPromotion = { from, to, pieces: pieces.length ? pieces : [...PROMOTION_PIECES] };
    this.ui = {
      ...this.ui,
      pendingPromotion: promo,
      interactionLock: 'awaiting-promotion',
      selectedSquare: null,
      legalTargets: [],
    };
    this.rebuildAndEmit();
  }

  private setSelection(square: Square | null): void {
    if (square == null) {
      this.ui = { ...this.ui, selectedSquare: null, legalTargets: [] };
    } else {
      this.ui = {
        ...this.ui,
        selectedSquare: square,
        legalTargets: this.rules.legalMovesFrom(square).map((m) => m.to),
      };
    }
    this.rebuildAndEmit();
  }

  private isOwnMovablePiece(square: Square): boolean {
    if (this.rules.turn() !== this.ui.userColor) return false;
    const p = this.rules.pieceAt(square);
    return !!p && p.color === this.ui.userColor;
  }

  private engineToMove(): boolean {
    return this.rules.turn() === OTHER[this.ui.userColor];
  }

  // ---- engine wiring -----------------------------------------------------

  private wireEngine(): void {
    this.unwireEngine = [
      this.engine.onStateChange((s) => {
        this.session = { ...this.session, engineState: s };
        this.rebuildAndEmit();
      }),
      this.engine.onError((err) => {
        if (err.code === 'disposed') return; // intentional teardown
        this.faultEngine(err);
      }),
      this.engine.onPvUpdate((pv) => this.onPvUpdate(pv)),
    ];
  }

  private recreateEngine(): void {
    for (const off of this.unwireEngine) off();
    this.unwireEngine = [];
    this.engine.dispose();
    this.engine = new EngineService(this.engineFactory);
    this.wireEngine();
    this.session = {
      engineState: this.engine.getState(),
      appliedElo: null,
      currentToken: null,
      lastBestMove: this.session.lastBestMove,
      supportsEloLimiting: false,
      engineError: null,
    };
  }

  /** Ensure the engine is booted & ready. On failure sets the engine-error state and returns false. */
  private async ensureEngineReady(): Promise<boolean> {
    const s = this.engine.getState();
    if (s === 'ready' || s === 'thinking') return true;
    if (s === 'error') {
      this.faultEngine(this.engine.getInfo().error ?? { code: 'crashed', message: 'engine not available' });
      return false;
    }
    try {
      await this.engine.init();
    } catch {
      // engine.onError already fired -> faultEngine was called. Make sure UI reflects it.
      if (this.ui.interactionLock !== 'engine-error') {
        this.faultEngine(this.engine.getInfo().error ?? { code: 'load-failed', message: 'failed to load engine' });
      }
      return false;
    }
    this.syncEngineInfo();
    return this.engine.getState() === 'ready';
  }

  private onPvUpdate(pv: PvUpdate): void {
    if (pv.token !== this.session.currentToken) return; // stale
    // The engine reports scores from the side-to-move POV; normalize to White's POV for display.
    const stm = this.rules.turn();
    const flip = stm === 'b';
    const pvUci = pv.pvUci;
    const pvSan = this.rules.sanLineFromUci(pvUci);
    const analysis: AnalysisLine = {
      depth: pv.depth,
      pvSan,
      pvUci,
      updatedAt: typeof performance !== 'undefined' ? performance.now() : Date.now(),
      ...(pv.score?.cp !== undefined ? { scoreCp: flip ? -pv.score.cp : pv.score.cp } : {}),
      ...(pv.score?.mateIn !== undefined ? { mateIn: flip ? -pv.score.mateIn : pv.score.mateIn } : {}),
      ...(pv.nps !== undefined ? { nps: pv.nps } : {}),
    };
    this.ui = { ...this.ui, analysis };
    this.session = { ...this.session, liveScore: pv.score };
    this.rebuildAndEmit();
  }

  private faultEngine(err: EngineError | { code: string; message: string }): void {
    const code = err.code;
    const isLoad = code === 'load-failed';
    this.session = { ...this.session, engineError: { code, message: err.message }, currentToken: null, engineState: 'error' };
    this.tokens.bump();
    this.clock.pause();
    this.clockSnap = this.clock.getSnapshot();
    this.ui = {
      ...this.ui,
      interactionLock: 'engine-error',
      selectedSquare: null,
      legalTargets: [],
      banner: isLoad
        ? { kind: 'engine-load-failed', text: 'The chess engine failed to load. You can retry below.' }
        : { kind: 'engine-crashed', text: 'The chess engine stopped responding. You can restart it below.' },
    };
    this.rebuildAndEmit();
  }

  private syncEngineInfo(): void {
    const info = this.engine.getInfo();
    this.session = {
      ...this.session,
      engineState: info.state,
      appliedElo: info.appliedElo,
      supportsEloLimiting: info.supportsEloLimiting,
      engineError: info.error ? { code: info.error.code, message: info.error.message } : this.session.engineError,
    };
  }

  // ---- snapshot ----------------------------------------------------------

  private deriveGameState(): GameState {
    const status = this.rules.status();
    const history = this.rules.historyVerbose();
    const last = history.length ? history[history.length - 1]! : null;
    const result = this.rules.result();
    return {
      fen: this.rules.fen(),
      turn: this.rules.turn(),
      startColor: this.rules.startColor(),
      history,
      historyUci: this.rules.historyUci(),
      status: result ? statusFromResult(result) : 'in-progress',
      result,
      inCheck: status.inCheck,
      lastMove: last ? { from: last.from, to: last.to } : null,
    };
  }

  private buildSnapshot(): ControllerSnapshot {
    return { game: this.game, ui: this.ui, engine: this.session, clock: this.clockSnap };
  }

  private rebuildAndEmit(): void {
    this.snapshot = this.buildSnapshot();
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* ignore */
      }
    }
  }
}

// ---- small pure helpers --------------------------------------------------

function statusFromResult(result: GameResult): GameStatus {
  switch (result.reason) {
    case 'checkmate':
      return 'checkmate';
    case 'stalemate':
      return 'stalemate';
    case 'insufficient-material':
      return 'draw-insufficient';
    case 'threefold-repetition':
      return 'draw-threefold';
    case 'fifty-move-rule':
      return 'draw-fifty';
    case 'timeout':
      return 'timeout';
    case 'resignation':
    case 'aborted':
      return 'aborted';
  }
}

function bannerThinking(): Banner {
  return { kind: 'engine-thinking', text: 'Computer is thinking…' };
}
function bannerYourMove(inCheck: boolean): Banner {
  return inCheck ? { kind: 'check', text: 'Check — your move' } : { kind: 'your-move', text: 'Your move' };
}
function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return 'unknown error';
}
