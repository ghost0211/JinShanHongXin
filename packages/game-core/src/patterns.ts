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

function consumeChainFromPool(
  pool: readonly KeyGroup[],
  candidate: AtomicChainCandidate,
  multiplicity: 2 | 3,
): KeyGroup[] {
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
  return updated;
}

function greedyDecomposeNon510K(
  initialPool: readonly KeyGroup[],
  tractorBeforeTriple: boolean,
): AtomicPattern[] {
  let pool = initialPool.map((g) => ({ ...g, cards: [...g.cards] }));
  const components: AtomicPattern[] = [];

  while (true) {
    const tripleTractors = enumerateChainCandidates(pool, 3);
    if (tripleTractors.length === 0) break;
    pool = consumeChainFromPool(pool, tripleTractors[0], 3);
    components.push(toAtomicPattern(tripleTractors[0]));
  }

  if (tractorBeforeTriple) {
    while (true) {
      const tractors = enumerateChainCandidates(pool, 2);
      if (tractors.length === 0) break;
      pool = consumeChainFromPool(pool, tractors[0], 2);
      components.push(toAtomicPattern(tractors[0]));
    }
  }

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

  if (!tractorBeforeTriple) {
    while (true) {
      const tractors = enumerateChainCandidates(pool, 2);
      if (tractors.length === 0) break;
      pool = consumeChainFromPool(pool, tractors[0], 2);
      components.push(toAtomicPattern(tractors[0]));
    }
  }

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

  return sortComponentsCanonical(components);
}

function scoreDecompositionQuality(components: readonly AtomicPattern[]): number {
  let singleCount = 0;
  let strongScore = 0;
  for (const comp of components) {
    if (comp.type === 'SINGLE') {
      singleCount += 1;
    } else if (comp.type === 'PAIR') {
      strongScore += 18;
    } else if (comp.type === 'TRACTOR') {
      strongScore += 32 * comp.length;
    } else if (comp.type === 'F510K') {
      strongScore += 55 * comp.length;
    } else if (comp.type === 'TRIPLE') {
      strongScore += 60;
    } else if (comp.type === 'TRIPLE_TRACTOR') {
      strongScore += 95 * comp.length;
    }
  }
  // Strongly minimize leftover singles, then minimize total component count, then prefer stronger patterns
  return -singleCount * 1000 - components.length * 120 + strongScore;
}

function decompositionSignature(components: readonly AtomicPattern[]): string {
  return components
    .map((c) => `${c.type}:${c.length}:${c.cardKeys.join('+')}`)
    .join('|');
}

/**
 * Enumerate optimal candidate decompositions for a lead play (including F510K
 * components and off-suit borrowed ♥5 / level 10 / level K inside F510K).
 * Returned candidates are sorted from strongest/most compact to weakest.
 */
export function enumeratePlayDecompositions(
  cards: readonly Card[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): ParsedPlay[] {
  if (cards.length === 0) return [];

  const exact510k = parse510K(cards, trumpSuit);
  if (exact510k) {
    return [
      {
        patternType: 'F510K',
        category: exact510k.category,
        cards: [...exact510k.atomic.cards],
        components: [exact510k.atomic],
      },
    ];
  }

  // Determine valid category & 510K suit (supporting borrowed ♥5 / level 10 / level K in off-suit 510K)
  let category = getSingleCategory(cards, trumpSuit, levelRank);
  let f510kSuit: StandardSuit | null = null;
  let requireAtLeastOne510K = false;

  if (category) {
    f510kSuit = category === 'TRUMP' ? trumpSuit : category;
  } else {
    // Check if all cards share one physical non-trump suit S (e.g. ♥A + ♥5 + ♥10 + ♥K when ♥ is not trump)
    const firstSuit = cards[0].suit;
    if (
      firstSuit !== 'J' &&
      firstSuit !== trumpSuit &&
      cards.every((c) => c.suit === firstSuit)
    ) {
      category = firstSuit;
      f510kSuit = firstSuit;
      requireAtLeastOne510K = true;
    } else {
      return [];
    }
  }

  const results: ParsedPlay[] = [];
  const seen = new Set<string>();

  const pushCandidate = (components: AtomicPattern[]) => {
    const sorted = sortComponentsCanonical(components);
    const sig = decompositionSignature(sorted);
    if (seen.has(sig)) return;
    seen.add(sig);
    results.push({
      patternType: sorted.length === 1 ? sorted[0].type : 'SLING',
      category: category!,
      cards: [...cards],
      components: sorted,
    });
  };

  // Single non-510K atomic pattern check (only when no borrowing needed)
  if (!requireAtLeastOne510K) {
    const atomic = parseSingleAtomicPattern(cards, trumpSuit, levelRank);
    if (atomic) {
      pushCandidate([atomic]);
    }
  }

  const s5 = f510kSuit
    ? cards.filter((c) => c.suit === f510kSuit && c.rank === '5')
    : [];
  const s10 = f510kSuit
    ? cards.filter((c) => c.suit === f510kSuit && c.rank === '10')
    : [];
  const sK = f510kSuit
    ? cards.filter((c) => c.suit === f510kSuit && c.rank === 'K')
    : [];
  const max510k = Math.min(s5.length, s10.length, sK.length);

  for (let m = max510k; m >= 0; m--) {
    if (requireAtLeastOne510K && m === 0) continue;

    const usedIds = new Set<number>();
    const fCards: Card[] = [];
    for (let i = 0; i < m; i++) {
      usedIds.add(s5[i].id);
      usedIds.add(s10[i].id);
      usedIds.add(sK[i].id);
      fCards.push(s5[i], s10[i], sK[i]);
    }
    const remCards = cards.filter((c) => !usedIds.has(c.id));

    // Verify all remaining non-510K cards genuinely belong to `category`
    if (
      remCards.length > 0 &&
      getSingleCategory(remCards, trumpSuit, levelRank) !== category
    ) {
      continue;
    }

    const baseComponents: AtomicPattern[] =
      m > 0 && f510kSuit
        ? [
            {
              type: 'F510K',
              cards: fCards,
              cardKeys: [`${f510kSuit}:5`, `${f510kSuit}:10`, `${f510kSuit}:K`],
              length: m,
              topOrder: -100,
              usedLowAce: false,
            },
          ]
        : [];

    if (remCards.length === 0) {
      pushCandidate(baseComponents);
      continue;
    }

    const remPool = groupCardsByKey(remCards, trumpSuit, levelRank);

    // Strategy 1: triples before tractors
    pushCandidate([...baseComponents, ...greedyDecomposeNon510K(remPool, false)]);
    // Strategy 2: tractors before triples (e.g. QQQKK -> QQKK + Q vs QQQ + KK)
    pushCandidate([...baseComponents, ...greedyDecomposeNon510K(remPool, true)]);

    // Strategy 3: alternate top tractor choice (e.g. low-A tractor vs high-A tractor)
    const tractors = enumerateChainCandidates(remPool, 2);
    for (let t = 1; t < Math.min(tractors.length, 4); t++) {
      const after = consumeChainFromPool(remPool, tractors[t], 2);
      pushCandidate([
        ...baseComponents,
        toAtomicPattern(tractors[t]),
        ...greedyDecomposeNon510K(after, false),
      ]);
    }
  }

  results.sort((a, b) => {
    const scoreDiff =
      scoreDecompositionQuality(b.components) -
      scoreDecompositionQuality(a.components);
    if (scoreDiff !== 0) return scoreDiff;
    return a.components.length - b.components.length;
  });

  return results;
}

export function parsePlay(
  cards: readonly Card[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): ParsedPlay | null {
  const n = cards.length;
  if (n === 0) return null;
  if (n === 1) {
    const c = cards[0];
    const cat = getCardCategory(c, trumpSuit, levelRank);
    const ord = getCardOrder(c, trumpSuit, levelRank);
    return {
      patternType: 'SINGLE',
      category: cat,
      cards: [c],
      components: [
        {
          type: 'SINGLE',
          cards: [c],
          cardKeys: [getCardKey(c)],
          length: 1,
          topOrder: ord,
          usedLowAce: false,
        },
      ],
    };
  }
  if (n === 2) {
    const a = cards[0];
    const b = cards[1];
    const catA = getCardCategory(a, trumpSuit, levelRank);
    const catB = getCardCategory(b, trumpSuit, levelRank);
    if (catA !== catB) return null;
    const ordA = getCardOrder(a, trumpSuit, levelRank);
    const keyA = getCardKey(a);
    if (a.suit === b.suit && a.rank === b.rank) {
      return {
        patternType: 'PAIR',
        category: catA,
        cards: [a, b],
        components: [
          {
            type: 'PAIR',
            cards: [a, b],
            cardKeys: [keyA],
            length: 1,
            topOrder: ordA,
            usedLowAce: false,
          },
        ],
      };
    }
    const ordB = getCardOrder(b, trumpSuit, levelRank);
    const keyB = getCardKey(b);
    const compA: AtomicPattern = {
      type: 'SINGLE',
      cards: [a],
      cardKeys: [keyA],
      length: 1,
      topOrder: ordA,
      usedLowAce: false,
    };
    const compB: AtomicPattern = {
      type: 'SINGLE',
      cards: [b],
      cardKeys: [keyB],
      length: 1,
      topOrder: ordB,
      usedLowAce: false,
    };
    return {
      patternType: 'SLING',
      category: catA,
      cards: [a, b],
      components: ordA >= ordB ? [compA, compB] : [compB, compA],
    };
  }
  const decompositions = enumeratePlayDecompositions(cards, trumpSuit, levelRank);
  return decompositions[0] ?? null;
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
    const sizeDiff = b.cards.length - a.cards.length;
    if (sizeDiff !== 0) return sizeDiff;
    const pDiff = PATTERN_PRIORITY[b.type] - PATTERN_PRIORITY[a.type];
    if (pDiff !== 0) return pDiff;
    if (b.length !== a.length) return b.length - a.length;
    return b.topOrder - a.topOrder;
  });
}

function getComponentStrengthTuple(comp: AtomicPattern): [number, number] {
  // For comparing two components matched against the same canonical target slot
  // (e.g. TRIPLE / TRIPLE_TRACTOR beating an F510K slot)
  if (comp.type === 'F510K') {
    return [0, -100];
  }
  return [1, comp.topOrder];
}

function compareStrengthTuple(a: [number, number], b: [number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  return a[1] - b[1];
}

function getDecisiveFamilyKey(comp: AtomicPattern): string {
  switch (comp.type) {
    case 'SINGLE':
      return '1x1';
    case 'PAIR':
      return '2x1';
    case 'TRACTOR':
      return `2x${comp.length}`;
    case 'TRIPLE':
      return '3x1';
    case 'TRIPLE_TRACTOR':
    case 'F510K':
      return `3x${comp.length}`;
  }
}

/**
 * Compare two matched sling component sets (candidate `a` vs current best `b`):
 * 1. Only components with the largest single-group card count decide the winner
 *    (e.g. 4-card tractor > 3-card triple/510K > 2-card pair > 1-card single).
 * 2. Within the same pattern family (e.g. multiple singles or multiple pairs),
 *    only the strongest single group is compared; ties return 0 (first-played wins).
 * 3. If multiple incomparable families share the exact same max card count
 *    (e.g. 6-card 3-pair tractor + 6-card 2-triple tractor), `a` beats `b` iff
 *    `a` is >= `b` in every such family and strictly > in at least one.
 */
export function compareMatchedComponents(
  a: readonly AtomicPattern[],
  b: readonly AtomicPattern[],
): number {
  if (a.length === 0 || b.length === 0) return 0;

  let maxSize = 0;
  for (const comp of a) {
    if (comp.cards.length > maxSize) maxSize = comp.cards.length;
  }

  const bestByFamily = (comps: readonly AtomicPattern[]) => {
    const map = new Map<string, [number, number]>();
    for (const comp of comps) {
      if (comp.cards.length !== maxSize) continue;
      const fam = getDecisiveFamilyKey(comp);
      const strength = getComponentStrengthTuple(comp);
      const cur = map.get(fam);
      if (!cur || compareStrengthTuple(strength, cur) > 0) {
        map.set(fam, strength);
      }
    }
    return map;
  };

  const mapA = bestByFamily(a);
  const mapB = bestByFamily(b);

  let hasGreater = false;
  for (const [fam, strA] of mapA) {
    const strB = mapB.get(fam);
    if (!strB) continue;
    const cmp = compareStrengthTuple(strA, strB);
    if (cmp < 0) return -1;
    if (cmp > 0) hasGreater = true;
  }
  return hasGreater ? 1 : 0;
}

export function canMatchSlingStructure(
  cards: readonly Card[],
  targetComponents: readonly AtomicPattern[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): { matched: boolean; matchedComponents: AtomicPattern[] } {
  const totalNeeded = targetComponents.reduce(
    (sum, c) => sum + c.cards.length,
    0,
  );
  if (cards.length !== totalNeeded) {
    return { matched: false, matchedComponents: [] };
  }

  const orderedTargets = sortComponentsCanonical(targetComponents);
  const hasF510KTarget = orderedTargets.some((c) => c.type === 'F510K');

  let category = getSingleCategory(cards, trumpSuit, levelRank);
  if (!category && hasF510KTarget) {
    const firstSuit = cards[0]?.suit;
    if (
      firstSuit &&
      firstSuit !== 'J' &&
      firstSuit !== trumpSuit &&
      cards.every((c) => c.suit === firstSuit)
    ) {
      category = firstSuit;
    }
  }
  if (!category) return { matched: false, matchedComponents: [] };

  const f510kSuit: StandardSuit | null =
    category === 'TRUMP' ? trumpSuit : category;

  const search = (
    idx: number,
    remCards: readonly Card[],
    acc: AtomicPattern[],
  ): AtomicPattern[] | null => {
    if (idx === orderedTargets.length) {
      return remCards.length === 0 ? [...acc] : null;
    }

    const target = orderedTargets[idx];

    if (target.type === 'F510K') {
      const k = target.length;
      const remPool = groupCardsByKey(remCards, trumpSuit, levelRank);
      const candidates: Array<{ pattern: AtomicPattern; usedIds: Set<number> }> = [];

      // 1. Prefer beating shapes first: TRIPLE (for k=1) or TRIPLE_TRACTOR(k) (for k>=2)
      //    only using genuine cards of `category`
      const inCatRem = remCards.filter(
        (c) => getCardCategory(c, trumpSuit, levelRank) === category,
      );
      const inCatPool = groupCardsByKey(inCatRem, trumpSuit, levelRank);
      if (k === 1) {
        for (const g of inCatPool) {
          if (g.cards.length === 3) {
            candidates.push({
              pattern: {
                type: 'TRIPLE',
                cards: g.cards.slice(0, 3),
                cardKeys: [g.key],
                length: 1,
                topOrder: g.order,
                usedLowAce: false,
              },
              usedIds: new Set(g.cards.slice(0, 3).map((c) => c.id)),
            });
          }
        }
      } else {
        for (const ch of enumerateChainCandidates(inCatPool, 3, { exactLength: k })) {
          candidates.push({
            pattern: toAtomicPattern(ch),
            usedIds: new Set(ch.cards.map((c) => c.id)),
          });
        }
      }

      // 2. Also allow matching with k units of same-suit F510K (e.g. trump 510K killing side 510K)
      if (f510kSuit) {
        const c5 = remCards.filter((c) => c.suit === f510kSuit && c.rank === '5');
        const c10 = remCards.filter((c) => c.suit === f510kSuit && c.rank === '10');
        const cK = remCards.filter((c) => c.suit === f510kSuit && c.rank === 'K');
        if (Math.min(c5.length, c10.length, cK.length) >= k) {
          const picked: Card[] = [];
          for (let i = 0; i < k; i++) picked.push(c5[i], c10[i], cK[i]);
          candidates.push({
            pattern: {
              type: 'F510K',
              cards: picked,
              cardKeys: [`${f510kSuit}:5`, `${f510kSuit}:10`, `${f510kSuit}:K`],
              length: k,
              topOrder: -100,
              usedLowAce: false,
            },
            usedIds: new Set(picked.map((c) => c.id)),
          });
        }
      }

      // Unused variable suppression for remPool if needed
      void remPool;

      for (const cand of candidates) {
        const nextRem = remCards.filter((c) => !cand.usedIds.has(c.id));
        acc.push(cand.pattern);
        const res = search(idx + 1, nextRem, acc);
        if (res) return res;
        acc.pop();
      }
      return null;
    }

    // For all remaining non-F510K targets, every remaining card must strictly belong to `category`
    if (
      !orderedTargets.slice(idx).some((t) => t.type === 'F510K') &&
      getSingleCategory(remCards, trumpSuit, levelRank) !== category
    ) {
      return null;
    }

    const inCatRem = remCards.filter(
      (c) => getCardCategory(c, trumpSuit, levelRank) === category,
    );
    const pool = groupCardsByKey(inCatRem, trumpSuit, levelRank);

    if (target.type === 'TRIPLE_TRACTOR' || target.type === 'TRACTOR') {
      const mult: 2 | 3 = target.type === 'TRIPLE_TRACTOR' ? 3 : 2;
      const chains = enumerateChainCandidates(pool, mult, {
        exactLength: target.length,
      });
      for (const ch of chains) {
        const usedIds = new Set(ch.cards.map((c) => c.id));
        const nextRem = remCards.filter((c) => !usedIds.has(c.id));
        acc.push(toAtomicPattern(ch));
        const res = search(idx + 1, nextRem, acc);
        if (res) return res;
        acc.pop();
      }
      return null;
    }

    const needCount =
      target.type === 'TRIPLE' ? 3 : target.type === 'PAIR' ? 2 : 1;

    for (const g of pool) {
      if (g.cards.length < needCount) continue;
      const picked = g.cards.slice(0, needCount);
      const usedIds = new Set(picked.map((c) => c.id));
      const nextRem = remCards.filter((c) => !usedIds.has(c.id));
      acc.push({
        type: target.type,
        cards: picked,
        cardKeys: [g.key],
        length: 1,
        topOrder: g.order,
        usedLowAce: false,
      });
      const res = search(idx + 1, nextRem, acc);
      if (res) return res;
      acc.pop();
    }
    return null;
  };

  const matched = search(0, cards, []);
  if (!matched) return { matched: false, matchedComponents: [] };
  return { matched: true, matchedComponents: matched };
}
