import type {
  AtomicPattern,
  BotDifficulty,
  Card,
  CardCategory,
  GameAction,
  GameMode,
  LevelRank,
  ParsedPlay,
  Seat,
  StandardSuit,
} from '@jinshan/protocol';
import {
  countBipai,
  createThreeDecks,
  getCardCategory,
  getCardKey,
  getCardOrder,
  getCardPoints,
  getSeatTeam,
  isRedFive,
  STANDARD_SUITS,
} from './cards.js';
import {
  canHandBeatComponent,
  canMatchSlingStructure,
  enumerateChainCandidates,
  groupCardsByKey,
  parsePlay,
  sortComponentsCanonical,
} from './patterns.js';
import type { GameState } from './types.js';
import {
  findLegalFollowCards,
  resolveTrickWinner,
  validateFollowPlay,
} from './validator.js';
import { searchPlayCards } from './botSearch.js';

const ALL_SEATS: readonly Seat[] = [0, 1, 2, 3];
const ALL_CATEGORIES: readonly CardCategory[] = ['TRUMP', 'S', 'H', 'C', 'D'];
const THREE_DECKS: readonly Card[] = createThreeDecks();
const CAT_BIT: Record<CardCategory, number> = {
  TRUMP: 1,
  S: 2,
  H: 4,
  C: 8,
  D: 16,
};
const SUIT_INDEX: Record<StandardSuit, number> = { S: 0, H: 1, C: 2, D: 3 };

interface CompletedTricksSummary {
  trumpSuit: StandardSuit | null;
  levelRank: LevelRank;
  playedMask: Uint8Array;
  voidMasks: Uint8Array; // length 4, bitmask by CAT_BIT
  offSuitDiscards: Uint8Array; // length 16: seat * 4 + SUIT_INDEX[suit]
}

const completedTricksCache = new WeakMap<
  GameState['completedTricks'],
  CompletedTricksSummary
>();

function getCompletedTricksSummary(
  state: GameState,
): CompletedTricksSummary {
  const { trumpSuit, levelRank, completedTricks } = state;
  const cached = completedTricksCache.get(completedTricks);
  if (
    cached &&
    cached.trumpSuit === trumpSuit &&
    cached.levelRank === levelRank
  ) {
    return cached;
  }

  const playedMask = new Uint8Array(162);
  const voidMasks = new Uint8Array(4);
  const offSuitDiscards = new Uint8Array(16);

  for (let idx = 0; idx < completedTricks.length; idx++) {
    const plays = completedTricks[idx].plays;
    if (plays.length === 0) continue;
    const leadPlay = plays[0];
    const leadCat = leadPlay.parsed.category;
    const leadCount = leadPlay.cards.length;
    const leadBit = CAT_BIT[leadCat];
    let lead510KUnits = 0;
    for (const comp of leadPlay.parsed.components) {
      if (comp.type === 'F510K') lead510KUnits += comp.length;
    }

    for (let i = 0; i < plays.length; i++) {
      const p = plays[i];
      for (let j = 0; j < p.cards.length; j++) {
        const id = p.cards[j].id;
        if (id >= 0 && id < 162) playedMask[id] = 1;
      }
      if (i === 0) continue;

      let inCatCount = 0;
      for (let j = 0; j < p.cards.length; j++) {
        if (getCardCategory(p.cards[j], trumpSuit, levelRank) === leadCat) {
          inCatCount += 1;
        }
      }
      if (inCatCount < leadCount) {
        if (leadCat !== 'TRUMP' && lead510KUnits > 0) {
          let samePhysical = 0;
          for (let j = 0; j < p.cards.length; j++) {
            if (p.cards[j].suit === leadCat) samePhysical += 1;
          }
          if (samePhysical < leadCount) {
            voidMasks[p.seat] |= leadBit;
          }
        } else {
          voidMasks[p.seat] |= leadBit;
        }

        const isTrumpRuff = leadCat !== 'TRUMP' && p.parsed.category === 'TRUMP';
        if (!isTrumpRuff) {
          const baseOff = p.seat * 4;
          for (let j = 0; j < p.cards.length; j++) {
            const c = p.cards[j];
            const cCat = getCardCategory(c, trumpSuit, levelRank);
            if (cCat !== 'TRUMP' && cCat !== leadCat && getCardPoints(c) === 0) {
              offSuitDiscards[baseOff + SUIT_INDEX[cCat]] += 1;
            }
          }
        }
      }
    }
  }

  const summary: CompletedTricksSummary = {
    trumpSuit,
    levelRank,
    playedMask,
    voidMasks,
    offSuitDiscards,
  };
  completedTricksCache.set(completedTricks, summary);
  return summary;
}

export interface PublicCardTracker {
  unseenByCat: Map<CardCategory, Card[]>;
  voidSeatsByCat: Map<CardCategory, Set<Seat>>;
  trumpsPlayedBySeat: Record<Seat, number>;
  voluntaryTrumpLeadsBySeat: Record<Seat, number>;
  offSuitDiscardsBySeat: Record<Seat, Record<StandardSuit, number>>;
  unseenCount: (cat: CardCategory) => number;
  maxUnseenOrder: (cat: CardCategory) => number;
  isComponentUnbeatable: (cat: CardCategory, comp: AtomicPattern) => boolean;
  isSeatVoid: (seat: Seat, cat: CardCategory) => boolean;
  hasPossibleTrump: (seat: Seat) => boolean;
  anySeatHasPossibleTrump: (seats: readonly Seat[]) => boolean;
  trumpsPlayed: (seat: Seat) => number;
  voluntaryTrumpLeads: (seat: Seat) => number;
  offSuitDiscardCount: (seat: Seat, suit: StandardSuit) => number;
  failedHighOrder: (seat: Seat, cat: CardCategory) => number | null;
}

export function isSameSide(state: GameState, a: Seat, b: Seat): boolean {
  if (state.mode === 'heixin') {
    return (a === state.dealer) === (b === state.dealer);
  }
  return getSeatTeam(a) === getSeatTeam(b);
}

/**
 * Strictly fair card tracker constructed ONLY from public information:
 * completed tricks, current trick, the bot's own hand, and (if bot is dealer)
 * the 10 cards the bot itself buried. Never reads other seats' hidden hands.
 */
export function buildPublicCardTracker(
  state: GameState,
  seat: Seat,
  includeSearchSignals = false,
): PublicCardTracker {
  const { trumpSuit, levelRank } = state;
  const summary = getCompletedTricksSummary(state);

  const knownMask = new Uint8Array(summary.playedMask);
  const voidMasks = new Uint8Array(summary.voidMasks);
  const offSuitDiscards = new Uint8Array(summary.offSuitDiscards);

  const myHand = state.hands[seat];
  for (let i = 0; i < myHand.length; i++) {
    const id = myHand[i].id;
    if (id >= 0 && id < 162) knownMask[id] = 1;
  }
  if (state.dealer === seat && state.phase === 'PLAYING') {
    for (let i = 0; i < state.bottomCards.length; i++) {
      const id = state.bottomCards[i].id;
      if (id >= 0 && id < 162) knownMask[id] = 1;
    }
  }

  // Apply currentTrick incrementally on top of cached completedTricks summary
  const curPlays = state.currentTrick;
  if (curPlays.length > 0) {
    const leadPlay = curPlays[0];
    const leadCat = leadPlay.parsed.category;
    const leadCount = leadPlay.cards.length;
    const leadBit = CAT_BIT[leadCat];
    let lead510KUnits = 0;
    for (const comp of leadPlay.parsed.components) {
      if (comp.type === 'F510K') lead510KUnits += comp.length;
    }
    for (let i = 0; i < curPlays.length; i++) {
      const p = curPlays[i];
      for (let j = 0; j < p.cards.length; j++) {
        const id = p.cards[j].id;
        if (id >= 0 && id < 162) knownMask[id] = 1;
      }
      if (i === 0) continue;
      let inCatCount = 0;
      for (let j = 0; j < p.cards.length; j++) {
        if (getCardCategory(p.cards[j], trumpSuit, levelRank) === leadCat) {
          inCatCount += 1;
        }
      }
      if (inCatCount < leadCount) {
        if (leadCat !== 'TRUMP' && lead510KUnits > 0) {
          let samePhysical = 0;
          for (let j = 0; j < p.cards.length; j++) {
            if (p.cards[j].suit === leadCat) samePhysical += 1;
          }
          if (samePhysical < leadCount) voidMasks[p.seat] |= leadBit;
        } else {
          voidMasks[p.seat] |= leadBit;
        }
        const isTrumpRuff = leadCat !== 'TRUMP' && p.parsed.category === 'TRUMP';
        if (!isTrumpRuff) {
          const baseOff = p.seat * 4;
          for (let j = 0; j < p.cards.length; j++) {
            const c = p.cards[j];
            const cCat = getCardCategory(c, trumpSuit, levelRank);
            if (cCat !== 'TRUMP' && cCat !== leadCat && getCardPoints(c) === 0) {
              offSuitDiscards[baseOff + SUIT_INDEX[cCat]] += 1;
            }
          }
        }
      }
    }
  }

  const trumpsPlayedBySeat: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const voluntaryTrumpLeadsBySeat: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  const failedOrderBySeat = includeSearchSignals
    ? new Map<Seat, Map<CardCategory, number>>()
    : null;

  if (failedOrderBySeat) {
    for (const s of ALL_SEATS) {
      failedOrderBySeat.set(s, new Map<CardCategory, number>());
    }
    const inspectSignals = (
      plays: ReadonlyArray<{ seat: Seat; cards: Card[]; parsed: ParsedPlay }>,
      trickIndex: number,
    ) => {
      if (plays.length === 0) return;
      const leadPlay = plays[0];
      const leadCat = leadPlay.parsed.category;
      if (leadCat === 'TRUMP' && trickIndex < 22) {
        voluntaryTrumpLeadsBySeat[leadPlay.seat] += 1;
      }
      for (let i = 0; i < plays.length; i++) {
        const p = plays[i];
        for (let j = 0; j < p.cards.length; j++) {
          if (getCardCategory(p.cards[j], trumpSuit, levelRank) === 'TRUMP') {
            trumpsPlayedBySeat[p.seat] += 1;
          }
        }
      }
      if (
        plays.length === 4 &&
        leadPlay.parsed.patternType === 'SINGLE' &&
        plays[3].cards.length === 1 &&
        getCardCategory(plays[3].cards[0], trumpSuit, levelRank) === leadCat
      ) {
        const p3 = plays[3];
        let winSeat = leadPlay.seat;
        let winOrd = getCardOrder(leadPlay.cards[0], trumpSuit, levelRank);
        let ptsOnTable = getCardPoints(leadPlay.cards[0]) + getCardPoints(p3.cards[0]);
        let ruffed = false;
        for (let k = 1; k < 3; k++) {
          const pk = plays[k];
          const c0 = pk.cards[0];
          ptsOnTable += getCardPoints(c0);
          const cCat = getCardCategory(c0, trumpSuit, levelRank);
          if (leadCat !== 'TRUMP' && cCat === 'TRUMP') {
            ruffed = true;
            break;
          }
          if (cCat === leadCat) {
            const ord = getCardOrder(c0, trumpSuit, levelRank);
            if (ord > winOrd) {
              winOrd = ord;
              winSeat = pk.seat;
            }
          }
        }
        if (!ruffed && ptsOnTable >= 10 && !isSameSide(state, p3.seat, winSeat)) {
          const myOrd = getCardOrder(p3.cards[0], trumpSuit, levelRank);
          if (myOrd <= winOrd) {
            const seatMap = failedOrderBySeat.get(p3.seat)!;
            const prev = seatMap.get(leadCat);
            if (prev === undefined || winOrd < prev) {
              seatMap.set(leadCat, winOrd);
            }
          }
        }
      }
    };
    for (let idx = 0; idx < state.completedTricks.length; idx++) {
      inspectSignals(state.completedTricks[idx].plays, idx);
    }
    inspectSignals(curPlays, state.completedTricks.length);
  }

  const unseenTrump: Card[] = [];
  const unseenS: Card[] = [];
  const unseenH: Card[] = [];
  const unseenC: Card[] = [];
  const unseenD: Card[] = [];
  let maxTrump = -1;
  let maxS = -1;
  let maxH = -1;
  let maxC = -1;
  let maxD = -1;

  for (let i = 0; i < THREE_DECKS.length; i++) {
    const card = THREE_DECKS[i];
    if (knownMask[card.id]) continue;
    const cat = getCardCategory(card, trumpSuit, levelRank);
    const ord = getCardOrder(card, trumpSuit, levelRank);
    if (cat === 'TRUMP') {
      unseenTrump.push(card);
      if (ord > maxTrump) maxTrump = ord;
    } else if (cat === 'S') {
      unseenS.push(card);
      if (ord > maxS) maxS = ord;
    } else if (cat === 'H') {
      unseenH.push(card);
      if (ord > maxH) maxH = ord;
    } else if (cat === 'C') {
      unseenC.push(card);
      if (ord > maxC) maxC = ord;
    } else {
      unseenD.push(card);
      if (ord > maxD) maxD = ord;
    }
  }

  const unseenByCat = new Map<CardCategory, Card[]>([
    ['TRUMP', unseenTrump],
    ['S', unseenS],
    ['H', unseenH],
    ['C', unseenC],
    ['D', unseenD],
  ]);
  const maxOrderByCat = new Map<CardCategory, number>([
    ['TRUMP', maxTrump],
    ['S', maxS],
    ['H', maxH],
    ['C', maxC],
    ['D', maxD],
  ]);

  const voidSeatsByCat = new Map<CardCategory, Set<Seat>>();
  for (const cat of ALL_CATEGORIES) {
    const set = new Set<Seat>();
    const bit = CAT_BIT[cat];
    for (const s of ALL_SEATS) {
      if ((voidMasks[s] & bit) !== 0) set.add(s);
    }
    voidSeatsByCat.set(cat, set);
  }

  const offSuitDiscardsBySeat: Record<Seat, Record<StandardSuit, number>> = {
    0: { S: offSuitDiscards[0], H: offSuitDiscards[1], C: offSuitDiscards[2], D: offSuitDiscards[3] },
    1: { S: offSuitDiscards[4], H: offSuitDiscards[5], C: offSuitDiscards[6], D: offSuitDiscards[7] },
    2: { S: offSuitDiscards[8], H: offSuitDiscards[9], C: offSuitDiscards[10], D: offSuitDiscards[11] },
    3: { S: offSuitDiscards[12], H: offSuitDiscards[13], C: offSuitDiscards[14], D: offSuitDiscards[15] },
  };

  const unseenTrumps = unseenTrump.length;
  const isSeatVoidFn = (targetSeat: Seat, cat: CardCategory) =>
    (voidMasks[targetSeat] & CAT_BIT[cat]) !== 0;
  const hasPossibleTrumpFn = (targetSeat: Seat) =>
    unseenTrumps > 0 && (voidMasks[targetSeat] & CAT_BIT.TRUMP) === 0;

  return {
    unseenByCat,
    voidSeatsByCat,
    trumpsPlayedBySeat,
    voluntaryTrumpLeadsBySeat,
    offSuitDiscardsBySeat,
    unseenCount: (cat) => unseenByCat.get(cat)?.length ?? 0,
    maxUnseenOrder: (cat) => maxOrderByCat.get(cat) ?? -1,
    isComponentUnbeatable: (cat, comp) => {
      const unseen = unseenByCat.get(cat) ?? [];
      if (unseen.length === 0) return true;
      return !canHandBeatComponent(unseen, cat, comp, trumpSuit, levelRank);
    },
    isSeatVoid: isSeatVoidFn,
    hasPossibleTrump: hasPossibleTrumpFn,
    anySeatHasPossibleTrump: (seats) => seats.some((s) => hasPossibleTrumpFn(s)),
    trumpsPlayed: (targetSeat) => trumpsPlayedBySeat[targetSeat] ?? 0,
    voluntaryTrumpLeads: (targetSeat) => voluntaryTrumpLeadsBySeat[targetSeat] ?? 0,
    offSuitDiscardCount: (targetSeat, suit) =>
      offSuitDiscards[targetSeat * 4 + SUIT_INDEX[suit]] ?? 0,
    failedHighOrder: (targetSeat, cat) =>
      failedOrderBySeat?.get(targetSeat)?.get(cat) ?? null,
  };
}

function scoreSuitStrength(
  hand: readonly Card[],
  suit: StandardSuit,
  levelRank: GameState['levelRank'],
): number {
  let score = 0;
  let suitLen = 0;
  let aces = 0;
  for (const card of hand) {
    if (card.suit === suit) {
      suitLen += 1;
      score += 10 + getCardPoints(card) * 0.45;
      if (card.rank === levelRank) score += 22;
      if (card.rank === '3') score += 14;
      if (card.rank === 'A') {
        score += 8;
        aces += 1;
      } else if (card.rank === 'K') {
        score += 5;
      }
    } else if (card.suit === 'J') {
      score += 12;
    } else if (isRedFive(card)) {
      score += 16;
    } else if (card.rank === '3') {
      // Same-color vice-3 becomes a high trump when suit is chosen
      const sameColor =
        (suit === 'S' && card.suit === 'C') ||
        (suit === 'C' && card.suit === 'S') ||
        (suit === 'H' && card.suit === 'D') ||
        (suit === 'D' && card.suit === 'H');
      if (sameColor) score += 11;
    }
  }
  if (suitLen >= 10) score += 12;
  if (aces >= 2) score += 8;
  return score;
}

export function getCardValueCost(
  card: Card,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): number {
  const cat = getCardCategory(card, trumpSuit, levelRank);
  const order = getCardOrder(card, trumpSuit, levelRank);
  if (cat === 'TRUMP') {
    if (isRedFive(card)) return 62;
    if (card.rank === 'BJ') return 48;
    if (card.rank === 'SJ') return 36;
    if (trumpSuit && card.rank === '3' && card.suit === trumpSuit) return 28;
    if (trumpSuit && card.rank === '3') return 23;
    if (card.rank === levelRank && card.suit === trumpSuit) return 20;
    if (card.rank === levelRank) return 16;
    return 9 + order * 0.65;
  }
  if (card.rank === 'A') return 18;
  if (card.rank === 'K') return 8;
  if (card.rank === 'Q') return 6;
  return 1.5 + order * 0.45;
}

function getRemainingSeatsAfter(state: GameState, seat: Seat): Seat[] {
  const playedCount = state.currentTrick.length;
  const remCount = 3 - playedCount;
  const result: Seat[] = [];
  for (let i = 1; i <= remCount; i++) {
    result.push(((seat + i) % 4) as Seat);
  }
  return result;
}

function hasAnyVoidSeat(
  tracker: PublicCardTracker,
  seats: readonly Seat[],
  cat: CardCategory,
): boolean {
  return seats.some((s) => tracker.isSeatVoid(s, cat));
}

function chooseBidAction(state: GameState, seat: Seat): GameAction {
  const hand = state.hands[seat];
  const bidState = state.bidState!;

  let h5 = 0;
  let bj = 0;
  let sj = 0;
  let tens = 0;
  let threes = 0;
  let aces = 0;
  const suitCount: Record<StandardSuit, number> = { S: 0, H: 0, C: 0, D: 0 };

  for (const c of hand) {
    if (isRedFive(c)) h5 += 1;
    else if (c.rank === 'BJ') bj += 1;
    else if (c.rank === 'SJ') sj += 1;
    else if (c.rank === '10') tens += 1;
    else if (c.rank === '3') threes += 1;
    else if (c.rank === 'A') aces += 1;
    if (c.suit !== 'J') suitCount[c.suit] += 1;
  }

  const maxSuitLen = Math.max(suitCount.S, suitCount.H, suitCount.C, suitCount.D);
  const strength =
    70 +
    h5 * 16 +
    bj * 13 +
    sj * 9 +
    tens * 8 +
    threes * 4 +
    aces * 3 +
    maxSuitLen * 2.2;
  const ceiling = Math.min(220, Math.floor(strength / 10) * 10);
  const nextBid = Math.max(bidState.minBid, bidState.highestBid + 10);

  if (nextBid <= ceiling && nextBid <= bidState.maxBid) {
    return { type: 'BID_SCORE', seat, score: nextBid };
  }
  return { type: 'PASS_BID', seat };
}

function chooseTrumpSuitAction(state: GameState, seat: Seat): GameAction {
  const hand = state.hands[seat];
  let bestSuit: StandardSuit = 'S';
  let bestScore = -1;
  for (const s of STANDARD_SUITS) {
    const sc = scoreSuitStrength(hand, s, state.levelRank);
    if (sc > bestScore) {
      bestScore = sc;
      bestSuit = s;
    }
  }
  return { type: 'CHOOSE_TRUMP', seat, suit: bestSuit };
}

function chooseCallingAction(state: GameState, seat: Seat): GameAction {
  const hand = state.hands[seat];
  const levelCardsBySuit = new Map<StandardSuit, Card[]>();
  for (const s of STANDARD_SUITS) {
    levelCardsBySuit.set(s, []);
  }
  for (const c of hand) {
    if (c.rank === state.levelRank && c.suit !== 'J') {
      levelCardsBySuit.get(c.suit)!.push(c);
    }
  }

  const bipai = countBipai(hand, state.levelRank);
  if (state.isFirstRound) {
    let bestSuit: StandardSuit | null = null;
    let bestCards: Card[] = [];
    let bestScore = -1;
    for (const s of STANDARD_SUITS) {
      const cards = levelCardsBySuit.get(s)!;
      if (cards.length >= 2) {
        const sc = cards.length * 100 + scoreSuitStrength(hand, s, state.levelRank);
        if (sc > bestScore) {
          bestScore = sc;
          bestSuit = s;
          bestCards = cards;
        }
      }
    }
    if (
      bestSuit &&
      (bestCards.length === 3 ||
        bipai >= 5 ||
        state.callState.passedSeats.length >= 2)
    ) {
      return {
        type: 'CALL_TRUMP',
        seat,
        suit: bestSuit,
        cardIds: bestCards.slice(0, bestCards.length === 3 ? 3 : 2).map((c) => c.id),
      };
    }
    return { type: 'PASS_CALL', seat };
  }

  let bestSuit: StandardSuit | null = null;
  let bestScore = -1;
  for (const s of STANDARD_SUITS) {
    const cards = levelCardsBySuit.get(s)!;
    if (cards.length >= 1) {
      const sc = scoreSuitStrength(hand, s, state.levelRank);
      if (sc > bestScore) {
        bestScore = sc;
        bestSuit = s;
      }
    }
  }
  if (
    bestSuit &&
    (bipai >= 4 ||
      getSeatTeam(seat) === state.bankerTeam ||
      state.callState.passedSeats.length >= 2)
  ) {
    return {
      type: 'CALL_TRUMP',
      seat,
      suit: bestSuit,
      cardIds: [levelCardsBySuit.get(bestSuit)![0].id],
    };
  }
  return { type: 'PASS_CALL', seat };
}

function chooseCounterAction(state: GameState, seat: Seat): GameAction {
  const hand = state.hands[seat];
  const calledSuit = state.callState.calledSuit!;
  const required = state.isFirstRound ? 3 : 1;

  let bestSuit: StandardSuit | null = null;
  let bestCards: Card[] = [];
  let bestScore = -1;

  for (const s of STANDARD_SUITS) {
    if (s === calledSuit) continue;
    const cards = hand.filter((c) => c.rank === state.levelRank && c.suit === s);
    if (cards.length >= required) {
      const sc = scoreSuitStrength(hand, s, state.levelRank);
      if (sc > bestScore) {
        bestScore = sc;
        bestSuit = s;
        bestCards = cards;
      }
    }
  }

  if (!bestSuit) {
    return { type: 'PASS_COUNTER', seat };
  }

  const bipai = countBipai(hand, state.levelRank);
  const currentSuitScore = scoreSuitStrength(hand, calledSuit, state.levelRank);

  // Only counter if our target suit is actually helpful (not an empty suit)
  if (state.isFirstRound && state.callState.calledCount === 2 && bipai >= 5 && bestScore >= 95) {
    return {
      type: 'COUNTER_BID',
      seat,
      suit: bestSuit,
      cardIds: bestCards.slice(0, 3).map((c) => c.id),
    };
  }

  if (bipai >= 7 && bestScore >= currentSuitScore + 15) {
    return {
      type: 'COUNTER_BID',
      seat,
      suit: bestSuit,
      cardIds: bestCards.slice(0, required).map((c) => c.id),
    };
  }

  return { type: 'PASS_COUNTER', seat };
}

function chooseCounterResponseAction(state: GameState, seat: Seat): GameAction {
  const pending = state.callState.pendingCounter;
  if (!pending) {
    return { type: 'DEFEND_COUNTER', seat };
  }
  const hand = state.hands[seat];
  const currentSuit = state.callState.calledSuit!;
  const currentStrength = scoreSuitStrength(hand, currentSuit, state.levelRank);
  const proposedStrength = scoreSuitStrength(hand, pending.suit, state.levelRank);
  const myBipai = countBipai(hand, state.levelRank);

  if (state.isFirstRound) {
    // In round 1, defending and losing costs penalty; accept if very weak bipai and proposed suit is better
    if (myBipai <= 3 && proposedStrength >= currentStrength + 10) {
      return { type: 'ACCEPT_COUNTER', seat };
    }
    return { type: 'DEFEND_COUNTER', seat };
  }

  // Round 2+: accepting counter does NOT lose dealer; accept when proposed suit fits better or bipai is weak
  if (proposedStrength >= currentStrength + 15) {
    return { type: 'ACCEPT_COUNTER', seat };
  }
  if (myBipai <= 4 && proposedStrength >= currentStrength - 8) {
    return { type: 'ACCEPT_COUNTER', seat };
  }
  return { type: 'DEFEND_COUNTER', seat };
}

export function chooseBotDealingCallAction(
  state: GameState,
  seat: Seat,
  difficulty: BotDifficulty = 'high',
): GameAction | null {
  // Low-tier bots let human players call first during dealing
  if (difficulty === 'low') return null;
  const minDealt = difficulty === 'medium' ? 28 : 24;
  if (
    state.mode !== 'hongxin' ||
    state.phase !== 'DEALING' ||
    state.callState.callerSeat !== null ||
    state.dealtCount < minDealt
  ) {
    return null;
  }
  const hand = state.hands[seat];
  const levelCardsBySuit = new Map<StandardSuit, Card[]>();
  for (const s of STANDARD_SUITS) levelCardsBySuit.set(s, []);
  for (const c of hand) {
    if (c.rank === state.levelRank && c.suit !== 'J') {
      levelCardsBySuit.get(c.suit)!.push(c);
    }
  }
  if (state.isFirstRound) {
    for (const s of STANDARD_SUITS) {
      const cards = levelCardsBySuit.get(s)!;
      if (cards.length >= 3) {
        return {
          type: 'CALL_TRUMP',
          seat,
          suit: s,
          cardIds: cards.slice(0, 3).map((c) => c.id),
        };
      }
    }
    return null;
  }
  if (state.dealtCount < (difficulty === 'medium' ? 34 : 31)) return null;
  let bestSuit: StandardSuit | null = null;
  let bestScore = -1;
  for (const s of STANDARD_SUITS) {
    const cards = levelCardsBySuit.get(s)!;
    if (cards.length >= 1) {
      const sc = scoreSuitStrength(hand, s, state.levelRank);
      if (sc > bestScore) {
        bestScore = sc;
        bestSuit = s;
      }
    }
  }
  if (bestSuit && bestScore >= (difficulty === 'medium' ? 128 : 115)) {
    return {
      type: 'CALL_TRUMP',
      seat,
      suit: bestSuit,
      cardIds: [levelCardsBySuit.get(bestSuit)![0].id],
    };
  }
  return null;
}

export interface BottomHoldEvaluation {
  score: number;
  trumpCount: number;
  highTrumpCount: number;
  canStripEnemyTrumps: boolean;
  canBeatEnemyTrump510K: boolean;
  maxEnemyTrump510K: number;
  tier: 0 | 1 | 2 | 3;
}

/**
 * Quantify dealer's bottom-holding capability (保底能力) from the 48-card hand before burying.
 * Evaluates four core pillars of Jinshan Hongxin / Heixin endgame bottom security:
 * 1. Trump length (ability to pull & strip enemy trumps / 吊空对手主牌)
 * 2. Top trump density & structure (♥5 / Jokers / 3s / level cards, top pairs & tractors)
 * 3. Anti-510K control when unable to strip enemies (trump triples that crush 510K, blocking trump 5/10/K, own trump 510K)
 * 4. Side-suit Ace control for late-game lead retention.
 */
export function evaluateBottomHoldStrength(
  hand: readonly Card[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): BottomHoldEvaluation {
  const trumps = hand.filter((c) => getCardCategory(c, trumpSuit, levelRank) === 'TRUMP');
  const trumpGroups = groupCardsByKey(trumps, trumpSuit, levelRank);

  let red5Count = 0;
  let bigJokerCount = 0;
  let smallJokerCount = 0;
  let mainThreeCount = 0;
  let sideThreeCount = 0;
  let mainLevelCount = 0;
  let sideLevelCount = 0;
  let highTrumpCount = 0;
  let offSuitAceCount = 0;

  for (const c of hand) {
    const cat = getCardCategory(c, trumpSuit, levelRank);
    if (cat === 'TRUMP') {
      if (isRedFive(c)) {
        red5Count += 1;
        highTrumpCount += 1;
      } else if (c.rank === 'BJ') {
        bigJokerCount += 1;
        highTrumpCount += 1;
      } else if (c.rank === 'SJ') {
        smallJokerCount += 1;
        highTrumpCount += 1;
      } else if (trumpSuit !== null && c.rank === '3') {
        highTrumpCount += 1;
        if (c.suit === trumpSuit) mainThreeCount += 1;
        else sideThreeCount += 1;
      } else if (c.rank === levelRank) {
        highTrumpCount += 1;
        if (c.suit === trumpSuit) mainLevelCount += 1;
        else sideLevelCount += 1;
      }
    } else if (c.rank === 'A') {
      offSuitAceCount += 1;
    }
  }

  // 1. Trump length (strongest real-game predictor of holding/stripping the bottom)
  const trumpCount = trumps.length;
  let score = 0;
  if (trumpCount <= 15) {
    score -= (16 - trumpCount) * 5;
  } else if (trumpCount <= 18) {
    score += (trumpCount - 15) * 4;
  } else if (trumpCount <= 21) {
    score += 12 + (trumpCount - 18) * 6;
  } else {
    score += 30 + (trumpCount - 21) * 8;
  }

  // 2. Ultra-top anchors + top pairs + trump tractors (actually decide the final trick!)
  score +=
    red5Count * 14 +
    bigJokerCount * 8 +
    smallJokerCount * 4 +
    mainThreeCount * 3 +
    sideThreeCount * 1 +
    mainLevelCount * 2.5 +
    sideLevelCount * 0.8;

  if (red5Count >= 3) score += 24;
  else if (red5Count >= 2) score += 14;
  if (bigJokerCount >= 2) score += 8;
  if (smallJokerCount >= 2) score += 4;
  if (mainThreeCount >= 2) score += 3.5;
  if (mainLevelCount >= 2) score += 3;

  const trumpTractors = enumerateChainCandidates(trumpGroups, 2);
  const trumpTripleTractors = enumerateChainCandidates(trumpGroups, 3);
  if (trumpTractors.length > 0) score += Math.min(10, trumpTractors.length * 5);
  if (trumpTripleTractors.length > 0) score += 10;

  // 3. Anti-510K bottom defense (crucial when dealer cannot strip all enemy trumps!)
  const trumpTriples = trumpGroups.filter((g) => g.cards.length === 3);
  const highTrumpTriples = trumpTriples.filter((g) => {
    const sample = g.cards[0];
    return (
      isRedFive(sample) ||
      sample.suit === 'J' ||
      sample.rank === levelRank ||
      (trumpSuit !== null && sample.rank === '3')
    );
  });

  let myTrump5 = 0;
  let myTrump10 = 0;
  let myTrumpK = 0;
  if (trumpSuit !== null) {
    for (const c of hand) {
      if (c.suit === trumpSuit) {
        if (c.rank === '5') myTrump5 += 1;
        else if (c.rank === '10') myTrump10 += 1;
        else if (c.rank === 'K') myTrumpK += 1;
      }
    }
  }
  const myTrump510KUnits = trumpSuit !== null ? Math.min(myTrump5, myTrump10, myTrumpK) : 0;
  const maxEnemyTrump510K =
    trumpSuit !== null ? Math.min(3 - myTrump5, 3 - myTrump10, 3 - myTrumpK) : 0;

  // Can strip enemy trumps dry?
  const canStripEnemyTrumps =
    trumpCount >= 23 &&
    highTrumpCount >= 8 &&
    (red5Count >= 2 || red5Count + bigJokerCount >= 3);
  // Can beat or neutralize an opponent's hidden trump 510K?
  // Any trump triple directly beats a single trump 510K; owning all 3 of trump 5/10/K makes enemy trump 510K impossible!
  const canBeatEnemyTrump510K =
    trumpTriples.length >= 1 || maxEnemyTrump510K === 0;

  if (maxEnemyTrump510K === 0) {
    score += 12; // Enemies literally cannot form any trump 510K!
  } else if (maxEnemyTrump510K === 1) {
    score += 3;
  }
  if (trumpTriples.length >= 1) {
    score += 7 + Math.min(1, trumpTriples.length - 1) * 4 + highTrumpTriples.length * 6;
  } else if (!canStripEnemyTrumps && maxEnemyTrump510K >= 2) {
    // Major vulnerability: cannot strip enemy trumps AND has no trump triple to stop a hidden trump 510K!
    score -= myTrump510KUnits >= 1 ? 6 : 14;
  }
  if (myTrump510KUnits >= 1) {
    score += myTrump510KUnits * 3.5;
  }

  // 4. Side-suit Aces help keep/reclaim lead near the endgame
  score += Math.min(6, offSuitAceCount * 1.5);

  // Classify into 4 calibrated bottom-hold tiers:
  // Tier 0 (score < 34 or trumps <= 15): Weak / high kill risk -> keep bottom strictly clean (0 pts)
  // Tier 1 (34..59): Ordinary trumps, vulnerable to big trumps/510K -> at most 5~10 pts for voids/pairs
  // Tier 2 (60..87): Strong trumps + top anchors + anti-510K defense -> up to 15~20 pts
  // Tier 3 (>= 88): Dominant bottom lock (can strip enemies or crush/block 510K with top anchors) -> up to 30~40 pts
  let tier: 0 | 1 | 2 | 3;
  if (
    score >= 88 &&
    trumpCount >= 21 &&
    red5Count >= 1 &&
    (red5Count >= 2 || red5Count + bigJokerCount >= 3) &&
    (canStripEnemyTrumps || canBeatEnemyTrump510K)
  ) {
    tier = 3;
  } else if (
    score >= 60 &&
    trumpCount >= 19 &&
    red5Count + bigJokerCount >= 2 &&
    (canBeatEnemyTrump510K || canStripEnemyTrumps || maxEnemyTrump510K <= 1)
  ) {
    tier = 2;
  } else if (score >= 34 && trumpCount >= 16) {
    tier = 1;
  } else {
    tier = 0;
  }

  return {
    score,
    trumpCount,
    highTrumpCount,
    canStripEnemyTrumps,
    canBeatEnemyTrump510K,
    maxEnemyTrump510K,
    tier,
  };
}

/**
 * Recommend 10 cards to bury into the bottom (shared by bots and the UI's "智能选底" button).
 * Preserves trumps, Aces, triples, tractors, 510K, and pairs; voids short weak off-suits when feasible.
 * Scales bottom-point tolerance smoothly with `evaluateBottomHoldStrength` (trump length, high trumps, and anti-510K defense).
 */
export function suggestBuryCards(
  hand: readonly Card[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
  mode: GameMode,
): number[] {
  const buryPool = mode === 'heixin' ? hand.filter((c) => c.rank !== '10') : hand;

  const hold = evaluateBottomHoldStrength(hand, trumpSuit, levelRank);

  // Smooth bottom-point budget scaled directly by bottom-hold capability:
  // Hongxin:
  //   Tier 0 (weak / vulnerable) -> 0 pts
  //   Tier 1 (average trumps, no anti-510K lock) -> max 10 pts (allows lone 5 for clean voids/pairs, never heavy 10/K dumps)
  //   Tier 2 (strong trumps + top anchors + anti-510K) -> max 15 pts (tucks a loose 10/K or voids short point suit safely)
  //   Tier 3 (dominant bottom lock: strip/510K-proof + top anchors) -> max 30~40 pts
  // Heixin (10s already banned, buried points score directly for dealer if bottom holds):
  //   Tier 0 -> max 5 pts, Tier 1 -> max 15 pts, Tier 2 -> max 25 pts, Tier 3 -> max 40 pts
  const maxBottomPoints =
    mode === 'hongxin'
      ? hold.tier === 3
        ? hold.canStripEnemyTrumps
          ? 40
          : 30
        : hold.tier === 2
          ? 15
          : hold.tier === 1
            ? 10
            : 0
      : hold.tier === 3
        ? 45
        : hold.tier === 2
          ? 30
          : hold.tier === 1
            ? 20
            : 10;

  const suitCards = new Map<StandardSuit, Card[]>();
  for (const s of STANDARD_SUITS) suitCards.set(s, []);
  for (const c of hand) {
    const cat = getCardCategory(c, trumpSuit, levelRank);
    if (cat !== 'TRUMP') {
      suitCards.get(cat)!.push(c);
    }
  }

  const groups = groupCardsByKey(hand, trumpSuit, levelRank);
  const keyCounts = new Map(groups.map((g) => [g.key, g.cards.length]));

  // Detect cards participating in tractors / 510K to avoid breaking them
  const protectedIds = new Set<number>();
  for (const cat of ALL_CATEGORIES) {
    const inCat = hand.filter((c) => getCardCategory(c, trumpSuit, levelRank) === cat);
    const catGroups = groupCardsByKey(inCat, trumpSuit, levelRank);
    for (const ch of enumerateChainCandidates(catGroups, 3)) {
      for (const c of ch.cards) protectedIds.add(c.id);
    }
    for (const ch of enumerateChainCandidates(catGroups, 2)) {
      for (const c of ch.cards) protectedIds.add(c.id);
    }
  }
  for (const s of STANDARD_SUITS) {
    const c5 = hand.filter((c) => c.suit === s && c.rank === '5');
    const c10 = hand.filter((c) => c.suit === s && c.rank === '10');
    const cK = hand.filter((c) => c.suit === s && c.rank === 'K');
    const m = Math.min(c5.length, c10.length, cK.length);
    for (let i = 0; i < m; i++) {
      protectedIds.add(c5[i].id);
      protectedIds.add(c10[i].id);
      protectedIds.add(cK[i].id);
    }
  }

  // Identify short off-suits whose NON-ACE cards can be cleanly cleared!
  // Keeping A / AA while burying the rest of the suit lets dealer cash A/AA on trick 1
  // for free points and STILL become 100% void in that suit on trick 2 (strictly better than burying Aces!).
  const voidTargetSuits = new Set<StandardSuit>();
  const offSuitsSorted = STANDARD_SUITS.filter((s) => s !== trumpSuit)
    .map((s) => {
      const cards = suitCards.get(s)!;
      const nonAceCards = cards.filter((c) => c.rank !== 'A');
      const eligibleNonAce = nonAceCards.filter(
        (c) => mode !== 'heixin' || c.rank !== '10',
      );
      const canVoidNonAces =
        eligibleNonAce.length === nonAceCards.length && nonAceCards.length > 0;
      const aces = cards.length - nonAceCards.length;
      const hasTriple = groupCardsByKey(nonAceCards, trumpSuit, levelRank).some(
        (g) => g.cards.length === 3,
      );
      const nonAcePts = nonAceCards.reduce((sum, c) => sum + getCardPoints(c), 0);
      return {
        suit: s,
        nonAceLen: nonAceCards.length,
        canVoidNonAces,
        aces,
        hasTriple,
        nonAcePts,
      };
    })
    .filter((info) => info.canVoidNonAces && info.nonAceLen <= 6 && !info.hasTriple)
    .sort(
      (a, b) =>
        a.nonAcePts - b.nonAcePts ||
        a.nonAceLen + a.aces * 1.2 - (b.nonAceLen + b.aces * 1.2),
    );

  let voidBudget = 10;
  let voidPtsUsed = 0;
  const maxSingleVoidPts =
    hold.tier >= 3
      ? 25
      : hold.tier === 2
        ? mode === 'heixin'
          ? 20
          : 15
        : hold.tier === 1
          ? mode === 'heixin'
            ? 15
            : 5
          : 0;

  for (const info of offSuitsSorted) {
    if (info.nonAceLen <= voidBudget) {
      if (info.nonAcePts > maxSingleVoidPts) continue;
      if (voidPtsUsed + info.nonAcePts > maxBottomPoints) continue;
      voidTargetSuits.add(info.suit);
      voidBudget -= info.nonAceLen;
      voidPtsUsed += info.nonAcePts;
    }
  }

  const scored = buryPool.map((card) => {
    const cat = getCardCategory(card, trumpSuit, levelRank);
    const key = getCardKey(card);
    const mult = keyCounts.get(key) ?? 1;
    const order = getCardOrder(card, trumpSuit, levelRank);
    const pts = getCardPoints(card);
    let keepScore = 0;

    if (cat === 'TRUMP') {
      keepScore += 280 + getCardValueCost(card, trumpSuit, levelRank) * 4;
    } else if (card.rank === 'A') {
      // NEVER bury an off-suit Ace: cash it early to win points & shorten/void the suit!
      keepScore = 155 + order * 2.5 + (mult >= 2 ? 40 : 0);
    } else {
      const len = suitCards.get(cat)?.length ?? 0;
      const isVoidTarget = voidTargetSuits.has(cat);

      if (isVoidTarget) {
        // Strongly encourage clearing all non-Ace cards of the short suit to create an instant/1-trick void
        keepScore = -45 + order * 1.1;
        if (pts > 0) {
          keepScore += hold.tier >= 3 ? -6 : hold.tier === 2 ? 4 : 18 + pts;
        }
      } else {
        keepScore = order * 2.8 + len * 2.4;
        if (mult === 3) keepScore += 110;
        else if (mult === 2) keepScore += 34;
        if (protectedIds.has(card.id)) keepScore += 40;
        if (pts > 0) {
          if (hold.tier === 3 && mult === 1 && !protectedIds.has(card.id)) {
            // Dominant bottom lock: safely banking loose singletons denies points on table
            keepScore -= 8;
          } else if (hold.tier === 2 && mult === 1 && !protectedIds.has(card.id)) {
            // Strong bottom defense (anti-510K + high trumps): still prefers 0-pt trash first,
            // may tuck 10~15 pts of loose singletons rather than breaking pairs/triples
            keepScore += mode === 'heixin' ? -6 : 10;
          } else if (hold.tier === 1) {
            // Ordinary trumps without 510K lock: bury 0-pt singles first, allow lone 5 before breaking pairs, protect 10/K
            keepScore += mode === 'heixin' ? 16 + pts * 0.8 : pts === 5 ? 26 : 58 + pts * 2.5;
          } else {
            // Tier 0: strictly avoid burying points
            keepScore += 70 + pts * 4;
          }
        }
      }
    }

    return { card, cat, pts, keepScore };
  });

  scored.sort((a, b) => a.keepScore - b.keepScore || a.card.id - b.card.id);

  // Two-pass selection respecting `maxBottomPoints` so hands without bottom-hold lock
  // never dump excessive points into the bottom unless literally forced.
  const picked: typeof scored = [];
  const pickedIds = new Set<number>();
  let buriedPts = 0;

  for (const item of scored) {
    if (picked.length >= 10) break;
    if (item.cat === 'TRUMP' || item.card.rank === 'A') continue;
    if (item.pts > 0 && buriedPts + item.pts > maxBottomPoints) continue;
    picked.push(item);
    pickedIds.add(item.card.id);
    buriedPts += item.pts;
  }

  for (const item of scored) {
    if (picked.length >= 10) break;
    if (pickedIds.has(item.card.id)) continue;
    picked.push(item);
    pickedIds.add(item.card.id);
  }

  return picked.map((s) => s.card.id);
}

function chooseBuryAction(state: GameState, seat: Seat): GameAction {
  return {
    type: 'BURY_BOTTOM',
    seat,
    cardIds: suggestBuryCards(
      state.hands[seat],
      state.trumpSuit,
      state.levelRank,
      state.mode,
    ),
  };
}

/** All sensible lead options, best-first by heuristic priority (each structurally legal). */
export function rankLeadCandidates(state: GameState, seat: Seat): Card[][] {
  const hand = state.hands[seat];
  const { trumpSuit, levelRank } = state;
  const tracker = buildPublicCardTracker(state, seat);

  const enemies = ALL_SEATS.filter((s) => !isSameSide(state, seat, s));
  const allies = ALL_SEATS.filter((s) => s !== seat && isSameSide(state, seat, s));
  const isBankerSide = state.dealer !== null && isSameSide(state, seat, state.dealer);
  const isHeixinChallenger = state.mode === 'heixin' && !isBankerSide;
  const dealerSeat = state.dealer;
  const knownBottomPts =
    dealerSeat === seat
      ? state.bottomCards.reduce((sum, c) => sum + getCardPoints(c), 0)
      : 0;
  const unseenTrumps = tracker.unseenCount('TRUMP');
  const enemiesHaveTrump = tracker.anySeatHasPossibleTrump(enemies);
  const allyMayHaveTrump = tracker.anySeatHasPossibleTrump(allies);
  const partnerIsStrongRole =
    state.mode === 'hongxin' &&
    allies.some(
      (a) =>
        (a === state.dealer || a === state.callState.callerSeat) &&
        tracker.hasPossibleTrump(a),
    );
  const fourthSeat = ((seat + 3) % 4) as Seat;
  const dealerRel =
    isHeixinChallenger && dealerSeat !== null ? (dealerSeat - seat + 4) % 4 : -1;

  const myTrumps = hand.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) === 'TRUMP',
  );
  const myHighTrumps = myTrumps.filter((c) => {
    if (isRedFive(c) || c.suit === 'J' || c.rank === levelRank) return true;
    return trumpSuit !== null && c.rank === '3';
  });
  // Never pull trumps when all enemies are already void in trump (burning trumps into thin air
  // wastes our ruffing interceptors, lets enemies shed trash/make voids, and cannibalizes teammate's trumps!).
  // In 1v3 heixin, challengers suffer a 3-for-1 trump drain when pulling trumps mid-game, so only pull in endgame.
  const wantPullTrump =
    enemiesHaveTrump &&
    (!isHeixinChallenger || hand.length <= 5) &&
    ((isBankerSide && myTrumps.length >= 8 && myHighTrumps.length >= 3) ||
      (myTrumps.length >= 11 && myHighTrumps.length >= 4) ||
      (hand.length <= 6 && myHighTrumps.length >= 2));
  // Only penalize pulling trumps when all enemies are void in TRUMP AND our teammate still has trumps
  // (otherwise leading an unbeatable trump when everyone is void lets our teammate safely feed us points!).
  const cannibalizeAllyTrumpPenalty =
    !enemiesHaveTrump && allyMayHaveTrump && hand.length > 6 ? 26 : 0;

  const candidatePlays: { cards: Card[]; priority: number }[] = [];
  const seenSigs = new Set<string>();
  const addCandidate = (cards: readonly Card[], priority: number) => {
    if (cards.length === 0) return;
    const sig = cards
      .map((c) => c.id)
      .sort((a, b) => a - b)
      .join(',');
    if (seenSigs.has(sig)) return;
    seenSigs.add(sig);
    candidatePlays.push({ cards: [...cards], priority });
  };

  // Track cards belonging to 510K or strong combos so exploratory singles avoid breaking them
  const comboIds = new Set<number>();
  for (const s of STANDARD_SUITS) {
    const s5 = hand.filter((c) => c.suit === s && c.rank === '5');
    const s10 = hand.filter((c) => c.suit === s && c.rank === '10');
    const sK = hand.filter((c) => c.suit === s && c.rank === 'K');
    const count510k = Math.min(s5.length, s10.length, sK.length);
    if (count510k >= 1) {
      const fCards: Card[] = [];
      for (let i = 0; i < count510k; i++) {
        fCards.push(s5[i], s10[i], sK[i]);
        comboIds.add(s5[i].id);
        comboIds.add(s10[i].id);
        comboIds.add(sK[i].id);
      }

      const cat: CardCategory = s === trumpSuit ? 'TRUMP' : s;
      const parsed510k = parsePlay(fCards, trumpSuit, levelRank);
      const safe510k =
        parsed510k !== null &&
        parsed510k.components.every((comp) => tracker.isComponentUnbeatable(cat, comp));
      const enemyRuffDanger =
        cat !== 'TRUMP' &&
        enemies.some((e) => tracker.isSeatVoid(e, cat) && tracker.hasPossibleTrump(e));
      const unseenInCat = tracker.unseenCount(cat);

      if (cat === 'TRUMP') {
        // Trump 510K forces EVERY non-triple seat (including our own teammate!) to surrender their 3 BIGGEST trumps!
        // Great for solo heixin dealer (0 friendly fire); catastrophic for heixin challengers (2-for-1 self-damage).
        let prio = 88 + count510k * 16 - cannibalizeAllyTrumpPenalty;
        if (safe510k) prio += 26;
        if (wantPullTrump) prio += 18;
        if (!enemiesHaveTrump || unseenTrumps < 6) prio -= 14;
        if (state.mode === 'heixin' && dealerSeat === seat && enemiesHaveTrump) {
          prio += safe510k ? 18 : 6;
        } else if (isHeixinChallenger && allyMayHaveTrump) {
          prio -= 55;
        } else if (allyMayHaveTrump && !safe510k && unseenTrumps >= 18) {
          // Avoid early unsafe trump 510K in 2v2 that feeds enemy triple while stripping teammate's top trumps
          prio -= 32;
        }
        addCandidate(fCards, prio);
      } else {
        // Side-suit 510K carries 25*k points! Only lead aggressively when safe or unlikely to get killed
        let prio = 38 + count510k * 18;
        if (safe510k) prio += 36;
        if (enemyRuffDanger) prio -= 55;
        else if (unseenInCat <= 8 && enemiesHaveTrump) prio -= 18;
        else if (unseenInCat >= 14 && count510k === 1 && !safe510k) prio -= 10;
        if (!enemiesHaveTrump && safe510k) prio += 30;
        addCandidate(fCards, prio);
      }
    }
  }

  const categories: CardCategory[] = [
    ...STANDARD_SUITS.filter((s) => s !== trumpSuit),
    'TRUMP',
  ];

  for (const cat of categories) {
    const inCat = hand.filter(
      (c) => getCardCategory(c, trumpSuit, levelRank) === cat,
    );
    if (inCat.length === 0) continue;

    const groups = groupCardsByKey(inCat, trumpSuit, levelRank);
    const isTrumpCat = cat === 'TRUMP';
    const enemyRuffDanger =
      !isTrumpCat &&
      enemies.some((e) => tracker.isSeatVoid(e, cat) && tracker.hasPossibleTrump(e));
    const fourthSeatEnemyRuffRisk =
      !isTrumpCat &&
      !isSameSide(state, seat, fourthSeat) &&
      tracker.isSeatVoid(fourthSeat, cat) &&
      tracker.hasPossibleTrump(fourthSeat);
    const allyVoidWithTrump =
      !isTrumpCat &&
      allies.some((a) => tracker.isSeatVoid(a, cat) && tracker.hasPossibleTrump(a));
    const allySignaledVoid =
      !isTrumpCat &&
      !allyVoidWithTrump &&
      allies.some(
        (a) => tracker.offSuitDiscardCount(a, cat) >= 2 && tracker.hasPossibleTrump(a),
      );
    const unseenInCat = tracker.unseenCount(cat);
    const heixinSandwichBonus =
      isHeixinChallenger && dealerRel === 1 && !isTrumpCat && !enemyRuffDanger ? 8 : 0;

    // 1. Check for 100% fair guaranteed-safe multi-card sling in this category
    const safeComponents: AtomicPattern[] = [];
    const usedSafeIds = new Set<number>();

    const ttAll = enumerateChainCandidates(groups, 3);
    for (const ch of ttAll) {
      for (const c of ch.cards) comboIds.add(c.id);
      const comp: AtomicPattern = {
        type: 'TRIPLE_TRACTOR',
        cards: ch.cards,
        cardKeys: ch.keys,
        length: ch.length,
        topOrder: ch.topOrder,
        usedLowAce: ch.usedLowAce,
      };
      const safe = tracker.isComponentUnbeatable(cat, comp);
      let prio = isTrumpCat
        ? (wantPullTrump ? 128 : 88) + ch.topOrder - cannibalizeAllyTrumpPenalty
        : 105 + ch.topOrder;
      if (safe) prio += 20;
      if (enemyRuffDanger) prio -= 48;
      addCandidate(ch.cards, prio);

      if (safe && ch.cards.every((c) => !usedSafeIds.has(c.id))) {
        safeComponents.push(comp);
        for (const c of ch.cards) usedSafeIds.add(c.id);
      }
    }

    const trAll = enumerateChainCandidates(groups, 2);
    for (const ch of trAll) {
      for (const c of ch.cards) comboIds.add(c.id);
      const comp: AtomicPattern = {
        type: 'TRACTOR',
        cards: ch.cards,
        cardKeys: ch.keys,
        length: ch.length,
        topOrder: ch.topOrder,
        usedLowAce: ch.usedLowAce,
      };
      const safe = tracker.isComponentUnbeatable(cat, comp);
      let prio = isTrumpCat
        ? (wantPullTrump ? 112 : 74) + ch.topOrder - cannibalizeAllyTrumpPenalty
        : 84 + ch.topOrder;
      if (safe) prio += 22;
      if (enemyRuffDanger) prio -= 44;
      else if (!isTrumpCat && unseenInCat < 6 && enemiesHaveTrump) prio -= 18;
      addCandidate(ch.cards, prio);

      if (safe && ch.cards.every((c) => !usedSafeIds.has(c.id))) {
        safeComponents.push(comp);
        for (const c of ch.cards) usedSafeIds.add(c.id);
      }
    }

    for (const g of groups) {
      const sz = g.cards.length;
      if (sz >= 2) {
        for (const c of g.cards) comboIds.add(c.id);
      }

      if (sz === 3) {
        const comp: AtomicPattern = {
          type: 'TRIPLE',
          cards: g.cards,
          cardKeys: [g.key],
          length: 1,
          topOrder: g.order,
          usedLowAce: false,
        };
        const safe = tracker.isComponentUnbeatable(cat, comp);
        const pts = g.cards.reduce((s, c) => s + getCardPoints(c), 0);
        let prio = isTrumpCat
          ? (wantPullTrump ? 104 : 62) + g.order - cannibalizeAllyTrumpPenalty
          : (safe ? 96 : 48) + g.order;
        if (enemyRuffDanger) prio -= 45 + pts;
        else if (!isTrumpCat && unseenInCat < 5 && enemiesHaveTrump) prio -= 16;
        addCandidate(g.cards, prio);

        if (safe && g.cards.every((c) => !usedSafeIds.has(c.id))) {
          safeComponents.push(comp);
          for (const c of g.cards) usedSafeIds.add(c.id);
        }
      } else if (sz === 2) {
        const comp: AtomicPattern = {
          type: 'PAIR',
          cards: g.cards,
          cardKeys: [g.key],
          length: 1,
          topOrder: g.order,
          usedLowAce: false,
        };
        const safe = tracker.isComponentUnbeatable(cat, comp);
        const pts = g.cards.reduce((s, c) => s + getCardPoints(c), 0);
        let prio = isTrumpCat
          ? (wantPullTrump && safe ? 94 : safe ? 68 : 34) + g.order - cannibalizeAllyTrumpPenalty
          : (safe ? 86 : 26) + g.order - (safe ? 0 : pts * 1.4);
        if (!isTrumpCat && !safe && allyVoidWithTrump && !fourthSeatEnemyRuffRisk) {
          if (!enemyRuffDanger && unseenInCat >= 4 && unseenTrumps >= 4) {
            prio += 18 + (pts > 0 && unseenInCat >= 6 ? pts * 0.8 : 0);
          }
        }
        if (enemyRuffDanger) prio -= 38 + pts;
        else if (!isTrumpCat && unseenInCat < 4 && enemiesHaveTrump) prio -= 14;
        addCandidate(g.cards, prio);

        if (safe && g.cards.every((c) => !usedSafeIds.has(c.id))) {
          safeComponents.push(comp);
          for (const c of g.cards) usedSafeIds.add(c.id);
        }
      } else {
        const card = g.cards[0];
        const comp: AtomicPattern = {
          type: 'SINGLE',
          cards: [card],
          cardKeys: [g.key],
          length: 1,
          topOrder: g.order,
          usedLowAce: false,
        };
        const safe = tracker.isComponentUnbeatable(cat, comp);
        const pts = getCardPoints(card);
        const inCombo = comboIds.has(card.id);

        let prio = 0;
        if (safe) {
          if (isTrumpCat) {
            prio = (wantPullTrump ? 92 : 66) + g.order - cannibalizeAllyTrumpPenalty;
            // Don't trivially waste lone ♥5 on early lead unless pulling trumps or endgame
            if (isRedFive(card) && !wantPullTrump && hand.length > 8) {
              prio -= 26;
            }
          } else {
            prio = 82 + g.order + heixinSandwichBonus;
            if (enemyRuffDanger) prio -= 42 + pts * 1.5;
            else if (unseenInCat <= 2 && enemiesHaveTrump) prio -= 20;
            // Prefer cashing top Aces/Kings when unseen cards still exist in suit
            if (unseenInCat >= 4 && !enemyRuffDanger) prio += 12;
          }
          if (!usedSafeIds.has(card.id)) {
            safeComponents.push(comp);
            usedSafeIds.add(card.id);
          }
        } else {
          // Non-top exploratory lead: prefer low non-point off-suit card, or cooperatively feed teammate's void!
          if (isTrumpCat) {
            prio =
              (wantPullTrump ? 24 : 4) -
              g.order * 0.6 -
              pts * 2.5 -
              cannibalizeAllyTrumpPenalty;
          } else {
            prio = 32 - g.order * 1.1 - pts * 3.2;
            if (allyVoidWithTrump && !fourthSeatEnemyRuffRisk) {
              if (!enemyRuffDanger && unseenInCat >= 6 && unseenTrumps >= 5 && !inCombo) {
                // High-confidence void-feed: low card leads partner cleanly, and even 5/10/K is worth considering
                prio =
                  pts === 0
                    ? 66 - g.order * 0.5 + heixinSandwichBonus
                    : 54 - g.order * 0.5 + pts * 0.9 + heixinSandwichBonus;
                if (partnerIsStrongRole) prio += 6;
              } else if (!enemyRuffDanger) {
                prio += 30 + heixinSandwichBonus;
                if (partnerIsStrongRole) prio += 6;
              } else if (pts === 0) {
                // 2nd seat enemy is void, but 3rd seat ally acts after them and 4th seat enemy is not void
                prio += 14;
              }
            } else if (allySignaledVoid && !enemyRuffDanger && pts === 0 && !inCombo) {
              // Teammate voluntarily sloughed this suit repeatedly -> probe it to finish/use their void
              prio += 12 + heixinSandwichBonus;
            } else if (heixinSandwichBonus > 0 && pts === 0) {
              prio += heixinSandwichBonus;
            }

            // In 1v3 heixin, avoid leading point cards or short suits directly into 4th-seat dealer
            if (isHeixinChallenger && dealerRel === 3 && !allyVoidWithTrump) {
              if (pts > 0) prio -= 10;
              if (unseenInCat <= 5 && enemiesHaveTrump) prio -= 10;
            }

            if (enemyRuffDanger) {
              prio -= (isHeixinChallenger ? 26 : 18) + pts * 2;
            }
          }
          if (inCombo) prio -= 24;
        }

        addCandidate([card], prio);
      }
    }

    // Build a safe multi-card sling if we have >= 2 strictly unbeatable components!
    if (safeComponents.length >= 2 && !enemyRuffDanger) {
      const slingCards = safeComponents.flatMap((c) => c.cards);
      const parsedSling = parsePlay(slingCards, trumpSuit, levelRank);
      if (
        parsedSling &&
        parsedSling.components.every((comp) =>
          tracker.isComponentUnbeatable(cat, comp),
        )
      ) {
        const isFinishing = slingCards.length === hand.length;
        let slingPrio = isTrumpCat
          ? (wantPullTrump ? 132 : 95) +
            slingCards.length * 4 -
            (isFinishing ? 0 : cannibalizeAllyTrumpPenalty)
          : 110 + slingCards.length * 4;
        if (!isTrumpCat && unseenInCat < slingCards.length && enemiesHaveTrump) {
          slingPrio -= 30;
        }
        if (isFinishing) {
          slingPrio += 120; // Finish out the round cleanly!
        }
        addCandidate(slingCards, slingPrio);
      }
    }
  }

  candidatePlays.sort((a, b) => b.priority - a.priority);

  // Strictly verify structural legality via parsePlay (NO peeking at otherHands!)
  const ranked: Card[][] = [];
  for (const cand of candidatePlays) {
    const parsed = parsePlay(cand.cards, trumpSuit, levelRank);
    if (!parsed) continue;
    if (parsed.patternType === 'SLING') {
      const safeSling = parsed.components.every((comp) =>
        tracker.isComponentUnbeatable(parsed.category, comp),
      );
      if (!safeSling) continue;
    }
    ranked.push(cand.cards);
  }
  if (ranked.length === 0) ranked.push([hand[hand.length - 1]]);
  return ranked;
}

function chooseLeadCards(state: GameState, seat: Seat): number[] {
  return rankLeadCandidates(state, seat)[0].map((c) => c.id);
}

/**
 * Construct minimal-waste sling matches (for trump-killing or beating a multi-card sling).
 * Anchors the primary deciding component(s) with strong cards while filling all remaining
 * slots with the cheapest low cards (e.g. ♥5 + ♥5 + low trump instead of ♥5 + ♥5 + BJ!).
 */
function enumerateSmartSlingMatches(
  pool: readonly Card[],
  targetComponents: readonly AtomicPattern[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): Card[][] {
  const totalNeeded = targetComponents.reduce((s, c) => s + c.cards.length, 0);
  if (pool.length < totalNeeded || targetComponents.length === 0) return [];

  const ordered = sortComponentsCanonical(targetComponents);
  const results: Card[][] = [];
  const seen = new Set<string>();
  const emit = (cards: readonly Card[]) => {
    if (cards.length !== totalNeeded) return;
    const sig = cards
      .map((c) => c.id)
      .sort((a, b) => a - b)
      .join(',');
    if (seen.has(sig)) return;
    if (canMatchSlingStructure(cards, targetComponents, trumpSuit, levelRank).matched) {
      seen.add(sig);
      results.push([...cards]);
    }
  };

  const asc = [...pool].sort((a, b) => {
    const ordDiff =
      getCardOrder(a, trumpSuit, levelRank) - getCardOrder(b, trumpSuit, levelRank);
    if (ordDiff !== 0) return ordDiff;
    const ptsDiff = getCardPoints(a) - getCardPoints(b);
    if (ptsDiff !== 0) return ptsDiff;
    return a.id - b.id;
  });
  const desc = [...pool].sort((a, b) => {
    const ordDiff =
      getCardOrder(b, trumpSuit, levelRank) - getCardOrder(a, trumpSuit, levelRank);
    if (ordDiff !== 0) return ordDiff;
    const ptsDiff = getCardPoints(a) - getCardPoints(b);
    if (ptsDiff !== 0) return ptsDiff;
    return a.id - b.id;
  });

  // Fast & exact path for pure-SINGLE slings (e.g., 单×2, 单×3, 单×4)
  if (ordered.every((c) => c.type === 'SINGLE')) {
    const k = ordered.length;
    // 1. Cheapest all-low kill
    emit(asc.slice(0, k));

    // 2. Single-anchor kills: 1 strong card + (k-1) cheapest low fillers
    const seenAnchorOrd = new Set<number>();
    let anchorCount = 0;
    for (const anchor of desc) {
      const ord = getCardOrder(anchor, trumpSuit, levelRank);
      if (seenAnchorOrd.has(ord)) continue;
      seenAnchorOrd.add(ord);
      const fillers = asc.filter((c) => c.id !== anchor.id).slice(0, k - 1);
      emit([anchor, ...fillers]);
      anchorCount += 1;
      if (anchorCount >= 6) break;
    }

    // 3. Double-anchor kills (e.g. ♥5 + ♥5 + cheapest low trump — 100% unbeatable without burning BJ!)
    if (k >= 2 && desc.length >= 2) {
      const top2 = desc.slice(0, 2);
      const top2Ids = new Set(top2.map((c) => c.id));
      const fillers = asc.filter((c) => !top2Ids.has(c.id)).slice(0, k - 2);
      emit([...top2, ...fillers]);

      // Also consider top1 + next distinct higher anchor + low fillers (e.g. ♥5 + BJ + low when holding only 1 ♥5)
      if (k >= 3) {
        const firstOrd = getCardOrder(desc[0], trumpSuit, levelRank);
        const secondDistinct = desc.find(
          (c) =>
            c.id !== desc[0].id &&
            getCardOrder(c, trumpSuit, levelRank) < firstOrd,
        );
        if (secondDistinct) {
          const usedIds = new Set([desc[0].id, secondDistinct.id]);
          const remFillers = asc.filter((c) => !usedIds.has(c.id)).slice(0, k - 2);
          emit([desc[0], secondDistinct, ...remFillers]);
        }
      }
    }

    return results;
  }

  // General structured sling path (PAIR / TRIPLE / TRACTOR / TRIPLE_TRACTOR / F510K + fillers)
  const extractOptions = (
    rem: readonly Card[],
    target: AtomicPattern,
    maxOpts: number,
  ): Card[][] => {
    const opts: Card[][] = [];
    const remGroupsAsc = groupCardsByKey(rem, trumpSuit, levelRank).sort(
      (a, b) => a.order - b.order,
    );

    if (target.type === 'SINGLE') {
      const remAsc = [...rem].sort(
        (a, b) =>
          getCardOrder(a, trumpSuit, levelRank) - getCardOrder(b, trumpSuit, levelRank) ||
          getCardPoints(a) - getCardPoints(b),
      );
      if (remAsc.length > 0) opts.push([remAsc[0]]);
      if (maxOpts > 1 && remAsc.length > 1) {
        opts.push([remAsc[remAsc.length - 1]]);
      }
      return opts;
    }

    if (target.type === 'PAIR' || target.type === 'TRIPLE') {
      const need = target.type === 'TRIPLE' ? 3 : 2;
      const eligible = remGroupsAsc.filter((g) => g.cards.length >= need);
      if (eligible.length === 0) return [];
      const picks =
        eligible.length <= maxOpts
          ? eligible
          : [
              eligible[0],
              eligible[Math.floor(eligible.length / 2)],
              eligible[eligible.length - 1],
            ];
      for (const g of picks) opts.push(g.cards.slice(0, need));
      return opts;
    }

    if (target.type === 'TRACTOR' || target.type === 'TRIPLE_TRACTOR') {
      const mult: 2 | 3 = target.type === 'TRIPLE_TRACTOR' ? 3 : 2;
      const chains = enumerateChainCandidates(remGroupsAsc, mult, {
        exactLength: target.length,
      });
      if (chains.length === 0) return [];
      // chains is sorted descending by topOrder -> push lowest first, then highest
      opts.push(chains[chains.length - 1].cards);
      if (maxOpts > 1 && chains.length > 1) opts.push(chains[0].cards);
      return opts;
    }

    // F510K target: match with lowest/highest triple(s) or trump 510K
    if (target.length === 1) {
      const triples = remGroupsAsc.filter((g) => g.cards.length === 3);
      if (triples.length > 0) {
        opts.push(triples[0].cards.slice(0, 3));
        if (maxOpts > 1 && triples.length > 1) {
          opts.push(triples[triples.length - 1].cards.slice(0, 3));
        }
      }
    } else {
      const chains = enumerateChainCandidates(remGroupsAsc, 3, {
        exactLength: target.length,
      });
      if (chains.length > 0) {
        opts.push(chains[chains.length - 1].cards);
        if (maxOpts > 1 && chains.length > 1) opts.push(chains[0].cards);
      }
    }
    if (trumpSuit !== null) {
      const t5 = rem.filter((c) => c.suit === trumpSuit && c.rank === '5');
      const t10 = rem.filter((c) => c.suit === trumpSuit && c.rank === '10');
      const tK = rem.filter((c) => c.suit === trumpSuit && c.rank === 'K');
      if (Math.min(t5.length, t10.length, tK.length) >= target.length) {
        const picked: Card[] = [];
        for (let i = 0; i < target.length; i++) picked.push(t5[i], t10[i], tK[i]);
        opts.push(picked);
      }
    }
    return opts;
  };

  const fillRestLowest = (
    rem: readonly Card[],
    idx: number,
  ): Card[] | null => {
    if (idx >= ordered.length) return [];
    const lowOpts = extractOptions(rem, ordered[idx], 1);
    for (const opt of lowOpts) {
      const used = new Set(opt.map((c) => c.id));
      const next = fillRestLowest(
        rem.filter((c) => !used.has(c.id)),
        idx + 1,
      );
      if (next) return [...opt, ...next];
    }
    return null;
  };

  const primaryOpts = extractOptions(pool, ordered[0], 4);
  for (const opt0 of primaryOpts) {
    const used0 = new Set(opt0.map((c) => c.id));
    const remAfter0 = pool.filter((c) => !used0.has(c.id));
    const rest = fillRestLowest(remAfter0, 1);
    if (rest) emit([...opt0, ...rest]);
  }

  // Fallback low kill if pool already aligns directly
  emit(asc.slice(0, totalNeeded));
  return results;
}

/**
 * Estimate probability that a teammate acting AFTER us will cleanly trump-kill
 * the current enemy-winning off-suit trick (so 2nd/3rd seat can feed points to them!).
 */
function estimateRearAllyRuffConfidence(
  tracker: PublicCardTracker,
  state: GameState,
  seat: Seat,
  currentBestPlay: { seat: Seat; cards: readonly Card[]; parsed: ParsedPlay },
): number {
  const leadPlay = state.currentTrick[0].parsed;
  if (leadPlay.category === 'TRUMP') return 0;
  if (currentBestPlay.parsed.category === 'TRUMP') return 0;
  if (leadPlay.patternType !== 'SINGLE' && leadPlay.patternType !== 'PAIR') return 0;

  const remainingSeats = getRemainingSeatsAfter(state, seat);
  if (remainingSeats.length === 0) return 0;

  const unseenTrumps = tracker.unseenCount('TRUMP');
  const unseenInLead = tracker.unseenCount(leadPlay.category);
  const remainingEnemies = remainingSeats.filter((s) => !isSameSide(state, seat, s));

  let bestConf = 0;
  for (let idx = 0; idx < remainingSeats.length; idx++) {
    const s = remainingSeats[idx];
    if (!isSameSide(state, seat, s)) continue;
    if (!tracker.isSeatVoid(s, leadPlay.category) || !tracker.hasPossibleTrump(s)) continue;

    // Never blindly feed if an enemy acting AFTER this void ally can over-ruff
    const enemiesAfterAlly = remainingSeats
      .slice(idx + 1)
      .filter((e) => !isSameSide(state, seat, e));
    if (
      enemiesAfterAlly.some(
        (e) => tracker.isSeatVoid(e, leadPlay.category) && tracker.hasPossibleTrump(e),
      )
    ) {
      continue;
    }

    const anyRemainingEnemyRuffRisk = remainingEnemies.some(
      (e) => tracker.isSeatVoid(e, leadPlay.category) && tracker.hasPossibleTrump(e),
    );
    if (anyRemainingEnemyRuffRisk) {
      bestConf = Math.max(bestConf, 0.22);
      continue;
    }

    if (leadPlay.patternType === 'SINGLE') {
      if (remainingEnemies.length === 0) {
        bestConf = Math.max(bestConf, unseenTrumps >= 3 ? 0.88 : 0.72);
      } else if (unseenInLead >= 3 && unseenTrumps >= 4) {
        bestConf = Math.max(bestConf, 0.78);
      } else if (unseenInLead >= 2 && unseenTrumps >= 2) {
        bestConf = Math.max(bestConf, 0.68);
      } else {
        bestConf = Math.max(bestConf, 0.45);
      }
    } else {
      // PAIR: ally needs a trump pair to ruff
      if (remainingEnemies.length === 0 && unseenTrumps >= 6) {
        bestConf = Math.max(bestConf, 0.72);
      } else if (unseenInLead >= 4 && unseenTrumps >= 8) {
        bestConf = Math.max(bestConf, 0.62);
      } else {
        bestConf = Math.max(bestConf, 0.35);
      }
    }
  }

  return bestConf;
}

interface FollowCandidate {
  cards: Card[];
  parsed: ParsedPlay;
}

function buildSmartFollowCandidatesWithParsed(
  state: GameState,
  seat: Seat,
  trackerArg?: PublicCardTracker,
): FollowCandidate[] {
  const hand = state.hands[seat];
  const { trumpSuit, levelRank } = state;
  const leadPlay = state.currentTrick[0].parsed;
  const N = leadPlay.cards.length;

  const tracker = trackerArg ?? buildPublicCardTracker(state, seat);
  const currentBest = resolveTrickWinner(
    state.currentTrick,
    trumpSuit,
    levelRank,
  );
  const currentBestPlay = state.currentTrick.find(
    (p) => p.seat === currentBest.winnerSeat,
  )!;
  const currentWinningAlly = isSameSide(state, seat, currentBest.winnerSeat);
  const rearAllyRuffConf = currentWinningAlly
    ? 0
    : estimateRearAllyRuffConfidence(tracker, state, seat, currentBestPlay);
  const allowPointFeed = currentWinningAlly || rearAllyRuffConf >= 0.62;

  const inCatHand = hand.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) === leadPlay.category,
  );
  const outCatHand = hand.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) !== leadPlay.category,
  );

  // Fast path: for 1-card SINGLE leads, every card in inCatHand (or any card when void) is
  // guaranteed legal without calling findLegalFollowCards/validateFollowPlay 15 times!
  const isSingleLead = leadPlay.patternType === 'SINGLE' && N === 1;
  if (isSingleLead && inCatHand.length === 1) {
    const only = [inCatHand[0]];
    return [{ cards: only, parsed: parsePlay(only, trumpSuit, levelRank)! }];
  }
  const base = isSingleLead
    ? []
    : findLegalFollowCards(hand, leadPlay, trumpSuit, levelRank);
  const candidates: FollowCandidate[] = [];
  const seen = new Set<string>();

  const makeSig = (cards: readonly Card[]): string => {
    if (cards.length === 1) return String(cards[0].id);
    if (cards.length === 2) {
      return cards[0].id < cards[1].id
        ? `${cards[0].id},${cards[1].id}`
        : `${cards[1].id},${cards[0].id}`;
    }
    return cards
      .map((c) => c.id)
      .sort((a, b) => a - b)
      .join(',');
  };

  const makeFallbackParsed = (cards: Card[]): ParsedPlay =>
    parsePlay(cards, trumpSuit, levelRank) ?? {
      patternType: 'SLING',
      category: leadPlay.category,
      cards,
      components: [],
    };

  const pushPrevalidated = (cards: Card[], parsed?: ParsedPlay) => {
    if (cards.length !== N) return;
    const sig = makeSig(cards);
    if (seen.has(sig)) return;
    seen.add(sig);
    candidates.push({ cards, parsed: parsed ?? makeFallbackParsed(cards) });
  };

  const pushIfValid = (cards: readonly Card[]) => {
    if (cards.length !== N) return;
    const sig = makeSig(cards);
    if (seen.has(sig)) return;
    if (isSingleLead) {
      const c = cards[0];
      const ok =
        inCatHand.length === 0 ||
        getCardCategory(c, trumpSuit, levelRank) === leadPlay.category;
      if (ok) {
        seen.add(sig);
        const copy = [c];
        candidates.push({ cards: copy, parsed: makeFallbackParsed(copy) });
      }
      return;
    }
    const ids = cards.map((c) => c.id);
    const res = validateFollowPlay(hand, ids, leadPlay, trumpSuit, levelRank);
    if (res.valid) {
      seen.add(sig);
      const copy = [...cards];
      candidates.push({ cards: copy, parsed: res.parsed ?? makeFallbackParsed(copy) });
    }
  };

  const hasTrump510KLead =
    leadPlay.category === 'TRUMP' &&
    leadPlay.components.some((comp) => comp.type === 'F510K');

  if (isSingleLead && inCatHand.length > 0) {
    // Emit every distinct in-category card (or beating ones + smart discards when enemy winning)
    const seenKey = new Set<string>();
    for (const c of inCatHand) {
      const k = getCardKey(c);
      if (seenKey.has(k)) continue;
      seenKey.add(k);
      if (allowPointFeed) {
        pushPrevalidated([c]);
      } else {
        const parsed = makeFallbackParsed([c]);
        const sim = resolveTrickWinner(
          [...state.currentTrick, { seat, cards: [c], parsed }],
          trumpSuit,
          levelRank,
        );
        if (sim.winnerSeat === seat) {
          pushPrevalidated([c], parsed);
        }
      }
    }
  } else {
    // `base` comes directly from `findLegalFollowCards` (already validated by `validateFollowPlay`!)
    for (const c of base) {
      if (allowPointFeed || hasTrump510KLead) {
        pushPrevalidated(c);
      } else {
        // When enemy is currently winning, keep all beating plays from `base`,
        // but don't blindly import max-point feeding dumps (which cause noisy PIMC blunders);
        // losing discards are constructed cleanly below by low/balanced/void-making rankers.
        const parsed = makeFallbackParsed(c);
        const sim = resolveTrickWinner(
          [...state.currentTrick, { seat, cards: c, parsed }],
          trumpSuit,
          levelRank,
        );
        if (sim.winnerSeat === seat) {
          pushPrevalidated(c, parsed);
        }
      }
    }
  }

  // Precompute per-card metrics ONCE (avoids O(N log N) repeated calls inside discard sorters!)
  const allGroups = groupCardsByKey(hand, trumpSuit, levelRank);
  const keyMult = new Map(allGroups.map((g) => [g.key, g.cards.length]));
  const offSuitLens = new Map<CardCategory, number>();
  for (const cat of ALL_CATEGORIES) offSuitLens.set(cat, 0);
  interface CardMeta {
    card: Card;
    cat: CardCategory;
    isTrump: number;
    pts: number;
    mult: number;
    cost: number;
    suitLen: number;
    red5: boolean;
  }
  const metaById = new Map<number, CardMeta>();
  for (const c of hand) {
    const cat = getCardCategory(c, trumpSuit, levelRank);
    offSuitLens.set(cat, (offSuitLens.get(cat) ?? 0) + 1);
  }
  for (const c of hand) {
    const cat = getCardCategory(c, trumpSuit, levelRank);
    metaById.set(c.id, {
      card: c,
      cat,
      isTrump: cat === 'TRUMP' ? 1 : 0,
      pts: getCardPoints(c),
      mult: keyMult.get(getCardKey(c)) ?? 1,
      cost: getCardValueCost(c, trumpSuit, levelRank),
      suitLen: offSuitLens.get(cat) ?? 99,
      red5: isRedFive(c),
    });
  }

  const sortByScore = (pool: readonly Card[], scoreFn: (m: CardMeta) => number): Card[] =>
    pool
      .map((c) => ({ c, sc: scoreFn(metaById.get(c.id)!) }))
      .sort((a, b) => a.sc - b.sc || a.c.id - b.c.id)
      .map((x) => x.c);

  const rankForLowSafeDiscard = (pool: readonly Card[]): Card[] =>
    sortByScore(
      pool,
      (m) => m.isTrump * 100000 + m.pts * 1000 + m.mult * 100 + m.cost,
    );

  const rankForVoidMakingDiscard = (pool: readonly Card[]): Card[] =>
    sortByScore(
      pool,
      (m) => m.isTrump * 100000 + m.pts * 1000 + m.suitLen * 100 + m.cost,
    );

  const rankForBalancedDiscard = (
    pool: readonly Card[],
    ptWeight: number,
    keepPairs: boolean,
  ): Card[] =>
    sortByScore(pool, (m) => {
      const struct =
        m.mult >= 3 ? 20 : keepPairs && m.mult === 2 ? (m.cost >= 16 ? 12 : 4) : 0;
      return m.isTrump * 100000 + m.pts * ptWeight + m.cost + struct;
    });

  const rankForSafePointFeed = (pool: readonly Card[]): Card[] =>
    sortByScore(pool, (m) => {
      const voidBonus = !m.isTrump && m.suitLen === 1 ? 8 : 0;
      const feedVal =
        m.pts * 10 +
        voidBonus -
        (m.red5 ? 200 : m.isTrump * 45) -
        (m.mult >= 3 ? 35 : m.mult === 2 ? 12 : 0) -
        m.cost * 0.4;
      return -feedVal;
    });

  if (inCatHand.length === 0) {
    // Void in led category: add smart discards (strict 0-pt, balanced low-loss, void-making; point feed when ally winning or rear void ally ruffs) + trump kills
    pushIfValid(rankForLowSafeDiscard(hand).slice(0, N));
    pushIfValid(rankForBalancedDiscard(hand, 2.4, true).slice(0, N));
    pushIfValid(rankForBalancedDiscard(hand, 1.5, true).slice(0, N));
    pushIfValid(rankForVoidMakingDiscard(hand).slice(0, N));
    if (allowPointFeed) {
      pushIfValid(rankForSafePointFeed(hand).slice(0, N));
    }

    if (leadPlay.category !== 'TRUMP') {
      const trumps = hand.filter(
        (c) => getCardCategory(c, trumpSuit, levelRank) === 'TRUMP',
      );
      if (trumps.length >= N) {
        const sortedAsc = [...trumps].sort(
          (a, b) =>
            getCardOrder(a, trumpSuit, levelRank) -
            getCardOrder(b, trumpSuit, levelRank),
        );
        if (leadPlay.patternType === 'SINGLE') {
          // Include every distinct trump order so bot can pick minimal winning over-kill!
          const seenOrd = new Set<number>();
          for (const t of sortedAsc) {
            const ord = getCardOrder(t, trumpSuit, levelRank);
            if (!seenOrd.has(ord)) {
              seenOrd.add(ord);
              pushIfValid([t]);
            }
          }
        } else if (leadPlay.patternType === 'PAIR' || leadPlay.patternType === 'TRIPLE') {
          const need = leadPlay.patternType === 'TRIPLE' ? 3 : 2;
          const tGroups = groupCardsByKey(sortedAsc, trumpSuit, levelRank)
            .filter((g) => g.cards.length >= need)
            .sort((a, b) => a.order - b.order);
          for (const g of tGroups) {
            pushIfValid(g.cards.slice(0, need));
          }
        } else if (
          leadPlay.patternType === 'TRACTOR' ||
          leadPlay.patternType === 'TRIPLE_TRACTOR'
        ) {
          const mult: 2 | 3 = leadPlay.patternType === 'TRIPLE_TRACTOR' ? 3 : 2;
          const tGroups = groupCardsByKey(sortedAsc, trumpSuit, levelRank);
          const chains = enumerateChainCandidates(tGroups, mult, {
            exactLength: leadPlay.components[0].length,
          });
          for (const ch of chains) {
            pushIfValid(ch.cards);
          }
        } else if (leadPlay.patternType === 'SLING') {
          // Construct minimal-waste sling trump kills (e.g. ♥5 + ♥5 + low trump instead of ♥5 + ♥5 + BJ!)
          const slingKills = enumerateSmartSlingMatches(
            trumps,
            leadPlay.components,
            trumpSuit,
            levelRank,
          );
          for (const kill of slingKills) {
            pushIfValid(kill);
          }
        }
      }
    }
  } else if (inCatHand.length < N) {
    // Forced to play all inCatHand + pick (N - inCatHand.length) extra cards
    const needExtra = N - inCatHand.length;
    pushIfValid([...inCatHand, ...rankForLowSafeDiscard(outCatHand).slice(0, needExtra)]);
    pushIfValid([...inCatHand, ...rankForBalancedDiscard(outCatHand, 2.4, true).slice(0, needExtra)]);
    pushIfValid([...inCatHand, ...rankForBalancedDiscard(outCatHand, 1.5, true).slice(0, needExtra)]);
    pushIfValid([...inCatHand, ...rankForVoidMakingDiscard(outCatHand).slice(0, needExtra)]);
    if (allowPointFeed) {
      pushIfValid([...inCatHand, ...rankForSafePointFeed(outCatHand).slice(0, needExtra)]);
    }
  } else if (inCatHand.length > N) {
    // Richer in-category follow options: include balanced low-loss discards so bot never
    // has to choose only between sacrificing high trumps (参谋/王) vs dumping 20 points!
    pushIfValid(rankForLowSafeDiscard(inCatHand).slice(0, N));
    pushIfValid(rankForBalancedDiscard(inCatHand, 2.4, true).slice(0, N));
    pushIfValid(rankForBalancedDiscard(inCatHand, 1.5, true).slice(0, N));
    if (allowPointFeed) {
      pushIfValid(rankForSafePointFeed(inCatHand).slice(0, N));
    }
    if (leadPlay.patternType === 'SLING') {
      const slingBeats = enumerateSmartSlingMatches(
        inCatHand,
        leadPlay.components,
        trumpSuit,
        levelRank,
      );
      for (const beat of slingBeats) {
        pushIfValid(beat);
      }
    }
  }

  // Fallback for special forced-rule plays (e.g. trump 510K top-trump surrender or exact inCatHand.length === N)
  if (candidates.length === 0) {
    for (const c of base) {
      pushPrevalidated(c);
    }
  }

  return candidates;
}

export function buildSmartFollowCandidates(
  state: GameState,
  seat: Seat,
  trackerArg?: PublicCardTracker,
): Card[][] {
  return buildSmartFollowCandidatesWithParsed(state, seat, trackerArg).map(
    (item) => item.cards,
  );
}

function estimateWinHoldConfidence(
  tracker: PublicCardTracker,
  state: GameState,
  seat: Seat,
  winningPlay: { seat: Seat; cards: readonly Card[]; parsed: ParsedPlay },
  remainingEnemies: readonly Seat[],
): number {
  if (remainingEnemies.length === 0) return 1.0;

  const { trumpSuit, levelRank } = state;
  const leadCat = state.currentTrick[0].parsed.category;
  const winCat = winningPlay.parsed.category;
  const remainingEnemiesHaveTrump = tracker.anySeatHasPossibleTrump(remainingEnemies);

  // If all remaining enemies are confirmed void in winCat (and cannot ruff if off-suit), this play is 100% safe!
  if (
    remainingEnemies.every((e) => tracker.isSeatVoid(e, winCat)) &&
    (winCat === 'TRUMP' || !remainingEnemiesHaveTrump)
  ) {
    return 1.0;
  }

  // If currently winning with an off-suit play and a remaining enemy is confirmed void while holding possible trumps
  if (winCat !== 'TRUMP' && remainingEnemiesHaveTrump) {
    if (
      remainingEnemies.some(
        (e) => tracker.isSeatVoid(e, leadCat) && tracker.hasPossibleTrump(e),
      )
    ) {
      return 0.18;
    }
  }

  const comps = winningPlay.parsed.components;
  if (comps.length > 0) {
    const unbeatableInOwnCat = comps.every((comp) =>
      tracker.isComponentUnbeatable(winCat, comp),
    );
    if (unbeatableInOwnCat) {
      if (winCat === 'TRUMP' || !remainingEnemiesHaveTrump) return 1.0;
      const unseenInLead = tracker.unseenCount(leadCat);
      if (unseenInLead >= remainingEnemies.length * winningPlay.cards.length * 2) {
        return 0.92;
      }
      if (unseenInLead >= remainingEnemies.length * winningPlay.cards.length) {
        return 0.78;
      }
      return 0.55;
    }
  }

  const maxUnseen = tracker.maxUnseenOrder(winCat);
  const myTop =
    comps.length > 0
      ? comps[0].topOrder
      : Math.max(...winningPlay.cards.map((c) => getCardOrder(c, trumpSuit, levelRank)));

  if (maxUnseen < 0) return 0.95;
  const gap = maxUnseen - myTop;
  let baseConf = gap <= 1 ? 0.62 : gap <= 3 ? 0.42 : 0.22;
  const pt = winningPlay.parsed.patternType;
  if (pt === 'PAIR' || pt === 'TRIPLE' || pt === 'TRACTOR' || pt === 'TRIPLE_TRACTOR') {
    baseConf += 0.14;
  }
  if (remainingEnemies.length === 1) baseConf += 0.06;
  else if (remainingEnemies.length >= 2) baseConf -= 0.05;
  return Math.max(0.12, Math.min(0.88, baseConf));
}

/** All legal follow options, best-first by heuristic score. */
export function rankFollowCandidates(state: GameState, seat: Seat): Card[][] {
  const hand = state.hands[seat];
  const { trumpSuit, levelRank } = state;
  const leadPlay = state.currentTrick[0].parsed;
  const tracker = buildPublicCardTracker(state, seat);
  const candidates = buildSmartFollowCandidatesWithParsed(state, seat, tracker);

  if (candidates.length <= 1) {
    return candidates.length === 1
      ? [candidates[0].cards]
      : [hand.slice(0, leadPlay.cards.length)];
  }

  const currentBest = resolveTrickWinner(
    state.currentTrick,
    trumpSuit,
    levelRank,
  );
  const currentBestPlay = state.currentTrick.find(
    (p) => p.seat === currentBest.winnerSeat,
  )!;
  const currentWinningAlly = isSameSide(state, seat, currentBest.winnerSeat);
  const remainingSeats = getRemainingSeatsAfter(state, seat);
  const remainingEnemies = remainingSeats.filter(
    (s) => !isSameSide(state, seat, s),
  );
  const isLastTrick = hand.length === leadPlay.cards.length;
  const isNearEndgame = hand.length <= leadPlay.cards.length + 3;
  const knownBottomPts =
    state.dealer === seat
      ? state.bottomCards.reduce((sum, c) => sum + getCardPoints(c), 0)
      : null;

  const allyHoldConfidence = currentWinningAlly
    ? estimateWinHoldConfidence(
        tracker,
        state,
        seat,
        currentBestPlay,
        remainingEnemies,
      )
    : 0;
  const rearAllyRuffConf = currentWinningAlly
    ? 0
    : estimateRearAllyRuffConfidence(tracker, state, seat, currentBestPlay);

  // Precompute hand structure for breakage penalties and void-creation bonuses
  const allGroups = groupCardsByKey(hand, trumpSuit, levelRank);
  const keyMult = new Map(allGroups.map((g) => [g.key, g.cards.length]));
  const catCounts = new Map<CardCategory, number>();
  for (const cat of ALL_CATEGORIES) catCounts.set(cat, 0);
  for (const c of hand) {
    const cat = getCardCategory(c, trumpSuit, levelRank);
    catCounts.set(cat, (catCounts.get(cat) ?? 0) + 1);
  }

  const f510kIds = new Set<number>();
  for (const s of STANDARD_SUITS) {
    const c5 = hand.filter((c) => c.suit === s && c.rank === '5');
    const c10 = hand.filter((c) => c.suit === s && c.rank === '10');
    const cK = hand.filter((c) => c.suit === s && c.rank === 'K');
    const m = Math.min(c5.length, c10.length, cK.length);
    for (let i = 0; i < m; i++) {
      f510kIds.add(c5[i].id);
      f510kIds.add(c10[i].id);
      f510kIds.add(cK[i].id);
    }
  }

  const scoredCands: { cards: Card[]; score: number }[] = [];

  for (const { cards, parsed } of candidates) {
    const simulatedTrick = [...state.currentTrick, { seat, cards, parsed }];
    const simResult = resolveTrickWinner(simulatedTrick, trumpSuit, levelRank);
    const iWin = simResult.winnerSeat === seat;
    const mySideWins = isSameSide(state, seat, simResult.winnerSeat);
    const candPts = cards.reduce((s, c) => s + getCardPoints(c), 0);
    const trickPts = currentBest.pointsInTrick + candPts;

    // Card expenditure & structure cost
    let cardCost = 0;
    const playedByKey = new Map<string, number>();
    const playedByCat = new Map<CardCategory, number>();
    for (const c of cards) {
      cardCost += getCardValueCost(c, trumpSuit, levelRank);
      const k = getCardKey(c);
      playedByKey.set(k, (playedByKey.get(k) ?? 0) + 1);
      const cat = getCardCategory(c, trumpSuit, levelRank);
      playedByCat.set(cat, (playedByCat.get(cat) ?? 0) + 1);
    }

    // Penalize splitting a pair/triple/510K unnecessarily
    for (const [k, cnt] of playedByKey) {
      const total = keyMult.get(k) ?? 1;
      if (total === 3 && cnt < 3) cardCost += 22;
      else if (total === 2 && cnt < 2) cardCost += 10;
    }
    if (parsed.patternType !== 'F510K') {
      let broken510k = 0;
      for (const c of cards) {
        if (f510kIds.has(c.id)) broken510k += 1;
      }
      if (broken510k > 0 && broken510k < 3) {
        cardCost += 16;
      }
    }

    // Void-creation bonus when discarding off-suit non-point cards
    let voidBonus = 0;
    for (const [cat, cnt] of playedByCat) {
      if (
        cat !== 'TRUMP' &&
        cat !== leadPlay.category &&
        cnt === (catCounts.get(cat) ?? 0) &&
        cnt > 0
      ) {
        voidBonus += 9;
      }
    }

    const myWinHold = iWin
      ? estimateWinHoldConfidence(
          tracker,
          state,
          seat,
          { seat, cards, parsed },
          remainingEnemies,
        )
      : 0;

    // Unified game-theoretic expected-value follow scoring (aligned with PIMC's ~5.6 point-to-cost ratio):
    // For any outcome with team win probability p in [0, 1], expected net swing is (2p - 1) * (trickPts * W + L + bottom) - cardCost.
    // This seamlessly handles last-seat feeding (p=1), enemy dodging (p=0), 3rd-hand-high teammate protection (q vs p),
    // never overtaking a secure teammate (q≈p saves cardCost), and 2nd/3rd-seat feeding to a void rear teammate!
    const bottomBonus = isLastTrick ? 110 : isNearEndgame ? 14 : 0;
    const trickPot = trickPts * 2.75 + 11 + bottomBonus;

    let winProb: number;
    if (iWin) {
      winProb = myWinHold;
    } else if (currentWinningAlly) {
      winProb = allyHoldConfidence;
    } else if (rearAllyRuffConf >= 0.65) {
      // Conservative effective ruff-hold probability (accounts for ally possibly holding only huge trumps)
      winProb = rearAllyRuffConf * 0.88;
    } else {
      winProb = 0;
    }

    let score = (2 * winProb - 1) * trickPot + voidBonus - cardCost;

    // Slight tie-break against unnecessarily overtaking a teammate who is already very likely to hold
    if (currentWinningAlly && iWin && allyHoldConfidence >= 0.8) {
      score -= 18;
    }
    // Avoid burning huge trumps (♥5 / BJ / SJ) on a 0-point early trick
    if (iWin && trickPts === 0 && !isLastTrick && !isNearEndgame && cardCost >= 32) {
      score -= 22;
    }

    scoredCands.push({ cards, score });
  }

  scoredCands.sort((a, b) => b.score - a.score);
  return scoredCands.map((c) => c.cards);
}

function chooseFollowCards(state: GameState, seat: Seat): number[] {
  return rankFollowCandidates(state, seat)[0].map((c) => c.id);
}

/** Fast pure-heuristic card play (used as the rollout policy by the search bot). */
export function chooseHeuristicPlayCards(state: GameState, seat: Seat): number[] {
  return state.currentTrick.length === 0
    ? chooseLeadCards(state, seat)
    : chooseFollowCards(state, seat);
}

/** Deterministic public-info hash in [0, 1) so lower-tier bots stay fair and reproducible. */
function publicStateRoll(state: GameState, seat: Seat, salt: number): number {
  let h =
    2166136261 ^
    (state.roundNumber * 131 + seat * 37 + state.completedTricks.length * 19 + salt * 97);
  const hand = state.hands[seat];
  for (let i = 0; i < hand.length; i++) {
    h = Math.imul(h ^ hand[i].id, 16777619);
  }
  for (let i = 0; i < state.currentTrick.length; i++) {
    const cards = state.currentTrick[i].cards;
    for (let j = 0; j < cards.length; j++) {
      h = Math.imul(h ^ (cards[j].id + 521), 16777619);
    }
  }
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Medium-tier ("中") card play: fast heuristic without Monte Carlo lookahead,
 * plus light human-like suboptimality on non-trivial decisions.
 */
function chooseMediumPlayCards(state: GameState, seat: Seat): number[] {
  const isLead = state.currentTrick.length === 0;
  const ranked = isLead ? rankLeadCandidates(state, seat) : rankFollowCandidates(state, seat);
  if (ranked.length <= 1) return ranked[0].map((c) => c.id);

  const roll = publicStateRoll(state, seat, 11);
  if (isLead) {
    if (ranked.length >= 3 && roll < 0.14) return ranked[2].map((c) => c.id);
    if (ranked.length >= 2 && roll < 0.36) return ranked[1].map((c) => c.id);
    return ranked[0].map((c) => c.id);
  }

  // Follow: avoid obvious catastrophic blunders on last trick, otherwise occasionally play #2 option
  const isLastTrick = state.hands[seat].length === state.currentTrick[0].cards.length;
  if (!isLastTrick && ranked.length >= 2 && roll < 0.28) {
    return ranked[1].map((c) => c.id);
  }
  return ranked[0].map((c) => c.id);
}

/**
 * Low-tier ("低") beginner bury: keeps trumps and Aces, buries lowest non-trump cards
 * without void engineering or pair/triple/510K preservation (respects heixin no-bury-10).
 */
function chooseLowBuryAction(state: GameState, seat: Seat): GameAction {
  const hand = state.hands[seat];
  const { trumpSuit, levelRank, mode } = state;
  const pool = mode === 'heixin' ? hand.filter((c) => c.rank !== '10') : hand;
  const scored = pool.map((card) => {
    const cat = getCardCategory(card, trumpSuit, levelRank);
    const ord = getCardOrder(card, trumpSuit, levelRank);
    const pts = getCardPoints(card);
    let keep = ord * 2;
    if (cat === 'TRUMP') keep += 200 + ord * 3;
    else if (card.rank === 'A') keep += 80;
    else if (pts > 0) keep += 35 + pts * 3;
    return { card, keep };
  });
  scored.sort((a, b) => a.keep - b.keep || a.card.id - b.card.id);
  return {
    type: 'BURY_BOTTOM',
    seat,
    cardIds: scored.slice(0, 10).map((x) => x.card.id),
  };
}

/**
 * Low-tier ("低") beginner card play: no search, no card-counting/void tracking,
 * no advanced teammate tactics; plays simple legal combos with casual instincts.
 */
function chooseLowPlayCards(state: GameState, seat: Seat): number[] {
  const hand = state.hands[seat];
  const { trumpSuit, levelRank } = state;

  if (state.currentTrick.length === 0) {
    // Simple beginner leads: single cards, pairs, or triples from own hand (no slings / tractors / void tracking)
    const groups = groupCardsByKey(hand, trumpSuit, levelRank);
    const leads: { cards: Card[]; score: number }[] = [];
    for (const g of groups) {
      const cat = getCardCategory(g.cards[0], trumpSuit, levelRank);
      const isT = cat === 'TRUMP';
      const pts = g.cards.reduce((s, c) => s + getCardPoints(c), 0);
      if (g.cards.length >= 2) {
        leads.push({
          cards: g.cards,
          score: (isT ? 24 : 38) + g.order * 0.75 + (g.cards.length === 3 ? 14 : 0),
        });
      } else {
        const card = g.cards[0];
        let sc = isT ? 16 - g.order * 0.35 : 32 - g.order * 0.25 - pts * 0.6;
        if (card.rank === 'A' && !isT) sc += 14;
        if (isRedFive(card) && hand.length > 5) sc -= 40;
        leads.push({ cards: [card], score: sc });
      }
    }
    leads.sort((a, b) => b.score - a.score);
    const topK = Math.min(leads.length, 3);
    const pickIdx = Math.floor(publicStateRoll(state, seat, 23) * topK);
    return (leads[pickIdx]?.cards ?? [hand[0]]).map((c) => c.id);
  }

  // Beginner follow: legal plays with natural casual instincts (minimal card counting, occasional slips)
  const leadPlay = state.currentTrick[0].parsed;
  const legal = findLegalFollowCards(hand, leadPlay, trumpSuit, levelRank);
  if (legal.length <= 1) {
    return (legal[0] ?? hand.slice(0, leadPlay.cards.length)).map((c) => c.id);
  }

  const currentBest = resolveTrickWinner(state.currentTrick, trumpSuit, levelRank);
  const allyWinning = isSameSide(state, seat, currentBest.winnerSeat);
  const roll = publicStateRoll(state, seat, 31);

  const beating: Card[][] = [];
  const nonBeating: Card[][] = [];
  for (const cand of legal) {
    const parsed = parsePlay(cand, trumpSuit, levelRank) ?? {
      patternType: 'SLING' as const,
      category: leadPlay.category,
      cards: cand,
      components: [],
    };
    const sim = resolveTrickWinner(
      [...state.currentTrick, { seat, cards: cand, parsed }],
      trumpSuit,
      levelRank,
    );
    if (sim.winnerSeat === seat) beating.push(cand);
    else nonBeating.push(cand);
  }

  const ptsOf = (cards: readonly Card[]) =>
    cards.reduce((s, c) => s + getCardPoints(c), 0);
  const costOf = (cards: readonly Card[]) =>
    cards.reduce((s, c) => s + getCardValueCost(c, trumpSuit, levelRank), 0);
  const hasRed5 = (cards: readonly Card[]) => cards.some((c) => isRedFive(c));

  if (allyWinning) {
    // Beginner feeds points to winning teammate ~68% of the time (avoids throwing ♥5), else plays low safe card
    const pool = nonBeating.length > 0 ? nonBeating : legal;
    if (roll < 0.68) {
      const byFeed = [...pool].sort(
        (a, b) =>
          (hasRed5(a) ? 1 : 0) - (hasRed5(b) ? 1 : 0) ||
          ptsOf(b) - ptsOf(a) ||
          costOf(a) - costOf(b),
      );
      return byFeed[0].map((c) => c.id);
    }
    const byCheap = [...pool].sort((a, b) => costOf(a) - costOf(b));
    const idx = Math.floor(publicStateRoll(state, seat, 37) * Math.min(byCheap.length, 3));
    return byCheap[idx].map((c) => c.id);
  }

  // Enemy winning: contest point tricks ~72% of the time using one of the cheaper winning plays
  if (beating.length > 0 && (currentBest.pointsInTrick >= 10 ? roll < 0.72 : roll < 0.30)) {
    const byCheapBeat = [...beating].sort((a, b) => costOf(a) - costOf(b));
    const topK = Math.min(byCheapBeat.length, 2);
    const idx = Math.floor(publicStateRoll(state, seat, 41) * topK);
    // Avoid burning ♥5 on a tiny 0-point early trick even for beginner bots
    if (
      currentBest.pointsInTrick === 0 &&
      hand.length > leadPlay.cards.length * 2 &&
      hasRed5(byCheapBeat[idx])
    ) {
      const alt = nonBeating.length > 0 ? nonBeating : legal;
      const byLow = [...alt].sort((a, b) => ptsOf(a) - ptsOf(b) || costOf(a) - costOf(b));
      return byLow[0].map((c) => c.id);
    }
    return byCheapBeat[idx].map((c) => c.id);
  }

  // Losing: dodge points ~72% of the time, with occasional casual beginner point-slips (~28%)
  const losePool = nonBeating.length > 0 ? nonBeating : legal;
  if (roll < 0.72) {
    const byLow = [...losePool].sort((a, b) => ptsOf(a) - ptsOf(b) || costOf(a) - costOf(b));
    const topK = Math.min(byLow.length, 2);
    const idx = Math.floor(publicStateRoll(state, seat, 43) * topK);
    return byLow[idx].map((c) => c.id);
  }
  const byCost = [...losePool].sort((a, b) => costOf(a) - costOf(b));
  const idx = Math.floor(publicStateRoll(state, seat, 47) * Math.min(byCost.length, 4));
  return byCost[idx].map((c) => c.id);
}

export function chooseBotAction(
  state: GameState,
  seat: Seat,
  difficulty: BotDifficulty = 'high',
): GameAction {
  switch (state.phase) {
    case 'DEALING':
      return { type: 'DEAL_STEP' };
    case 'BIDDING': {
      if (difficulty === 'low') {
        const act = chooseBidAction(state, seat);
        if (act.type === 'BID_SCORE' && publicStateRoll(state, seat, 5) < 0.35) {
          return { type: 'PASS_BID', seat };
        }
        return act;
      }
      return chooseBidAction(state, seat);
    }
    case 'CHOOSE_TRUMP':
      return chooseTrumpSuitAction(state, seat);
    case 'CALLING':
      return chooseCallingAction(state, seat);
    case 'COUNTER_BIDDING': {
      if (difficulty === 'low' && publicStateRoll(state, seat, 7) < 0.65) {
        return { type: 'PASS_COUNTER', seat };
      }
      return chooseCounterAction(state, seat);
    }
    case 'COUNTER_RESPONSE':
      return chooseCounterResponseAction(state, seat);
    case 'BURYING':
      return difficulty === 'low' ? chooseLowBuryAction(state, seat) : chooseBuryAction(state, seat);
    case 'PLAYING': {
      const cardIds =
        difficulty === 'low'
          ? chooseLowPlayCards(state, seat)
          : difficulty === 'medium'
            ? chooseMediumPlayCards(state, seat)
            : searchPlayCards(state, seat);
      return {
        type: 'PLAY_CARDS',
        seat,
        cardIds,
      };
    }
    case 'ROUND_OVER':
      return { type: 'NEXT_ROUND' };
    case 'MATCH_OVER':
      throw new Error('Match is already over');
  }
}

export function getSuggestedHintCards(state: GameState, seat: Seat): number[] {
  if (state.phase === 'BURYING' && state.dealer === seat) {
    const act = chooseBuryAction(state, seat);
    return act.type === 'BURY_BOTTOM' ? act.cardIds : [];
  }
  if (state.phase === 'PLAYING' && state.currentTurn === seat) {
    return searchPlayCards(state, seat);
  }
  return [];
}
