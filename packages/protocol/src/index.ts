export type Seat = 0 | 1 | 2 | 3;

export type TeamId = 'A' | 'B';

export type GameMode = 'hongxin' | 'heixin';

export type StandardSuit = 'S' | 'H' | 'C' | 'D';

export type Suit = StandardSuit | 'J';

export type NormalRank =
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | 'J'
  | 'Q'
  | 'K'
  | 'A';

export type JokerRank = 'SJ' | 'BJ';

export type Rank = NormalRank | JokerRank;

export type LevelRank = '2' | '4' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K' | 'A';

export interface Card {
  id: number;
  deck: 0 | 1 | 2;
  suit: Suit;
  rank: Rank;
}

export type GamePhase =
  | 'DEALING'
  | 'BIDDING'
  | 'CHOOSE_TRUMP'
  | 'CALLING'
  | 'COUNTER_BIDDING'
  | 'COUNTER_RESPONSE'
  | 'BURYING'
  | 'PLAYING'
  | 'ROUND_OVER'
  | 'MATCH_OVER';

export type CardCategory = 'TRUMP' | StandardSuit;

export type PatternType =
  | 'SINGLE'
  | 'PAIR'
  | 'TRIPLE'
  | 'F510K'
  | 'TRACTOR'
  | 'TRIPLE_TRACTOR'
  | 'SLING';

export type AtomicPatternType = Exclude<PatternType, 'SLING'>;

export interface AtomicPattern {
  type: AtomicPatternType;
  cards: Card[];
  cardKeys: string[];
  length: number;
  topOrder: number;
  usedLowAce: boolean;
}

export interface ParsedPlay {
  patternType: PatternType;
  category: CardCategory;
  cards: Card[];
  components: AtomicPattern[];
}

export interface TeamScoreState {
  team: TeamId;
  levelIndex: number;
  levelRank: LevelRank;
  penaltyCount: number;
}

export interface BidState {
  startSeat: Seat;
  highestBid: number;
  highestBidder: Seat | null;
  passedSeats: Seat[];
  minBid: number;
  maxBid: number;
  step: number;
}

export interface PendingCounterBid {
  seat: Seat;
  team: TeamId;
  suit: StandardSuit;
  cardIds: number[];
}

export interface SeatCallDisplay {
  kind: 'CALL' | 'COUNTER' | 'COUNTER_SUCCESS' | 'COUNTER_ACCEPTED' | 'COUNTER_FAILED';
  suit: StandardSuit;
  cards: Card[];
}

export interface RoundCallState {
  callerSeat: Seat | null;
  callerTeam: TeamId | null;
  calledSuit: StandardSuit | null;
  calledCount: number;
  passedSeats: Seat[];
  counterAttempts: number;
  counteredSeats: Seat[];
  beenCounteredSeats: Seat[];
  failedCounterSeats: Seat[];
  passedCounterSeats: Seat[];
  eligibleCounterSeats: Seat[];
  pendingCounter: PendingCounterBid | null;
  seatCallDisplays: Partial<Record<Seat, SeatCallDisplay>>;
}

export interface TrickPlayView {
  seat: Seat;
  cards: Card[];
  parsed: ParsedPlay;
}

export interface CompletedTrickView {
  trickNumber: number;
  leadSeat: Seat;
  winnerSeat: Seat;
  plays: TrickPlayView[];
  points: number;
  killedByTrump: boolean;
}

export interface RoundSettlement {
  mode: GameMode;
  roundNumber: number;
  dealer: Seat;
  bankerTeam: TeamId;
  challengerTeam: TeamId;
  tableChallengerPoints: number;
  bottomPointsRaw: number;
  bottomKilled: boolean;
  bottomBonusPoints: number;
  totalChallengerScore: number;
  bankerWon: boolean;
  earningTeam: TeamId;
  earnedSteps: number;
  penaltyAbsorbed: number;
  actualLevelUp: number;
  previousLevels: Record<TeamId, number>;
  newLevels: Record<TeamId, number>;
  previousPenalties: Record<TeamId, number>;
  newPenalties: Record<TeamId, number>;
  nextDealer: Seat;
  matchWinner: TeamId | null;
  revealedBottom: Card[];
  bidScore?: number;
  bankerNetScore?: number;
  scoreDeltas?: Record<Seat, number>;
  playerScores?: Record<Seat, number>;
}

export interface GameEvent {
  type: string;
  seat?: Seat;
  team?: TeamId;
  message: string;
  payload?: Record<string, unknown>;
}

export type GameAction =
  | { type: 'DEAL_STEP' }
  | { type: 'FINISH_CALL_WINDOW' }
  | { type: 'FINISH_COUNTER_WINDOW' }
  | { type: 'BID_SCORE'; seat: Seat; score: number }
  | { type: 'PASS_BID'; seat: Seat }
  | { type: 'CHOOSE_TRUMP'; seat: Seat; suit: StandardSuit }
  | { type: 'CALL_TRUMP'; seat: Seat; suit: StandardSuit; cardIds: number[] }
  | { type: 'PASS_CALL'; seat: Seat }
  | { type: 'COUNTER_BID'; seat: Seat; suit: StandardSuit; cardIds: number[] }
  | { type: 'ACCEPT_COUNTER'; seat: Seat }
  | { type: 'DEFEND_COUNTER'; seat: Seat }
  | { type: 'PASS_COUNTER'; seat: Seat }
  | { type: 'BURY_BOTTOM'; seat: Seat; cardIds: number[] }
  | { type: 'PLAY_CARDS'; seat: Seat; cardIds: number[] }
  | { type: 'NEXT_ROUND' };

export interface DebugView {
  allHands: Record<Seat, Card[]>;
  bottomCards: Card[];
  bipaiCounts: Record<Seat, number>;
}

export interface PlayerView {
  mode: GameMode;
  viewerSeat: Seat;
  roundNumber: number;
  isFirstRound: boolean;
  phase: GamePhase;
  levelIndex: number;
  levelRank: LevelRank;
  teams: Record<TeamId, TeamScoreState>;
  playerScores: Record<Seat, number>;
  dealer: Seat | null;
  bankerTeam: TeamId | null;
  trumpSuit: StandardSuit | null;
  currentTurn: Seat | null;
  myHand: Card[];
  handCounts: Record<Seat, number>;
  dealtCount: number;
  bottomCount: number;
  revealedBottom: Card[] | null;
  bidState: BidState | null;
  callState: RoundCallState;
  currentTrickLeadSeat: Seat | null;
  currentTrick: TrickPlayView[];
  lastTrick: CompletedTrickView | null;
  trickNumber: number;
  challengerPoints: number;
  bankerPoints: number;
  capturedPointCards: Card[];
  escapedPointCards: Card[];
  phaseDeadlineMs?: number | null;
  phaseWindowTotalSec?: number | null;
  trickPauseMs?: number | null;
  settlement: RoundSettlement | null;
  matchWinner: TeamId | null;
  events: GameEvent[];
  debugView?: DebugView;
}

export interface UserProfile {
  id: number;
  username: string;
  nickname: string;
  hongxinGames: number;
  hongxinWins: number;
  heixinGames: number;
  heixinWins: number;
  heixinTotalScore: number;
  createdAt: string;
}

export interface RoomSeatInfo {
  seat: Seat;
  team: TeamId;
  occupied: boolean;
  playerId: string | null;
  userId: number | null;
  name: string;
  isBot: boolean;
  connected: boolean;
  ready: boolean;
  autoBot: boolean;
}

export interface RoomSummary {
  roomId: string;
  mode: GameMode;
  status: 'WAITING' | 'IN_GAME' | 'FINISHED';
  debugMode: boolean;
  debugOpenHands: boolean;
  hostSeat: Seat;
  seats: RoomSeatInfo[];
  roundNumber: number;
}

export type ClientMessage =
  | { type: 'CREATE_ROOM'; playerName: string; authToken?: string; mode?: GameMode; debugMode?: boolean; fillBots?: boolean; autoStart?: boolean }
  | { type: 'JOIN_ROOM'; roomId: string; playerName: string; authToken?: string; playerId?: string; preferredSeat?: Seat }
  | { type: 'RECONNECT'; roomId: string; playerId: string }
  | { type: 'SET_ROOM_MODE'; mode: GameMode }
  | { type: 'SET_SEAT_BOT'; seat: Seat; isBot: boolean }
  | { type: 'SWAP_SEAT'; targetSeat: Seat }
  | { type: 'SET_READY'; ready: boolean }
  | { type: 'START_GAME' }
  | { type: 'GAME_ACTION'; action: GameAction }
  | { type: 'SET_AUTO_BOT'; enabled: boolean }
  | { type: 'TOGGLE_DEBUG_OPEN_HANDS'; enabled: boolean }
  | { type: 'PING'; ts: number };

export type ServerMessage =
  | { type: 'ROOM_JOINED'; roomId: string; playerId: string; seat: Seat; room: RoomSummary }
  | { type: 'ROOM_UPDATED'; room: RoomSummary }
  | { type: 'GAME_STATE'; view: PlayerView }
  | { type: 'ACTION_ERROR'; code: string; message: string }
  | { type: 'PONG'; ts: number; serverTs: number };
