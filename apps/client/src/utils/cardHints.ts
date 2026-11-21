import {
  enumerateChainCandidates,
  findLegalFollowCards,
  getCardCategory,
  getCardOrder,
  getCardPoints,
  getSameColorSuit,
  groupCardsByKey,
  isRedFive,
  parsePlay,
  STANDARD_SUITS,
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
    case 'BIDDING':
      return '叫分抢庄';
    case 'CHOOSE_TRUMP':
      return '庄家选主';
    case 'CALLING':
      return mode === 'hongxin' ? '亮牌叫主' : '叫主';
    case 'COUNTER_BIDDING':
      return '比牌反主';
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
    case 'SLING':
      return `甩牌(${parsed.cards.length}张)`;
  }
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
    const selectedSet = new Set(selectedIds);
    const chosen = view.myHand.filter((c) => selectedSet.has(c.id));
    if (view.mode === 'heixin' && chosen.some((c) => c.rank === '10')) {
      return { valid: false, error: '打黑心不可将 10 埋入底牌' };
    }
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

export function getHintOptions(view: PlayerView): number[][] {
  if (view.phase === 'BURYING' && view.dealer === view.viewerSeat) {
    const pool =
      view.mode === 'heixin'
        ? view.myHand.filter((c) => c.rank !== '10')
        : view.myHand;
    const suitCounts = new Map<StandardSuit, number>();
    for (const s of STANDARD_SUITS) suitCounts.set(s, 0);
    for (const c of view.myHand) {
      const cat = getCardCategory(c, view.trumpSuit, view.levelRank);
      if (cat !== 'TRUMP') suitCounts.set(cat, (suitCounts.get(cat) ?? 0) + 1);
    }
    const sorted = [...pool].sort((a, b) => {
      const catA = getCardCategory(a, view.trumpSuit, view.levelRank);
      const catB = getCardCategory(b, view.trumpSuit, view.levelRank);
      const trumpA = catA === 'TRUMP' ? 1 : 0;
      const trumpB = catB === 'TRUMP' ? 1 : 0;
      if (trumpA !== trumpB) return trumpA - trumpB;
      const ptsDiff = getCardPoints(a) - getCardPoints(b);
      if (ptsDiff !== 0) return ptsDiff;
      const lenA = catA === 'TRUMP' ? 99 : suitCounts.get(catA) ?? 0;
      const lenB = catB === 'TRUMP' ? 99 : suitCounts.get(catB) ?? 0;
      if (lenA !== lenB) return lenA - lenB;
      return (
        getCardOrder(a, view.trumpSuit, view.levelRank) -
        getCardOrder(b, view.trumpSuit, view.levelRank)
      );
    });
    return [sorted.slice(0, 10).map((c) => c.id)];
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
