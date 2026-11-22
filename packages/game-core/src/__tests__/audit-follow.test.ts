import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findLegalFollowCards,
  resolveTrickWinner,
  validateFollowPlay,
  validateLeadPlay,
} from '../index.js';
import type { Card, LevelRank, ParsedPlay, StandardSuit } from '../index.js';
import { cards, ids, parsed, pick, trick } from './audit-helpers.js';

const T: StandardSuit = 'D';
const L: LevelRank = '2';

function follow(hand: Card[], sel: string, lead: ParsedPlay, t = T, l = L) {
  return validateFollowPlay(hand, ids(pick(hand, sel)), lead, t, l);
}

describe('AUDIT B3: follow obligations (仅强制跟同门花色，无强制对子/三张/拖拉机限制)', () => {
  it('PAIR lead: must follow suit count, NO forced pair even when holding pair or triple', () => {
    const lead = parsed(cards('S:9*2'), T, L);
    const hand = cards('S:K*3 S:7 S:6 H:4');
    assert.equal(follow(hand, 'S:7 S:6', lead).valid, true);
    assert.equal(follow(hand, 'S:K S:7', lead).valid, true);
    assert.equal(follow(hand, 'S:K*2', lead).valid, true);
    const noPair = cards('S:K S:7 S:6 H:4*2');
    assert.equal(follow(noPair, 'S:7 S:6', lead).valid, true);
    assert.equal(follow(noPair, 'H:4*2', lead).valid, false, 'must follow suit before discarding');
    // only one card of suit -> must play it + anything
    const oneSpade = cards('S:3 H:4*2');
    assert.equal(follow(oneSpade, 'S:3 H:4', lead).valid, true);
    assert.equal(follow(oneSpade, 'H:4*2', lead).valid, false);
  });

  it('TRIPLE lead: only same-suit count is mandatory; holding triple does NOT force playing it', () => {
    const lead = parsed(cards('S:9*3'), T, L);
    const withTriple = cards('S:4*3 S:K*2 S:7');
    assert.equal(follow(withTriple, 'S:K*2 S:7', lead).valid, true);
    assert.equal(follow(withTriple, 'S:4*3', lead).valid, true);
    const pairsOnly = cards('S:K*2 S:Q*2 S:7');
    assert.equal(follow(pairsOnly, 'S:K S:Q S:7', lead).valid, true);
    assert.equal(follow(pairsOnly, 'S:K*2 S:7', lead).valid, true);
  });

  it('TRACTOR lead: only same-suit count is mandatory; holding tractor or pairs does NOT force playing them', () => {
    const lead = parsed(cards('H:9*2 H:10*2'), T, L);
    const lowA = cards('H:A*2 H:4*2 H:K*2 H:7');
    assert.equal(follow(lowA, 'H:A*2 H:4*2', lead).valid, true);
    assert.equal(follow(lowA, 'H:K*2 H:4*2', lead).valid, true);
    assert.equal(follow(lowA, 'H:A H:4 H:K H:7', lead).valid, true);
    const twoPairs = cards('H:A*2 H:Q*2 H:7 H:6');
    assert.equal(follow(twoPairs, 'H:A*2 H:Q*2', lead).valid, true);
    assert.equal(follow(twoPairs, 'H:A*2 H:7 H:6', lead).valid, true);
    assert.equal(follow(twoPairs, 'H:A H:Q H:7 H:6', lead).valid, true);
  });

  it('TRIPLE_TRACTOR lead: only same-suit count is mandatory', () => {
    const lead = parsed(cards('S:9*3 S:10*3'), T, L);
    const oneTriple = cards('S:4*3 S:K*2 S:Q*2 S:7');
    assert.equal(follow(oneTriple, 'S:4*3 S:K S:Q S:7', lead).valid, true);
    assert.equal(follow(oneTriple, 'S:K*2 S:Q*2 S:7 S:4', lead).valid, true);
    const twoLoose = cards('S:4*3 S:8*3 S:K');
    assert.equal(follow(twoLoose, 'S:4*3 S:8*3', lead).valid, true);
    assert.equal(follow(twoLoose, 'S:4*3 S:8*2 S:K', lead).valid, true);
  });

  it('findLegalFollowCards always yields only legal plays and at least one', () => {
    const leads = [
      parsed(cards('S:9*2'), T, L),
      parsed(cards('S:9*3'), T, L),
      parsed(cards('S:9*2 S:10*2'), T, L),
      parsed(cards('S:9*3 S:10*3'), T, L),
    ];
    const hands = [
      cards('S:4*3 S:K*2 S:Q*2 S:7 D:A*2 J:BJ'),
      cards('S:4 H:K*2 D:A*3 D:K*3'),
      cards('H:K*2 H:Q*2 C:7*3'),
    ];
    for (const lead of leads) {
      for (const hand of hands) {
        const opts = findLegalFollowCards(hand, lead, T, L);
        assert.ok(opts.length > 0);
        for (const o of opts) assert.equal(validateFollowPlay(hand, ids(o), lead, T, L).valid, true);
      }
    }
  });
});

describe('AUDIT B3: 毙牌 / 盖毙 / 同大先出', () => {
  it('void follower kills only with matching trump structure; higher trump overkills; equal trump: first wins', () => {
    const leadCards = cards('S:9*2');
    const lead = parsed(leadCards, T, L);
    const p1 = cards('D:6*2');
    const p2 = cards('D:6*2');
    const p3 = cards('D:7 J:BJ');
    const t1 = trick([
      [0, leadCards, lead],
      [1, p1, parsed(p1, T, L)],
      [2, p2, parsed(p2, T, L)],
      [3, p3, parsed(p3, T, L)],
    ]);
    const r1 = resolveTrickWinner(t1, T, L);
    assert.equal(r1.winnerSeat, 1, 'equal trump pairs -> first killer wins; mismatched trumps are a discard');
    assert.equal(r1.killedByTrump, true);

    const p2b = cards('J:SJ*2');
    const r2 = resolveTrickWinner(
      trick([
        [0, leadCards, lead],
        [1, p1, parsed(p1, T, L)],
        [2, p2b, parsed(p2b, T, L)],
        [3, p3, parsed(p3, T, L)],
      ]),
      T,
      L,
    );
    assert.equal(r2.winnerSeat, 2, '盖毙');
  });

  it('副级牌 of different suits are equal: the earlier one wins', () => {
    const a = cards('S:2');
    const b = cards('C:2');
    const c = cards('H:2');
    const d = cards('D:A');
    const r = resolveTrickWinner(
      trick([
        [0, a, parsed(a, T, L)],
        [1, b, parsed(b, T, L)],
        [2, c, parsed(c, T, L)],
        [3, d, parsed(d, T, L)],
      ]),
      T,
      L,
    );
    assert.equal(r.winnerSeat, 0);
  });

  it('a same-suit tractor beats only with higher topOrder; A=1 tractor is the lowest tractor', () => {
    const lead = cards('H:4*2 H:6*2');
    const lowA = cards('H:A*2 H:4*2');
    const normal = cards('H:6*2 H:7*2');
    const pairs = cards('H:K*2 H:Q*2'); // not a tractor? K,Q adjacent -> tractor
    const r = resolveTrickWinner(
      trick([
        [0, lead, parsed(lead, T, L)],
        [1, lowA, parsed(lowA, T, L)],
        [2, normal, parsed(normal, T, L)],
        [3, pairs, parsed(pairs, T, L)],
      ]),
      T,
      L,
    );
    assert.equal(r.winnerSeat, 3);
    const r2 = resolveTrickWinner(
      trick([
        [0, lowA, parsed(lowA, T, L)],
        [1, lead, parsed(lead, T, L)],
      ]),
      T,
      L,
    );
    assert.equal(r2.winnerSeat, 1);
  });
});

describe('AUDIT B3: 甩牌 (sling) and 甩牌失败出小', () => {
  it('sling succeeds when no other hand can beat any component', () => {
    const hand = cards('S:A*3 S:K S:7');
    const others = [cards('S:Q*3 S:J'), cards('H:A*3'), cards('S:K')];
    const res = validateLeadPlay(hand, ids(pick(hand, 'S:A*3 S:K')), others, T, L);
    assert.equal(res.valid, true);
    assert.equal(res.slingFailed, false);
  });

  it('equal cards (3-deck duplicates / same-tier 副级) do not beat a sling component', () => {
    const hand = cards('S:A S:K');
    const others = [cards('S:K'), cards('S:K'), cards('H:A')];
    assert.equal(validateLeadPlay(hand, ids(hand), others, T, L).slingFailed, false);
    // trump sling: ♠2 (副级) + BJ; another player holds ♣2 (same tier) only
    const th = cards('S:2 J:BJ');
    const o2 = [cards('C:2 H:2'), cards('D:A'), cards('S:3')];
    assert.equal(validateLeadPlay(th, ids(th), o2, T, L).slingFailed, false);
  });

  it('failed sling forces the smallest beaten component; leader keeps the rest', () => {
    const hand = cards('S:A*2 S:K S:8 S:7');
    // other hand can beat ♠8 single (with ♠9) and ♠K single? no (A is in leader hand...) -> others have ♠A
    const others = [cards('S:A S:9'), cards('H:4'), cards('C:4')];
    const sel = pick(hand, 'S:A*2 S:K S:8');
    const res = validateLeadPlay(hand, ids(sel), others, T, L);
    assert.equal(res.slingFailed, true);
    assert.deepEqual(
      res.effectiveCards!.map((c) => c.rank),
      ['8'],
      'smallest beaten component is ♠8',
    );
  });

  it('a triple in another hand can be split to beat a sling pair; trump never "beats" a side sling', () => {
    const hand = cards('S:A*3 S:10*2');
    const others = [cards('S:K*3'), cards('D:A*3 J:BJ*3'), cards('H:4')];
    const res = validateLeadPlay(hand, ids(hand), others, T, L);
    assert.equal(res.slingFailed, true);
    assert.equal(res.effectiveCards!.length, 2);
    assert.ok(res.effectiveCards!.every((c) => c.rank === '10'));
    const others2 = [cards('S:9*3'), cards('D:A*3 J:BJ*3'), cards('H:4')];
    assert.equal(validateLeadPlay(hand, ids(hand), others2, T, L).slingFailed, false);
  });

  it('void follower kills a sling only by matching every component with trumps', () => {
    const leadCards = cards('S:A*3 S:K');
    const lead = parsed(leadCards, T, L);
    const killer = cards('D:5*3 D:6');
    const nonKiller = cards('D:7*2 D:8*2');
    const hand1 = [...killer, ...cards('H:4')];
    const fv = validateFollowPlay(hand1, ids(killer), lead, T, L);
    assert.equal(fv.valid, true);
    assert.equal(fv.matchedTrumpKill, true);
    const r = resolveTrickWinner(
      trick([
        [0, leadCards, lead],
        [1, nonKiller, parsed(nonKiller, T, L)],
        [2, killer, fv.parsed!],
      ]),
      T,
      L,
    );
    assert.equal(r.winnerSeat, 2);
  });
});

import { applyAction, createInitialMatchState } from '../index.js';
import type { GameState } from '../index.js';

function playingState(hands: Record<0 | 1 | 2 | 3, Card[]>, t: StandardSuit | null, l: LevelRank): GameState {
  const base = createInitialMatchState(3);
  return {
    ...base,
    phase: 'PLAYING',
    dealer: 0,
    bankerTeam: 'A',
    trumpSuit: t,
    levelRank: l,
    currentTurn: 0,
    currentTrickLeadSeat: 0,
    currentTrick: [],
    completedTricks: [],
    hands,
  };
}

describe('AUDIT B3: engine-level play flow', () => {
  it('failed sling: only the smallest beaten component leaves the hand; followers must follow that component', () => {
    const h0 = cards('S:A*2 S:K S:8 H:4');
    const st = playingState(
      { 0: h0, 1: cards('S:A S:9 S:3 H:5'), 2: cards('H:6*3 S:4 H:7'), 3: cards('C:4*5') },
      T,
      L,
    );
    const r = applyAction(st, { type: 'PLAY_CARDS', seat: 0, cardIds: ids(pick(h0, 'S:A*2 S:K S:8')) });
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.state.hands[0].length, 4);
    assert.deepEqual(r.state.currentTrick[0].cards.map((c) => c.rank), ['8']);
    assert.equal(r.events[0].type, 'SLING_FAILED');
    // seat 1 now follows a SINGLE spade: one card only
    const bad = applyAction(r.state, { type: 'PLAY_CARDS', seat: 1, cardIds: ids(pick(r.state.hands[1], 'S:A S:9')) });
    assert.equal(bad.ok, false);
    const ok = applyAction(r.state, { type: 'PLAY_CARDS', seat: 1, cardIds: ids(pick(r.state.hands[1], 'S:9')) });
    assert.equal(ok.ok, true);
  });
});

describe('AUDIT B3 (pending user confirmation – documents CURRENT behaviour)', () => {
  it('pair-TRACTOR lead, follower without tractor but with pairs: NOT forced to play pairs (confirmed #9B)', () => {
    const lead = parsed(cards('S:9*2 S:10*2'), T, L);
    const hand = cards('S:K*2 S:7*2 S:4 S:5');
    assert.equal(follow(hand, 'S:K*2 S:4 S:5', lead).valid, true);
    assert.equal(follow(hand, 'S:K S:7 S:4 S:5', lead).valid, true);
    assert.equal(follow(hand, 'S:K*2 S:7*2', lead).valid, true);
  });

  it('[待确认] failed sling picks the smallest BEATEN component, not the smallest component overall', () => {
    // ♠44 pair is unbeaten (nobody holds a spade pair), ♠K single is beaten by ♠A
    const hand = cards('S:4*2 S:K');
    const others = [cards('S:A S:Q'), cards('H:4'), cards('C:4')];
    const res = validateLeadPlay(hand, ids(hand), others, T, L);
    assert.equal(res.slingFailed, true);
    assert.deepEqual(res.effectiveCards!.map((c) => c.rank), ['K']);
  });
});
