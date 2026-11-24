import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction,
  calculateHeixinSettlement,
  chooseBotAction,
  createInitialMatchState,
  getCardPoints,
  startNextRound,
} from '../index.js';
import type { Card, GameState, Seat } from '../index.js';

describe('金山打黑心 (heixin) mode: bidding, unrestricted burying, 1v3 scoring & simulation', () => {
  it('supports bidding 100..300, immediate 300 win, all-pass fallback, and allows burying any card including 10', () => {
    const s0 = createInitialMatchState({ seed: 202, mode: 'heixin' });
    assert.equal(s0.mode, 'heixin');
    assert.equal(s0.phase, 'BIDDING');
    assert.equal(s0.levelRank, '10');

    // Seat 0 bids 120, Seat 1 passes, Seat 2 bids 150, Seat 3 bids 300 -> immediate CHOOSE_TRUMP
    const b1 = applyAction(s0, { type: 'BID_SCORE', seat: 0, score: 120 });
    assert.equal(b1.ok, true);
    if (!b1.ok) return;
    const b2 = applyAction(b1.state, { type: 'PASS_BID', seat: 1 });
    assert.equal(b2.ok, true);
    if (!b2.ok) return;
    const b3 = applyAction(b2.state, { type: 'BID_SCORE', seat: 2, score: 150 });
    assert.equal(b3.ok, true);
    if (!b3.ok) return;
    const b4 = applyAction(b3.state, { type: 'BID_SCORE', seat: 3, score: 300 });
    assert.equal(b4.ok, true);
    if (!b4.ok) return;

    assert.equal(b4.state.phase, 'CHOOSE_TRUMP');
    assert.equal(b4.state.dealer, 3);
    assert.equal(b4.state.bidState?.highestBid, 300);

    // Choose trump suit 'S' -> BURYING for Seat 3 with 48 cards
    const ch = applyAction(b4.state, { type: 'CHOOSE_TRUMP', seat: 3, suit: 'S' });
    assert.equal(ch.ok, true);
    if (!ch.ok) return;
    assert.equal(ch.state.phase, 'BURYING');
    assert.equal(ch.state.trumpSuit, 'S');
    assert.equal(ch.state.hands[3].length, 48);

    // Burying cards including a '10' must be ALLOWED in heixin
    const aTen = ch.state.hands[3].find((c) => c.rank === '10');
    const nonTens = ch.state.hands[3].filter((c) => c.rank !== '10');
    assert.ok(aTen);
    const buryWithTen = applyAction(ch.state, {
      type: 'BURY_BOTTOM',
      seat: 3,
      cardIds: [aTen.id, ...nonTens.slice(0, 9).map((c) => c.id)],
    });
    assert.equal(buryWithTen.ok, true);
    if (!buryWithTen.ok) return;
    assert.equal(buryWithTen.state.phase, 'PLAYING');
    assert.equal(buryWithTen.state.bottomCards.some((c) => c.id === aTen.id), true);

    // All-pass fallback -> startSeat becomes dealer at 100
    let passState = createInitialMatchState({ seed: 303, mode: 'heixin' });
    for (let i = 0; i < 4; i++) {
      const res = applyAction(passState, {
        type: 'PASS_BID',
        seat: passState.currentTurn as Seat,
      });
      assert.equal(res.ok, true);
      if (!res.ok) return;
      passState = res.state;
    }
    assert.equal(passState.phase, 'CHOOSE_TRUMP');
    assert.equal(passState.dealer, 0);
    assert.equal(passState.bidState?.highestBid, 100);
  });

  it('computes 1v3 heixin zero-sum settlement with bottom kill x2', () => {
    const emptyBottom: Card[] = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      deck: 0 as const,
      suit: 'S' as const,
      rank: '5' as const, // 10 * 5 = 50 raw -> 100 bonus when killed
    }));

    // Bid 160, table challenger = 40, challenger won last trick (+100) -> total challenger = 140
    // Banker net = 300 - 140 = 160 >= 160 -> Banker WINS (+480 / -160 each)
    const win = calculateHeixinSettlement({
      roundNumber: 1,
      dealer: 1,
      bidScore: 160,
      tableChallengerPoints: 40,
      bottomCards: emptyBottom,
      challengerWonLastTrick: true,
      previousPlayerScores: { 0: 0, 1: 0, 2: 0, 3: 0 },
      teams: {
        A: { team: 'A', levelIndex: 6, levelRank: '10', penaltyCount: 0 },
        B: { team: 'B', levelIndex: 6, levelRank: '10', penaltyCount: 0 },
      },
    });
    assert.equal(win.settlement.bankerWon, true);
    assert.equal(win.settlement.bankerNetScore, 160);
    assert.deepEqual(win.updatedPlayerScores, { 0: -160, 1: 480, 2: -160, 3: -160 });

    // Table challenger = 45 + 100 = 145 -> banker net = 155 < 160 -> Challengers WIN!
    const lose = calculateHeixinSettlement({
      roundNumber: 2,
      dealer: 1,
      bidScore: 160,
      tableChallengerPoints: 45,
      bottomCards: emptyBottom,
      challengerWonLastTrick: true,
      previousPlayerScores: win.updatedPlayerScores,
      teams: {
        A: { team: 'A', levelIndex: 6, levelRank: '10', penaltyCount: 0 },
        B: { team: 'B', levelIndex: 6, levelRank: '10', penaltyCount: 0 },
      },
    });
    assert.equal(lose.settlement.bankerWon, false);
    assert.deepEqual(lose.updatedPlayerScores, { 0: 0, 1: 0, 2: 0, 3: 0 });
  });

  it('completes 5 consecutive rounds of 4-bot heixin with zero-sum scores and full card/point conservation', () => {
    let state: GameState = createInitialMatchState({ seed: 555, mode: 'heixin' });

    for (let r = 0; r < 5; r++) {
      let steps = 0;
      while (state.phase !== 'ROUND_OVER' && steps < 400) {
        const handTotal =
          state.hands[0].length +
          state.hands[1].length +
          state.hands[2].length +
          state.hands[3].length;
        const playedTotal =
          state.completedTricks.reduce(
            (s, t) => s + t.plays.reduce((ps, p) => ps + p.cards.length, 0),
            0,
          ) + state.currentTrick.reduce((s, p) => s + p.cards.length, 0);
        assert.equal(handTotal + state.bottomCards.length + playedTotal, 162);

        const turn = state.currentTurn as Seat;
        const act = chooseBotAction(state, turn);
        const res = applyAction(state, act);
        assert.equal(res.ok, true, !res.ok ? res.error : '');
        if (!res.ok) break;
        state = res.state;
        steps += 1;
      }

      assert.equal(state.phase, 'ROUND_OVER');
      assert.equal(state.bottomCards.length, 10);

      const trickPoints = state.completedTricks.reduce((s, t) => s + t.points, 0);
      const bottomPoints = state.bottomCards.reduce((s, c) => s + getCardPoints(c), 0);
      assert.equal(trickPoints + bottomPoints, 300);

      const sumScores =
        state.playerScores[0] +
        state.playerScores[1] +
        state.playerScores[2] +
        state.playerScores[3];
      assert.equal(sumScores, 0);

      if (r < 4) {
        state = startNextRound(state, 555 + (r + 1) * 131);
      }
    }
  });
});
