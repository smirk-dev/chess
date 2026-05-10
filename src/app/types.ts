import type { Color, Move, Square } from 'chess.js';
import type { DifficultyPreset } from '../config/difficulty';
import type { TimeControl } from '../config/timeControls';
import type { ClockSnapshot } from '../clock/types';
import type { EngineState, EngineScore } from '../engine/types';
import type { GameResult } from '../domain/result';
import type { PromotionPiece } from '../domain/san';

/** What the user chose for "which side do I play". `random` is resolved to w/b at New Game time. */
export type SideChoice = 'white' | 'black' | 'random';

/** Coarse game phase, derived from the rules layer plus clock/resignation outcomes. */
export type GameStatus =
  | 'in-progress'
  | 'checkmate'
  | 'stalemate'
  | 'draw-insufficient'
  | 'draw-threefold'
  | 'draw-fifty'
  | 'timeout'
  | 'aborted';

/** What the board/UI is currently allowing the user to do. */
export type InteractionLock =
  | 'idle' // user's turn — moves allowed
  | 'awaiting-engine' // engine is thinking; board read-only
  | 'awaiting-promotion' // user picked a promoting move; waiting for the piece choice
  | 'game-over' // game finished; only New Game
  | 'engine-error'; // engine failed to load / crashed; board read-only

export interface PendingPromotion {
  from: Square;
  to: Square;
  /** Promotion pieces that are actually legal for this from/to (normally all four). */
  pieces: PromotionPiece[];
}

export interface AnalysisLine {
  depth: number;
  /** Score from White's point of view (already sign-flipped if needed), in centipawns. */
  scoreCp?: number;
  /** Plies-to-mate from White's point of view (positive => White mates), if a mate is seen. */
  mateIn?: number;
  /** Principal variation rendered as SAN. */
  pvSan: string[];
  /** Same PV as UCI (useful for arrows / debugging). */
  pvUci: string[];
  nps?: number;
  updatedAt: number;
}

export type BannerKind =
  | 'your-move'
  | 'engine-thinking'
  | 'check'
  | 'game-over'
  | 'engine-loading'
  | 'engine-load-failed'
  | 'engine-crashed';

export interface Banner {
  kind: BannerKind;
  text: string;
}

export interface DifficultySelection {
  preset: DifficultyPreset;
}

/** The chess truth, derived from RulesService after every applied move. */
export interface GameState {
  fen: string;
  turn: Color;
  startColor: Color;
  history: Move[];
  historyUci: string[];
  status: GameStatus;
  result: GameResult | null;
  inCheck: boolean;
  /** The most recently played move's squares, for highlighting. */
  lastMove: { from: Square; to: Square } | null;
}

/** Presentation / interaction state — never conflated with the chess truth or the engine session. */
export interface UIState {
  userColor: Color;
  sideChoice: SideChoice;
  boardOrientation: 'white' | 'black';
  interactionLock: InteractionLock;
  pendingPromotion: PendingPromotion | null;
  selectedSquare: Square | null;
  legalTargets: Square[];
  analysis: AnalysisLine | null;
  /** The difficulty actually applied to the engine right now — this is what the EloBadge shows. */
  difficulty: DifficultyPreset;
  /** A difficulty the user picked mid-game that will take effect on the engine's next turn. */
  pendingDifficulty: DifficultyPreset | null;
  timeControl: TimeControl;
  banner: Banner | null;
  /** Whether the analysis panel should be visible/expanded (user toggle). */
  showAnalysis: boolean;
}

export interface EngineSessionState {
  engineState: EngineState;
  appliedElo: number | null;
  currentToken: number | null;
  lastBestMove: string | null;
  supportsEloLimiting: boolean;
  engineError: { code: string; message: string } | null;
  /** Live during a search: latest depth/score for the spinner area. */
  liveScore?: EngineScore;
}

/** The single immutable object React subscribes to. */
export interface ControllerSnapshot {
  game: GameState;
  ui: UIState;
  engine: EngineSessionState;
  clock: ClockSnapshot;
}
