import type {
  AtomicPattern,
  Card,
  CardCategory,
  LevelRank,
  ParsedPlay,
  Seat,
  StandardSuit,
} from '@jinshan/protocol';
import {
  getCardCategory,
  getCardOrder,
  getCardPoints,
} from './cards.js';
import {
  canHandBeatComponent,
  canMatchSlingStructure,
  compareMatchedComponents,
  enumerateChainCandidates,
  getSingleCategory,
  groupCardsByKey,
  parse510K,
  parsePlay,
  type KeyGroup,
} from './patterns.js';
import type {
  FollowValidationResult,
  LeadValidationResult,
  TrickPlay,
} from './types.js';

interface FollowProfile {
  tripleScore: number[];
  pairScore: number[];
  bestTripleKeys: string[];
  bestPairChainKeys: string[][];
  bestExtraPairKeys: string[];
}

function compareNumberArrays(a: readonly number[], b: readonly number[]): number {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;
    if (va !== vb) return va - vb;
  }
  return 0;
}

function compareProfiles(a: FollowProfile, b: FollowProfile): number {
  const tDiff = compareNumberArrays(a.tripleScore, b.tripleScore);
  if (tDiff !== 0) return tDiff;
  return compareNumberArrays(a.pairScore, b.pairScore);
}

function evaluateChainDemandSatisfaction(
  groups: readonly KeyGroup[],
  multiplicity: 2 | 3,
  demands: readonly number[],
  totalSlots: number,
  totalAvailableUnits: number,
): { lengths: number[]; chainKeys: string[][]; unitScore: number[] } {
  const unitCount = Math.min(totalSlots, totalAvailableUnits);
  if (demands.length === 0) {
    return { lengths: [], chainKeys: [], unitScore: [unitCount] };
  }

  if (demands.length === 1) {
    const d = demands[0];
    const chains = enumerateChainCandidates(groups, multiplicity, {
      maxLength: d,
    });
    if (chains.length === 0) {
      return { lengths: [0], chainKeys: [], unitScore: [0, unitCount] };
    }
    // Prefer longest chain; among ties prefer lowest topOrder for constructive fallback
    const bestLen = chains[0].length;
    const lowestOfBest = [...chains]
      .filter((c) => c.length === bestLen)
      .sort((a, b) => a.topOrder - b.topOrder)[0];
    return {
      lengths: [bestLen],
      chainKeys: [lowestOfBest.keys],
      unitScore: [bestLen, unitCount],
    };
  }

  let bestLengths: number[] | null = null;
  let bestChainKeys: string[][] = [];

  const search = (
    idx: number,
    pool: readonly KeyGroup[],
    lens: number[],
    picked: string[][],
  ) => {
    if (idx === demands.length) {
      if (!bestLengths || compareNumberArrays(lens, bestLengths) > 0) {
        bestLengths = [...lens];
        bestChainKeys = picked.map((k) => [...k]);
      }
      return;
    }

    const d = demands[idx];
    const chains = enumerateChainCandidates(pool, multiplicity, {
      maxLength: d,
    });

    if (chains.length === 0) {
      lens.push(0);
      search(idx + 1, pool, lens, picked);
      lens.pop();
      return;
    }

    // Try up to top few chains per length tier to keep branching bounded
    const maxFoundLen = chains[0].length;
    const seenSig = new Set<string>();
    for (const ch of chains) {
      if (ch.length < maxFoundLen && bestLengths && (bestLengths[idx] ?? 0) > ch.length) {
        break;
      }
      const sig = `${ch.length}:${ch.keys.join(',')}`;
      if (seenSig.has(sig)) continue;
      seenSig.add(sig);

      const used = new Set(ch.keys);
      const nextPool = pool.filter((g) => !used.has(g.key));
      lens.push(ch.length);
      picked.push(ch.keys);
      search(idx + 1, nextPool, lens, picked);
      picked.pop();
      lens.pop();
    }
  };

  search(0, groups, [], []);
  const finalLengths = bestLengths ?? demands.map(() => 0);
  return {
    lengths: finalLengths,
    chainKeys: bestChainKeys,
    unitScore: [...finalLengths, unitCount],
  };
}

function computeBestFollowProfile(
  cardsInCat: readonly Card[],
  leadComponents: readonly AtomicPattern[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): FollowProfile {
  const ttDemands = leadComponents
    .filter((c) => c.type === 'TRIPLE_TRACTOR')
    .map((c) => c.length)
    .sort((a, b) => b - a);
  const tDemandCount = leadComponents.filter((c) => c.type === 'TRIPLE').length;
  const totalTripleSlots =
    ttDemands.reduce((s, l) => s + l, 0) + tDemandCount;

  const trDemands = leadComponents
    .filter((c) => c.type === 'TRACTOR')
    .map((c) => c.length)
    .sort((a, b) => b - a);
  const pDemandCount = leadComponents.filter((c) => c.type === 'PAIR').length;
  const totalPairSlots = trDemands.reduce((s, l) => s + l, 0) + pDemandCount;

  if (totalTripleSlots === 0 && totalPairSlots === 0) {
    return {
      tripleScore: [],
      pairScore: [],
      bestTripleKeys: [],
      bestPairChainKeys: [],
      bestExtraPairKeys: [],
    };
  }

  const groups = groupCardsByKey(cardsInCat, trumpSuit, levelRank);
  // Sort ascending by order for lowest constructive selection
  const ascGroups = [...groups].sort((a, b) => a.order - b.order);
  const tripleGroups = ascGroups.filter((g) => g.cards.length === 3);

  const evaluateWithTripleSubset = (chosenTriples: KeyGroup[]): FollowProfile => {
    const tripleSet = new Set(chosenTriples.map((g) => g.key));
    const tripleEval =
      totalTripleSlots > 0
        ? evaluateChainDemandSatisfaction(
            chosenTriples,
            3,
            ttDemands,
            totalTripleSlots,
            chosenTriples.length,
          )
        : { lengths: [], chainKeys: [], unitScore: [] };

    const remainingForPairs = ascGroups.filter(
      (g) => !tripleSet.has(g.key) && g.cards.length >= 2,
    );

    const pairEval =
      totalPairSlots > 0
        ? evaluateChainDemandSatisfaction(
            remainingForPairs,
            2,
            trDemands,
            totalPairSlots,
            remainingForPairs.length,
          )
        : { lengths: [], chainKeys: [], unitScore: [] };

    const usedInChains = new Set(pairEval.chainKeys.flat());
    const extraPairKeys = remainingForPairs
      .filter((g) => !usedInChains.has(g.key))
      .slice(0, Math.max(0, Math.min(totalPairSlots, remainingForPairs.length) - usedInChains.size))
      .map((g) => g.key);

    return {
      tripleScore: tripleEval.unitScore,
      pairScore: pairEval.unitScore,
      bestTripleKeys: chosenTriples.map((g) => g.key),
      bestPairChainKeys: pairEval.chainKeys,
      bestExtraPairKeys: extraPairKeys,
    };
  };

  if (totalTripleSlots === 0 || tripleGroups.length === 0) {
    return evaluateWithTripleSubset([]);
  }

  const pickCount = Math.min(totalTripleSlots, tripleGroups.length);

  // Fast path when all triples are needed and no pair competition exists or all triples consumed
  if (tripleGroups.length <= totalTripleSlots) {
    return evaluateWithTripleSubset(tripleGroups);
  }

  // Subset search when choosing pickCount triples out of tripleGroups
  // If no triple-tractor AND no pairs exist, any pickCount triples give identical score
  if (ttDemands.length === 0 && totalPairSlots === 0) {
    return evaluateWithTripleSubset(tripleGroups.slice(0, pickCount));
  }

  let bestProfile: FollowProfile | null = null;
  const chosen: KeyGroup[] = [];

  const chooseSubsets = (startIdx: number) => {
    if (chosen.length === pickCount) {
      const profile = evaluateWithTripleSubset(chosen);
      if (!bestProfile || compareProfiles(profile, bestProfile) > 0) {
        bestProfile = profile;
      }
      return;
    }
    const needed = pickCount - chosen.length;
    for (let i = startIdx; i <= tripleGroups.length - needed; i++) {
      chosen.push(tripleGroups[i]);
      chooseSubsets(i + 1);
      chosen.pop();
    }
  };

  chooseSubsets(0);
  return bestProfile ?? evaluateWithTripleSubset([]);
}

export function validateLeadPlay(
  hand: readonly Card[],
  selectedIds: readonly number[],
  otherHands: readonly (readonly Card[])[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): LeadValidationResult {
  if (selectedIds.length === 0) {
    return { valid: false, reason: '请至少选择一张牌出牌' };
  }

  const uniqueIds = new Set(selectedIds);
  if (uniqueIds.size !== selectedIds.length) {
    return { valid: false, reason: '选牌存在重复' };
  }

  const handMap = new Map(hand.map((c) => [c.id, c]));
  const selectedCards: Card[] = [];
  for (const id of selectedIds) {
    const card = handMap.get(id);
    if (!card) {
      return { valid: false, reason: '所选牌不在手牌中' };
    }
    selectedCards.push(card);
  }

  const parsed = parsePlay(selectedCards, trumpSuit, levelRank);
  if (!parsed) {
    return {
      valid: false,
      reason: '首家出牌必须属于同一种花色（或全部为主牌）',
    };
  }

  if (parsed.patternType !== 'SLING') {
    return {
      valid: true,
      slingFailed: false,
      effectiveCards: parsed.cards,
      parsed,
    };
  }

  // Validate SLING against all other players' hands
  const beatenComponents: AtomicPattern[] = [];
  for (const comp of parsed.components) {
    const isBeaten = otherHands.some((oh) =>
      canHandBeatComponent(oh, parsed.category, comp, trumpSuit, levelRank),
    );
    if (isBeaten) {
      beatenComponents.push(comp);
    }
  }

  if (beatenComponents.length === 0) {
    return {
      valid: true,
      slingFailed: false,
      effectiveCards: selectedCards,
      parsed,
    };
  }

  beatenComponents.sort((a, b) => {
    if (a.topOrder !== b.topOrder) return a.topOrder - b.topOrder;
    return a.cards.length - b.cards.length;
  });

  const smallestBeaten = beatenComponents[0];
  return {
    valid: true,
    slingFailed: true,
    effectiveCards: smallestBeaten.cards,
    failedComponent: smallestBeaten,
    parsed: {
      patternType: smallestBeaten.type,
      category: parsed.category,
      cards: smallestBeaten.cards,
      components: [smallestBeaten],
    },
  };
}

function isTopMTrumps(
  selected: readonly Card[],
  pool: readonly Card[],
  m: number,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): boolean {
  if (m === 0) return true;
  if (selected.length !== m || pool.length < m) return false;

  const sortedPool = [...pool].sort(
    (a, b) =>
      getCardOrder(b, trumpSuit, levelRank) -
      getCardOrder(a, trumpSuit, levelRank),
  );
  const cutoff = getCardOrder(sortedPool[m - 1], trumpSuit, levelRank);
  const selectedIdSet = new Set(selected.map((c) => c.id));

  for (const c of pool) {
    if (getCardOrder(c, trumpSuit, levelRank) > cutoff && !selectedIdSet.has(c.id)) {
      return false;
    }
  }
  for (const c of selected) {
    if (getCardOrder(c, trumpSuit, levelRank) < cutoff) {
      return false;
    }
  }
  return true;
}

function validateTrump510KFollow(
  inCatHand: readonly Card[],
  selectedCards: readonly Card[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): boolean {
  const search = (remSelected: Card[], remHand: Card[]): boolean => {
    if (remSelected.length === 0) return true;
    if (isTopMTrumps(remSelected, remHand, remSelected.length, trumpSuit, levelRank)) {
      return true;
    }

    // Try extracting a trump TRIPLE (3 identical suit:rank cards)
    const groups = groupCardsByKey(remSelected, trumpSuit, levelRank);
    for (const g of groups) {
      if (g.cards.length === 3) {
        const dropIds = new Set(g.cards.map((c) => c.id));
        if (
          search(
            remSelected.filter((c) => !dropIds.has(c.id)),
            remHand.filter((c) => !dropIds.has(c.id)),
          )
        ) {
          return true;
        }
      }
    }

    // Try extracting a trump 510K (only possible when trumpSuit is a standard suit)
    if (trumpSuit !== null) {
      const c5 = remSelected.find((c) => c.suit === trumpSuit && c.rank === '5');
      const c10 = remSelected.find((c) => c.suit === trumpSuit && c.rank === '10');
      const cK = remSelected.find((c) => c.suit === trumpSuit && c.rank === 'K');
      if (c5 && c10 && cK) {
        const dropIds = new Set([c5.id, c10.id, cK.id]);
        if (
          search(
            remSelected.filter((c) => !dropIds.has(c.id)),
            remHand.filter((c) => !dropIds.has(c.id)),
          )
        ) {
          return true;
        }
      }
    }

    return false;
  };

  return search([...selectedCards], [...inCatHand]);
}

function validate510KFollowPlay(
  hand: readonly Card[],
  selectedCards: readonly Card[],
  leadPlay: ParsedPlay,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): FollowValidationResult {
  const k = leadPlay.components[0].length;
  const leadCount = 3 * k;
  const inCatHand = hand.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) === leadPlay.category,
  );
  const inCatSelected = selectedCards.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) === leadPlay.category,
  );

  // Branch A: Lead was TRUMP 510K
  if (leadPlay.category === 'TRUMP') {
    const required = Math.min(inCatHand.length, leadCount);
    if (inCatSelected.length !== required) {
      return { valid: false, reason: '手中有主牌时必须优先跟出主牌' };
    }
    if (inCatHand.length <= leadCount) {
      return {
        valid: true,
        matchedTrumpKill: false,
        parsed:
          (inCatHand.length === leadCount
            ? parsePlay(selectedCards, trumpSuit, levelRank)
            : null) ?? {
            patternType: 'SLING',
            category: 'TRUMP',
            cards: [...selectedCards],
            components: [],
          },
      };
    }

    if (!validateTrump510KFollow(inCatHand, selectedCards, trumpSuit, levelRank)) {
      return {
        valid: false,
        reason: '跟主牌 510K 若未用三张或 510K 抵消，必须出最大的对应张数主牌',
      };
    }
    return {
      valid: true,
      matchedTrumpKill: false,
      parsed: parsePlay(selectedCards, trumpSuit, levelRank) ?? {
        patternType: 'SLING',
        category: 'TRUMP',
        cards: [...selectedCards],
        components: [],
      },
    };
  }

  // Branch B: Lead was non-trump 510K of suit S (may borrow ♥5 / level 10 / level K)
  const targetSuit = leadPlay.category;
  const fives = selectedCards.filter((c) => c.suit === targetSuit && c.rank === '5');
  const tens = selectedCards.filter((c) => c.suit === targetSuit && c.rank === '10');
  const ks = selectedCards.filter((c) => c.suit === targetSuit && c.rank === 'K');
  const maxUnits = Math.min(k, fives.length, tens.length, ks.length);

  let validFollowFound = false;
  let matchedAllSameSuitUnits = false;

  for (let m = maxUnits; m >= 0; m--) {
    const unitIds = new Set<number>();
    for (let i = 0; i < m; i++) {
      unitIds.add(fives[i].id);
      unitIds.add(tens[i].id);
      unitIds.add(ks[i].id);
    }
    const remSelected = selectedCards.filter((c) => !unitIds.has(c.id));
    const remInCatHand = inCatHand.filter((c) => !unitIds.has(c.id));
    const remInCatSelected = remSelected.filter(
      (c) => getCardCategory(c, trumpSuit, levelRank) === targetSuit,
    );
    const reqRem = Math.min(remInCatHand.length, remSelected.length);
    if (remInCatSelected.length === reqRem) {
      validFollowFound = true;
      matchedAllSameSuitUnits = m === k;
      break;
    }
  }

  if (!validFollowFound) {
    return {
      valid: false,
      reason: '手中有首家花色时必须优先跟出同门花色',
    };
  }

  if (inCatHand.length === 0 && !matchedAllSameSuitUnits) {
    const trump510k = parse510K(selectedCards, trumpSuit);
    if (trump510k && trump510k.category === 'TRUMP' && trump510k.atomic.length === k) {
      return {
        valid: true,
        matchedTrumpKill: true,
        parsed: {
          patternType: 'F510K',
          category: 'TRUMP',
          cards: [...selectedCards],
          components: [trump510k.atomic],
        },
      };
    }
    const cat = getSingleCategory(selectedCards, trumpSuit, levelRank);
    if (cat === 'TRUMP') {
      const parsed = parsePlay(selectedCards, trumpSuit, levelRank);
      const isKillBeater =
        parsed &&
        (k === 1
          ? parsed.patternType === 'TRIPLE'
          : parsed.patternType === 'TRIPLE_TRACTOR' &&
            parsed.components[0].length === k);
      if (isKillBeater) {
        return {
          valid: true,
          matchedTrumpKill: true,
          parsed,
        };
      }
    }
  }

  return {
    valid: true,
    matchedTrumpKill: false,
    parsed: parsePlay(selectedCards, trumpSuit, levelRank) ?? {
      patternType: 'SLING',
      category: leadPlay.category,
      cards: [...selectedCards],
      components: [],
    },
  };
}

export function validateFollowPlay(
  hand: readonly Card[],
  selectedIds: readonly number[],
  leadPlay: ParsedPlay,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): FollowValidationResult {
  const leadCount = leadPlay.cards.length;
  if (selectedIds.length !== leadCount) {
    return {
      valid: false,
      reason: `跟牌张数必须等于首家出牌张数（${leadCount} 张）`,
    };
  }

  const uniqueIds = new Set(selectedIds);
  if (uniqueIds.size !== selectedIds.length) {
    return { valid: false, reason: '选牌存在重复' };
  }

  const handMap = new Map(hand.map((c) => [c.id, c]));
  const selectedCards: Card[] = [];
  for (const id of selectedIds) {
    const card = handMap.get(id);
    if (!card) {
      return { valid: false, reason: '所选牌不在手牌中' };
    }
    selectedCards.push(card);
  }

  if (leadPlay.patternType === 'F510K') {
    return validate510KFollowPlay(
      hand,
      selectedCards,
      leadPlay,
      trumpSuit,
      levelRank,
    );
  }

  const inCatHand = hand.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) === leadPlay.category,
  );
  const inCatSelected = selectedCards.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) === leadPlay.category,
  );

  const requiredInCat = Math.min(inCatHand.length, leadCount);
  if (inCatSelected.length !== requiredInCat) {
    return {
      valid: false,
      reason:
        leadPlay.category === 'TRUMP'
          ? '手中有主牌时必须优先跟出主牌'
          : '手中有首家花色时必须优先跟出同门花色',
    };
  }

  // Case 1: Void in led category
  if (inCatHand.length === 0) {
    if (leadPlay.category !== 'TRUMP') {
      const cat = getSingleCategory(selectedCards, trumpSuit, levelRank);
      if (cat === 'TRUMP') {
        const killMatch = canMatchSlingStructure(
          selectedCards,
          leadPlay.components,
          trumpSuit,
          levelRank,
        );
        if (killMatch.matched) {
          return {
            valid: true,
            matchedTrumpKill: true,
            parsed: {
              patternType:
                killMatch.matchedComponents.length === 1
                  ? killMatch.matchedComponents[0].type
                  : 'SLING',
              category: 'TRUMP',
              cards: selectedCards,
              components: killMatch.matchedComponents,
            },
          };
        }
      }
    }
    return {
      valid: true,
      matchedTrumpKill: false,
      parsed: {
        patternType: leadCount === 1 ? 'SINGLE' : 'SLING',
        category: leadPlay.category,
        cards: selectedCards,
        components: [],
      },
    };
  }

  // Case 2: Has <= leadCount cards in led category (must dump all of them)
  if (inCatHand.length <= leadCount) {
    const parsed: ParsedPlay =
      (inCatHand.length === leadCount
        ? parsePlay(selectedCards, trumpSuit, levelRank)
        : null) ?? {
        patternType: leadCount === 1 ? 'SINGLE' : 'SLING',
        category: leadPlay.category,
        cards: selectedCards,
        components: [],
      };
    return {
      valid: true,
      matchedTrumpKill: false,
      parsed,
    };
  }

  // Case 3: Has > leadCount cards in led category (must meet structural obligations)
  const handProfile = computeBestFollowProfile(
    inCatHand,
    leadPlay.components,
    trumpSuit,
    levelRank,
  );
  const selectedProfile = computeBestFollowProfile(
    inCatSelected,
    leadPlay.components,
    trumpSuit,
    levelRank,
  );

  if (compareProfiles(selectedProfile, handProfile) < 0) {
    return {
      valid: false,
      reason: '未按规则跟出对应的三张、拖拉机或对子',
    };
  }

  const parsed =
    parsePlay(selectedCards, trumpSuit, levelRank) ?? {
      patternType: 'SLING',
      category: leadPlay.category,
      cards: selectedCards,
      components: [],
    };

  return {
    valid: true,
    matchedTrumpKill: false,
    parsed,
  };
}

function classify510KContender(
  cards: readonly Card[],
  leadCategory: CardCategory,
  k: number,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): { tier: number; order: number } {
  const f510k = parse510K(cards, trumpSuit);
  if (f510k && f510k.atomic.length === k) {
    if (f510k.category === 'TRUMP') return { tier: 2, order: -100 };
    if (f510k.category === leadCategory) return { tier: 0, order: -100 };
    return { tier: -1, order: -1000 };
  }

  const parsed = parsePlay(cards, trumpSuit, levelRank);
  if (!parsed) return { tier: -1, order: -1000 };

  const isBeaterShape =
    k === 1
      ? parsed.patternType === 'TRIPLE'
      : parsed.patternType === 'TRIPLE_TRACTOR' &&
        parsed.components[0].length === k;

  if (!isBeaterShape) return { tier: -1, order: -1000 };

  if (parsed.category === 'TRUMP') {
    return { tier: 3, order: parsed.components[0].topOrder };
  }
  if (parsed.category === leadCategory) {
    return { tier: 1, order: parsed.components[0].topOrder };
  }
  return { tier: -1, order: -1000 };
}

export function resolveTrickWinner(
  trickPlays: readonly TrickPlay[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): { winnerSeat: Seat; pointsInTrick: number; killedByTrump: boolean } {
  const leadPlay = trickPlays[0];
  const leadParsed = leadPlay.parsed;

  if (leadParsed.patternType === 'F510K') {
    const k = leadParsed.components[0].length;
    let bestPlay = leadPlay;
    let bestRank = classify510KContender(
      leadPlay.cards,
      leadParsed.category,
      k,
      trumpSuit,
      levelRank,
    );

    for (let i = 1; i < trickPlays.length; i++) {
      const play = trickPlays[i];
      const rank = classify510KContender(
        play.cards,
        leadParsed.category,
        k,
        trumpSuit,
        levelRank,
      );
      if (
        rank.tier > bestRank.tier ||
        (rank.tier === bestRank.tier && rank.order > bestRank.order)
      ) {
        bestPlay = play;
        bestRank = rank;
      }
    }

    const pointsInTrick = trickPlays.reduce(
      (sum, p) =>
        sum + p.cards.reduce((s, card) => s + getCardPoints(card), 0),
      0,
    );

    return {
      winnerSeat: bestPlay.seat,
      pointsInTrick,
      killedByTrump: leadParsed.category !== 'TRUMP' && bestRank.tier >= 2,
    };
  }

  let bestPlay = leadPlay;
  let bestComponents = leadParsed.components;
  let bestIsTrump = leadParsed.category === 'TRUMP';
  let killedByTrump = false;

  for (let i = 1; i < trickPlays.length; i++) {
    const play = trickPlays[i];
    const cat = getSingleCategory(play.cards, trumpSuit, levelRank);
    if (!cat) continue;

    if (cat === leadParsed.category) {
      if (bestIsTrump && leadParsed.category !== 'TRUMP') {
        continue;
      }
      const match = canMatchSlingStructure(
        play.cards,
        leadParsed.components,
        trumpSuit,
        levelRank,
      );
      if (
        match.matched &&
        compareMatchedComponents(match.matchedComponents, bestComponents) > 0
      ) {
        bestPlay = play;
        bestComponents = match.matchedComponents;
      }
    } else if (cat === 'TRUMP' && leadParsed.category !== 'TRUMP') {
      const match = canMatchSlingStructure(
        play.cards,
        leadParsed.components,
        trumpSuit,
        levelRank,
      );
      if (!match.matched) continue;
      if (!bestIsTrump) {
        bestIsTrump = true;
        killedByTrump = true;
        bestPlay = play;
        bestComponents = match.matchedComponents;
      } else if (
        compareMatchedComponents(match.matchedComponents, bestComponents) > 0
      ) {
        bestPlay = play;
        bestComponents = match.matchedComponents;
      }
    }
  }

  const pointsInTrick = trickPlays.reduce(
    (sum, p) =>
      sum + p.cards.reduce((s, card) => s + getCardPoints(card), 0),
    0,
  );

  return {
    winnerSeat: bestPlay.seat,
    pointsInTrick,
    killedByTrump,
  };
}

function sortCardsForDiscard(
  cards: readonly Card[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
  preferPoints: boolean,
): Card[] {
  return [...cards].sort((a, b) => {
    const aIsTrump = getCardCategory(a, trumpSuit, levelRank) === 'TRUMP';
    const bIsTrump = getCardCategory(b, trumpSuit, levelRank) === 'TRUMP';
    if (aIsTrump !== bIsTrump) return aIsTrump ? 1 : -1;

    const ptsDiff = getCardPoints(a) - getCardPoints(b);
    if (ptsDiff !== 0) return preferPoints ? -ptsDiff : ptsDiff;

    const orderDiff =
      getCardOrder(a, trumpSuit, levelRank) - getCardOrder(b, trumpSuit, levelRank);
    if (orderDiff !== 0) return orderDiff;
    return a.id - b.id;
  });
}

export function findLegalFollowCards(
  hand: readonly Card[],
  leadPlay: ParsedPlay,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): Card[][] {
  const N = leadPlay.cards.length;
  const candidates: Card[][] = [];
  const seenSignatures = new Set<string>();

  const pushIfValid = (cards: readonly Card[]) => {
    if (cards.length !== N) return;
    const ids = cards.map((c) => c.id);
    const sig = [...ids].sort((a, b) => a - b).join(',');
    if (seenSignatures.has(sig)) return;
    const check = validateFollowPlay(hand, ids, leadPlay, trumpSuit, levelRank);
    if (check.valid) {
      seenSignatures.add(sig);
      candidates.push([...cards]);
    }
  };

  const inCatHand = hand.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) === leadPlay.category,
  );
  const outCatHand = hand.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) !== leadPlay.category,
  );

  if (leadPlay.patternType === 'F510K') {
    const k = leadPlay.components[0].length;
    if (leadPlay.category === 'TRUMP') {
      if (inCatHand.length > N) {
        const sortedDesc = [...inCatHand].sort(
          (a, b) =>
            getCardOrder(b, trumpSuit, levelRank) -
            getCardOrder(a, trumpSuit, levelRank),
        );
        pushIfValid(sortedDesc.slice(0, N));

        const groups = groupCardsByKey(inCatHand, trumpSuit, levelRank);
        if (k === 1) {
          for (const g of groups) {
            if (g.cards.length === 3) pushIfValid(g.cards);
          }
        } else {
          const chains = enumerateChainCandidates(groups, 3, { exactLength: k });
          for (const ch of chains) {
            pushIfValid(ch.cards);
          }
          // Try using disconnected triples + top remaining trumps
          const triples = groups.filter((g) => g.cards.length === 3);
          if (triples.length > 0) {
            const takeTriples = triples.slice(0, k).flatMap((g) => g.cards);
            const usedIds = new Set(takeTriples.map((c) => c.id));
            const remTop = sortedDesc
              .filter((c) => !usedIds.has(c.id))
              .slice(0, N - takeTriples.length);
            pushIfValid([...takeTriples, ...remTop]);
          }
        }
        if (trumpSuit !== null) {
          const f5 = inCatHand.filter((c) => c.suit === trumpSuit && c.rank === '5');
          const f10 = inCatHand.filter((c) => c.suit === trumpSuit && c.rank === '10');
          const fK = inCatHand.filter((c) => c.suit === trumpSuit && c.rank === 'K');
          const availUnits = Math.min(k, f5.length, f10.length, fK.length);
          for (let u = availUnits; u >= 1; u--) {
            const unitCards: Card[] = [];
            for (let i = 0; i < u; i++) {
              unitCards.push(f5[i], f10[i], fK[i]);
            }
            const usedIds = new Set(unitCards.map((c) => c.id));
            const remTop = sortedDesc
              .filter((c) => !usedIds.has(c.id))
              .slice(0, N - unitCards.length);
            pushIfValid([...unitCards, ...remTop]);
          }
        }
        return candidates;
      }
      if (inCatHand.length > 0) {
        const needExtra = N - inCatHand.length;
        pushIfValid([
          ...inCatHand,
          ...sortCardsForDiscard(outCatHand, trumpSuit, levelRank, false).slice(0, needExtra),
        ]);
        pushIfValid([
          ...inCatHand,
          ...sortCardsForDiscard(outCatHand, trumpSuit, levelRank, true).slice(0, needExtra),
        ]);
        return candidates;
      }
    } else {
      // Non-trump 510K of suit S: check same-suit 510K (including borrowed ♥5/10/K), same-suit beaters, and trump kills
      const targetSuit = leadPlay.category;
      const s5 = hand.filter((c) => c.suit === targetSuit && c.rank === '5');
      const s10 = hand.filter((c) => c.suit === targetSuit && c.rank === '10');
      const sK = hand.filter((c) => c.suit === targetSuit && c.rank === 'K');
      if (Math.min(s5.length, s10.length, sK.length) >= k) {
        const unitCards: Card[] = [];
        for (let i = 0; i < k; i++) {
          unitCards.push(s5[i], s10[i], sK[i]);
        }
        pushIfValid(unitCards);
      }

      if (inCatHand.length > N) {
        const groups = groupCardsByKey(inCatHand, trumpSuit, levelRank);
        if (k === 1) {
          for (const g of groups) {
            if (g.cards.length === 3) pushIfValid(g.cards);
          }
        } else {
          for (const ch of enumerateChainCandidates(groups, 3, { exactLength: k })) {
            pushIfValid(ch.cards);
          }
        }
        pushIfValid(sortCardsForDiscard(inCatHand, trumpSuit, levelRank, false).slice(0, N));
        pushIfValid(sortCardsForDiscard(inCatHand, trumpSuit, levelRank, true).slice(0, N));
        return candidates;
      }

      if (inCatHand.length === 0 && trumpSuit !== null) {
        const trumps = hand.filter(
          (c) => getCardCategory(c, trumpSuit, levelRank) === 'TRUMP',
        );
        const tGroups = groupCardsByKey(trumps, trumpSuit, levelRank);
        if (k === 1) {
          for (const g of tGroups) {
            if (g.cards.length === 3) pushIfValid(g.cards);
          }
        } else {
          for (const ch of enumerateChainCandidates(tGroups, 3, { exactLength: k })) {
            pushIfValid(ch.cards);
          }
        }
        const t5 = trumps.filter((c) => c.suit === trumpSuit && c.rank === '5');
        const t10 = trumps.filter((c) => c.suit === trumpSuit && c.rank === '10');
        const tK = trumps.filter((c) => c.suit === trumpSuit && c.rank === 'K');
        if (Math.min(t5.length, t10.length, tK.length) >= k) {
          const kill510k: Card[] = [];
          for (let i = 0; i < k; i++) kill510k.push(t5[i], t10[i], tK[i]);
          pushIfValid(kill510k);
        }
      }
    }
  }

  if (inCatHand.length === 0) {
    // Discard low non-point cards
    pushIfValid(sortCardsForDiscard(hand, trumpSuit, levelRank, false).slice(0, N));
    // Discard point cards (useful when feeding teammate)
    pushIfValid(sortCardsForDiscard(hand, trumpSuit, levelRank, true).slice(0, N));

    // Try trump kills if leading a non-trump category
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
        const sortedDesc = [...sortedAsc].reverse();
        if (leadPlay.patternType === 'SINGLE') {
          pushIfValid([sortedAsc[0]]);
          pushIfValid([sortedDesc[0]]);
        } else if (leadPlay.patternType === 'PAIR' || leadPlay.patternType === 'TRIPLE') {
          const need = leadPlay.patternType === 'TRIPLE' ? 3 : 2;
          const groups = groupCardsByKey(sortedAsc, trumpSuit, levelRank)
            .filter((g) => g.cards.length >= need)
            .sort((a, b) => a.order - b.order);
          if (groups.length > 0) {
            pushIfValid(groups[0].cards.slice(0, need));
            pushIfValid(groups[groups.length - 1].cards.slice(0, need));
          }
        } else if (
          leadPlay.patternType === 'TRACTOR' ||
          leadPlay.patternType === 'TRIPLE_TRACTOR'
        ) {
          const mult: 2 | 3 = leadPlay.patternType === 'TRIPLE_TRACTOR' ? 3 : 2;
          const groups = groupCardsByKey(trumps, trumpSuit, levelRank);
          const chains = enumerateChainCandidates(groups, mult, {
            exactLength: leadPlay.components[0].length,
          });
          if (chains.length > 0) {
            pushIfValid(chains[chains.length - 1].cards);
            pushIfValid(chains[0].cards);
          }
        }
      }
    }

    if (candidates.length === 0) {
      pushIfValid(hand.slice(0, N));
    }
    return candidates;
  }

  if (inCatHand.length <= N) {
    const needExtra = N - inCatHand.length;
    const lowExtra = sortCardsForDiscard(outCatHand, trumpSuit, levelRank, false).slice(
      0,
      needExtra,
    );
    const pointExtra = sortCardsForDiscard(outCatHand, trumpSuit, levelRank, true).slice(
      0,
      needExtra,
    );
    pushIfValid([...inCatHand, ...lowExtra]);
    pushIfValid([...inCatHand, ...pointExtra]);
    return candidates;
  }

  // inCatHand.length > N: build structural obligation candidates + atomic winning candidates
  const profile = computeBestFollowProfile(
    inCatHand,
    leadPlay.components,
    trumpSuit,
    levelRank,
  );
  const groups = groupCardsByKey(inCatHand, trumpSuit, levelRank);
  const groupMap = new Map(groups.map((g) => [g.key, g]));

  const mandatoryCards: Card[] = [];
  const usedIds = new Set<number>();

  for (const key of profile.bestTripleKeys) {
    const g = groupMap.get(key);
    if (g) {
      for (const c of g.cards.slice(0, 3)) {
        if (!usedIds.has(c.id)) {
          usedIds.add(c.id);
          mandatoryCards.push(c);
        }
      }
    }
  }
  for (const chain of profile.bestPairChainKeys) {
    for (const key of chain) {
      const g = groupMap.get(key);
      if (g) {
        for (const c of g.cards.slice(0, 2)) {
          if (!usedIds.has(c.id) && mandatoryCards.length < N) {
            usedIds.add(c.id);
            mandatoryCards.push(c);
          }
        }
      }
    }
  }
  for (const key of profile.bestExtraPairKeys) {
    const g = groupMap.get(key);
    if (g) {
      for (const c of g.cards.slice(0, 2)) {
        if (!usedIds.has(c.id) && mandatoryCards.length < N) {
          usedIds.add(c.id);
          mandatoryCards.push(c);
        }
      }
    }
  }

  const remainingInCat = inCatHand.filter((c) => !usedIds.has(c.id));
  const fillLow = sortCardsForDiscard(remainingInCat, trumpSuit, levelRank, false).slice(
    0,
    Math.max(0, N - mandatoryCards.length),
  );
  const fillHighPts = sortCardsForDiscard(
    remainingInCat,
    trumpSuit,
    levelRank,
    true,
  ).slice(0, Math.max(0, N - mandatoryCards.length));

  pushIfValid([...mandatoryCards, ...fillLow]);
  pushIfValid([...mandatoryCards, ...fillHighPts]);

  // Also add winning/alternative atomic patterns when lead is atomic
  if (leadPlay.patternType === 'SINGLE') {
    const sorted = [...inCatHand].sort(
      (a, b) =>
        getCardOrder(a, trumpSuit, levelRank) -
        getCardOrder(b, trumpSuit, levelRank),
    );
    for (const c of sorted) {
      pushIfValid([c]);
    }
  } else if (leadPlay.patternType === 'PAIR' || leadPlay.patternType === 'TRIPLE') {
    const need = leadPlay.patternType === 'TRIPLE' ? 3 : 2;
    for (const g of groups) {
      if (g.cards.length >= need) {
        pushIfValid(g.cards.slice(0, need));
      }
    }
  } else if (
    leadPlay.patternType === 'TRACTOR' ||
    leadPlay.patternType === 'TRIPLE_TRACTOR'
  ) {
    const mult: 2 | 3 = leadPlay.patternType === 'TRIPLE_TRACTOR' ? 3 : 2;
    const chains = enumerateChainCandidates(groups, mult, {
      exactLength: leadPlay.components[0].length,
    });
    for (const ch of chains) {
      pushIfValid(ch.cards);
    }
  }

  return candidates;
}
