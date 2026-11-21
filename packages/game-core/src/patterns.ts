import type {
  AtomicPattern,
  AtomicPatternType,
  Card,
  CardCategory,
  LevelRank,
  ParsedPlay,
  StandardSuit,
} from '@jinshan/protocol';
import {
  canUseAceAsOne,
  getCardCategory,
  getCardKey,
  getCardOrder,
} from './cards.js';

export interface KeyGroup {
  key: string;
  cards: Card[];
  order: number;
  allowLowAce: boolean;
}

export interface AtomicChainCandidate {
  type: 'TRACTOR' | 'TRIPLE_TRACTOR';
  keys: string[];
  cards: Card[];
  length: number;
  topOrder: number;
  usedLowAce: boolean;
}

const PATTERN_PRIORITY: Record<AtomicPatternType, number> = {
  TRIPLE_TRACTOR: 5,
  TRIPLE: 4,
  F510K: 3.5,
  TRACTOR: 3,
  PAIR: 2,
  SINGLE: 1,
};

export function parse510K(
  cards: readonly Card[],
  trumpSuit: StandardSuit | null,
): { atomic: AtomicPattern; category: CardCategory } | null {
  if (cards.length !== 3 && cards.length !== 6 && cards.length !== 9) {
    return null;
  }
  const firstSuit = cards[0].suit;
  if (firstSuit === 'J') return null;

  let count5 = 0;
  let count10 = 0;
  let countK = 0;
  for (const c of cards) {
    if (c.suit !== firstSuit) return null;
    if (c.rank === '5') count5 += 1;
    else if (c.rank === '10') count10 += 1;
    else if (c.rank === 'K') countK += 1;
    else return null;
  }

  const k = cards.length / 3;
  if (count5 !== k || count10 !== k || countK !== k) {
    return null;
  }

  const category: CardCategory = firstSuit === trumpSuit ? 'TRUMP' : firstSuit;
  return {
    category,
    atomic: {
      type: 'F510K',
      cards: [...cards],
      cardKeys: [`${firstSuit}:5`, `${firstSuit}:10`, `${firstSuit}:K`],
      length: k,
      topOrder: -100,
      usedLowAce: false,
    },
  };
}

export function groupCardsByKey(
  cards: readonly Card[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): KeyGroup[] {
  const map = new Map<string, KeyGroup>();
  for (const card of cards) {
    const key = getCardKey(card);
    const existing = map.get(key);
    if (existing) {
      existing.cards.push(card);
    } else {
      map.set(key, {
        key,
        cards: [card],
        order: getCardOrder(card, trumpSuit, levelRank),
        allowLowAce: canUseAceAsOne(card, trumpSuit, levelRank),
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.order !== a.order) return b.order - a.order;
    return a.key.localeCompare(b.key);
  });
}

export function enumerateChainCandidates(
  groups: readonly KeyGroup[],
  multiplicity: 2 | 3,
  options?: { exactLength?: number; maxLength?: number; minLength?: number },
): AtomicChainCandidate[] {
  const minLen = options?.minLength ?? 2;
  const maxLen = options?.maxLength ?? Number.POSITIVE_INFINITY;
  const exactLen = options?.exactLength;

  const eligible = groups.filter((g) => g.cards.length >= multiplicity);
  if (eligible.length < minLen) return [];

  // Map order tier -> groups available at that tier (low-A occupies virtual tier -1)
  const orderBuckets = new Map<number, KeyGroup[]>();
  const addToBucket = (ord: number, g: KeyGroup) => {
    const list = orderBuckets.get(ord);
    if (list) list.push(g);
    else orderBuckets.set(ord, [g]);
  };

  for (const g of eligible) {
    addToBucket(g.order, g);
    if (g.allowLowAce) {
      addToBucket(-1, g);
    }
  }

  const allOrders = Array.from(orderBuckets.keys()).sort((a, b) => a - b);
  const type: 'TRACTOR' | 'TRIPLE_TRACTOR' =
    multiplicity === 3 ? 'TRIPLE_TRACTOR' : 'TRACTOR';

  const results: AtomicChainCandidate[] = [];

  const dfs = (
    startOrder: number,
    currOrder: number,
    chosenGroups: KeyGroup[],
    usedKeys: Set<string>,
  ) => {
    const len = chosenGroups.length;
    if (len >= minLen && (exactLen === undefined || len === exactLen)) {
      results.push({
        type,
        keys: chosenGroups.map((g) => g.key),
        cards: chosenGroups.flatMap((g) => g.cards.slice(0, multiplicity)),
        length: len,
        topOrder: currOrder - 1,
        usedLowAce: startOrder === -1,
      });
    }
    if (len >= maxLen || (exactLen !== undefined && len >= exactLen)) {
      return;
    }
    const nextGroups = orderBuckets.get(currOrder);
    if (!nextGroups) return;
    for (const nextGroup of nextGroups) {
      if (usedKeys.has(nextGroup.key)) continue;
      usedKeys.add(nextGroup.key);
      chosenGroups.push(nextGroup);
      dfs(startOrder, currOrder + 1, chosenGroups, usedKeys);
      chosenGroups.pop();
      usedKeys.delete(nextGroup.key);
    }
  };

  for (const startOrder of allOrders) {
    const starts = orderBuckets.get(startOrder) ?? [];
    for (const first of starts) {
      const used = new Set<string>([first.key]);
      dfs(startOrder, startOrder + 1, [first], used);
    }
  }

  return results.sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    if (b.topOrder !== a.topOrder) return b.topOrder - a.topOrder;
    if (a.usedLowAce !== b.usedLowAce) return a.usedLowAce ? 1 : -1;
    return a.keys.join(',').localeCompare(b.keys.join(','));
  });
}

function toAtomicPattern(candidate: AtomicChainCandidate): AtomicPattern {
  return {
    type: candidate.type,
    cards: candidate.cards,
    cardKeys: candidate.keys,
    length: candidate.length,
    topOrder: candidate.topOrder,
    usedLowAce: candidate.usedLowAce,
  };
}

export function getSingleCategory(
  cards: readonly Card[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): CardCategory | null {
  if (cards.length === 0) return null;
  const first = getCardCategory(cards[0], trumpSuit, levelRank);
  for (let i = 1; i < cards.length; i++) {
    if (getCardCategory(cards[i], trumpSuit, levelRank) !== first) {
      return null;
    }
  }
  return first;
}

export function parseSingleAtomicPattern(
  cards: readonly Card[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): AtomicPattern | null {
  if (cards.length === 0) return null;
  const groups = groupCardsByKey(cards, trumpSuit, levelRank);

  if (cards.length === 1) {
    return {
      type: 'SINGLE',
      cards: [...cards],
      cardKeys: [groups[0].key],
      length: 1,
      topOrder: groups[0].order,
      usedLowAce: false,
    };
  }

  if (groups.length === 1 && cards.length === 2) {
    return {
      type: 'PAIR',
      cards: [...cards],
      cardKeys: [groups[0].key],
      length: 1,
      topOrder: groups[0].order,
      usedLowAce: false,
    };
  }

  if (groups.length === 1 && cards.length === 3) {
    return {
      type: 'TRIPLE',
      cards: [...cards],
      cardKeys: [groups[0].key],
      length: 1,
      topOrder: groups[0].order,
      usedLowAce: false,
    };
  }

  if (groups.length >= 2 && groups.every((g) => g.cards.length === 3)) {
    const candidates = enumerateChainCandidates(groups, 3, {
      exactLength: groups.length,
    });
    if (candidates.length > 0) {
      return toAtomicPattern(candidates[0]);
    }
  }

  if (groups.length >= 2 && groups.every((g) => g.cards.length === 2)) {
    const candidates = enumerateChainCandidates(groups, 2, {
      exactLength: groups.length,
    });
    if (candidates.length > 0) {
      return toAtomicPattern(candidates[0]);
    }
  }

  return null;
}

export function parsePlay(
  cards: readonly Card[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): ParsedPlay | null {
  const f510k = parse510K(cards, trumpSuit);
  if (f510k) {
    return {
      patternType: 'F510K',
      category: f510k.category,
      cards: [...f510k.atomic.cards],
      components: [f510k.atomic],
    };
  }

  const category = getSingleCategory(cards, trumpSuit, levelRank);
  if (!category) return null;

  const atomic = parseSingleAtomicPattern(cards, trumpSuit, levelRank);
  if (atomic) {
    return {
      patternType: atomic.type,
      category,
      cards: [...atomic.cards],
      components: [atomic],
    };
  }

  // Decompose into SLING components greedily:
  // TRIPLE_TRACTOR -> TRIPLE -> TRACTOR -> PAIR -> SINGLE
  let pool = groupCardsByKey(cards, trumpSuit, levelRank);
  const components: AtomicPattern[] = [];

  const consumeChain = (candidate: AtomicChainCandidate, multiplicity: 2 | 3) => {
    const usedKeySet = new Set(candidate.keys);
    const updated: KeyGroup[] = [];
    for (const g of pool) {
      if (usedKeySet.has(g.key)) {
        const leftover = g.cards.slice(multiplicity);
        if (leftover.length > 0) {
          updated.push({ ...g, cards: leftover });
        }
      } else {
        updated.push(g);
      }
    }
    pool = updated;
    components.push(toAtomicPattern(candidate));
  };

  while (true) {
    const tripleTractors = enumerateChainCandidates(pool, 3);
    if (tripleTractors.length === 0) break;
    consumeChain(tripleTractors[0], 3);
  }

  // Extract remaining TRIPLES (groups of 3)
  const afterTriples: KeyGroup[] = [];
  for (const g of pool) {
    if (g.cards.length === 3) {
      components.push({
        type: 'TRIPLE',
        cards: g.cards.slice(0, 3),
        cardKeys: [g.key],
        length: 1,
        topOrder: g.order,
        usedLowAce: false,
      });
    } else {
      afterTriples.push(g);
    }
  }
  pool = afterTriples;

  while (true) {
    const tractors = enumerateChainCandidates(pool, 2);
    if (tractors.length === 0) break;
    consumeChain(tractors[0], 2);
  }

  // Extract remaining PAIRS and SINGLES
  const afterPairs: KeyGroup[] = [];
  for (const g of pool) {
    if (g.cards.length >= 2) {
      components.push({
        type: 'PAIR',
        cards: g.cards.slice(0, 2),
        cardKeys: [g.key],
        length: 1,
        topOrder: g.order,
        usedLowAce: false,
      });
      if (g.cards.length > 2) {
        afterPairs.push({ ...g, cards: g.cards.slice(2) });
      }
    } else {
      afterPairs.push(g);
    }
  }

  for (const g of afterPairs) {
    for (const c of g.cards) {
      components.push({
        type: 'SINGLE',
        cards: [c],
        cardKeys: [g.key],
        length: 1,
        topOrder: g.order,
        usedLowAce: false,
      });
    }
  }

  components.sort((a, b) => {
    const pDiff = PATTERN_PRIORITY[b.type] - PATTERN_PRIORITY[a.type];
    if (pDiff !== 0) return pDiff;
    if (b.length !== a.length) return b.length - a.length;
    return b.topOrder - a.topOrder;
  });

  return {
    patternType: 'SLING',
    category,
    cards: [...cards],
    components,
  };
}

export function canHandBeatComponent(
  hand: readonly Card[],
  category: CardCategory,
  component: AtomicPattern,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): boolean {
  const inCat = hand.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) === category,
  );
  if (inCat.length === 0) return false;
  const groups = groupCardsByKey(inCat, trumpSuit, levelRank);

  switch (component.type) {
    case 'SINGLE':
      return groups.some((g) => g.order > component.topOrder);
    case 'PAIR':
      return groups.some((g) => g.cards.length >= 2 && g.order > component.topOrder);
    case 'TRIPLE':
      return groups.some((g) => g.cards.length === 3 && g.order > component.topOrder);
    case 'TRACTOR': {
      const chains = enumerateChainCandidates(groups, 2, {
        exactLength: component.length,
      });
      return chains.some((c) => c.topOrder > component.topOrder);
    }
    case 'TRIPLE_TRACTOR': {
      const chains = enumerateChainCandidates(groups, 3, {
        exactLength: component.length,
      });
      return chains.some((c) => c.topOrder > component.topOrder);
    }
    case 'F510K': {
      if (component.length === 1) {
        return groups.some((g) => g.cards.length === 3);
      }
      return (
        enumerateChainCandidates(groups, 3, { exactLength: component.length })
          .length > 0
      );
    }
  }
}

export function sortComponentsCanonical(
  components: readonly AtomicPattern[],
): AtomicPattern[] {
  return [...components].sort((a, b) => {
    const pDiff = PATTERN_PRIORITY[b.type] - PATTERN_PRIORITY[a.type];
    if (pDiff !== 0) return pDiff;
    if (b.length !== a.length) return b.length - a.length;
    return b.topOrder - a.topOrder;
  });
}

export function compareMatchedComponents(
  a: readonly AtomicPattern[],
  b: readonly AtomicPattern[],
): number {
  const sa = sortComponentsCanonical(a);
  const sb = sortComponentsCanonical(b);
  const len = Math.min(sa.length, sb.length);
  for (let i = 0; i < len; i++) {
    const diff = sa[i].topOrder - sb[i].topOrder;
    if (diff !== 0) return diff;
  }
  return 0;
}

export function canMatchSlingStructure(
  cards: readonly Card[],
  targetComponents: readonly AtomicPattern[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): { matched: boolean; matchedComponents: AtomicPattern[] } {
  const category = getSingleCategory(cards, trumpSuit, levelRank);
  if (!category) return { matched: false, matchedComponents: [] };

  const totalNeeded = targetComponents.reduce(
    (sum, c) => sum + c.cards.length,
    0,
  );
  if (cards.length !== totalNeeded) {
    return { matched: false, matchedComponents: [] };
  }

  const orderedTargets = sortComponentsCanonical(targetComponents);
  const initialPool = groupCardsByKey(cards, trumpSuit, levelRank);

  const search = (
    idx: number,
    pool: KeyGroup[],
    acc: AtomicPattern[],
  ): AtomicPattern[] | null => {
    if (idx === orderedTargets.length) {
      return pool.length === 0 ? acc : null;
    }

    const target = orderedTargets[idx];

    if (target.type === 'TRIPLE_TRACTOR' || target.type === 'TRACTOR') {
      const mult: 2 | 3 = target.type === 'TRIPLE_TRACTOR' ? 3 : 2;
      const chains = enumerateChainCandidates(pool, mult, {
        exactLength: target.length,
      });
      for (const ch of chains) {
        const usedSet = new Set(ch.keys);
        const nextPool: KeyGroup[] = [];
        for (const g of pool) {
          if (usedSet.has(g.key)) {
            const rem = g.cards.slice(mult);
            if (rem.length > 0) nextPool.push({ ...g, cards: rem });
          } else {
            nextPool.push(g);
          }
        }
        acc.push(toAtomicPattern(ch));
        const res = search(idx + 1, nextPool, acc);
        if (res) return res;
        acc.pop();
      }
      return null;
    }

    if (target.type === 'F510K') {
      return null;
    }

    const needCount =
      target.type === 'TRIPLE' ? 3 : target.type === 'PAIR' ? 2 : 1;

    for (let i = 0; i < pool.length; i++) {
      const g = pool[i];
      if (g.cards.length < needCount) continue;
      const nextPool: KeyGroup[] = [];
      for (let j = 0; j < pool.length; j++) {
        if (j === i) {
          const rem = pool[j].cards.slice(needCount);
          if (rem.length > 0) nextPool.push({ ...pool[j], cards: rem });
        } else {
          nextPool.push(pool[j]);
        }
      }
      acc.push({
        type: target.type,
        cards: g.cards.slice(0, needCount),
        cardKeys: [g.key],
        length: 1,
        topOrder: g.order,
        usedLowAce: false,
      });
      const res = search(idx + 1, nextPool, acc);
      if (res) return res;
      acc.pop();
    }
    return null;
  };

  const matched = search(0, initialPool, []);
  if (!matched) return { matched: false, matchedComponents: [] };
  return { matched: true, matchedComponents: matched };
}
