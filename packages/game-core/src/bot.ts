import type {
  AtomicPattern,
  Card,
  CardCategory,
  GameAction,
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

export interface PublicCardTracker {
  unseenByCat: Map<CardCategory, Card[]>;
  voidSeatsByCat: Map<CardCategory, Set<Seat>>;
  unseenCount: (cat: CardCategory) => number;
  maxUnseenOrder: (cat: CardCategory) => number;
  isComponentUnbeatable: (cat: CardCategory, comp: AtomicPattern) => boolean;
  isSeatVoid: (seat: Seat, cat: CardCategory) => boolean;
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
export function buildPublicCardTracker(state: GameState, seat: Seat): PublicCardTracker {
  const { trumpSuit, levelRank } = state;
  const knownIds = new Set<number>();

  for (const c of state.hands[seat]) {
    knownIds.add(c.id);
  }
  if (state.dealer === seat && state.phase === 'PLAYING') {
    for (const c of state.bottomCards) {
      knownIds.add(c.id);
    }
  }

  const voidSeatsByCat = new Map<CardCategory, Set<Seat>>();
  for (const cat of ALL_CATEGORIES) {
    voidSeatsByCat.set(cat, new Set<Seat>());
  }

  const inspectTrick = (
    plays: ReadonlyArray<{ seat: Seat; cards: readonly Card[]; parsed: ParsedPlay }>,
  ) => {
    if (plays.length === 0) return;
    const leadPlay = plays[0];
    const leadCat = leadPlay.parsed.category;
    const leadCount = leadPlay.cards.length;
    const lead510KUnits = leadPlay.parsed.components
      .filter((c) => c.type === 'F510K')
      .reduce((sum, c) => sum + c.length, 0);

    for (let i = 0; i < plays.length; i++) {
      const p = plays[i];
      for (const c of p.cards) {
        knownIds.add(c.id);
      }
      if (i === 0) continue;

      const inCatCount = p.cards.filter(
        (c) => getCardCategory(c, trumpSuit, levelRank) === leadCat,
      ).length;
      if (inCatCount < leadCount) {
        // Account for off-suit borrowed 510K (e.g. ♥5 or level 10/K played as part of off-suit 510K)
        if (leadCat !== 'TRUMP' && lead510KUnits > 0) {
          const samePhysicalSuitCount = p.cards.filter((c) => c.suit === leadCat).length;
          if (samePhysicalSuitCount < leadCount) {
            voidSeatsByCat.get(leadCat)!.add(p.seat);
          }
        } else {
          voidSeatsByCat.get(leadCat)!.add(p.seat);
        }
      }
    }
  };

  for (const trick of state.completedTricks) {
    inspectTrick(trick.plays);
  }
  inspectTrick(state.currentTrick);

  const unseenByCat = new Map<CardCategory, Card[]>();
  for (const cat of ALL_CATEGORIES) {
    unseenByCat.set(cat, []);
  }

  for (const card of createThreeDecks()) {
    if (knownIds.has(card.id)) continue;
    const cat = getCardCategory(card, trumpSuit, levelRank);
    unseenByCat.get(cat)!.push(card);
  }

  const maxOrderByCat = new Map<CardCategory, number>();
  for (const cat of ALL_CATEGORIES) {
    const list = unseenByCat.get(cat)!;
    let best = -1;
    for (const c of list) {
      const ord = getCardOrder(c, trumpSuit, levelRank);
      if (ord > best) best = ord;
    }
    maxOrderByCat.set(cat, best);
  }

  return {
    unseenByCat,
    voidSeatsByCat,
    unseenCount: (cat) => unseenByCat.get(cat)?.length ?? 0,
    maxUnseenOrder: (cat) => maxOrderByCat.get(cat) ?? -1,
    isComponentUnbeatable: (cat, comp) => {
      const unseen = unseenByCat.get(cat) ?? [];
      if (unseen.length === 0) return true;
      return !canHandBeatComponent(unseen, cat, comp, trumpSuit, levelRank);
    },
    isSeatVoid: (targetSeat, cat) =>
      voidSeatsByCat.get(cat)?.has(targetSeat) ?? false,
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
): GameAction | null {
  if (
    state.mode !== 'hongxin' ||
    state.phase !== 'DEALING' ||
    state.callState.callerSeat !== null ||
    state.dealtCount < 24
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
  if (state.dealtCount < 31) return null;
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
  if (bestSuit && bestScore >= 115) {
    return {
      type: 'CALL_TRUMP',
      seat,
      suit: bestSuit,
      cardIds: [levelCardsBySuit.get(bestSuit)![0].id],
    };
  }
  return null;
}

function chooseBuryAction(state: GameState, seat: Seat): GameAction {
  const hand = state.hands[seat];
  const { trumpSuit, levelRank, mode } = state;
  const buryPool = mode === 'heixin' ? hand.filter((c) => c.rank !== '10') : hand;

  const trumps = hand.filter((c) => getCardCategory(c, trumpSuit, levelRank) === 'TRUMP');
  const highTrumps = trumps.filter((c) => {
    if (isRedFive(c) || c.suit === 'J' || c.rank === levelRank) return true;
    return trumpSuit !== null && c.rank === '3';
  });
  const strongTrumpControl = trumps.length >= 18 && highTrumps.length >= 5;

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

  // Identify short off-suits that can be cleanly voided!
  const voidTargetSuits = new Set<StandardSuit>();
  const offSuitsSorted = STANDARD_SUITS.filter((s) => s !== trumpSuit)
    .map((s) => {
      const cards = suitCards.get(s)!;
      const eligibleCards = cards.filter((c) => mode !== 'heixin' || c.rank !== '10');
      const canFullyVoid = eligibleCards.length === cards.length && cards.length > 0;
      const aces = cards.filter((c) => c.rank === 'A').length;
      const hasTriple = groupCardsByKey(cards, trumpSuit, levelRank).some(
        (g) => g.cards.length === 3,
      );
      const pts = cards.reduce((sum, c) => sum + getCardPoints(c), 0);
      return { suit: s, len: cards.length, canFullyVoid, aces, hasTriple, pts };
    })
    .filter((info) => info.canFullyVoid && info.len <= 6 && !info.hasTriple)
    .sort((a, b) => a.len + a.aces * 2.5 - (b.len + b.aces * 2.5));

  let voidBudget = 10;
  for (const info of offSuitsSorted) {
    if (info.len <= voidBudget && info.aces <= 1) {
      // Avoid burying 30+ points in a void suit if trump control is weak
      if (!strongTrumpControl && info.pts >= 25 && info.len >= 3) continue;
      voidTargetSuits.add(info.suit);
      voidBudget -= info.len;
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
      keepScore += 220 + getCardValueCost(card, trumpSuit, levelRank) * 4;
    } else {
      const len = suitCards.get(cat)?.length ?? 0;
      const isVoidTarget = voidTargetSuits.has(cat);

      if (isVoidTarget) {
        // Strongly encourage clearing the entire short suit to create a trump-kill void
        keepScore = -45 + order * 1.1 + (card.rank === 'A' ? 28 : 0);
        if (pts > 0) {
          keepScore += strongTrumpControl ? -6 : 16;
        }
      } else {
        keepScore = order * 2.8 + len * 2.4;
        if (card.rank === 'A') keepScore += 58;
        if (mult === 3) keepScore += 55;
        else if (mult === 2) keepScore += 22;
        if (protectedIds.has(card.id)) keepScore += 28;
        if (pts > 0) {
          // Burying 10/K/5 is risky if bottom might get killed; safe only with very strong trumps
          keepScore += strongTrumpControl ? 4 : 26 + pts * 0.8;
        }
      }
    }

    return { card, keepScore };
  });

  scored.sort((a, b) => a.keepScore - b.keepScore || a.card.id - b.card.id);
  return {
    type: 'BURY_BOTTOM',
    seat,
    cardIds: scored.slice(0, 10).map((s) => s.card.id),
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
  const unseenTrumps = tracker.unseenCount('TRUMP');

  const myTrumps = hand.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) === 'TRUMP',
  );
  const myHighTrumps = myTrumps.filter((c) => {
    if (isRedFive(c) || c.suit === 'J' || c.rank === levelRank) return true;
    return trumpSuit !== null && c.rank === '3';
  });
  const wantPullTrump =
    unseenTrumps > 0 &&
    ((isBankerSide && myTrumps.length >= 8 && myHighTrumps.length >= 3) ||
      (myTrumps.length >= 11 && myHighTrumps.length >= 4) ||
      (hand.length <= 6 && myHighTrumps.length >= 2));

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
      const enemyVoid = hasAnyVoidSeat(tracker, enemies, cat);
      const unseenInCat = tracker.unseenCount(cat);

      if (cat === 'TRUMP') {
        // Trump 510K forces enemies without trump triple/510K to surrender their 3 BIGGEST trumps!
        let prio = 88 + count510k * 16;
        if (safe510k) prio += 26;
        if (wantPullTrump) prio += 18;
        if (unseenTrumps < 6) prio -= 14;
        addCandidate(fCards, prio);
      } else {
        // Side-suit 510K carries 25*k points! Only lead aggressively when safe or unlikely to get killed
        let prio = 38 + count510k * 18;
        if (safe510k) prio += 36;
        if (enemyVoid && unseenTrumps > 0) prio -= 55;
        else if (unseenInCat <= 8 && unseenTrumps > 0) prio -= 18;
        else if (unseenInCat >= 14 && count510k === 1 && !safe510k) prio -= 10;
        if (unseenTrumps === 0 && safe510k) prio += 30;
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
    const enemyVoid = !isTrumpCat && hasAnyVoidSeat(tracker, enemies, cat);
    const allyVoid = !isTrumpCat && hasAnyVoidSeat(tracker, allies, cat);
    const unseenInCat = tracker.unseenCount(cat);

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
        ? (wantPullTrump ? 128 : 88) + ch.topOrder
        : 105 + ch.topOrder;
      if (safe) prio += 20;
      if (enemyVoid && unseenTrumps > 0) prio -= 48;
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
        ? (wantPullTrump ? 112 : 74) + ch.topOrder
        : 84 + ch.topOrder;
      if (safe) prio += 22;
      if (enemyVoid && unseenTrumps > 0) prio -= 44;
      else if (!isTrumpCat && unseenInCat < 6 && unseenTrumps > 0) prio -= 18;
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
          ? (wantPullTrump ? 104 : 62) + g.order
          : (safe ? 96 : 48) + g.order;
        if (enemyVoid && unseenTrumps > 0) prio -= 45 + pts;
        else if (!isTrumpCat && unseenInCat < 5 && unseenTrumps > 0) prio -= 16;
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
          ? (wantPullTrump && safe ? 94 : safe ? 68 : 34) + g.order
          : (safe ? 86 : 26) + g.order - (safe ? 0 : pts * 1.4);
        if (enemyVoid && unseenTrumps > 0) prio -= 38 + pts;
        else if (!isTrumpCat && unseenInCat < 4 && unseenTrumps > 0) prio -= 14;
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
            prio = (wantPullTrump ? 92 : 66) + g.order;
            // Don't trivially waste lone ♥5 on early lead unless pulling trumps or endgame
            if (isRedFive(card) && !wantPullTrump && hand.length > 8) {
              prio -= 26;
            }
          } else {
            prio = 82 + g.order;
            if (enemyVoid && unseenTrumps > 0) prio -= 42 + pts * 1.5;
            else if (unseenInCat <= 2 && unseenTrumps > 0) prio -= 20;
            // Prefer cashing top Aces/Kings when unseen cards still exist in suit
            if (unseenInCat >= 4 && !enemyVoid) prio += 12;
          }
          if (!usedSafeIds.has(card.id)) {
            safeComponents.push(comp);
            usedSafeIds.add(card.id);
          }
        } else {
          // Non-top exploratory lead: prefer low non-point off-suit card; never break combos or donate points!
          if (isTrumpCat) {
            prio = (wantPullTrump ? 24 : 4) - g.order * 0.6 - pts * 2.5;
          } else {
            prio = 32 - g.order * 1.1 - pts * 3.2;
            if (allyVoid && !enemyVoid && unseenTrumps > 0) {
              // Feed teammate's void suit so teammate can trump-kill!
              prio += 26;
            }
            if (enemyVoid && unseenTrumps > 0) {
              prio -= 18 + pts * 2;
            }
          }
          if (inCombo) prio -= 24;
        }

        addCandidate([card], prio);
      }
    }

    // Build a safe multi-card sling if we have >= 2 strictly unbeatable components!
    if (safeComponents.length >= 2 && (!enemyVoid || unseenTrumps === 0)) {
      const slingCards = safeComponents.flatMap((c) => c.cards);
      const parsedSling = parsePlay(slingCards, trumpSuit, levelRank);
      if (
        parsedSling &&
        parsedSling.components.every((comp) =>
          tracker.isComponentUnbeatable(cat, comp),
        )
      ) {
        let slingPrio = isTrumpCat
          ? (wantPullTrump ? 132 : 95) + slingCards.length * 4
          : 110 + slingCards.length * 4;
        if (!isTrumpCat && unseenInCat < slingCards.length && unseenTrumps > 0) {
          slingPrio -= 30;
        }
        if (slingCards.length === hand.length) {
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

export function buildSmartFollowCandidates(
  state: GameState,
  seat: Seat,
): Card[][] {
  const hand = state.hands[seat];
  const { trumpSuit, levelRank } = state;
  const leadPlay = state.currentTrick[0].parsed;
  const N = leadPlay.cards.length;

  const base = findLegalFollowCards(hand, leadPlay, trumpSuit, levelRank);
  const candidates: Card[][] = [];
  const seen = new Set<string>();

  const pushIfValid = (cards: readonly Card[]) => {
    if (cards.length !== N) return;
    const ids = cards.map((c) => c.id);
    const sig = [...ids].sort((a, b) => a - b).join(',');
    if (seen.has(sig)) return;
    const res = validateFollowPlay(hand, ids, leadPlay, trumpSuit, levelRank);
    if (res.valid) {
      seen.add(sig);
      candidates.push([...cards]);
    }
  };

  for (const c of base) {
    pushIfValid(c);
  }

  const inCatHand = hand.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) === leadPlay.category,
  );
  const outCatHand = hand.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) !== leadPlay.category,
  );

  // Compute multiplicity map to preserve pairs/triples/tractors when discarding or feeding
  const allGroups = groupCardsByKey(hand, trumpSuit, levelRank);
  const keyMult = new Map(allGroups.map((g) => [g.key, g.cards.length]));
  const offSuitLens = new Map<CardCategory, number>();
  for (const cat of ALL_CATEGORIES) offSuitLens.set(cat, 0);
  for (const c of hand) {
    const cat = getCardCategory(c, trumpSuit, levelRank);
    offSuitLens.set(cat, (offSuitLens.get(cat) ?? 0) + 1);
  }

  const rankForLowSafeDiscard = (pool: readonly Card[]): Card[] =>
    [...pool].sort((a, b) => {
      const aT = getCardCategory(a, trumpSuit, levelRank) === 'TRUMP' ? 1 : 0;
      const bT = getCardCategory(b, trumpSuit, levelRank) === 'TRUMP' ? 1 : 0;
      if (aT !== bT) return aT - bT;
      const ptsDiff = getCardPoints(a) - getCardPoints(b);
      if (ptsDiff !== 0) return ptsDiff;
      const mA = keyMult.get(getCardKey(a)) ?? 1;
      const mB = keyMult.get(getCardKey(b)) ?? 1;
      if (mA !== mB) return mA - mB;
      const costDiff =
        getCardValueCost(a, trumpSuit, levelRank) -
        getCardValueCost(b, trumpSuit, levelRank);
      if (costDiff !== 0) return costDiff;
      return a.id - b.id;
    });

  const rankForVoidMakingDiscard = (pool: readonly Card[]): Card[] =>
    [...pool].sort((a, b) => {
      const catA = getCardCategory(a, trumpSuit, levelRank);
      const catB = getCardCategory(b, trumpSuit, levelRank);
      const aT = catA === 'TRUMP' ? 1 : 0;
      const bT = catB === 'TRUMP' ? 1 : 0;
      if (aT !== bT) return aT - bT;
      const ptsDiff = getCardPoints(a) - getCardPoints(b);
      if (ptsDiff !== 0) return ptsDiff;
      const lenA = offSuitLens.get(catA) ?? 99;
      const lenB = offSuitLens.get(catB) ?? 99;
      if (lenA !== lenB) return lenA - lenB;
      return (
        getCardValueCost(a, trumpSuit, levelRank) -
        getCardValueCost(b, trumpSuit, levelRank)
      );
    });

  const rankForSafePointFeed = (pool: readonly Card[]): Card[] =>
    [...pool].sort((a, b) => {
      const aT = getCardCategory(a, trumpSuit, levelRank) === 'TRUMP' ? 1 : 0;
      const bT = getCardCategory(b, trumpSuit, levelRank) === 'TRUMP' ? 1 : 0;
      // Prefer feeding off-suit points before spending trump points (especially ♥5!)
      const aFeedVal =
        getCardPoints(a) * 10 -
        (isRedFive(a) ? 200 : aT * 45) -
        ((keyMult.get(getCardKey(a)) ?? 1) >= 3 ? 35 : 0) -
        getCardValueCost(a, trumpSuit, levelRank) * 0.4;
      const bFeedVal =
        getCardPoints(b) * 10 -
        (isRedFive(b) ? 200 : bT * 45) -
        ((keyMult.get(getCardKey(b)) ?? 1) >= 3 ? 35 : 0) -
        getCardValueCost(b, trumpSuit, levelRank) * 0.4;
      if (bFeedVal !== aFeedVal) return bFeedVal - aFeedVal;
      return a.id - b.id;
    });

  if (inCatHand.length === 0) {
    // Void in led category: add smart discards + all distinct trump kill strengths
    pushIfValid(rankForLowSafeDiscard(hand).slice(0, N));
    pushIfValid(rankForVoidMakingDiscard(hand).slice(0, N));
    pushIfValid(rankForSafePointFeed(hand).slice(0, N));

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
          // Try constructing minimal & maximal trump kills for multi-card slings!
          const lowKill = canMatchSlingStructure(
            sortedAsc.slice(0, N),
            leadPlay.components,
            trumpSuit,
            levelRank,
          );
          if (lowKill.matched) pushIfValid(sortedAsc.slice(0, N));
          const sortedDesc = [...sortedAsc].reverse();
          const highKill = canMatchSlingStructure(
            sortedDesc.slice(0, N),
            leadPlay.components,
            trumpSuit,
            levelRank,
          );
          if (highKill.matched) pushIfValid(sortedDesc.slice(0, N));
        }
      }
    }
  } else if (inCatHand.length < N) {
    // Forced to play all inCatHand + pick (N - inCatHand.length) extra cards
    const needExtra = N - inCatHand.length;
    pushIfValid([...inCatHand, ...rankForLowSafeDiscard(outCatHand).slice(0, needExtra)]);
    pushIfValid([...inCatHand, ...rankForVoidMakingDiscard(outCatHand).slice(0, needExtra)]);
    pushIfValid([...inCatHand, ...rankForSafePointFeed(outCatHand).slice(0, needExtra)]);
  } else if (inCatHand.length > N) {
    // Richer in-category follow options
    pushIfValid(rankForLowSafeDiscard(inCatHand).slice(0, N));
    pushIfValid(rankForSafePointFeed(inCatHand).slice(0, N));
  }

  return candidates;
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
  const unseenTrumps = tracker.unseenCount('TRUMP');

  // If currently winning with an off-suit play and a remaining enemy is confirmed void while trumps remain
  if (winCat !== 'TRUMP' && unseenTrumps > 0) {
    if (hasAnyVoidSeat(tracker, remainingEnemies, leadCat)) {
      return 0.18;
    }
  }

  const comps = winningPlay.parsed.components;
  if (comps.length > 0) {
    const unbeatableInOwnCat = comps.every((comp) =>
      tracker.isComponentUnbeatable(winCat, comp),
    );
    if (unbeatableInOwnCat) {
      if (winCat === 'TRUMP' || unseenTrumps === 0) return 1.0;
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
  if (gap <= 1) return 0.62;
  if (gap <= 3) return 0.42;
  return 0.22;
}

/** All legal follow options, best-first by heuristic score. */
export function rankFollowCandidates(state: GameState, seat: Seat): Card[][] {
  const hand = state.hands[seat];
  const { trumpSuit, levelRank } = state;
  const leadPlay = state.currentTrick[0].parsed;
  const candidates = buildSmartFollowCandidates(state, seat);

  if (candidates.length <= 1) {
    return candidates.length === 1 ? candidates : [hand.slice(0, leadPlay.cards.length)];
  }

  const tracker = buildPublicCardTracker(state, seat);
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

  const allyHoldConfidence = currentWinningAlly
    ? estimateWinHoldConfidence(
        tracker,
        state,
        seat,
        currentBestPlay,
        remainingEnemies,
      )
    : 0;

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

  for (const cards of candidates) {
    const parsed = parsePlay(cards, trumpSuit, levelRank) ?? {
      patternType: 'SLING' as const,
      category: leadPlay.category,
      cards,
      components: [],
    };
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

    // Value of winning this trick (points + lead control + last-trick bottom multiplier!)
    const bottomMultiplierBonus = isLastTrick ? 190 : isNearEndgame ? 26 : 0;
    const trickValue = trickPts * 3.1 + 14 + bottomMultiplierBonus;

    let score = 0;

    if (currentWinningAlly) {
      if (!iWin) {
        // Letting ally keep the win!
        if (allyHoldConfidence >= 0.78) {
          // Ally win is secure (e.g. last seat or ally played a top card): feed maximum safe points!
          score =
            140 +
            trickPts * 2.5 +
            candPts * 4.8 +
            voidBonus -
            cardCost * 1.15;
        } else {
          // Ally win is vulnerable to remaining enemy: protect our points and play small trash
          score =
            60 * allyHoldConfidence -
            candPts * 3.2 +
            voidBonus -
            cardCost * 1.1;
        }
      } else {
        // Overtaking our own ally
        if (allyHoldConfidence >= 0.8) {
          // NEVER waste cards overtaking a secure ally (especially in 4th seat)!
          score =
            75 +
            trickPts * 2.0 -
            55 -
            cardCost * 1.45;
        } else {
          // Ally is vulnerable to remaining enemy: overtaking with a strong/top card to secure points makes sense!
          score =
            trickValue * myWinHold +
            (myWinHold - allyHoldConfidence) * (trickPts * 2.8 + 25) -
            cardCost * 1.2;
        }
      }
    } else if (mySideWins && iWin) {
      // Enemy was winning, and this play overtakes them!
      score = trickValue * myWinHold - cardCost * 1.15;
      // Extra urgency to contest a 20+ point trick
      if (trickPts >= 20) score += 20 * myWinHold;
      // Avoid wasting huge trumps (♥5 / BJ / SJ) on a 0-point early trick
      if (trickPts === 0 && !isLastTrick && !isNearEndgame && cardCost >= 32) {
        score -= 28;
      }
    } else {
      // Enemy keeps winning: strictly dodge points, keep high cards & structures, try to void short suits!
      score = -candPts * 6.8 + voidBonus - cardCost * 1.15;
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

export function chooseBotAction(state: GameState, seat: Seat): GameAction {
  switch (state.phase) {
    case 'DEALING':
      return { type: 'DEAL_STEP' };
    case 'BIDDING':
      return chooseBidAction(state, seat);
    case 'CHOOSE_TRUMP':
      return chooseTrumpSuitAction(state, seat);
    case 'CALLING':
      return chooseCallingAction(state, seat);
    case 'COUNTER_BIDDING':
      return chooseCounterAction(state, seat);
    case 'COUNTER_RESPONSE':
      return chooseCounterResponseAction(state, seat);
    case 'BURYING':
      return chooseBuryAction(state, seat);
    case 'PLAYING':
      return {
        type: 'PLAY_CARDS',
        seat,
        cardIds: searchPlayCards(state, seat),
      };
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
