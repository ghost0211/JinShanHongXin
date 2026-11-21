import type {
  BidState,
  Card,
  DebugView,
  GameAction,
  GameEvent,
  GameMode,
  LevelRank,
  PlayerView,
  Seat,
  StandardSuit,
  TeamId,
  TeamScoreState,
} from '@jinshan/protocol';
import {
  countBipai,
  createThreeDecks,
  formatCardLabel,
  getOtherTeam,
  getSeatTeam,
  isRedFive,
  LEVEL_SEQUENCE,
  shuffleCards,
  sortHandForDisplay,
} from './cards.js';
import {
  calculateHeixinSettlement,
  calculateRoundSettlement,
} from './scoring.js';
import type { ActionResult, CallState, GameState, TrickPlay } from './types.js';
import {
  resolveTrickWinner,
  validateFollowPlay,
  validateLeadPlay,
} from './validator.js';

const ALL_SEATS: readonly Seat[] = [0, 1, 2, 3] as const;

function createEmptyCallState(): CallState {
  return {
    callerSeat: null,
    callerTeam: null,
    calledSuit: null,
    calledCount: 0,
    passedSeats: [],
    counterAttempts: 0,
    failedCounterSeats: [],
    passedCounterSeats: [],
    eligibleCounterSeats: [],
  };
}

function dealRoundHands(seed?: number): {
  hands: Record<Seat, Card[]>;
  bottomCards: Card[];
} {
  const deck = shuffleCards(createThreeDecks(), seed);
  return {
    hands: {
      0: deck.slice(0, 38),
      1: deck.slice(38, 76),
      2: deck.slice(76, 114),
      3: deck.slice(114, 152),
    },
    bottomCards: deck.slice(152, 162),
  };
}

function sortAllHands(
  hands: Record<Seat, Card[]>,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): Record<Seat, Card[]> {
  return {
    0: sortHandForDisplay(hands[0], trumpSuit, levelRank),
    1: sortHandForDisplay(hands[1], trumpSuit, levelRank),
    2: sortHandForDisplay(hands[2], trumpSuit, levelRank),
    3: sortHandForDisplay(hands[3], trumpSuit, levelRank),
  };
}

function flipBottomForTrumpSuit(bottomCards: readonly Card[]): StandardSuit | null {
  for (const card of bottomCards) {
    if (card.suit !== 'J' && !isRedFive(card)) {
      return card.suit;
    }
  }
  return null;
}

export function canSeatCounterBid(state: GameState, seat: Seat): boolean {
  const { callState, isFirstRound, levelRank, hands } = state;
  if (callState.callerTeam === null || callState.calledSuit === null) return false;
  if (getSeatTeam(seat) === callState.callerTeam) return false;
  if (callState.failedCounterSeats.includes(seat)) return false;
  if (callState.passedCounterSeats.includes(seat)) return false;

  const hand = hands[seat];
  const countsBySuit = new Map<StandardSuit, number>();
  for (const card of hand) {
    if (card.rank === levelRank && card.suit !== 'J' && card.suit !== callState.calledSuit) {
      countsBySuit.set(card.suit, (countsBySuit.get(card.suit) ?? 0) + 1);
    }
  }

  const required = isFirstRound ? 3 : 1;
  for (const cnt of countsBySuit.values()) {
    if (cnt >= required) return true;
  }
  return false;
}

export function getEligibleCounterSeats(state: GameState): Seat[] {
  const anchor = state.callState.callerSeat ?? 0;
  const eligible: Seat[] = [];
  for (let offset = 1; offset <= 4; offset++) {
    const seat = ((anchor + offset) % 4) as Seat;
    if (canSeatCounterBid(state, seat)) {
      eligible.push(seat);
    }
  }
  return eligible;
}

function enterBuryingPhase(state: GameState, events: GameEvent[]): GameState {
  if (state.dealer === null) {
    throw new Error('Cannot enter BURYING without dealer');
  }
  const dealer = state.dealer;
  const newHands: Record<Seat, Card[]> = {
    0: [...state.hands[0]],
    1: [...state.hands[1]],
    2: [...state.hands[2]],
    3: [...state.hands[3]],
  };
  newHands[dealer] = [...newHands[dealer], ...state.bottomCards];

  const sortedHands = sortAllHands(newHands, state.trumpSuit, state.levelRank);
  events.push({
    type: 'BURY_START',
    seat: dealer,
    message: `座位 ${dealer} 庄家收下 10 张底牌，进入埋底阶段`,
  });

  return {
    ...state,
    phase: 'BURYING',
    currentTurn: dealer,
    hands: sortedHands,
    bottomCards: [],
    callState: {
      ...state.callState,
      eligibleCounterSeats: [],
    },
    events: [...state.events, ...events],
  };
}

function advanceCounterOrBury(state: GameState, events: GameEvent[]): GameState {
  const eligible = getEligibleCounterSeats(state);
  if (eligible.length === 0) {
    return enterBuryingPhase(state, events);
  }
  return {
    ...state,
    phase: 'COUNTER_BIDDING',
    currentTurn: eligible[0],
    callState: {
      ...state.callState,
      eligibleCounterSeats: eligible,
    },
    events: [...state.events, ...events],
  };
}

export interface MatchInitOptions {
  seed?: number;
  mode?: GameMode;
}

export function createInitialMatchState(
  seedOrOptions?: number | MatchInitOptions,
): GameState {
  const seed =
    typeof seedOrOptions === 'number' ? seedOrOptions : seedOrOptions?.seed;
  const mode: GameMode =
    typeof seedOrOptions === 'object' && seedOrOptions?.mode
      ? seedOrOptions.mode
      : 'hongxin';

  const { hands, bottomCards } = dealRoundHands(seed);
  const playerScores: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

  if (mode === 'heixin') {
    const levelIndex = LEVEL_SEQUENCE.indexOf('10');
    const levelRank: LevelRank = '10';
    const teams: Record<TeamId, TeamScoreState> = {
      A: { team: 'A', levelIndex, levelRank, penaltyCount: 0 },
      B: { team: 'B', levelIndex, levelRank, penaltyCount: 0 },
    };
    const bidState: BidState = {
      startSeat: 0,
      highestBid: 0,
      highestBidder: null,
      passedSeats: [],
      minBid: 100,
      maxBid: 300,
      step: 5,
    };
    const startEvent: GameEvent = {
      type: 'ROUND_START',
      message: '金山打黑心第 1 局开始（固定打 10，100~300 叫分抢庄）',
    };
    return {
      mode: 'heixin',
      roundNumber: 1,
      isFirstRound: true,
      phase: 'BIDDING',
      levelIndex,
      levelRank,
      teams,
      playerScores,
      dealer: null,
      bankerTeam: null,
      trumpSuit: null,
      currentTurn: 0,
      hands: sortAllHands(hands, null, levelRank),
      bottomCards,
      bidState,
      callState: createEmptyCallState(),
      currentTrickLeadSeat: null,
      currentTrick: [],
      completedTricks: [],
      challengerPoints: 0,
      settlement: null,
      matchWinner: null,
      events: [startEvent],
    };
  }

  const levelIndex = 0;
  const levelRank = LEVEL_SEQUENCE[levelIndex];
  const teams: Record<TeamId, TeamScoreState> = {
    A: { team: 'A', levelIndex: 0, levelRank: '2', penaltyCount: 0 },
    B: { team: 'B', levelIndex: 0, levelRank: '2', penaltyCount: 0 },
  };
  const startEvent: GameEvent = {
    type: 'ROUND_START',
    message: '第 1 局开始（打 2 无主抢庄局）',
  };

  return {
    mode: 'hongxin',
    roundNumber: 1,
    isFirstRound: true,
    phase: 'CALLING',
    levelIndex,
    levelRank,
    teams,
    playerScores,
    dealer: null,
    bankerTeam: null,
    trumpSuit: null,
    currentTurn: 0,
    hands: sortAllHands(hands, null, levelRank),
    bottomCards,
    bidState: null,
    callState: createEmptyCallState(),
    currentTrickLeadSeat: null,
    currentTrick: [],
    completedTricks: [],
    challengerPoints: 0,
    settlement: null,
    matchWinner: null,
    events: [startEvent],
  };
}

export function startNextRound(state: GameState, seed?: number): GameState {
  if (!state.settlement) {
    throw new Error('Cannot start next round without prior settlement');
  }
  const roundNumber = state.roundNumber + 1;
  const { hands, bottomCards } = dealRoundHands(seed);

  if (state.mode === 'heixin') {
    const startSeat = state.settlement.nextDealer;
    const levelIndex = LEVEL_SEQUENCE.indexOf('10');
    const levelRank: LevelRank = '10';
    const bidState: BidState = {
      startSeat,
      highestBid: 0,
      highestBidder: null,
      passedSeats: [],
      minBid: 100,
      maxBid: 300,
      step: 5,
    };
    const startEvent: GameEvent = {
      type: 'ROUND_START',
      seat: startSeat,
      message: `金山打黑心第 ${roundNumber} 局开始，座位 ${startSeat} 首叫`,
    };
    return {
      mode: 'heixin',
      roundNumber,
      isFirstRound: false,
      phase: 'BIDDING',
      levelIndex,
      levelRank,
      teams: {
        A: { ...state.teams.A },
        B: { ...state.teams.B },
      },
      playerScores: { ...state.playerScores },
      dealer: null,
      bankerTeam: null,
      trumpSuit: null,
      currentTurn: startSeat,
      hands: sortAllHands(hands, null, levelRank),
      bottomCards,
      bidState,
      callState: createEmptyCallState(),
      currentTrickLeadSeat: null,
      currentTrick: [],
      completedTricks: [],
      challengerPoints: 0,
      settlement: null,
      matchWinner: null,
      events: [startEvent],
    };
  }

  const dealer = state.settlement.nextDealer;
  const bankerTeam = getSeatTeam(dealer);
  const levelIndex = state.teams[bankerTeam].levelIndex;
  const levelRank = LEVEL_SEQUENCE[levelIndex];

  const startEvent: GameEvent = {
    type: 'ROUND_START',
    seat: dealer,
    team: bankerTeam,
    message: `第 ${roundNumber} 局开始，座位 ${dealer}（${bankerTeam}队）坐庄打 ${levelRank}`,
  };

  return {
    mode: 'hongxin',
    roundNumber,
    isFirstRound: false,
    phase: 'CALLING',
    levelIndex,
    levelRank,
    teams: {
      A: { ...state.teams.A },
      B: { ...state.teams.B },
    },
    playerScores: { ...state.playerScores },
    dealer,
    bankerTeam,
    trumpSuit: null,
    currentTurn: dealer,
    hands: sortAllHands(hands, null, levelRank),
    bottomCards,
    bidState: null,
    callState: createEmptyCallState(),
    currentTrickLeadSeat: null,
    currentTrick: [],
    completedTricks: [],
    challengerPoints: 0,
    settlement: null,
    matchWinner: null,
    events: [startEvent],
  };
}

function findNextActiveBidder(
  fromSeat: Seat,
  passedSeats: readonly Seat[],
): Seat | null {
  for (let offset = 1; offset <= 4; offset++) {
    const s = ((fromSeat + offset) % 4) as Seat;
    if (!passedSeats.includes(s)) return s;
  }
  return null;
}

function handleBidScore(
  state: GameState,
  seat: Seat,
  score: number,
): ActionResult {
  if (state.mode !== 'heixin' || state.phase !== 'BIDDING' || !state.bidState) {
    return { ok: false, code: 'INVALID_PHASE', error: '当前不在叫分抢庄阶段' };
  }
  if (state.currentTurn !== seat) {
    return { ok: false, code: 'NOT_YOUR_TURN', error: '未轮到该座位叫分' };
  }
  if (state.bidState.passedSeats.includes(seat)) {
    return { ok: false, code: 'ALREADY_PASSED', error: '已放弃叫分，本局不可再叫' };
  }
  const { minBid, maxBid, step, highestBid, passedSeats } = state.bidState;
  if (
    !Number.isInteger(score) ||
    score < minBid ||
    score > maxBid ||
    score % step !== 0 ||
    score <= highestBid
  ) {
    return {
      ok: false,
      code: 'INVALID_BID_SCORE',
      error: `叫分必须是 ${minBid}~${maxBid} 之间且大于 ${highestBid} 的 ${step} 的倍数`,
    };
  }

  const nextBidState: BidState = {
    ...state.bidState,
    highestBid: score,
    highestBidder: seat,
  };

  const ev: GameEvent = {
    type: 'BID_SCORE',
    seat,
    message: `座位 ${seat} 叫分 ${score}`,
    payload: { score },
  };

  // Bidding 300 or everyone else already passed ends bidding immediately
  if (score === maxBid || passedSeats.length >= 3) {
    const winEv: GameEvent = {
      type: 'BID_WON',
      seat,
      message: `座位 ${seat} 以 ${score} 分坐庄（1打3），请选择主花色`,
      payload: { score },
    };
    return {
      ok: true,
      state: {
        ...state,
        phase: 'CHOOSE_TRUMP',
        dealer: seat,
        bankerTeam: getSeatTeam(seat),
        currentTurn: seat,
        bidState: nextBidState,
        events: [...state.events, ev, winEv],
      },
      events: [ev, winEv],
    };
  }

  const nextTurn = findNextActiveBidder(seat, passedSeats);
  return {
    ok: true,
    state: {
      ...state,
      currentTurn: nextTurn,
      bidState: nextBidState,
      events: [...state.events, ev],
    },
    events: [ev],
  };
}

function handlePassBid(state: GameState, seat: Seat): ActionResult {
  if (state.mode !== 'heixin' || state.phase !== 'BIDDING' || !state.bidState) {
    return { ok: false, code: 'INVALID_PHASE', error: '当前不在叫分抢庄阶段' };
  }
  if (state.currentTurn !== seat) {
    return { ok: false, code: 'NOT_YOUR_TURN', error: '未轮到该座位操作' };
  }
  if (state.bidState.passedSeats.includes(seat)) {
    return { ok: false, code: 'ALREADY_PASSED', error: '已经放弃过叫分' };
  }

  const passedSeats = [...state.bidState.passedSeats, seat];
  const passEv: GameEvent = {
    type: 'PASS_BID',
    seat,
    message: `座位 ${seat} 不叫分`,
  };

  // All 4 passed without any bid -> startSeat forced banker at 100
  if (passedSeats.length === 4 && state.bidState.highestBidder === null) {
    const dealer = state.bidState.startSeat;
    const winEv: GameEvent = {
      type: 'BID_WON',
      seat: dealer,
      message: `四家全不叫，默认座位 ${dealer} 以 100 分坐庄，请选择主花色`,
      payload: { score: 100 },
    };
    return {
      ok: true,
      state: {
        ...state,
        phase: 'CHOOSE_TRUMP',
        dealer,
        bankerTeam: getSeatTeam(dealer),
        currentTurn: dealer,
        bidState: {
          ...state.bidState,
          highestBid: 100,
          highestBidder: dealer,
          passedSeats,
        },
        events: [...state.events, passEv, winEv],
      },
      events: [passEv, winEv],
    };
  }

  // 3 passed and 1 bidder remains -> bidder wins
  if (passedSeats.length === 3 && state.bidState.highestBidder !== null) {
    const dealer = state.bidState.highestBidder;
    const score = state.bidState.highestBid;
    const winEv: GameEvent = {
      type: 'BID_WON',
      seat: dealer,
      message: `座位 ${dealer} 以 ${score} 分坐庄（1打3），请选择主花色`,
      payload: { score },
    };
    return {
      ok: true,
      state: {
        ...state,
        phase: 'CHOOSE_TRUMP',
        dealer,
        bankerTeam: getSeatTeam(dealer),
        currentTurn: dealer,
        bidState: {
          ...state.bidState,
          passedSeats,
        },
        events: [...state.events, passEv, winEv],
      },
      events: [passEv, winEv],
    };
  }

  const nextTurn = findNextActiveBidder(seat, passedSeats);
  return {
    ok: true,
    state: {
      ...state,
      currentTurn: nextTurn,
      bidState: {
        ...state.bidState,
        passedSeats,
      },
      events: [...state.events, passEv],
    },
    events: [passEv],
  };
}

function handleChooseTrump(
  state: GameState,
  seat: Seat,
  suit: StandardSuit,
): ActionResult {
  if (state.mode !== 'heixin' || state.phase !== 'CHOOSE_TRUMP') {
    return { ok: false, code: 'INVALID_PHASE', error: '当前不在定主花色阶段' };
  }
  if (state.dealer !== seat) {
    return { ok: false, code: 'NOT_DEALER', error: '只有庄家可以指定主花色' };
  }

  const ev: GameEvent = {
    type: 'CHOOSE_TRUMP',
    seat,
    message: `庄家（座位 ${seat}）定主花色为 ${suit}`,
    payload: { suit },
  };
  const updated: GameState = {
    ...state,
    trumpSuit: suit,
    hands: sortAllHands(state.hands, suit, state.levelRank),
  };
  const nextState = enterBuryingPhase(updated, [ev]);
  return { ok: true, state: nextState, events: [ev] };
}

function handleCallTrump(
  state: GameState,
  seat: Seat,
  suit: StandardSuit,
  cardIds: readonly number[],
): ActionResult {
  if (state.phase !== 'CALLING') {
    return { ok: false, code: 'INVALID_PHASE', error: '当前不在叫主阶段' };
  }
  if (state.currentTurn !== seat) {
    return { ok: false, code: 'NOT_YOUR_TURN', error: '未轮到该座位操作' };
  }

  const uniqueIds = new Set(cardIds);
  if (uniqueIds.size !== cardIds.length) {
    return { ok: false, code: 'DUPLICATE_CARDS', error: '选牌存在重复' };
  }

  if (state.isFirstRound) {
    if (cardIds.length !== 2 && cardIds.length !== 3) {
      return {
        ok: false,
        code: 'INVALID_CALL_COUNT',
        error: '首局打 2 叫主必须亮出 2 张或 3 张同花色的 2',
      };
    }
  } else if (cardIds.length !== 1) {
    return {
      ok: false,
      code: 'INVALID_CALL_COUNT',
      error: '后续局叫主只需亮出 1 张当前级牌',
    };
  }

  const handMap = new Map(state.hands[seat].map((c) => [c.id, c]));
  for (const id of cardIds) {
    const card = handMap.get(id);
    if (!card) {
      return { ok: false, code: 'CARD_NOT_IN_HAND', error: '叫主牌不在手牌中' };
    }
    if (card.rank !== state.levelRank || card.suit !== suit) {
      return {
        ok: false,
        code: 'INVALID_CALL_CARD',
        error: `叫主必须使用花色为 ${suit} 的级牌 ${state.levelRank}`,
      };
    }
  }

  const callerTeam = getSeatTeam(seat);
  const dealer = state.isFirstRound ? seat : state.dealer!;
  const bankerTeam = getSeatTeam(dealer);

  const event: GameEvent = {
    type: 'TRUMP_CALLED',
    seat,
    team: callerTeam,
    message: state.isFirstRound
      ? `座位 ${seat} 亮 ${cardIds.length} 张 ${suit}2 叫主抢庄`
      : `座位 ${seat} 亮 ${suit}${state.levelRank} 定主`,
    payload: { suit, count: cardIds.length },
  };

  const nextState: GameState = {
    ...state,
    dealer,
    bankerTeam,
    trumpSuit: suit,
    hands: sortAllHands(state.hands, suit, state.levelRank),
    callState: {
      ...state.callState,
      callerSeat: seat,
      callerTeam,
      calledSuit: suit,
      calledCount: cardIds.length,
    },
  };

  return {
    ok: true,
    state: advanceCounterOrBury(nextState, [event]),
    events: [event],
  };
}

function handlePassCall(state: GameState, seat: Seat): ActionResult {
  if (state.phase !== 'CALLING') {
    return { ok: false, code: 'INVALID_PHASE', error: '当前不在叫主阶段' };
  }
  if (state.currentTurn !== seat) {
    return { ok: false, code: 'NOT_YOUR_TURN', error: '未轮到该座位操作' };
  }

  const passedSeats = [...state.callState.passedSeats, seat];
  const passEvent: GameEvent = {
    type: 'PASS_CALL',
    seat,
    message: `座位 ${seat} 选择不叫主`,
  };

  if (passedSeats.length >= 4) {
    const dealer: Seat = state.dealer ?? 0;
    const bankerTeam = getSeatTeam(dealer);
    const flippedSuit = flipBottomForTrumpSuit(state.bottomCards);
    const flipEvent: GameEvent = {
      type: 'FLIP_BOTTOM_TRUMP',
      seat: dealer,
      message: flippedSuit
        ? `四家均未叫主，翻底牌定主花色为 ${flippedSuit}`
        : '四家均未叫主且底牌全为王/红五，本局无主花色',
      payload: { suit: flippedSuit },
    };

    const baseState: GameState = {
      ...state,
      dealer,
      bankerTeam,
      trumpSuit: flippedSuit,
      callState: {
        ...state.callState,
        passedSeats,
      },
    };
    const buryEvents = [passEvent, flipEvent];
    const finalState = enterBuryingPhase(baseState, buryEvents);
    return { ok: true, state: finalState, events: buryEvents };
  }

  const nextSeat = ((seat + 1) % 4) as Seat;
  return {
    ok: true,
    state: {
      ...state,
      currentTurn: nextSeat,
      callState: {
        ...state.callState,
        passedSeats,
      },
      events: [...state.events, passEvent],
    },
    events: [passEvent],
  };
}

function handleCounterBid(
  state: GameState,
  seat: Seat,
  suit: StandardSuit,
  cardIds: readonly number[],
): ActionResult {
  if (state.phase !== 'COUNTER_BIDDING') {
    return { ok: false, code: 'INVALID_PHASE', error: '当前不在反主阶段' };
  }
  if (state.currentTurn !== seat) {
    return { ok: false, code: 'NOT_YOUR_TURN', error: '未轮到该座位反主' };
  }
  if (!state.callState.eligibleCounterSeats.includes(seat)) {
    return { ok: false, code: 'NOT_ELIGIBLE', error: '该座位当前无反主资格' };
  }
  if (suit === state.callState.calledSuit) {
    return {
      ok: false,
      code: 'SAME_SUIT',
      error: '反主必须使用不同于当前主花色的箭牌',
    };
  }

  const uniqueIds = new Set(cardIds);
  if (uniqueIds.size !== cardIds.length) {
    return { ok: false, code: 'DUPLICATE_CARDS', error: '选牌存在重复' };
  }

  const required = state.isFirstRound ? 3 : 1;
  if (cardIds.length !== required) {
    return {
      ok: false,
      code: 'INVALID_COUNTER_COUNT',
      error: state.isFirstRound
        ? '首局反主必须亮出 3 张同花色的 2'
        : '后续局反主必须亮出 1 张不同花色的当前级牌',
    };
  }

  const handMap = new Map(state.hands[seat].map((c) => [c.id, c]));
  for (const id of cardIds) {
    const card = handMap.get(id);
    if (!card || card.rank !== state.levelRank || card.suit !== suit) {
      return {
        ok: false,
        code: 'INVALID_COUNTER_CARD',
        error: `反主牌必须是花色为 ${suit} 的级牌 ${state.levelRank}`,
      };
    }
  }

  const counterTeam = getSeatTeam(seat);
  const callerSeat = state.callState.callerSeat!;

  let counterSuccess = false;
  let usedBipai = false;
  let counterBipai = 0;
  let callerBipai = 0;

  if (state.isFirstRound && state.callState.calledCount === 2) {
    counterSuccess = true;
  } else {
    usedBipai = true;
    counterBipai = countBipai(state.hands[seat], state.levelRank);
    callerBipai = countBipai(state.hands[callerSeat], state.levelRank);
    counterSuccess = counterBipai > callerBipai;
  }

  const events: GameEvent[] = [];
  if (counterSuccess) {
    const nextDealer = state.isFirstRound ? seat : state.dealer!;
    const nextBankerTeam = getSeatTeam(nextDealer);
    const ev: GameEvent = {
      type: 'COUNTER_SUCCESS',
      seat,
      team: counterTeam,
      message: usedBipai
        ? `座位 ${seat} 比牌 ${counterBipai} > ${callerBipai} 反主成功，主花色改为 ${suit}`
        : `座位 ${seat} 以 3 张 ${suit}2 压过 2 张叫主，反主抢庄成功`,
      payload: { suit, usedBipai, counterBipai, callerBipai },
    };
    events.push(ev);

    const updated: GameState = {
      ...state,
      dealer: nextDealer,
      bankerTeam: nextBankerTeam,
      trumpSuit: suit,
      hands: sortAllHands(state.hands, suit, state.levelRank),
      callState: {
        ...state.callState,
        callerSeat: seat,
        callerTeam: counterTeam,
        calledSuit: suit,
        calledCount: cardIds.length,
        counterAttempts: state.callState.counterAttempts + 1,
        failedCounterSeats: [],
        passedCounterSeats: [],
      },
    };
    return {
      ok: true,
      state: advanceCounterOrBury(updated, events),
      events,
    };
  }

  // Counter-bid failed: apply penalty (+1) to counterTeam; keep caller & trump unchanged
  const updatedTeams: Record<TeamId, TeamScoreState> = {
    A: { ...state.teams.A },
    B: { ...state.teams.B },
  };
  updatedTeams[counterTeam].penaltyCount += 1;

  const ev: GameEvent = {
    type: 'COUNTER_FAILED',
    seat,
    team: counterTeam,
    message: `座位 ${seat} 反主失败（比牌 ${counterBipai} <= ${callerBipai}），${counterTeam}队罚多打 1 次当前级牌（累计惩罚 ${updatedTeams[counterTeam].penaltyCount}）`,
    payload: {
      suit,
      counterBipai,
      callerBipai,
      penaltyCount: updatedTeams[counterTeam].penaltyCount,
    },
  };
  events.push(ev);

  const updated: GameState = {
    ...state,
    teams: updatedTeams,
    callState: {
      ...state.callState,
      counterAttempts: state.callState.counterAttempts + 1,
      failedCounterSeats: [...state.callState.failedCounterSeats, seat],
    },
  };
  return {
    ok: true,
    state: advanceCounterOrBury(updated, events),
    events,
  };
}

function handlePassCounter(state: GameState, seat: Seat): ActionResult {
  if (state.phase !== 'COUNTER_BIDDING') {
    return { ok: false, code: 'INVALID_PHASE', error: '当前不在反主阶段' };
  }
  if (state.currentTurn !== seat) {
    return { ok: false, code: 'NOT_YOUR_TURN', error: '未轮到该座位操作' };
  }
  if (!state.callState.eligibleCounterSeats.includes(seat)) {
    return { ok: false, code: 'NOT_ELIGIBLE', error: '该座位当前无反主资格' };
  }

  const ev: GameEvent = {
    type: 'PASS_COUNTER',
    seat,
    message: `座位 ${seat} 放弃反主`,
  };

  const updated: GameState = {
    ...state,
    callState: {
      ...state.callState,
      passedCounterSeats: [...state.callState.passedCounterSeats, seat],
    },
  };

  return {
    ok: true,
    state: advanceCounterOrBury(updated, [ev]),
    events: [ev],
  };
}

function handleBuryBottom(
  state: GameState,
  seat: Seat,
  cardIds: readonly number[],
): ActionResult {
  if (state.phase !== 'BURYING') {
    return { ok: false, code: 'INVALID_PHASE', error: '当前不在埋底阶段' };
  }
  if (state.dealer !== seat) {
    return { ok: false, code: 'NOT_DEALER', error: '只有庄家可以埋底' };
  }
  if (cardIds.length !== 10) {
    return { ok: false, code: 'INVALID_BURY_COUNT', error: '必须埋入恰好 10 张底牌' };
  }

  const uniqueIds = new Set(cardIds);
  if (uniqueIds.size !== 10) {
    return { ok: false, code: 'DUPLICATE_CARDS', error: '埋底选牌存在重复' };
  }

  const handMap = new Map(state.hands[seat].map((c) => [c.id, c]));
  const buried: Card[] = [];
  for (const id of cardIds) {
    const card = handMap.get(id);
    if (!card) {
      return { ok: false, code: 'CARD_NOT_IN_HAND', error: '埋底牌不在庄家手牌中' };
    }
    if (state.mode === 'heixin' && card.rank === '10') {
      return {
        ok: false,
        code: 'FORBIDDEN_BURY_TEN',
        error: '打黑心模式不能将 10 埋入底牌',
      };
    }
    buried.push(card);
  }

  const remaining = state.hands[seat].filter((c) => !uniqueIds.has(c.id));
  const nextHands: Record<Seat, Card[]> = {
    ...state.hands,
    [seat]: sortHandForDisplay(remaining, state.trumpSuit, state.levelRank),
  };

  const ev: GameEvent = {
    type: 'BURY_COMPLETE',
    seat,
    message: `庄家（座位 ${seat}）埋底完成，开始出牌`,
  };

  return {
    ok: true,
    state: {
      ...state,
      phase: 'PLAYING',
      currentTurn: seat,
      currentTrickLeadSeat: seat,
      currentTrick: [],
      hands: nextHands,
      bottomCards: buried,
      events: [...state.events, ev],
    },
    events: [ev],
  };
}

function handlePlayCards(
  state: GameState,
  seat: Seat,
  cardIds: readonly number[],
): ActionResult {
  if (state.phase !== 'PLAYING') {
    return { ok: false, code: 'INVALID_PHASE', error: '当前不在出牌阶段' };
  }
  if (state.currentTurn !== seat) {
    return { ok: false, code: 'NOT_YOUR_TURN', error: '未轮到该座位出牌' };
  }

  const events: GameEvent[] = [];
  let effectiveCards: Card[];
  let parsedPlay;

  if (state.currentTrick.length === 0) {
    const otherHands = ALL_SEATS.filter((s) => s !== seat).map(
      (s) => state.hands[s],
    );
    const res = validateLeadPlay(
      state.hands[seat],
      cardIds,
      otherHands,
      state.trumpSuit,
      state.levelRank,
    );
    if (!res.valid || !res.effectiveCards || !res.parsed) {
      return { ok: false, code: 'INVALID_LEAD', error: res.reason ?? '首家出牌非法' };
    }
    effectiveCards = res.effectiveCards;
    parsedPlay = res.parsed;
    if (res.slingFailed) {
      events.push({
        type: 'SLING_FAILED',
        seat,
        message: `座位 ${seat} 甩牌失败，强制打出最小被管上牌：${effectiveCards.map(formatCardLabel).join(' ')}`,
      });
    } else {
      events.push({
        type: 'CARD_PLAYED',
        seat,
        message: `座位 ${seat} 领出：${effectiveCards.map(formatCardLabel).join(' ')}`,
      });
    }
  } else {
    const leadPlay = state.currentTrick[0].parsed;
    const res = validateFollowPlay(
      state.hands[seat],
      cardIds,
      leadPlay,
      state.trumpSuit,
      state.levelRank,
    );
    if (!res.valid || !res.parsed) {
      return { ok: false, code: 'INVALID_FOLLOW', error: res.reason ?? '跟牌非法' };
    }
    const idSet = new Set(cardIds);
    effectiveCards = state.hands[seat].filter((c) => idSet.has(c.id));
    parsedPlay = res.parsed;
    events.push({
      type: 'CARD_PLAYED',
      seat,
      message: `座位 ${seat} 跟牌：${effectiveCards.map(formatCardLabel).join(' ')}`,
    });
  }

  const playedIds = new Set(effectiveCards.map((c) => c.id));
  const nextHands: Record<Seat, Card[]> = {
    ...state.hands,
    [seat]: state.hands[seat].filter((c) => !playedIds.has(c.id)),
  };

  const nextTrick: TrickPlay[] = [
    ...state.currentTrick,
    { seat, cards: effectiveCards, parsed: parsedPlay },
  ];

  if (nextTrick.length < 4) {
    const nextSeat = ((seat + 1) % 4) as Seat;
    return {
      ok: true,
      state: {
        ...state,
        hands: nextHands,
        currentTrick: nextTrick,
        currentTurn: nextSeat,
        events: [...state.events, ...events],
      },
      events,
    };
  }

  // Trick complete (4 plays)
  const { winnerSeat, pointsInTrick, killedByTrump } = resolveTrickWinner(
    nextTrick,
    state.trumpSuit,
    state.levelRank,
  );
  const winnerTeam = getSeatTeam(winnerSeat);
  const isChallengerWinner =
    state.mode === 'heixin'
      ? winnerSeat !== state.dealer
      : winnerTeam !== state.bankerTeam;
  const nextChallengerPoints =
    state.challengerPoints + (isChallengerWinner ? pointsInTrick : 0);

  const completedTrick = {
    trickNumber: state.completedTricks.length + 1,
    leadSeat: state.currentTrickLeadSeat!,
    winnerSeat,
    plays: nextTrick,
    points: pointsInTrick,
    killedByTrump,
  };

  events.push({
    type: 'TRICK_COMPLETE',
    seat: winnerSeat,
    team: winnerTeam,
    message: `第 ${completedTrick.trickNumber} 墩结束，座位 ${winnerSeat} 赢墩${pointsInTrick > 0 ? `（含 ${pointsInTrick} 分）` : ''}`,
    payload: { pointsInTrick, killedByTrump },
  });

  const roundFinished = nextHands[0].length === 0;
  if (!roundFinished) {
    return {
      ok: true,
      state: {
        ...state,
        hands: nextHands,
        currentTrick: [],
        currentTrickLeadSeat: winnerSeat,
        currentTurn: winnerSeat,
        completedTricks: [...state.completedTricks, completedTrick],
        challengerPoints: nextChallengerPoints,
        events: [...state.events, ...events],
      },
      events,
    };
  }

  // Round finished -> Settlement
  if (state.mode === 'heixin') {
    const { settlement, updatedPlayerScores } = calculateHeixinSettlement({
      roundNumber: state.roundNumber,
      dealer: state.dealer!,
      bidScore: state.bidState!.highestBid,
      tableChallengerPoints: nextChallengerPoints,
      bottomCards: state.bottomCards,
      challengerWonLastTrick: isChallengerWinner,
      previousPlayerScores: state.playerScores,
      teams: state.teams,
    });
    events.push({
      type: 'ROUND_SETTLED',
      seat: state.dealer!,
      message: `打黑心结算：叫分 ${settlement.bidScore}，闲家总分 ${settlement.totalChallengerScore}（含抠底 ${settlement.bottomBonusPoints}），庄家净分 ${settlement.bankerNetScore}，${settlement.bankerWon ? '庄家胜' : '闲家胜'}`,
      payload: { settlement },
    });
    return {
      ok: true,
      state: {
        ...state,
        phase: 'ROUND_OVER',
        playerScores: updatedPlayerScores,
        hands: nextHands,
        currentTrick: [],
        currentTrickLeadSeat: null,
        currentTurn: null,
        completedTricks: [...state.completedTricks, completedTrick],
        challengerPoints: nextChallengerPoints,
        settlement,
        matchWinner: null,
        events: [...state.events, ...events],
      },
      events,
    };
  }

  const { settlement, updatedTeams } = calculateRoundSettlement({
    roundNumber: state.roundNumber,
    dealer: state.dealer!,
    teams: state.teams,
    tableChallengerPoints: nextChallengerPoints,
    bottomCards: state.bottomCards,
    challengerWonLastTrick: isChallengerWinner,
  });

  events.push({
    type: 'ROUND_SETTLED',
    team: settlement.earningTeam,
    message: settlement.matchWinner
      ? `${settlement.matchWinner}队打完 A，赢得整场胜利！`
      : `本局结算：闲家总分 ${settlement.totalChallengerScore}（含抠底 ${settlement.bottomBonusPoints}），${settlement.earningTeam}队实际升 ${settlement.actualLevelUp} 级`,
    payload: { settlement },
  });

  return {
    ok: true,
    state: {
      ...state,
      phase: settlement.matchWinner ? 'MATCH_OVER' : 'ROUND_OVER',
      teams: updatedTeams,
      hands: nextHands,
      currentTrick: [],
      currentTrickLeadSeat: null,
      currentTurn: null,
      completedTricks: [...state.completedTricks, completedTrick],
      challengerPoints: nextChallengerPoints,
      settlement,
      matchWinner: settlement.matchWinner,
      events: [...state.events, ...events],
    },
    events,
  };
}

export function applyAction(state: GameState, action: GameAction): ActionResult {
  switch (action.type) {
    case 'BID_SCORE':
      return handleBidScore(state, action.seat, action.score);
    case 'PASS_BID':
      return handlePassBid(state, action.seat);
    case 'CHOOSE_TRUMP':
      return handleChooseTrump(state, action.seat, action.suit);
    case 'CALL_TRUMP':
      return handleCallTrump(state, action.seat, action.suit, action.cardIds);
    case 'PASS_CALL':
      return handlePassCall(state, action.seat);
    case 'COUNTER_BID':
      return handleCounterBid(state, action.seat, action.suit, action.cardIds);
    case 'PASS_COUNTER':
      return handlePassCounter(state, action.seat);
    case 'BURY_BOTTOM':
      return handleBuryBottom(state, action.seat, action.cardIds);
    case 'PLAY_CARDS':
      return handlePlayCards(state, action.seat, action.cardIds);
    case 'NEXT_ROUND': {
      if (state.phase !== 'ROUND_OVER' || !state.settlement) {
        return {
          ok: false,
          code: 'INVALID_PHASE',
          error: '当前不在局间结算状态',
        };
      }
      const next = startNextRound(state);
      return { ok: true, state: next, events: next.events };
    }
  }
}

export function getPlayerView(
  state: GameState,
  seat: Seat,
  debugOpenHands = false,
): PlayerView {
  const showBottom =
    state.phase === 'ROUND_OVER' || state.phase === 'MATCH_OVER';

  const debugView: DebugView | undefined = debugOpenHands
    ? {
        allHands: {
          0: [...state.hands[0]],
          1: [...state.hands[1]],
          2: [...state.hands[2]],
          3: [...state.hands[3]],
        },
        bottomCards: [...state.bottomCards],
        bipaiCounts: {
          0: countBipai(state.hands[0], state.levelRank),
          1: countBipai(state.hands[1], state.levelRank),
          2: countBipai(state.hands[2], state.levelRank),
          3: countBipai(state.hands[3], state.levelRank),
        },
      }
    : undefined;

  return {
    mode: state.mode,
    viewerSeat: seat,
    roundNumber: state.roundNumber,
    isFirstRound: state.isFirstRound,
    phase: state.phase,
    levelIndex: state.levelIndex,
    levelRank: state.levelRank,
    teams: {
      A: { ...state.teams.A },
      B: { ...state.teams.B },
    },
    playerScores: { ...state.playerScores },
    dealer: state.dealer,
    bankerTeam: state.bankerTeam,
    trumpSuit: state.trumpSuit,
    currentTurn: state.currentTurn,
    myHand: [...state.hands[seat]],
    handCounts: {
      0: state.hands[0].length,
      1: state.hands[1].length,
      2: state.hands[2].length,
      3: state.hands[3].length,
    },
    bottomCount: state.phase === 'BURYING' ? 0 : state.bottomCards.length,
    revealedBottom: showBottom ? [...state.bottomCards] : null,
    bidState: state.bidState
      ? { ...state.bidState, passedSeats: [...state.bidState.passedSeats] }
      : null,
    callState: {
      ...state.callState,
      passedSeats: [...state.callState.passedSeats],
      failedCounterSeats: [...state.callState.failedCounterSeats],
      passedCounterSeats: [...state.callState.passedCounterSeats],
      eligibleCounterSeats: [...state.callState.eligibleCounterSeats],
    },
    currentTrickLeadSeat: state.currentTrickLeadSeat,
    currentTrick: state.currentTrick.map((t) => ({ ...t })),
    lastTrick:
      state.completedTricks.length > 0
        ? state.completedTricks[state.completedTricks.length - 1]
        : null,
    trickNumber: state.completedTricks.length + 1,
    challengerPoints: state.challengerPoints,
    settlement: state.settlement,
    matchWinner: state.matchWinner,
    events: state.events.slice(-20),
    ...(debugView ? { debugView } : {}),
  };
}
