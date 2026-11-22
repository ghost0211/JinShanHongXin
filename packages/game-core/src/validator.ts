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
  enumeratePlayDecompositions,
  getSingleCategory,
  groupCardsByKey,
  parse510K,
  parsePlay,
} from './patterns.js';
import type {
  FollowValidationResult,
  LeadValidationResult,
  TrickPlay,
} from './types.js';

function getBeatenFailureSortOrder(comp: AtomicPattern): number {
  // F510K is a 3/6/9-card combo, strictly larger than singles/pairs when picking
  // "smallest beaten component" on sling failure
  if (comp.type === 'F510K') {
    return 1000 + comp.length;
  }
  return comp.topOrder;
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

  const decompositions = enumeratePlayDecompositions(
    selectedCards,
    trumpSuit,
    levelRank,
  );
  if (decompositions.length === 0) {
    return {
      valid: false,
      reason: '首家出牌必须属于同一种花色（或全部为主牌）',
    };
  }

  const primary = decompositions[0];
  if (primary.patternType !== 'SLING') {
    return {
      valid: true,
      slingFailed: false,
      effectiveCards: primary.cards,
      parsed: primary,
    };
  }

  // Evaluate all valid decompositions in optimal-first order:
  // If ANY legal decomposition has zero beaten components, the sling SUCCEEDS using that optimal combination!
  let bestFailed: {
    decomp: ParsedPlay;
    beaten: AtomicPattern[];
    smallestBeaten: AtomicPattern;
  } | null = null;

  for (const decomp of decompositions) {
    if (decomp.patternType !== 'SLING') {
      return {
        valid: true,
        slingFailed: false,
        effectiveCards: decomp.cards,
        parsed: decomp,
      };
    }

    const beaten: AtomicPattern[] = [];
    for (const comp of decomp.components) {
      const isBeaten = otherHands.some((oh) =>
        canHandBeatComponent(oh, decomp.category, comp, trumpSuit, levelRank),
      );
      if (isBeaten) {
        beaten.push(comp);
      }
    }

    if (beaten.length === 0) {
      return {
        valid: true,
        slingFailed: false,
        effectiveCards: selectedCards,
        parsed: decomp,
      };
    }

    const sortedBeaten = [...beaten].sort((a, b) => {
      const ordDiff = getBeatenFailureSortOrder(a) - getBeatenFailureSortOrder(b);
      if (ordDiff !== 0) return ordDiff;
      return a.cards.length - b.cards.length;
    });

    if (
      !bestFailed ||
      beaten.length < bestFailed.beaten.length
    ) {
      bestFailed = {
        decomp,
        beaten: sortedBeaten,
        smallestBeaten: sortedBeaten[0],
      };
    }
  }

  const chosen = bestFailed!;
  const smallestBeaten = chosen.smallestBeaten;
  return {
    valid: true,
    slingFailed: true,
    effectiveCards: smallestBeaten.cards,
    failedComponent: smallestBeaten,
    parsed: {
      patternType: smallestBeaten.type,
      category: chosen.decomp.category,
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

function containsTopMTrumps(
  selected: readonly Card[],
  pool: readonly Card[],
  m: number,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): boolean {
  if (m === 0) return true;
  if (selected.length < m || pool.length < m) return false;

  const sortedPool = [...pool].sort(
    (a, b) =>
      getCardOrder(b, trumpSuit, levelRank) -
      getCardOrder(a, trumpSuit, levelRank),
  );
  const cutoff = getCardOrder(sortedPool[m - 1], trumpSuit, levelRank);
  const selectedIdSet = new Set(selected.map((c) => c.id));

  let strictlyAboveTotal = 0;
  let atOrAboveSelected = 0;
  for (const c of pool) {
    const ord = getCardOrder(c, trumpSuit, levelRank);
    if (ord > cutoff) {
      strictlyAboveTotal += 1;
      if (!selectedIdSet.has(c.id)) return false;
    }
  }
  for (const c of selected) {
    if (getCardOrder(c, trumpSuit, levelRank) >= cutoff) {
      atOrAboveSelected += 1;
    }
  }
  return strictlyAboveTotal <= atOrAboveSelected && atOrAboveSelected >= m;
}

function validateTrump510KFollow(
  inCatHand: readonly Card[],
  selectedCards: readonly Card[],
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
  maxUnits?: number,
): boolean {
  const targetUnits = maxUnits ?? Math.floor(selectedCards.length / 3);
  const exactSizeMode = maxUnits === undefined;

  const search = (
    remSelected: Card[],
    remHand: Card[],
    unitsLeft: number,
  ): boolean => {
    if (unitsLeft <= 0) return true;
    const neededTop = unitsLeft * 3;
    if (exactSizeMode) {
      if (isTopMTrumps(remSelected, remHand, remSelected.length, trumpSuit, levelRank)) {
        return true;
      }
    } else if (containsTopMTrumps(remSelected, remHand, neededTop, trumpSuit, levelRank)) {
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
            unitsLeft - 1,
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
            unitsLeft - 1,
          )
        ) {
          return true;
        }
      }
    }

    return false;
  };

  return search([...selectedCards], [...inCatHand], targetUnits);
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

/**
 * 金山打红心 / 打黑心跟牌规则：
 * 1. 总张数必须等于首家出牌张数。
 * 2. 若手中有首家所出分类（主牌或对应副牌花色），必须优先跟出该分类的牌。
 * 3. 若首家领出主牌 510K（或含主牌 510K 的甩牌），未压制/未抵消的单位须出当前剩余最大主牌。
 * 4. 除此之外，没有任何强制必须跟出对子、三张、拖拉机或连三的要求。
 */
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

  const lead510KUnits = leadPlay.components
    .filter((c) => c.type === 'F510K')
    .reduce((sum, c) => sum + c.length, 0);

  const inCatHand = hand.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) === leadPlay.category,
  );
  const inCatSelected = selectedCards.filter(
    (c) => getCardCategory(c, trumpSuit, levelRank) === leadPlay.category,
  );

  // If side-suit SLING includes F510K, allow follower to borrow same-suit 5/10/K for F510K units
  if (lead510KUnits > 0 && leadPlay.category !== 'TRUMP') {
    const targetSuit = leadPlay.category;
    const fives = selectedCards.filter((c) => c.suit === targetSuit && c.rank === '5');
    const tens = selectedCards.filter((c) => c.suit === targetSuit && c.rank === '10');
    const ks = selectedCards.filter((c) => c.suit === targetSuit && c.rank === 'K');
    const maxUnits = Math.min(lead510KUnits, fives.length, tens.length, ks.length);

    let suitOk = false;
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
      if (remInCatSelected.length === Math.min(remInCatHand.length, remSelected.length)) {
        suitOk = true;
        break;
      }
    }
    if (!suitOk) {
      return {
        valid: false,
        reason: '手中有首家花色时必须优先跟出同门花色',
      };
    }
  } else {
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
  }

  // Case 1: Void in led category (may trump-kill with matching trump structure, or discard freely)
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

  // If TRUMP SLING includes F510K and follower has more trumps than leadCount, enforce trump 510K top-trump rule
  if (
    leadPlay.category === 'TRUMP' &&
    lead510KUnits > 0 &&
    inCatHand.length > leadCount
  ) {
    if (
      !validateTrump510KFollow(
        inCatHand,
        selectedCards,
        trumpSuit,
        levelRank,
        lead510KUnits,
      )
    ) {
      return {
        valid: false,
        reason: '跟含主牌 510K 的甩牌，未用主三张或主 510K 抵消的部分必须包含当前剩余最大的主牌',
      };
    }
  }

  const parsed: ParsedPlay =
    parsePlay(selectedCards, trumpSuit, levelRank) ?? {
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
    const match = canMatchSlingStructure(
      play.cards,
      leadParsed.components,
      trumpSuit,
      levelRank,
    );
    if (!match.matched) continue;

    // Determine effective category of this matched play
    let cat = getSingleCategory(play.cards, trumpSuit, levelRank);
    if (!cat && play.cards[0] && play.cards[0].suit !== 'J') {
      cat = play.cards[0].suit === trumpSuit ? 'TRUMP' : play.cards[0].suit;
    }
    if (!cat) continue;

    if (cat === leadParsed.category) {
      if (bestIsTrump && leadParsed.category !== 'TRUMP') {
        continue;
      }
      if (compareMatchedComponents(match.matchedComponents, bestComponents) > 0) {
        bestPlay = play;
        bestComponents = match.matchedComponents;
      }
    } else if (cat === 'TRUMP' && leadParsed.category !== 'TRUMP') {
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

  const lead510KUnits = leadPlay.components
    .filter((c) => c.type === 'F510K')
    .reduce((sum, c) => sum + c.length, 0);

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
    pushIfValid(sortCardsForDiscard(hand, trumpSuit, levelRank, false).slice(0, N));
    pushIfValid(sortCardsForDiscard(hand, trumpSuit, levelRank, true).slice(0, N));

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

  // If TRUMP SLING includes F510K, include top-trump + low-fill candidate so bots always have legal options
  if (leadPlay.category === 'TRUMP' && lead510KUnits > 0) {
    const sortedDesc = [...inCatHand].sort(
      (a, b) =>
        getCardOrder(b, trumpSuit, levelRank) -
        getCardOrder(a, trumpSuit, levelRank),
    );
    const mustTop = sortedDesc.slice(0, lead510KUnits * 3);
    const restPool = sortedDesc.slice(lead510KUnits * 3);
    const fillLow = sortCardsForDiscard(restPool, trumpSuit, levelRank, false).slice(
      0,
      N - mustTop.length,
    );
    pushIfValid([...mustTop, ...fillLow]);
    pushIfValid(sortedDesc.slice(0, N));
  }

  // inCatHand.length > N: no forced structural obligation, so generate both safe discards & matching patterns
  const groups = groupCardsByKey(inCatHand, trumpSuit, levelRank);

  const groupSizeByKey = new Map(groups.map((g) => [g.key, g.cards.length]));
  const preserveStructureLow = [...inCatHand].sort((a, b) => {
    const szA = groupSizeByKey.get(`${a.suit}:${a.rank}`) ?? 1;
    const szB = groupSizeByKey.get(`${b.suit}:${b.rank}`) ?? 1;
    if (szA !== szB) return szA - szB;
    const ptsDiff = getCardPoints(a) - getCardPoints(b);
    if (ptsDiff !== 0) return ptsDiff;
    return (
      getCardOrder(a, trumpSuit, levelRank) - getCardOrder(b, trumpSuit, levelRank)
    );
  });

  pushIfValid(preserveStructureLow.slice(0, N));
  pushIfValid(sortCardsForDiscard(inCatHand, trumpSuit, levelRank, false).slice(0, N));
  pushIfValid(sortCardsForDiscard(inCatHand, trumpSuit, levelRank, true).slice(0, N));

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
