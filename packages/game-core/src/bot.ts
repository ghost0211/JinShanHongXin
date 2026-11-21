import type {
  Card,
  GameAction,
  Seat,
  StandardSuit,
} from '@jinshan/protocol';
import {
  countBipai,
  getCardCategory,
  getCardOrder,
  getCardPoints,
  getOtherTeam,
  getSeatTeam,
  isRedFive,
  STANDARD_SUITS,
} from './cards.js';
import {
  enumerateChainCandidates,
  groupCardsByKey,
  parsePlay,
} from './patterns.js';
import type { GameState } from './types.js';
import {
  findLegalFollowCards,
  resolveTrickWinner,
  validateLeadPlay,
} from './validator.js';

function scoreSuitStrength(hand: readonly Card[], suit: StandardSuit, levelRank: GameState['levelRank']): number {
  let score = 0;
  for (const card of hand) {
    if (card.suit === suit) {
      score += 10 + getCardPoints(card) * 0.5;
      if (card.rank === levelRank) score += 20;
      if (card.rank === '3') score += 12;
      if (card.rank === 'A' || card.rank === 'K') score += 6;
    } else if (card.suit === 'J') {
      score += 12;
    } else if (isRedFive(card)) {
      score += 15;
    }
  }
  return score;
}

function isSameSide(state: GameState, a: Seat, b: Seat): boolean {
  if (state.mode === 'heixin') {
    return (a === state.dealer) === (b === state.dealer);
  }
  return getSeatTeam(a) === getSeatTeam(b);
}

function chooseBidAction(state: GameState, seat: Seat): GameAction {
  const hand = state.hands[seat];
  const bidState = state.bidState!;

  let h5 = 0;
  let bj = 0;
  let sj = 0;
  let tens = 0;
  let threes = 0;
  const suitCount: Record<StandardSuit, number> = { S: 0, H: 0, C: 0, D: 0 };

  for (const c of hand) {
    if (isRedFive(c)) h5 += 1;
    else if (c.rank === 'BJ') bj += 1;
    else if (c.rank === 'SJ') sj += 1;
    else if (c.rank === '10') tens += 1;
    else if (c.rank === '3') threes += 1;
    if (c.suit !== 'J') suitCount[c.suit] += 1;
  }

  const maxSuitLen = Math.max(suitCount.S, suitCount.H, suitCount.C, suitCount.D);
  const strength =
    75 + h5 * 14 + bj * 12 + sj * 9 + tens * 8 + threes * 4 + maxSuitLen * 2;
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
    if (bestSuit && (bestCards.length === 3 || bipai >= 4 || state.callState.passedSeats.length >= 2)) {
      return {
        type: 'CALL_TRUMP',
        seat,
        suit: bestSuit,
        cardIds: bestCards.slice(0, bestCards.length === 3 ? 3 : 2).map((c) => c.id),
      };
    }
    return { type: 'PASS_CALL', seat };
  }

  // Round 2+: call with 1 level card for best suit
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
  if (bestSuit && (bipai >= 4 || getSeatTeam(seat) === state.bankerTeam || state.callState.passedSeats.length >= 2)) {
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

  // Round 1 against 2-card call: guaranteed free steal!
  if (state.isFirstRound && state.callState.calledCount === 2) {
    return {
      type: 'COUNTER_BID',
      seat,
      suit: bestSuit,
      cardIds: bestCards.slice(0, 3).map((c) => c.id),
    };
  }

  const bipai = countBipai(hand, state.levelRank);
  if (bipai >= 7) {
    return {
      type: 'COUNTER_BID',
      seat,
      suit: bestSuit,
      cardIds: bestCards.slice(0, required).map((c) => c.id),
    };
  }

  return { type: 'PASS_COUNTER', seat };
}

function chooseBuryAction(state: GameState, seat: Seat): GameAction {
  const hand = state.hands[seat];
  const buryPool =
    state.mode === 'heixin'
      ? hand.filter((c) => c.rank !== '10')
      : hand;
  const suitCounts = new Map<StandardSuit, number>();
  for (const s of STANDARD_SUITS) suitCounts.set(s, 0);
  for (const c of hand) {
    const cat = getCardCategory(c, state.trumpSuit, state.levelRank);
    if (cat !== 'TRUMP') {
      suitCounts.set(cat, (suitCounts.get(cat) ?? 0) + 1);
    }
  }

  const groups = groupCardsByKey(hand, state.trumpSuit, state.levelRank);
  const keyCounts = new Map(groups.map((g) => [`${g.key}`, g.cards.length]));

  const scored = buryPool.map((card) => {
    const cat = getCardCategory(card, state.trumpSuit, state.levelRank);
    const key = `${card.suit}:${card.rank}`;
    const mult = keyCounts.get(key) ?? 1;
    let keepScore = 0;

    if (cat === 'TRUMP') {
      keepScore += 100 + getCardOrder(card, state.trumpSuit, state.levelRank) * 4;
    } else {
      const order = getCardOrder(card, state.trumpSuit, state.levelRank);
      const len = suitCounts.get(cat) ?? 0;
      keepScore += order * 3 + len * 2 + (mult >= 2 ? mult * 14 : 0);
      if (card.rank === 'A') keepScore += 45;
      // Avoid burying 5/10/K if risky, unless short off-suit singleton
      const pts = getCardPoints(card);
      if (pts > 0) keepScore += len <= 2 ? -5 : 15;
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

function chooseLeadCards(state: GameState, seat: Seat): number[] {
  const hand = state.hands[seat];
  const { trumpSuit, levelRank } = state;

  // Prefer high atomic plays in non-trump suits (top A/K pairs, triples, tractors, singles),
  // otherwise pull trumps or play lowest card safely.
  const categories = [...STANDARD_SUITS.filter((s) => s !== trumpSuit), 'TRUMP'] as const;
  const candidatePlays: { cards: Card[]; priority: number }[] = [];

  // Consider 510K leads in standard suits (including borrowed ♥5 / level 10 / level K)
  for (const s of STANDARD_SUITS) {
    const s5 = hand.filter((c) => c.suit === s && c.rank === '5');
    const s10 = hand.filter((c) => c.suit === s && c.rank === '10');
    const sK = hand.filter((c) => c.suit === s && c.rank === 'K');
    const count510k = Math.min(s5.length, s10.length, sK.length);
    if (count510k >= 1) {
      const fCards: Card[] = [];
      for (let i = 0; i < count510k; i++) {
        fCards.push(s5[i], s10[i], sK[i]);
      }
      candidatePlays.push({
        cards: fCards,
        priority: s === trumpSuit ? 80 + count510k * 5 : 58 + count510k * 3,
      });
    }
  }

  for (const cat of categories) {
    const inCat = hand.filter((c) => getCardCategory(c, trumpSuit, levelRank) === cat);
    if (inCat.length === 0) continue;
    const groups = groupCardsByKey(inCat, trumpSuit, levelRank);

    // Triple tractors / tractors
    const tt = enumerateChainCandidates(groups, 3);
    if (tt.length > 0) {
      candidatePlays.push({
        cards: tt[0].cards,
        priority: 90 + tt[0].topOrder,
      });
    }
    const tr = enumerateChainCandidates(groups, 2);
    if (tr.length > 0) {
      candidatePlays.push({
        cards: tr[0].cards,
        priority: 75 + tr[0].topOrder,
      });
    }

    // Highest triple or pair or single
    for (const g of groups) {
      const isTopOffSuit = cat !== 'TRUMP' && g.cards[0].rank === 'A';
      if (g.cards.length === 3) {
        candidatePlays.push({
          cards: g.cards,
          priority: (isTopOffSuit ? 85 : 40) + g.order,
        });
      } else if (g.cards.length === 2) {
        candidatePlays.push({
          cards: g.cards,
          priority: (isTopOffSuit ? 70 : 30) + g.order,
        });
      } else {
        const ptsPenalty = getCardPoints(g.cards[0]) * 0.5;
        candidatePlays.push({
          cards: [g.cards[0]],
          priority: (isTopOffSuit ? 65 : 15) + g.order - ptsPenalty,
        });
      }
    }
  }

  candidatePlays.sort((a, b) => b.priority - a.priority);
  const otherHands = ([0, 1, 2, 3] as Seat[])
    .filter((s) => s !== seat)
    .map((s) => state.hands[s]);

  for (const cand of candidatePlays) {
    const check = validateLeadPlay(
      hand,
      cand.cards.map((c) => c.id),
      otherHands,
      trumpSuit,
      levelRank,
    );
    if (check.valid && !check.slingFailed) {
      return cand.cards.map((c) => c.id);
    }
  }

  return [hand[hand.length - 1].id];
}

function chooseFollowCards(state: GameState, seat: Seat): number[] {
  const hand = state.hands[seat];
  const leadPlay = state.currentTrick[0].parsed;
  const candidates = findLegalFollowCards(
    hand,
    leadPlay,
    state.trumpSuit,
    state.levelRank,
  );
  if (candidates.length === 1) {
    return candidates[0].map((c) => c.id);
  }

  const currentBest = resolveTrickWinner(
    state.currentTrick,
    state.trumpSuit,
    state.levelRank,
  );
  const currentWinningAlly = isSameSide(state, seat, currentBest.winnerSeat);

  let bestChoice = candidates[0];
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const cards of candidates) {
    const parsed = parsePlay(cards, state.trumpSuit, state.levelRank) ?? {
      patternType: 'SLING' as const,
      category: leadPlay.category,
      cards,
      components: [],
    };
    const simulatedTrick = [
      ...state.currentTrick,
      { seat, cards, parsed },
    ];
    const simResult = resolveTrickWinner(
      simulatedTrick,
      state.trumpSuit,
      state.levelRank,
    );
    const iWin = simResult.winnerSeat === seat;
    const mySideWins = isSameSide(state, seat, simResult.winnerSeat);
    const candPts = cards.reduce((s, c) => s + getCardPoints(c), 0);
    const trickPts = currentBest.pointsInTrick + candPts;

    const avgOrder =
      cards.reduce(
        (s, c) => s + getCardOrder(c, state.trumpSuit, state.levelRank),
        0,
      ) / cards.length;
    const trumpCount = cards.filter(
      (c) => getCardCategory(c, state.trumpSuit, state.levelRank) === 'TRUMP',
    ).length;

    let score = 0;
    if (mySideWins) {
      // Teammate/ally or self wins: feed points if ally already winning cleanly, avoid wasting huge trumps if unnecessary
      score += 100 + trickPts * 2;
      if (currentWinningAlly && !iWin) {
        score += candPts * 3 - avgOrder * 2 - trumpCount * 15;
      } else {
        // I'm winning the trick: prefer winning with minimal cost
        score -= avgOrder * 1.5 + trumpCount * 10;
      }
    } else {
      // Opponent winning: dump non-point small cards
      score -= candPts * 5 + avgOrder * 1.2 + trumpCount * 20;
    }

    if (score > bestScore) {
      bestScore = score;
      bestChoice = cards;
    }
  }

  return bestChoice.map((c) => c.id);
}

export function chooseBotAction(state: GameState, seat: Seat): GameAction {
  switch (state.phase) {
    case 'BIDDING':
      return chooseBidAction(state, seat);
    case 'CHOOSE_TRUMP':
      return chooseTrumpSuitAction(state, seat);
    case 'CALLING':
      return chooseCallingAction(state, seat);
    case 'COUNTER_BIDDING':
      return chooseCounterAction(state, seat);
    case 'BURYING':
      return chooseBuryAction(state, seat);
    case 'PLAYING':
      return {
        type: 'PLAY_CARDS',
        seat,
        cardIds:
          state.currentTrick.length === 0
            ? chooseLeadCards(state, seat)
            : chooseFollowCards(state, seat),
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
    return state.currentTrick.length === 0
      ? chooseLeadCards(state, seat)
      : chooseFollowCards(state, seat);
  }
  return [];
}
