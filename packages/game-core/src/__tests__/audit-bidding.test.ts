// Domain-A audit: 叫主 / 反主 / 惩罚 / 埋底 / 翻底 / 打黑心叫分 —— adversarial & boundary tests.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction,
  chooseBotAction,
  countBipai,
  createInitialMatchState,
  getCardOrder,
  getEligibleCounterSeats,
  isTrump,
  startNextRound,
} from '../index.js';
import type { ActionResult, Card, GameAction, GameState, Seat } from '../index.js';

let nextId = 10000;
function c(suit: Card['suit'], rank: Card['rank']): Card {
  return { id: nextId++, deck: 0, suit, rank };
}
function many(n: number, suit: Card['suit'], rank: Card['rank']): Card[] {
  return Array.from({ length: n }, () => c(suit, rank));
}
/** Filler with no level card / jokers / ♥5 for the given level. */
function filler(n: number, levelRank: Card['rank']): Card[] {
  const ranks = (['7', '8', '9', 'J', 'Q'] as Card['rank'][]).filter((r) => r !== levelRank);
  const suits = ['S', 'C', 'D'] as const;
  return Array.from({ length: n }, (_, i) => c(suits[i % 3], ranks[i % ranks.length]));
}
function ok(r: ActionResult): GameState {
  if (!r.ok) assert.fail(`expected ok, got ${r.code}: ${r.error}`);
  return r.state;
}
function err(r: ActionResult, code: string): void {
  assert.equal(r.ok, false, `expected ${code} but action succeeded`);
  if (!r.ok) assert.equal(r.code, code);
}
function ids(cards: Card[]): number[] {
  return cards.map((x) => x.id);
}
function act(s: GameState, a: GameAction): ActionResult {
  return applyAction(s, a);
}

function firstRound(hands: Record<Seat, Card[]>, bottom?: Card[]): GameState {
  const base = createInitialMatchState(7);
  return { ...base, hands, bottomCards: bottom ?? filler(10, '2') };
}

function laterRound(
  dealer: Seat,
  levelRank: Card['rank'],
  hands: Record<Seat, Card[]>,
  bottom?: Card[],
): GameState {
  const base = createInitialMatchState(7);
  const levelIndex = ['2', '4', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].indexOf(levelRank);
  const bankerTeam = dealer % 2 === 0 ? 'A' : 'B';
  return {
    ...base,
    roundNumber: 2,
    isFirstRound: false,
    dealer,
    bankerTeam,
    levelIndex,
    levelRank: levelRank as GameState['levelRank'],
    teams: {
      A: { team: 'A', levelIndex: bankerTeam === 'A' ? levelIndex : 0, levelRank: bankerTeam === 'A' ? (levelRank as GameState['levelRank']) : '2', penaltyCount: 0 },
      B: { team: 'B', levelIndex: bankerTeam === 'B' ? levelIndex : 0, levelRank: bankerTeam === 'B' ? (levelRank as GameState['levelRank']) : '2', penaltyCount: 0 },
    },
    currentTurn: dealer,
    hands,
    bottomCards: bottom ?? filler(10, levelRank),
  };
}

describe('audit A1: 比牌 21 张定义', () => {
  it('counts ♥5, BJ, SJ, all 4 suits of level card; excludes 3s, ♠5/♣5/♦5', () => {
    const hand = [
      ...many(3, 'H', '5'),
      ...many(3, 'J', 'BJ'),
      ...many(3, 'J', 'SJ'),
      ...many(3, 'S', '6'),
      ...many(3, 'H', '6'),
      ...many(3, 'C', '6'),
      ...many(3, 'D', '6'),
      ...many(3, 'S', '3'),
      ...many(3, 'D', '3'),
      ...many(3, 'S', '5'),
      ...many(3, 'D', '5'),
      ...many(3, 'C', '5'),
    ];
    assert.equal(countBipai(hand, '6'), 21);
    assert.equal(countBipai(hand, '2'), 9);
  });

  it('正副参谋 by color: ♦ trump → ♦3 正, ♥3 副, ♠3/♣3 plain; ♠ trump → ♣3 副', () => {
    const d3 = c('D', '3');
    const h3 = c('H', '3');
    const s3 = c('S', '3');
    const c3 = c('C', '3');
    assert.equal(isTrump(d3, 'D', '4'), true);
    assert.equal(isTrump(h3, 'D', '4'), true);
    assert.equal(isTrump(s3, 'D', '4'), false);
    assert.equal(isTrump(c3, 'D', '4'), false);
    assert.ok(getCardOrder(d3, 'D', '4') > getCardOrder(h3, 'D', '4'));
    assert.equal(isTrump(c3, 'S', '4'), true);
    assert.equal(isTrump(h3, 'S', '4'), false);
    // 红五 only ♥5
    assert.equal(isTrump(c('D', '5'), 'S', '4'), false);
    assert.equal(isTrump(c('H', '5'), 'S', '4'), true);
  });
});

describe('audit A2: 首局打 2 叫主 / 反主', () => {
  it('call must be 2 or 3 same-suit 2s of own hand; 1 card / mixed suits / non-2 rejected', () => {
    const s2 = many(3, 'S', '2');
    const h2 = c('H', '2');
    const s = firstRound({
      0: [...s2, h2, c('S', '4'), ...filler(33, '2')],
      1: filler(38, '2'),
      2: filler(38, '2'),
      3: filler(38, '2'),
    });
    err(act(s, { type: 'CALL_TRUMP', seat: 0, suit: 'S', cardIds: [s2[0].id] }), 'INVALID_CALL_COUNT');
    err(act(s, { type: 'CALL_TRUMP', seat: 0, suit: 'S', cardIds: [s2[0].id, h2.id] }), 'INVALID_CALL_CARD');
    err(act(s, { type: 'CALL_TRUMP', seat: 0, suit: 'S', cardIds: [s2[0].id, s2[0].id] }), 'DUPLICATE_CARDS');
    err(act(s, { type: 'CALL_TRUMP', seat: 1, suit: 'S', cardIds: [s2[0].id, s2[1].id] }), 'NOT_YOUR_TURN');
    // cards of another player
    const s1 = { ...s, currentTurn: 1 as Seat };
    err(act(s1, { type: 'CALL_TRUMP', seat: 1, suit: 'S', cardIds: [s2[0].id, s2[1].id] }), 'CARD_NOT_IN_HAND');
    const r = ok(act(s, { type: 'CALL_TRUMP', seat: 0, suit: 'S', cardIds: ids(s2) }));
    assert.equal(r.dealer, 0);
    assert.equal(r.trumpSuit, 'S');
    assert.equal(r.callState.calledCount, 3);
  });

  it('teammate can never counter; only enemy with 3 same-suit 2s of a different suit is eligible', () => {
    const s = firstRound({
      0: [...many(2, 'S', '2'), ...filler(36, '2')],
      1: [...many(2, 'H', '2'), ...many(2, 'D', '2'), ...filler(34, '2')], // only pairs → not eligible
      2: [...many(3, 'C', '2'), ...filler(35, '2')], // teammate with 3 → not eligible
      3: [...many(3, 'D', '2'), ...filler(35, '2')],
    });
    const r = ok(act(s, { type: 'CALL_TRUMP', seat: 0, suit: 'S', cardIds: ids(s.hands[0].slice(0, 2)) }));
    assert.equal(r.phase, 'COUNTER_BIDDING');
    assert.deepEqual(r.callState.eligibleCounterSeats, [3]);
    assert.equal(r.currentTurn, 3);
    err(act({ ...r, currentTurn: 2 }, { type: 'COUNTER_BID', seat: 2, suit: 'C', cardIds: ids(s.hands[2].slice(0, 3)) }), 'NOT_ELIGIBLE');
    // counter with only 2 cards rejected
    err(act(r, { type: 'COUNTER_BID', seat: 3, suit: 'D', cardIds: ids(s.hands[3].slice(0, 2)) }), 'INVALID_COUNTER_COUNT');
  });

  it('2-card call → 3-card counter succeeds even with FEWER 比牌, steals dealer, no penalty', () => {
    const s = firstRound({
      0: [...many(2, 'S', '2'), ...many(3, 'J', 'BJ'), ...many(3, 'H', '5'), ...filler(30, '2')], // bipai 8
      1: [...many(3, 'D', '2'), ...filler(35, '2')], // bipai 3
      2: filler(38, '2'),
      3: filler(38, '2'),
    });
    const r1 = ok(act(s, { type: 'CALL_TRUMP', seat: 0, suit: 'S', cardIds: ids(s.hands[0].slice(0, 2)) }));
    const r2 = ok(act(r1, { type: 'COUNTER_BID', seat: 1, suit: 'D', cardIds: ids(s.hands[1].slice(0, 3)) }));
    assert.equal(r2.dealer, 1);
    assert.equal(r2.bankerTeam, 'B');
    assert.equal(r2.trumpSuit, 'D');
    assert.equal(r2.teams.A.penaltyCount + r2.teams.B.penaltyCount, 0);
    // nobody on team A has 3 same-suit 2s → straight to burying by NEW dealer
    assert.equal(r2.phase, 'BURYING');
    assert.equal(r2.currentTurn, 1);
    assert.equal(r2.hands[1].length, 48);
  });

  it('3-card call → counter needs STRICTLY more 比牌: tie fails (+1 penalty to counter team), more succeeds and steals dealer', () => {
    const mk = (extraForSeat1: number): GameState =>
      firstRound({
        0: [...many(3, 'S', '2'), c('J', 'BJ'), ...filler(34, '2')], // bipai 4
        1: [...many(3, 'H', '2'), ...many(extraForSeat1, 'J', 'SJ'), ...filler(35 - extraForSeat1, '2')],
        2: filler(38, '2'),
        3: filler(38, '2'),
      });
    // tie: seat1 bipai = 3 + 1 = 4
    const tie = mk(1);
    const t1 = ok(act(tie, { type: 'CALL_TRUMP', seat: 0, suit: 'S', cardIds: ids(tie.hands[0].slice(0, 3)) }));
    const t2 = ok(act(t1, { type: 'COUNTER_BID', seat: 1, suit: 'H', cardIds: ids(tie.hands[1].slice(0, 3)) }));
    assert.equal(t2.dealer, 0);
    assert.equal(t2.trumpSuit, 'S');
    assert.equal(t2.teams.B.penaltyCount, 1);
    assert.equal(t2.teams.A.penaltyCount, 0);
    assert.equal(t2.phase, 'BURYING');

    // more: seat1 bipai = 3 + 2 = 5 > 4
    const more = mk(2);
    const m1 = ok(act(more, { type: 'CALL_TRUMP', seat: 0, suit: 'S', cardIds: ids(more.hands[0].slice(0, 3)) }));
    const m2 = ok(act(m1, { type: 'COUNTER_BID', seat: 1, suit: 'H', cardIds: ids(more.hands[1].slice(0, 3)) }));
    assert.equal(m2.dealer, 1);
    assert.equal(m2.trumpSuit, 'H');
    assert.equal(m2.teams.B.penaltyCount, 0);
  });

  it('after a successful steal the robbed team (caller\'s teammate) may re-counter with 3 cards + strictly more 比牌', () => {
    const s = firstRound({
      0: [...many(2, 'S', '2'), ...filler(36, '2')],
      1: [...many(3, 'D', '2'), ...filler(35, '2')], // bipai 3
      2: [...many(3, 'C', '2'), c('J', 'BJ'), ...filler(34, '2')], // bipai 4
      3: filler(38, '2'),
    });
    const r1 = ok(act(s, { type: 'CALL_TRUMP', seat: 0, suit: 'S', cardIds: ids(s.hands[0].slice(0, 2)) }));
    const r2 = ok(act(r1, { type: 'COUNTER_BID', seat: 1, suit: 'D', cardIds: ids(s.hands[1].slice(0, 3)) }));
    assert.equal(r2.phase, 'COUNTER_BIDDING');
    assert.deepEqual(r2.callState.eligibleCounterSeats, [2]);
    const r3 = ok(act(r2, { type: 'COUNTER_BID', seat: 2, suit: 'C', cardIds: ids(s.hands[2].slice(0, 3)) }));
    assert.equal(r3.dealer, 2);
    assert.equal(r3.trumpSuit, 'C');
    // seat 1's ♦2×3 differs from new trump ♣ → may try again (bipai 3 vs 4 → fails, +1 penalty)
    assert.equal(r3.phase, 'COUNTER_BIDDING');
    assert.deepEqual(r3.callState.eligibleCounterSeats, [1]);
    const r4 = ok(act(r3, { type: 'COUNTER_BID', seat: 1, suit: 'D', cardIds: ids(s.hands[1].slice(0, 3)) }));
    assert.equal(r4.teams.B.penaltyCount, 1);
    assert.equal(r4.dealer, 2);
    assert.equal(r4.phase, 'BURYING');
  });

  it('all four pass → flip bottom (skip jokers/♥5), dealer defaults to seat 0, no counter window, dealer gets 48', () => {
    const bottom = [c('J', 'BJ'), c('H', '5'), c('J', 'SJ'), c('C', '9'), ...filler(6, '2')];
    let s = firstRound(
      { 0: filler(38, '2'), 1: filler(38, '2'), 2: filler(38, '2'), 3: filler(38, '2') },
      bottom,
    );
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      s = ok(act(s, { type: 'PASS_CALL', seat }));
    }
    assert.equal(s.phase, 'BURYING');
    assert.equal(s.trumpSuit, 'C');
    assert.equal(s.dealer, 0);
    assert.equal(s.hands[0].length, 48);
    err(act(s, { type: 'COUNTER_BID', seat: 1, suit: 'D', cardIds: [] }), 'INVALID_PHASE');
  });

  it('all-joker/♥5 bottom falls back to no-trump (null)', () => {
    const bottom = [...many(3, 'J', 'BJ'), ...many(3, 'J', 'SJ'), ...many(3, 'H', '5'), c('J', 'BJ')];
    let s = firstRound(
      { 0: filler(38, '2'), 1: filler(38, '2'), 2: filler(38, '2'), 3: filler(38, '2') },
      bottom,
    );
    for (const seat of [0, 1, 2, 3] as Seat[]) s = ok(act(s, { type: 'PASS_CALL', seat }));
    assert.equal(s.trumpSuit, null);
  });

  it('after burying no counter-bid / call is possible', () => {
    const s = firstRound({
      0: [...many(2, 'S', '2'), ...filler(36, '2')],
      1: [...many(3, 'D', '2'), ...filler(35, '2')],
      2: filler(38, '2'),
      3: filler(38, '2'),
    });
    const r1 = ok(act(s, { type: 'CALL_TRUMP', seat: 0, suit: 'S', cardIds: ids(s.hands[0].slice(0, 2)) }));
    const r2 = ok(act(r1, { type: 'PASS_COUNTER', seat: 1 }));
    assert.equal(r2.phase, 'BURYING');
    const r3 = ok(act(r2, { type: 'BURY_BOTTOM', seat: 0, cardIds: ids(r2.hands[0].slice(-10)) }));
    assert.equal(r3.phase, 'PLAYING');
    assert.equal(r3.bottomCards.length, 10);
    err(act(r3, { type: 'COUNTER_BID', seat: 1, suit: 'D', cardIds: ids(s.hands[1].slice(0, 3)) }), 'INVALID_PHASE');
    err(act(r3, { type: 'CALL_TRUMP', seat: 1, suit: 'D', cardIds: ids(s.hands[1].slice(0, 3)) }), 'INVALID_PHASE');
  });
});

describe('audit A3: 后续局叫主 / 反主', () => {
  it('any seat may call with exactly 1 level card; calling starts from dealer; dealer never changes', () => {
    const s = laterRound(1, '6', {
      0: [c('S', '6'), ...filler(37, '6')],
      1: filler(38, '6'),
      2: filler(38, '6'),
      3: [c('H', '6'), c('H', '6'), ...filler(36, '6')],
    });
    assert.equal(s.currentTurn, 1);
    let r = ok(act(s, { type: 'PASS_CALL', seat: 1 }));
    r = ok(act(r, { type: 'PASS_CALL', seat: 2 }));
    err(act(r, { type: 'CALL_TRUMP', seat: 3, suit: 'H', cardIds: ids(s.hands[3].slice(0, 2)) }), 'INVALID_CALL_COUNT');
    err(act(r, { type: 'CALL_TRUMP', seat: 3, suit: 'S', cardIds: ids(s.hands[3].slice(0, 1)) }), 'INVALID_CALL_CARD');
    const called = ok(act(r, { type: 'CALL_TRUMP', seat: 3, suit: 'H', cardIds: ids(s.hands[3].slice(0, 1)) }));
    assert.equal(called.dealer, 1);
    assert.equal(called.bankerTeam, 'B');
    assert.equal(called.trumpSuit, 'H');
    // team A seat 0 holds ♠6 → may counter
    assert.deepEqual(called.callState.eligibleCounterSeats, [0]);
  });

  it('challenger-team call countered by banker team; success changes only trump, dealer fixed', () => {
    const s = laterRound(0, '4', {
      0: [c('S', '4'), ...many(2, 'J', 'BJ'), ...filler(35, '4')], // bipai 3
      1: [c('D', '4'), c('J', 'SJ'), ...filler(36, '4')], // bipai 2
      2: filler(38, '4'),
      3: filler(38, '4'),
    });
    let r = ok(act(s, { type: 'PASS_CALL', seat: 0 }));
    r = ok(act(r, { type: 'CALL_TRUMP', seat: 1, suit: 'D', cardIds: [s.hands[1][0].id] }));
    assert.equal(r.dealer, 0);
    assert.deepEqual(r.callState.eligibleCounterSeats, [0]);
    err(act(r, { type: 'COUNTER_BID', seat: 0, suit: 'D', cardIds: [s.hands[0][0].id] }), 'SAME_SUIT');
    const r2 = ok(act(r, { type: 'COUNTER_BID', seat: 0, suit: 'S', cardIds: [s.hands[0][0].id] }));
    assert.equal(r2.dealer, 0);
    assert.equal(r2.trumpSuit, 'S');
    assert.equal(r2.callState.callerSeat, 0);
  });

  it('cannot counter teammate; teammate retries after failure: first penalty kept even if retry succeeds', () => {
    const s = laterRound(0, '7', {
      0: [c('S', '7'), ...many(3, 'J', 'BJ'), ...filler(34, '7')], // bipai 4
      1: [c('H', '7'), ...filler(37, '7')], // bipai 1 → fails
      2: [c('C', '7'), ...filler(37, '7')], // teammate
      3: [c('D', '7'), ...many(3, 'H', '5'), c('J', 'SJ'), ...filler(33, '7')], // bipai 5 → succeeds
    });
    const r1 = ok(act(s, { type: 'CALL_TRUMP', seat: 0, suit: 'S', cardIds: [s.hands[0][0].id] }));
    assert.deepEqual(r1.callState.eligibleCounterSeats, [1, 3]);
    const r2 = ok(act(r1, { type: 'COUNTER_BID', seat: 1, suit: 'H', cardIds: [s.hands[1][0].id] }));
    assert.equal(r2.teams.B.penaltyCount, 1);
    assert.equal(r2.trumpSuit, 'S');
    assert.deepEqual(r2.callState.eligibleCounterSeats, [3]);
    // seat1 cannot retry
    err(act({ ...r2, currentTurn: 1 }, { type: 'COUNTER_BID', seat: 1, suit: 'H', cardIds: [s.hands[1][0].id] }), 'NOT_ELIGIBLE');
    const r3 = ok(act(r2, { type: 'COUNTER_BID', seat: 3, suit: 'D', cardIds: [s.hands[3][0].id] }));
    assert.equal(r3.trumpSuit, 'D');
    assert.equal(r3.dealer, 0);
    assert.equal(r3.teams.B.penaltyCount, 1, 'first failure penalty must NOT be erased by teammate success');
    // team A now may re-counter: seat 0 bipai 4 vs seat3 5 → not more; seat2 bipai 1
    assert.deepEqual(r3.callState.eligibleCounterSeats, [0, 2]);
    const r4 = ok(act(r3, { type: 'COUNTER_BID', seat: 0, suit: 'S', cardIds: [s.hands[0][0].id] }));
    assert.equal(r4.teams.A.penaltyCount, 1);
    assert.equal(r4.trumpSuit, 'D');
    const r5 = ok(act(r4, { type: 'PASS_COUNTER', seat: 2 }));
    assert.equal(r5.phase, 'BURYING');
    assert.equal(r5.currentTurn, 0, 'dealer (not caller) buries');
    // penalties carry into next round state
    const next = startNextRound({ ...r5, settlement: { nextDealer: 2 } as GameState['settlement'] });
    assert.equal(next.teams.A.penaltyCount, 1);
    assert.equal(next.teams.B.penaltyCount, 1);
  });

  it('both enemies fail → penalty accumulates to 2', () => {
    const s = laterRound(2, '8', {
      0: filler(38, '8'),
      1: [c('H', '8'), ...filler(37, '8')],
      2: [c('S', '8'), c('J', 'BJ'), c('J', 'BJ'), ...filler(35, '8')],
      3: [c('D', '8'), ...filler(37, '8')],
    });
    let r = ok(act(s, { type: 'CALL_TRUMP', seat: 2, suit: 'S', cardIds: [s.hands[2][0].id] }));
    assert.deepEqual(r.callState.eligibleCounterSeats, [3, 1]);
    r = ok(act(r, { type: 'COUNTER_BID', seat: 3, suit: 'D', cardIds: [s.hands[3][0].id] }));
    r = ok(act(r, { type: 'COUNTER_BID', seat: 1, suit: 'H', cardIds: [s.hands[1][0].id] }));
    assert.equal(r.teams.B.penaltyCount, 2);
    assert.equal(r.phase, 'BURYING');
    assert.equal(r.dealer, 2);
  });

  it('enemy holding only the SAME suit level card as current trump is not eligible', () => {
    const s = laterRound(0, '9', {
      0: [c('S', '9'), ...filler(37, '9')],
      1: [c('S', '9'), c('S', '9'), ...filler(36, '9')],
      2: filler(38, '9'),
      3: filler(38, '9'),
    });
    const r = ok(act(s, { type: 'CALL_TRUMP', seat: 0, suit: 'S', cardIds: [s.hands[0][0].id] }));
    assert.equal(r.phase, 'BURYING');
    assert.deepEqual(getEligibleCounterSeats(r), []);
  });

  it('later rounds all pass → flip bottom, dealer unchanged', () => {
    let s = laterRound(3, 'J', {
      0: filler(38, 'J'),
      1: filler(38, 'J'),
      2: filler(38, 'J'),
      3: filler(38, 'J'),
    }, [c('D', 'A'), ...filler(9, 'J')]);
    for (const seat of [3, 0, 1, 2] as Seat[]) s = ok(act(s, { type: 'PASS_CALL', seat }));
    assert.equal(s.trumpSuit, 'D');
    assert.equal(s.dealer, 3);
    assert.equal(s.phase, 'BURYING');
  });
});

describe('audit A8: bot-driven bidding invariants over many seeds', () => {
  it('300 seeds × (round 1 + later round): all bot actions legal; invariants hold until BURYING', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const r1 = createInitialMatchState(seed);
      const fake = { ...r1, settlement: { nextDealer: (seed % 4) as Seat } as GameState['settlement'] };
      fake.teams = {
        A: { team: 'A', levelIndex: seed % 11, levelRank: (['2', '4', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const)[seed % 11], penaltyCount: 0 },
        B: { team: 'B', levelIndex: (seed * 7) % 11, levelRank: (['2', '4', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'] as const)[(seed * 7) % 11], penaltyCount: 0 },
      };
      for (const start of [r1, startNextRound(fake, seed + 1000)]) {
        let s = start;
        const fixedDealer = s.dealer;
        let guard = 0;
        while (s.phase === 'CALLING' || s.phase === 'COUNTER_BIDDING') {
          assert.ok(guard++ < 64, `seed ${seed}: bidding did not terminate`);
          const seat = s.currentTurn as Seat;
          const a = chooseBotAction(s, seat);
          const prev = s;
          s = ok(act(s, a));
          if (!start.isFirstRound) assert.equal(s.dealer, fixedDealer, 'later rounds: dealer fixed');
          if (a.type === 'COUNTER_BID') {
            const failed = s.callState.callerSeat === prev.callState.callerSeat;
            const team = seat % 2 === 0 ? 'A' : 'B';
            assert.notEqual(prev.callState.callerTeam, team, 'never counter own team');
            assert.equal(s.teams[team].penaltyCount - prev.teams[team].penaltyCount, failed ? 1 : 0);
            if (!failed && !(prev.isFirstRound && prev.callState.calledCount === 2)) {
              assert.ok(countBipai(prev.hands[seat], prev.levelRank) > countBipai(prev.hands[prev.callState.callerSeat!], prev.levelRank));
            }
            if (!failed && start.isFirstRound) assert.equal(s.dealer, seat, 'round 1 steal');
          }
        }
        assert.equal(s.phase, 'BURYING');
        assert.equal(s.hands[s.dealer!].length, 48);
        assert.equal(s.currentTurn, s.dealer);
        const total = [0, 1, 2, 3].reduce((n, k) => n + s.hands[k as Seat].length, 0);
        assert.equal(total, 162);
      }
    }
  });
});

describe('audit A7: 打黑心叫分', () => {
  it('rejects bids <100, >300, non-step, not-higher; passed seat cannot re-bid; last remaining bidder wins', () => {
    const s0 = createInitialMatchState({ seed: 9, mode: 'heixin' });
    err(act(s0, { type: 'BID_SCORE', seat: 0, score: 95 }), 'INVALID_BID_SCORE');
    err(act(s0, { type: 'BID_SCORE', seat: 0, score: 305 }), 'INVALID_BID_SCORE');
    err(act(s0, { type: 'BID_SCORE', seat: 0, score: 103 }), 'INVALID_BID_SCORE');
    let s = ok(act(s0, { type: 'BID_SCORE', seat: 0, score: 100 }));
    err(act(s, { type: 'BID_SCORE', seat: 1, score: 100 }), 'INVALID_BID_SCORE');
    s = ok(act(s, { type: 'PASS_BID', seat: 1 }));
    s = ok(act(s, { type: 'BID_SCORE', seat: 2, score: 150 }));
    s = ok(act(s, { type: 'PASS_BID', seat: 3 }));
    assert.equal(s.currentTurn, 0, 'passed seats are skipped');
    s = ok(act(s, { type: 'PASS_BID', seat: 0 }));
    assert.equal(s.phase, 'CHOOSE_TRUMP');
    assert.equal(s.dealer, 2);
    assert.equal(s.bidState?.highestBid, 150);
    err(act(s, { type: 'CHOOSE_TRUMP', seat: 0, suit: 'S' }), 'NOT_DEALER');
    // no counter-bidding in heixin
    const ch = ok(act(s, { type: 'CHOOSE_TRUMP', seat: 2, suit: 'H' }));
    assert.equal(ch.phase, 'BURYING');
    assert.equal(ch.hands[2].length, 48);
  });
});
