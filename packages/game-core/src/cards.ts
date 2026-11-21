import type {
  Card,
  CardCategory,
  LevelRank,
  NormalRank,
  Seat,
  StandardSuit,
  TeamId,
} from '@jinshan/protocol';

export const LEVEL_SEQUENCE: readonly LevelRank[] = [
  '2',
  '4',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
] as const;

export const STANDARD_SUITS: readonly StandardSuit[] = ['S', 'H', 'C', 'D'] as const;

export const ASCENDING_NORMAL_RANKS: readonly NormalRank[] = [
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
  'A',
] as const;

const SUIT_DISPLAY_ORDER: Record<StandardSuit, number> = {
  S: 0,
  H: 1,
  C: 2,
  D: 3,
};

export function getSeatTeam(seat: Seat): TeamId {
  return seat === 0 || seat === 2 ? 'A' : 'B';
}

export function getOtherTeam(team: TeamId): TeamId {
  return team === 'A' ? 'B' : 'A';
}

export function getSameColorSuit(suit: StandardSuit): StandardSuit {
  switch (suit) {
    case 'S':
      return 'C';
    case 'C':
      return 'S';
    case 'H':
      return 'D';
    case 'D':
      return 'H';
  }
}

export function getCardKey(card: Card): string {
  return `${card.suit}:${card.rank}`;
}

export function isJoker(card: Card): boolean {
  return card.suit === 'J';
}

export function isRedFive(card: Card): boolean {
  return card.suit === 'H' && card.rank === '5';
}

export function getCardPoints(card: Card): number {
  if (card.rank === '5') return 5;
  if (card.rank === '10' || card.rank === 'K') return 10;
  return 0;
}

export function isBipaiCard(card: Card, levelRank: LevelRank): boolean {
  return isRedFive(card) || isJoker(card) || card.rank === levelRank;
}

export function countBipai(cards: readonly Card[], levelRank: LevelRank): number {
  let total = 0;
  for (const card of cards) {
    if (isBipaiCard(card, levelRank)) {
      total += 1;
    }
  }
  return total;
}

export function isTrump(
  card: Card,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): boolean {
  if (isRedFive(card) || isJoker(card) || card.rank === levelRank) {
    return true;
  }
  if (trumpSuit === null) {
    return false;
  }
  if (card.suit === trumpSuit) {
    return true;
  }
  return card.rank === '3' && card.suit === getSameColorSuit(trumpSuit);
}

export function getCardCategory(
  card: Card,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): CardCategory {
  return isTrump(card, trumpSuit, levelRank) ? 'TRUMP' : (card.suit as StandardSuit);
}

export function getSuitNormalRanks(
  suit: StandardSuit,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): NormalRank[] {
  const sameColor = trumpSuit ? getSameColorSuit(trumpSuit) : null;
  return ASCENDING_NORMAL_RANKS.filter((rank) => {
    if (rank === levelRank) return false;
    if (suit === 'H' && rank === '5') return false;
    if (trumpSuit !== null && rank === '3' && (suit === trumpSuit || suit === sameColor)) {
      return false;
    }
    return true;
  });
}

export function getCardOrder(
  card: Card,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): number {
  if (!isTrump(card, trumpSuit, levelRank)) {
    const normalRanks = getSuitNormalRanks(card.suit as StandardSuit, trumpSuit, levelRank);
    return normalRanks.indexOf(card.rank as NormalRank);
  }

  if (trumpSuit === null) {
    if (card.rank === levelRank) return 0;
    if (card.rank === 'SJ') return 1;
    if (card.rank === 'BJ') return 2;
    return 3; // ♥5
  }

  const normalTrump = getSuitNormalRanks(trumpSuit, trumpSuit, levelRank);
  const M = normalTrump.length;
  if (isRedFive(card)) return M + 6;
  if (card.rank === 'BJ') return M + 5;
  if (card.rank === 'SJ') return M + 4;
  if (card.rank === '3' && card.suit === trumpSuit) return M + 3;
  if (card.rank === '3' && card.suit === getSameColorSuit(trumpSuit)) return M + 2;
  if (card.rank === levelRank && card.suit === trumpSuit) return M + 1;
  if (card.rank === levelRank) return M;
  return normalTrump.indexOf(card.rank as NormalRank);
}

export function canUseAceAsOne(
  card: Card,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): boolean {
  if (levelRank === 'A') return false;
  if (card.rank !== 'A') return false;
  // When levelRank !== 'A', every 'A' sits at the top of its suit's normal ranks
  // (either trump suit's normal section or a non-trump suit's normal section).
  return getSuitNormalRanks(card.suit as StandardSuit, trumpSuit, levelRank).includes('A');
}

export function createThreeDecks(): Card[] {
  const cards: Card[] = [];
  let id = 0;
  for (let deck = 0 as 0 | 1 | 2; deck < 3; deck = (deck + 1) as 0 | 1 | 2) {
    for (const suit of STANDARD_SUITS) {
      for (const rank of ASCENDING_NORMAL_RANKS) {
        cards.push({ id: id++, deck, suit, rank });
      }
    }
    cards.push({ id: id++, deck, suit: 'J', rank: 'SJ' });
    cards.push({ id: id++, deck, suit: 'J', rank: 'BJ' });
  }
  return cards;
}

function createMulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleCards(cards: readonly Card[], seed?: number): Card[] {
  const copy = [...cards];
  const rand = seed === undefined ? Math.random : createMulberry32(seed);
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

export function sortHandForDisplay(
  cards: readonly Card[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): Card[] {
  return [...cards].sort((a, b) => {
    const catA = getCardCategory(a, trumpSuit, levelRank);
    const catB = getCardCategory(b, trumpSuit, levelRank);
    if (catA === 'TRUMP' && catB !== 'TRUMP') return -1;
    if (catA !== 'TRUMP' && catB === 'TRUMP') return 1;
    if (catA !== catB) {
      return SUIT_DISPLAY_ORDER[catA as StandardSuit] - SUIT_DISPLAY_ORDER[catB as StandardSuit];
    }
    const orderDiff =
      getCardOrder(b, trumpSuit, levelRank) - getCardOrder(a, trumpSuit, levelRank);
    if (orderDiff !== 0) return orderDiff;
    if (a.suit !== b.suit) {
      if (a.suit === 'J') return -1;
      if (b.suit === 'J') return 1;
      return SUIT_DISPLAY_ORDER[a.suit] - SUIT_DISPLAY_ORDER[b.suit];
    }
    return a.id - b.id;
  });
}

export function formatCardLabel(card: Card): string {
  if (card.suit === 'J') {
    return card.rank === 'BJ' ? '大王' : '小王';
  }
  const symbol: Record<StandardSuit, string> = {
    S: '♠',
    H: '♥',
    C: '♣',
    D: '♦',
  };
  return `${symbol[card.suit]}${card.rank}`;
}
