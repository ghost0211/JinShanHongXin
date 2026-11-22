import type {
  AtomicPattern,
  BidState,
  Card,
  CardCategory,
  CompletedTrickView,
  GameAction,
  GameEvent,
  GameMode,
  GamePhase,
  LevelRank,
  ParsedPlay,
  RoundCallState,
  RoundSettlement,
  Seat,
  StandardSuit,
  TeamId,
  TeamScoreState,
  TrickPlayView,
} from '@jinshan/protocol';

export * from '@jinshan/protocol';

export type TrickPlay = TrickPlayView;
export type CompletedTrick = CompletedTrickView;
export type TeamState = TeamScoreState;
export type CallState = RoundCallState;

export interface GameState {
  mode: GameMode;
  roundNumber: number;
  isFirstRound: boolean;
  phase: GamePhase;
  levelIndex: number;
  levelRank: LevelRank;
  teams: Record<TeamId, TeamState>;
  playerScores: Record<Seat, number>;
  dealer: Seat | null;
  bankerTeam: TeamId | null;
  trumpSuit: StandardSuit | null;
  currentTurn: Seat | null;
  hands: Record<Seat, Card[]>;
  undealtHands: Record<Seat, Card[]>;
  dealtCount: number;
  bottomCards: Card[];
  bidState: BidState | null;
  callState: CallState;
  currentTrickLeadSeat: Seat | null;
  currentTrick: TrickPlay[];
  completedTricks: CompletedTrick[];
  challengerPoints: number;
  bankerPoints: number;
  settlement: RoundSettlement | null;
  matchWinner: TeamId | null;
  events: GameEvent[];
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

export interface LeadValidationResult extends ValidationResult {
  slingFailed?: boolean;
  effectiveCards?: Card[];
  failedComponent?: AtomicPattern;
  parsed?: ParsedPlay;
}

export interface FollowValidationResult extends ValidationResult {
  matchedTrumpKill?: boolean;
  parsed?: ParsedPlay;
}

export type ActionResult =
  | { ok: true; state: GameState; events: GameEvent[] }
  | { ok: false; code: string; error: string };
