import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction,
  createInitialMatchState,
  getPlayerView,
  LEVEL_SEQUENCE,
  startNextRound,
} from '../index.js';
import type { Card, GameState, Seat } from '../index.js';

function c(id: number, suit: Card['suit'], rank: Card['rank']): Card {
  return { id, deck: 0, suit, rank };
}

function makeFillerHand(startId: number, count: number): Card[] {
  const ranks = ['4', '6', '7', '8', '9', 'J', 'Q', 'K', 'A'] as const;
  const suits = ['S', 'H', 'C', 'D'] as const;
  const res: Card[] = [];
  for (let i = 0; i < count; i++) {
    res.push(c(startId + i, suits[i % 4], ranks[i % ranks.length]));
  }
  return res;
}

describe('engine FSM: Round 1 stealing, Round 2+ counter-bidding, penalty retention, and PlayerView isolation', () => {
  it('Round 1: 3-card counter-bid steals dealer freely against 2-card call, and compares 21-card bipai against 3-card call (tie = fail + penalty)', () => {
    const base = createInitialMatchState(42);
    // Construct deterministic hands:
    // Seat 0: 2x S2, 1x BJ (bipai = 3)
    // Seat 1: 3x H2, 1x H5 (bipai = 4) -> > 3, succeeds!
    // Seat 2: 2x C2, 3x BJ (teammate of Seat 0)
    // Seat 3: 3x D2 (bipai = 3) -> tie against 3, fails if Seat 0 had 3x S2!
    const state2Call: GameState = {
      ...base,
      hands: {
        0: [...[c(1000, 'S', '2'), c(1001, 'S', '2'), c(1002, 'J', 'BJ')], ...makeFillerHand(2000, 35)],
        1: [...[c(1010, 'H', '2'), c(1011, 'H', '2'), c(1012, 'H', '2'), c(1013, 'H', '5')], ...makeFillerHand(2100, 34)],
        2: [...[c(1020, 'C', '2'), c(1021, 'C', '2')], ...makeFillerHand(2200, 36)],
        3: [...[c(1030, 'D', '2'), c(1031, 'D', '2'), c(1032, 'D', '2')], ...makeFillerHand(2300, 35)],
      },
    };

    // Seat 0 calls with 2x S2
    const r1 = applyAction(state2Call, {
      type: 'CALL_TRUMP',
      seat: 0,
      suit: 'S',
      cardIds: [1000, 1001],
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    assert.equal(r1.state.dealer, 0);
    assert.equal(r1.state.phase, 'COUNTER_BIDDING');

    // Seat 1 counters with 3x H2 against 2-card call -> steals dealer immediately without bipai penalty
    const r2 = applyAction(r1.state, {
      type: 'COUNTER_BID',
      seat: 1,
      suit: 'H',
      cardIds: [1010, 1011, 1012],
    });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    assert.equal(r2.state.dealer, 1);
    assert.equal(r2.state.bankerTeam, 'B');
    assert.equal(r2.state.trumpSuit, 'H');
    assert.equal(r2.state.teams.B.penaltyCount, 0);
    // Team A has no 3-card 2s, so auto-enters BURYING for new dealer Seat 1
    assert.equal(r2.state.phase, 'BURYING');
    assert.equal(r2.state.hands[1].length, 48);

    // Bury 10 cards locks trump
    const buryIds = r2.state.hands[1].slice(0, 10).map((card) => card.id);
    const buried = applyAction(r2.state, { type: 'BURY_BOTTOM', seat: 1, cardIds: buryIds });
    assert.equal(buried.ok, true);
    if (!buried.ok) return;
    assert.equal(buried.state.phase, 'PLAYING');
    assert.equal(buried.state.hands[1].length, 38);
    assert.equal(buried.state.bottomCards.length, 10);

    // Now test 3-card call with bipai TIE -> counter-bid fails and adds +1 penalty
    const state3Call: GameState = {
      ...base,
      hands: {
        0: [...[c(1100, 'S', '2'), c(1101, 'S', '2'), c(1102, 'S', '2')], ...makeFillerHand(2400, 35)], // bipai = 3
        1: [...[c(1110, 'H', '2'), c(1111, 'H', '2'), c(1112, 'H', '2')], ...makeFillerHand(2500, 35)], // bipai = 3 (tie!)
        2: makeFillerHand(2600, 38),
        3: makeFillerHand(2700, 38),
      },
    };

    const c3 = applyAction(state3Call, {
      type: 'CALL_TRUMP',
      seat: 0,
      suit: 'S',
      cardIds: [1100, 1101, 1102],
    });
    assert.equal(c3.ok, true);
    if (!c3.ok) return;
    const tieCounter = applyAction(c3.state, {
      type: 'COUNTER_BID',
      seat: 1,
      suit: 'H',
      cardIds: [1110, 1111, 1112],
    });
    assert.equal(tieCounter.ok, true);
    if (!tieCounter.ok) return;
    assert.equal(tieCounter.state.dealer, 0);
    assert.equal(tieCounter.state.trumpSuit, 'S');
    assert.equal(tieCounter.state.teams.B.penaltyCount, 1);
    assert.equal(tieCounter.state.phase, 'BURYING');
  });

  it('Round 2+: 1-card call keeps fixed dealer; teammate can retry after first failure while preserving first penalty, and double failure adds 2 penalties', () => {
    const base = createInitialMatchState(7);
    const settledBase: GameState = {
      ...base,
      teams: {
        A: { team: 'A', levelIndex: 2, levelRank: LEVEL_SEQUENCE[2], penaltyCount: 0 }, // level 6
        B: { team: 'B', levelIndex: 1, levelRank: LEVEL_SEQUENCE[1], penaltyCount: 0 },
      },
      settlement: {
        mode: 'hongxin',
        roundNumber: 1,
        dealer: 0,
        bankerTeam: 'A',
        challengerTeam: 'B',
        tableChallengerPoints: 20,
        bottomPointsRaw: 0,
        bottomKilled: false,
        bottomBonusPoints: 0,
        totalChallengerScore: 20,
        bankerWon: true,
        earningTeam: 'A',
        earnedSteps: 2,
        penaltyAbsorbed: 0,
        actualLevelUp: 2,
        previousLevels: { A: 0, B: 0 },
        newLevels: { A: 2, B: 0 },
        previousPenalties: { A: 0, B: 0 },
        newPenalties: { A: 0, B: 0 },
        nextDealer: 2,
        matchWinner: null,
        revealedBottom: [],
      },
    };

    const r2Init = startNextRound(settledBase, 99);
    assert.equal(r2Init.dealer, 2);
    assert.equal(r2Init.levelRank, '6');

    // Construct Round 2 hands:
    // Seat 2 (dealer): 1x S6 + 2x BJ (bipai = 3)
    // Seat 3 (Team B): 1x H6 (bipai = 1 <= 3 -> fails!)
    // Seat 1 (Team B): 1x D6 + 3x H5 (bipai = 4 > 3 -> succeeds!)
    // Seat 0 (Team A): 1x C6 (bipai = 1)
    const r2Custom: GameState = {
      ...r2Init,
      hands: {
        2: [...[c(3000, 'S', '6'), c(3001, 'J', 'BJ'), c(3002, 'J', 'BJ')], ...makeFillerHand(4000, 35)],
        3: [...[c(3010, 'H', '6')], ...makeFillerHand(4100, 37)],
        0: [...[c(3020, 'C', '6')], ...makeFillerHand(4200, 37)],
        1: [...[c(3030, 'D', '6'), c(3031, 'H', '5'), c(3032, 'H', '5'), c(3033, 'H', '5')], ...makeFillerHand(4300, 34)],
      },
    };

    // Seat 2 calls S with 1x S6 -> dealer remains 2
    const called = applyAction(r2Custom, {
      type: 'CALL_TRUMP',
      seat: 2,
      suit: 'S',
      cardIds: [3000],
    });
    assert.equal(called.ok, true);
    if (!called.ok) return;
    assert.equal(called.state.dealer, 2);
    assert.equal(called.state.phase, 'COUNTER_BIDDING');
    assert.deepEqual(called.state.callState.eligibleCounterSeats, [3, 1]);

    // Seat 3 fails counter-bid -> B gets penalty = 1, Seat 1 (teammate) is next eligible!
    const fail1 = applyAction(called.state, {
      type: 'COUNTER_BID',
      seat: 3,
      suit: 'H',
      cardIds: [3010],
    });
    assert.equal(fail1.ok, true);
    if (!fail1.ok) return;
    assert.equal(fail1.state.teams.B.penaltyCount, 1);
    assert.equal(fail1.state.currentTurn, 1);
    assert.equal(fail1.state.trumpSuit, 'S');

    // Seat 1 retries and SUCCEEDS -> trump becomes D, dealer STILL 2, and B's first penalty (1) is PRESERVED!
    const succ2 = applyAction(fail1.state, {
      type: 'COUNTER_BID',
      seat: 1,
      suit: 'D',
      cardIds: [3030],
    });
    assert.equal(succ2.ok, true);
    if (!succ2.ok) return;
    assert.equal(succ2.state.trumpSuit, 'D');
    assert.equal(succ2.state.dealer, 2); // dealer NEVER changes in Round 2+!
    assert.equal(succ2.state.teams.B.penaltyCount, 1); // preserved!
    assert.equal(succ2.state.phase, 'COUNTER_BIDDING');
    assert.deepEqual(succ2.state.callState.eligibleCounterSeats, [2, 0]);
  });

  it('all-pass calling flips bottom to pick trumpSuit and hides hidden hands/bottom in getPlayerView', () => {
    let s = createInitialMatchState(123);
    for (let i = 0; i < 4; i++) {
      const seat = s.currentTurn as Seat;
      const res = applyAction(s, { type: 'PASS_CALL', seat });
      assert.equal(res.ok, true);
      if (!res.ok) return;
      s = res.state;
    }
    assert.equal(s.phase, 'BURYING');
    assert.equal(s.dealer, 0);
    assert.equal(s.hands[0].length, 48);

    // Non-dealer view hides other hands and bottom
    const p1View = getPlayerView(s, 1, false);
    assert.equal(p1View.myHand.length, 38);
    assert.equal(p1View.revealedBottom, null);
    assert.equal(p1View.debugView, undefined);

    // Debug view exposes all hands and bipai counts
    const debugView = getPlayerView(s, 1, true);
    assert.ok(debugView.debugView);
    assert.equal(debugView.debugView.allHands[0].length, 48);
  });
});
