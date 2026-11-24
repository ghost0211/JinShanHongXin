import {
  enumerateChainCandidates,
  findLegalFollowCards,
  getCardCategory,
  getCardOrder,
  getSameColorSuit,
  groupCardsByKey,
  isRedFive,
  parsePlay,
  STANDARD_SUITS,
  suggestBuryCards,
  validateFollowPlay,
} from '@jinshan/game-core';
import type {
  Card,
  GameMode,
  GamePhase,
  LevelRank,
  ParsedPlay,
  PlayerView,
  StandardSuit,
  Suit,
} from '@jinshan/protocol';

export function getSuitSymbol(suit: Suit): string {
  switch (suit) {
    case 'S':
      return '♠';
    case 'H':
      return '♥';
    case 'C':
      return '♣';
    case 'D':
      return '♦';
    case 'J':
      return '★';
  }
}

export function getSuitName(suit: StandardSuit): string {
  switch (suit) {
    case 'S':
      return '黑桃';
    case 'H':
      return '红桃';
    case 'C':
      return '梅花';
    case 'D':
      return '方块';
  }
}

export function isRedSuit(suit: Suit): boolean {
  return suit === 'H' || suit === 'D';
}

export function getPhaseLabel(phase: GamePhase, mode: GameMode): string {
  switch (phase) {
    case 'DEALING':
      return '发牌中';
    case 'BIDDING':
      return '叫分抢庄';
    case 'CHOOSE_TRUMP':
      return '庄家选主';
    case 'CALLING':
      return mode === 'hongxin' ? '亮牌叫主' : '叫主';
    case 'COUNTER_BIDDING':
      return '自由反主';
    case 'COUNTER_RESPONSE':
      return '被反主回应';
    case 'BURYING':
      return '庄家埋底';
    case 'PLAYING':
      return '出牌对战';
    case 'ROUND_OVER':
      return '本局结算';
    case 'MATCH_OVER':
      return '全场终局';
  }
}

export function getPatternLabel(parsed: ParsedPlay | undefined): string {
  if (!parsed) return '';
  switch (parsed.patternType) {
    case 'SINGLE':
      return '单张';
    case 'PAIR':
      return '对子';
    case 'TRIPLE':
      return '三张';
    case 'TRACTOR':
      return `${parsed.components[0]?.length ?? 2}连对拖拉机`;
    case 'TRIPLE_TRACTOR':
      return `${parsed.components[0]?.length ?? 2}连三拖拉机`;
    case 'F510K': {
      const k = parsed.components[0]?.length ?? 1;
      const prefix = k === 3 ? '三' : k === 2 ? '双' : '';
      return parsed.category === 'TRUMP'
        ? `主牌${prefix}510K`
        : `${prefix}510K`;
    }
    case 'SLING': {
      if (parsed.components.length > 0) {
        const grouped: Array<{ label: string; count: number }> = [];
        for (const c of parsed.components) {
          let label: string;
          switch (c.type) {
            case 'F510K':
              label = c.length === 3 ? '三510K' : c.length === 2 ? '双510K' : '510K';
              break;
            case 'TRIPLE_TRACTOR':
              label = `${c.length}连三`;
              break;
            case 'TRIPLE':
              label = '三张';
              break;
            case 'TRACTOR':
              label = `${c.length}连对`;
              break;
            case 'PAIR':
              label = '对子';
              break;
            case 'SINGLE':
              label = '单';
              break;
          }
          const last = grouped[grouped.length - 1];
          if (last && last.label === label) {
            last.count += 1;
          } else {
            grouped.push({ label, count: 1 });
          }
        }
        if (grouped.length <= 3) {
          const summary = grouped
            .map((g) => (g.count > 1 ? `${g.label}×${g.count}` : g.label))
            .join('+');
          return `甩牌(${summary})`;
        }
      }
      return `甩牌(${parsed.cards.length}张)`;
    }
  }
}

export function getTrickPlayLabel(
  parsed: ParsedPlay | undefined,
  cardCount: number,
  isLead: boolean,
): string {
  if (!parsed) return `${cardCount}张`;
  if (!isLead && parsed.patternType === 'SLING') {
    return `跟牌(${cardCount}张)`;
  }
  return getPatternLabel(parsed);
}

export function getCardRoleBadge(
  card: Card,
  trumpSuit: StandardSuit | null,
  levelRank: LevelRank,
): { text: string; kind: 'red5' | 'trump' } | null {
  if (isRedFive(card)) {
    return { text: '红5', kind: 'red5' };
  }
  if (card.suit === 'J') return null;
  if (card.rank === levelRank) {
    return {
      text: card.suit === trumpSuit ? '正级' : '副级',
      kind: 'trump',
    };
  }
  if (trumpSuit && card.rank === '3') {
    if (card.suit === trumpSuit) return { text: '正参', kind: 'trump' };
    if (card.suit === getSameColorSuit(trumpSuit)) {
      return { text: '副参', kind: 'trump' };
    }
  }
  return null;
}

export interface CallSuitOption {
  suit: StandardSuit;
  count: number;
  cardIds: number[];
  label: string;
}

export function getLegalCallOptions(view: PlayerView): CallSuitOption[] {
  const opts: CallSuitOption[] = [];
  for (const suit of STANDARD_SUITS) {
    const matches = view.myHand.filter(
      (c) => c.suit === suit && c.rank === view.levelRank,
    );
    if (view.isFirstRound) {
      if (matches.length >= 3) {
        opts.push({
          suit,
          count: 3,
          cardIds: matches.slice(0, 3).map((c) => c.id),
          label: `3张${getSuitSymbol(suit)}2抢庄`,
        });
      }
      if (matches.length >= 2) {
        opts.push({
          suit,
          count: 2,
          cardIds: matches.slice(0, 2).map((c) => c.id),
          label: `2张${getSuitSymbol(suit)}2抢庄`,
        });
      }
    } else if (matches.length >= 1) {
      opts.push({
        suit,
        count: 1,
        cardIds: [matches[0].id],
        label: `亮${getSuitSymbol(suit)}${view.levelRank}`,
      });
    }
  }
  return opts;
}

export function getLegalCounterOptions(view: PlayerView): CallSuitOption[] {
  const opts: CallSuitOption[] = [];
  const need = view.isFirstRound ? 3 : 1;
  for (const suit of STANDARD_SUITS) {
    if (suit === view.callState.calledSuit) continue;
    const matches = view.myHand.filter(
      (c) => c.suit === suit && c.rank === view.levelRank,
    );
    if (matches.length >= need) {
      opts.push({
        suit,
        count: need,
        cardIds: matches.slice(0, need).map((c) => c.id),
        label: view.isFirstRound
          ? `3张${getSuitSymbol(suit)}2反主`
          : `亮${getSuitSymbol(suit)}${view.levelRank}反主`,
      });
    }
  }
  return opts;
}

export interface SelectionPreview {
  valid: boolean;
  label?: string;
  error?: string;
}

export function previewSelection(
  view: PlayerView,
  selectedIds: readonly number[],
): SelectionPreview {
  if (view.phase === 'BURYING') {
    if (selectedIds.length !== 10) {
      return {
        valid: false,
        error: `还需选择 ${10 - selectedIds.length} 张（已选 ${selectedIds.length}/10）`,
      };
    }
    return { valid: true, label: '已选满 10 张底牌' };
  }

  if (view.phase === 'PLAYING') {
    if (selectedIds.length === 0) {
      return { valid: false };
    }
    const idSet = new Set(selectedIds);
    const selectedCards = view.myHand.filter((c) => idSet.has(c.id));

    if (view.currentTrick.length === 0) {
      const parsed = parsePlay(selectedCards, view.trumpSuit, view.levelRank);
      if (!parsed) {
        return { valid: false, error: '须出同花色或全主牌（或510K）' };
      }
      return { valid: true, label: getPatternLabel(parsed) };
    }

    const res = validateFollowPlay(
      view.myHand,
      selectedIds,
      view.currentTrick[0].parsed,
      view.trumpSuit,
      view.levelRank,
    );
    if (!res.valid) {
      return { valid: false, error: res.reason ?? '选牌不符合跟牌规则' };
    }
    return {
      valid: true,
      label: res.matchedTrumpKill ? '毙牌!' : getPatternLabel(res.parsed),
    };
  }

  return { valid: false };
}

export interface MandatoryAutoSelection {
  cardIds: number[];
  complete: boolean;
  reason: string;
}

/**
 * Automatically detect cards the player is mathematically forced to include
 * when following a trick:
 * 1. Following a category where remaining cards in that category are 1..leadCount
 *    (except when an off-suit 510K can be formed via borrowed ♥5 / level 10 / level K).
 * 2. Following a trump 510K (or trump sling with 510K) when holding NO trump triple
 *    and NO trump 510K to beat/cancel -> forced to include the top 3*k largest trumps.
 */
export function getMandatoryFollowSelection(
  view: PlayerView,
): MandatoryAutoSelection | null {
  if (
    view.phase !== 'PLAYING' ||
    view.currentTurn !== view.viewerSeat ||
    view.currentTrick.length === 0
  ) {
    return null;
  }

  const hand = view.myHand;
  const leadPlay = view.currentTrick[0].parsed;
  const leadCount = leadPlay.cards.length;
  if (hand.length === 0 || leadCount === 0) return null;

  const inCatHand = hand.filter(
    (c) => getCardCategory(c, view.trumpSuit, view.levelRank) === leadPlay.category,
  );
  const lead510KUnits = leadPlay.components
    .filter((c) => c.type === 'F510K')
    .reduce((sum, c) => sum + c.length, 0);

  // Case B: Remaining cards in led category are 1..leadCount -> every one of them is mandatory
  if (inCatHand.length > 0 && inCatHand.length <= leadCount) {
    // Guard: if lead is an off-suit 510K (or sling with off-suit 510K) and player can borrow
    // a trump-category card (♥5 / level 10 / level K) of that suit to form a same-suit 510K,
    // do not over-select all inCatHand when inCatHand.length === leadCount.
    if (
      leadPlay.category !== 'TRUMP' &&
      lead510KUnits > 0 &&
      inCatHand.length === leadCount
    ) {
      const targetSuit = leadPlay.category;
      const s5 = hand.filter((c) => c.suit === targetSuit && c.rank === '5');
      const s10 = hand.filter((c) => c.suit === targetSuit && c.rank === '10');
      const sK = hand.filter((c) => c.suit === targetSuit && c.rank === 'K');
      if (Math.min(s5.length, s10.length, sK.length) >= 1) {
        const inCatSet = new Set(inCatHand.map((c) => c.id));
        const usesBorrowedCard =
          s5.some((c) => !inCatSet.has(c.id)) ||
          s10.some((c) => !inCatSet.has(c.id)) ||
          sK.some((c) => !inCatSet.has(c.id));
        if (usesBorrowedCard) {
          return null;
        }
      }
    }

    const complete = inCatHand.length === leadCount;
    const catName =
      leadPlay.category === 'TRUMP'
        ? '主牌'
        : `${getSuitSymbol(leadPlay.category)}${getSuitName(leadPlay.category)}`;
    return {
      cardIds: inCatHand.map((c) => c.id),
      complete,
      reason: complete
        ? `已自动选中全部必跟的 ${catName}（${inCatHand.length} 张）`
        : `已自动选中全部剩余 ${catName}（${inCatHand.length} 张），请再补选 ${leadCount - inCatHand.length} 张垫牌`,
    };
  }

  // Case A: Following TRUMP 510K (or TRUMP sling with 510K) with no trump triple and no trump 510K
  if (
    leadPlay.category === 'TRUMP' &&
    lead510KUnits > 0 &&
    inCatHand.length > leadCount
  ) {
    const groups = groupCardsByKey(inCatHand, view.trumpSuit, view.levelRank);
    const hasTrumpTriple = groups.some((g) => g.cards.length === 3);
    const hasTrump510K =
      view.trumpSuit !== null &&
      inCatHand.some((c) => c.suit === view.trumpSuit && c.rank === '5') &&
      inCatHand.some((c) => c.suit === view.trumpSuit && c.rank === '10') &&
      inCatHand.some((c) => c.suit === view.trumpSuit && c.rank === 'K');

    if (!hasTrumpTriple && !hasTrump510K) {
      const needTop = Math.min(lead510KUnits * 3, inCatHand.length);
      const sortedDesc = [...inCatHand].sort((a, b) => {
        const diff =
          getCardOrder(b, view.trumpSuit, view.levelRank) -
          getCardOrder(a, view.trumpSuit, view.levelRank);
        return diff !== 0 ? diff : a.id - b.id;
      });
      const picked = sortedDesc.slice(0, needTop);
      const complete = needTop === leadCount;
      return {
        cardIds: picked.map((c) => c.id),
        complete,
        reason: complete
          ? `无主三张或主510K可压/抵，已自动选中最大的 ${needTop} 张主牌`
          : `无主三张或主510K可压/抵，已自动选中最大的 ${needTop} 张主牌，请再补选 ${leadCount - needTop} 张主牌`,
      };
    }
  }

  return null;
}

export function getHintOptions(view: PlayerView): number[][] {
  if (view.phase === 'BURYING' && view.dealer === view.viewerSeat) {
    return [
      suggestBuryCards(
        view.myHand,
        view.trumpSuit,
        view.levelRank,
        view.mode,
      ),
    ];
  }

  if (view.phase !== 'PLAYING' || view.currentTurn !== view.viewerSeat) {
    return [];
  }

  if (view.currentTrick.length > 0) {
    return findLegalFollowCards(
      view.myHand,
      view.currentTrick[0].parsed,
      view.trumpSuit,
      view.levelRank,
    ).map((cards) => cards.map((c) => c.id));
  }

  // Leading hints: 510K -> triple tractor -> tractor -> triple -> pair -> single
  const options: number[][] = [];
  const seen = new Set<string>();
  const addOpt = (cards: readonly Card[]) => {
    const ids = cards.map((c) => c.id);
    const sig = [...ids].sort((a, b) => a - b).join(',');
    if (!seen.has(sig)) {
      seen.add(sig);
      options.push(ids);
    }
  };

  for (const s of STANDARD_SUITS) {
    const c5 = view.myHand.filter((c) => c.suit === s && c.rank === '5');
    const c10 = view.myHand.filter((c) => c.suit === s && c.rank === '10');
    const cK = view.myHand.filter((c) => c.suit === s && c.rank === 'K');
    const m = Math.min(c5.length, c10.length, cK.length);
    if (m >= 1) {
      const f: Card[] = [];
      for (let i = 0; i < m; i++) f.push(c5[i], c10[i], cK[i]);
      addOpt(f);
    }
  }

  for (const cat of [...STANDARD_SUITS.filter((s) => s !== view.trumpSuit), 'TRUMP'] as const) {
    const inCat = view.myHand.filter(
      (c) => getCardCategory(c, view.trumpSuit, view.levelRank) === cat,
    );
    if (inCat.length === 0) continue;
    const groups = groupCardsByKey(inCat, view.trumpSuit, view.levelRank);
    for (const ch of enumerateChainCandidates(groups, 3)) addOpt(ch.cards);
    for (const ch of enumerateChainCandidates(groups, 2)) addOpt(ch.cards);
    for (const g of groups) {
      if (g.cards.length === 3) addOpt(g.cards);
    }
    for (const g of groups) {
      if (g.cards.length >= 2) addOpt(g.cards.slice(0, 2));
    }
    for (const g of groups) {
      addOpt([g.cards[0]]);
    }
  }

  return options;
}
