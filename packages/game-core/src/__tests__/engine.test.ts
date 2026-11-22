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

describe('engine FSM: dealing, Round 1 real-count stealing, accept-vs-defend counter, no re-counter by countered/been-countered', () => {
  it('Round 1: 3-card counter steals freely ONLY if caller truly holds <3; hiding 3rd card still triggers COUNTER_RESPONSE & bipai', () => {
    const base = createInitialMatchState(42);
    // Seat 0 truly holds only 2x S2 -> Seat 1's 3x H2 steals directly without bipai penalty
    const state2Real: GameState = {
      ...base,
      hands: {
        0: [...[c(1000, 'S', '2'), c(1001, 'S', '2'), c(1002, 'J', 'BJ')], ...makeFillerHand(2000, 35)],
        1: [...[c(1010, 'H', '2'), c(1011, 'H', '2'), c(1012, 'H', '2'), c(1013, 'H', '5')], ...makeFillerHand(2100, 34)],
        2: [...[c(1020, 'C', '2'), c(1021, 'C', '2')], ...makeFillerHand(2200, 36)],
        3: [...[c(1030, 'D', '2'), c(1031, 'D', '2'), c(1032, 'D', '2')], ...makeFillerHand(2300, 35)],
      },
    };

    const r1 = applyAction(state2Real, {
      type: 'CALL_TRUMP',
      seat: 0,
      suit: 'S',
      cardIds: [1000, 1001],
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    assert.equal(r1.state.dealer, 0);
    assert.equal(r1.state.phase, 'COUNTER_BIDDING');

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

    // NOW test rule #1: Seat 0 ACTUALLY holds 3x S2, but only shows 2x S2 -> Seat 1 counters with 3x H2 (tie bipai 3 == 3)
    // Must enter COUNTER_RESPONSE -> Seat 0 defends -> Seat 1 FAILS and gets +1 penalty!
    const state3Hidden: GameState = {
      ...base,
      hands: {
        0: [...[c(1100, 'S', '2'), c(1101, 'S', '2'), c(1102, 'S', '2')], ...makeFillerHand(2400, 35)], // real 3x S2, bipai = 3
        1: [...[c(1110, 'H', '2'), c(1111, 'H', '2'), c(1112, 'H', '2')], ...makeFillerHand(2500, 35)], // bipai = 3 (tie!)
        2: makeFillerHand(2600, 38),
        3: makeFillerHand(2700, 38),
      },
    };

    const c2Shown = applyAction(state3Hidden, {
      type: 'CALL_TRUMP',
      seat: 0,
      suit: 'S',
      cardIds: [1100, 1101], // intentionally show only 2 of 3!
    });
    assert.equal(c2Shown.ok, true);
    if (!c2Shown.ok) return;
    const proposed = applyAction(c2Shown.state, {
      type: 'COUNTER_BID',
      seat: 1,
      suit: 'H',
      cardIds: [1110, 1111, 1112],
    });
    assert.equal(proposed.ok, true);
    if (!proposed.ok) return;
    assert.equal(proposed.state.phase, 'COUNTER_RESPONSE');
    assert.equal(proposed.state.currentTurn, 0);

    const defended = applyAction(proposed.state, {
      type: 'DEFEND_COUNTER',
      seat: 0,
    });
    assert.equal(defended.ok, true);
    if (!defended.ok) return;
    assert.equal(defended.state.dealer, 0);
    assert.equal(defended.state.trumpSuit, 'S');
    assert.equal(defended.state.teams.B.penaltyCount, 1);
    assert.equal(defended.state.phase, 'BURYING');
  });

  it('Round 2+: accept-vs-defend counter, penalty retention, and countered/been-countered seats cannot re-counter', () => {
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

    const r2Custom: GameState = {
      ...r2Init,
      hands: {
        2: [...[c(3000, 'S', '6'), c(3001, 'J', 'BJ'), c(3002, 'J', 'BJ')], ...makeFillerHand(4000, 35)], // bipai 3
        3: [...[c(3010, 'H', '6')], ...makeFillerHand(4100, 37)], // bipai 1
        0: [...[c(3020, 'C', '6')], ...makeFillerHand(4200, 37)], // bipai 1
        1: [...[c(3030, 'D', '6'), c(3031, 'H', '5'), c(3032, 'H', '5'), c(3033, 'H', '5')], ...makeFillerHand(4300, 34)], // bipai 4
      },
    };

    const called = applyAction(r2Custom, {
      type: 'CALL_TRUMP',
      seat: 2,
      suit: 'S',
      cardIds: [3000],
    });
    assert.equal(called.ok, true);
    if (!called.ok) return;
    assert.equal(called.state.phase, 'COUNTER_BIDDING');
    assert.deepEqual(called.state.callState.eligibleCounterSeats, [3, 1]);

    // Seat 3 counters -> Seat 2 defends -> Seat 3 fails (+1 penalty); Seat 1 (teammate) remains eligible!
    const prop1 = applyAction(called.state, {
      type: 'COUNTER_BID',
      seat: 3,
      suit: 'H',
      cardIds: [3010],
    });
    assert.equal(prop1.ok, true);
    if (!prop1.ok) return;
    assert.equal(prop1.state.phase, 'COUNTER_RESPONSE');

    const fail1 = applyAction(prop1.state, { type: 'DEFEND_COUNTER', seat: 2 });
    assert.equal(fail1.ok, true);
    if (!fail1.ok) return;
    assert.equal(fail1.state.teams.B.penaltyCount, 1);
    assert.equal(fail1.state.trumpSuit, 'S');
    assert.deepEqual(fail1.state.callState.eligibleCounterSeats, [1]);

    // Seat 1 retries and Seat 2 chooses ACCEPT_COUNTER (no bipai needed, B's first penalty preserved!)
    const prop2 = applyAction(fail1.state, {
      type: 'COUNTER_BID',
      seat: 1,
      suit: 'D',
      cardIds: [3030],
    });
    assert.equal(prop2.ok, true);
    if (!prop2.ok) return;
    const acc2 = applyAction(prop2.state, { type: 'ACCEPT_COUNTER', seat: 2 });
    assert.equal(acc2.ok, true);
    if (!acc2.ok) return;
    assert.equal(acc2.state.trumpSuit, 'D');
    assert.equal(acc2.state.dealer, 2); // dealer fixed in Round 2+
    assert.equal(acc2.state.teams.B.penaltyCount, 1); // first penalty preserved!
    // Seat 2 has been countered -> CANNOT re-counter; ONLY Seat 0 (teammate) is eligible!
    assert.equal(acc2.state.phase, 'COUNTER_BIDDING');
    assert.deepEqual(acc2.state.callState.eligibleCounterSeats, [0]);
  });

  it('DEALING phase: can call on card #1, dealing continues to 38 cards, no counter during dealing', () => {
    const d0 = createInitialMatchState({ seed: 55, mode: 'hongxin', withDealing: true });
    assert.equal(d0.phase, 'DEALING');
    assert.equal(d0.dealtCount, 0);

    // Put a level-2 pair right at the top of Seat 2's undealt queue to test early dealing call
    const custom: GameState = {
      ...d0,
      undealtHands: {
        ...d0.undealtHands,
        2: [c(9001, 'H', '2'), c(9002, 'H', '2'), ...d0.undealtHands[2].slice(2)],
      },
    };

    // Deal 2 cards -> Seat 2 can immediately call trump!
    let s = custom;
    for (let i = 0; i < 2; i++) {
      const step = applyAction(s, { type: 'DEAL_STEP' });
      assert.equal(step.ok, true);
      if (!step.ok) return;
      s = step.state;
    }
    assert.equal(s.dealtCount, 2);
    assert.equal(s.phase, 'DEALING');

    const earlyCall = applyAction(s, {
      type: 'CALL_TRUMP',
      seat: 2,
      suit: 'H',
      cardIds: [9001, 9002],
    });
    assert.equal(earlyCall.ok, true);
    if (!earlyCall.ok) return;
    // Dealing animation must NOT be skipped after calling!
    assert.equal(earlyCall.state.phase, 'DEALING');
    assert.equal(earlyCall.state.trumpSuit, 'H');
    assert.equal(earlyCall.state.dealer, 2);

    // Counter-bid is forbidden while still dealing
    const badCounter = applyAction(earlyCall.state, {
      type: 'COUNTER_BID',
      seat: 1,
      suit: 'S',
      cardIds: [],
    });
    assert.equal(badCounter.ok, false);

    // Finish remaining 36 deal steps -> automatically transitions out of DEALING
    s = earlyCall.state;
    for (let i = 2; i < 38; i++) {
      const step = applyAction(s, { type: 'DEAL_STEP' });
      assert.equal(step.ok, true);
      if (!step.ok) return;
      s = step.state;
    }
    assert.equal(s.dealtCount, 38);
    assert.ok(s.phase === 'COUNTER_BIDDING' || s.phase === 'BURYING');
  });

  it('all-pass calling flips bottom to pick trumpSuit and hides hidden hands/bottom in getPlayerView', () => {
    let s = createInitialMatchState(123);
    for (const seat of [0, 1, 2, 3] as Seat[]) {
      const res = applyAction(s, { type: 'PASS_CALL', seat });
      assert.equal(res.ok, true);
      if (!res.ok) return;
      s = res.state;
    }
    assert.equal(s.phase, 'BURYING');
    assert.equal(s.dealer, 0);
    assert.equal(s.hands[0].length, 48);

    const p1View = getPlayerView(s, 1, false);
    assert.equal(p1View.myHand.length, 38);
    assert.equal(p1View.revealedBottom, null);
    assert.equal(p1View.debugView, undefined);

    const debugView = getPlayerView(s, 1, true);
    assert.ok(debugView.debugView);
    assert.equal(debugView.debugView.allHands[0].length, 48);
  });
});
