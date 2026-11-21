// Domain-A audit: 计分 / 抠底 / 升级 / 惩罚抵消 / 打 A / 轮庄 —— boundary tests.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction,
  calculateRoundSettlement,
  createInitialMatchState,
  LEVEL_SEQUENCE,
  startNextRound,
} from '../index.js';
import type { ActionResult, Card, GameState, Seat, TeamId } from '../index.js';

let nextId = 50000;
function c(suit: Card['suit'], rank: Card['rank']): Card {
  return { id: nextId++, deck: 0, suit, rank };
}
function ok(r: ActionResult): GameState {
  if (!r.ok) assert.fail(`expected ok, got ${r.code}: ${r.error}`);
  return r.state;
}
function teams(aLvl: number, aPen: number, bLvl: number, bPen: number) {
  return {
    A: { team: 'A' as TeamId, levelIndex: aLvl, levelRank: LEVEL_SEQUENCE[aLvl], penaltyCount: aPen },
    B: { team: 'B' as TeamId, levelIndex: bLvl, levelRank: LEVEL_SEQUENCE[bLvl], penaltyCount: bPen },
  };
}
function settle(dealer: Seat, S: number, t = teams(0, 0, 0, 0)) {
  return calculateRoundSettlement({
    roundNumber: 3,
    dealer,
    teams: t,
    tableChallengerPoints: S,
    bottomCards: [],
    challengerWonLastTrick: false,
  });
}

describe('audit A4: 120 及格 / 庄 40 跳级线 / 闲 60 分档', () => {
  const table: Array<[number, boolean, number]> = [
    [0, true, 3],
    [5, true, 2],
    [35, true, 2],
    [40, true, 1],
    [115, true, 1],
    [120, false, 0],
    [175, false, 0],
    [180, false, 1],
    [235, false, 1],
    [240, false, 2],
    [295, false, 2],
    [300, false, 3],
    [360, false, 4],
  ];
  for (const [S, bankerWon, steps] of table) {
    it(`S=${S} → bankerWon=${bankerWon}, earnedSteps=${steps}`, () => {
      const { settlement, updatedTeams } = settle(1, S, teams(2, 0, 3, 0));
      assert.equal(settlement.bankerWon, bankerWon);
      assert.equal(settlement.earnedSteps, steps);
      assert.equal(settlement.earningTeam, bankerWon ? 'B' : 'A');
      // rotation: banker wins → partner; challengers win → banker's next seat
      assert.equal(settlement.nextDealer, bankerWon ? 3 : 2);
      const winner = bankerWon ? 'B' : 'A';
      const loser = bankerWon ? 'A' : 'B';
      const before = bankerWon ? 3 : 2;
      assert.equal(updatedTeams[winner].levelIndex, Math.min(10, before + steps));
      assert.equal(updatedTeams[loser].levelIndex, bankerWon ? 2 : 3, 'loser level never drops');
    });
  }
});

describe('audit A4b: 抠底只算 5/10/K、固定 ×2', () => {
  it('bottom with ♥5, ♠5, 10, K, 3, A, jokers → raw 30, ×2 only when challengers win last trick', () => {
    const bottom = [c('H', '5'), c('S', '5'), c('D', '10'), c('C', 'K'), c('S', '3'), c('S', 'A'), c('J', 'BJ'), c('J', 'SJ'), c('D', '2'), c('H', 'Q')];
    const killed = calculateRoundSettlement({ roundNumber: 1, dealer: 0, teams: teams(0, 0, 0, 0), tableChallengerPoints: 100, bottomCards: bottom, challengerWonLastTrick: true });
    assert.equal(killed.settlement.bottomPointsRaw, 30);
    assert.equal(killed.settlement.bottomBonusPoints, 60);
    assert.equal(killed.settlement.totalChallengerScore, 160);
    assert.equal(killed.settlement.bankerWon, false);
    const kept = calculateRoundSettlement({ roundNumber: 1, dealer: 0, teams: teams(0, 0, 0, 0), tableChallengerPoints: 100, bottomCards: bottom, challengerWonLastTrick: false });
    assert.equal(kept.settlement.bottomBonusPoints, 0);
    assert.equal(kept.settlement.totalChallengerScore, 100);
    assert.equal(kept.settlement.bankerWon, true);
  });
});

describe('audit A5: 反主惩罚抵消', () => {
  it('banker +1 with 1 penalty → stays (留级), penalty cleared', () => {
    const { settlement, updatedTeams } = settle(0, 60, teams(4, 1, 2, 0));
    assert.equal(settlement.penaltyAbsorbed, 1);
    assert.equal(settlement.actualLevelUp, 0);
    assert.equal(updatedTeams.A.levelIndex, 4);
    assert.equal(updatedTeams.A.penaltyCount, 0);
    assert.equal(settlement.nextDealer, 2);
  });
  it('challengers 180 (+1) with 1 penalty → take over without level-up', () => {
    const { settlement, updatedTeams } = settle(0, 180, teams(4, 0, 2, 1));
    assert.equal(settlement.actualLevelUp, 0);
    assert.equal(updatedTeams.B.levelIndex, 2);
    assert.equal(updatedTeams.B.penaltyCount, 0);
    assert.equal(settlement.nextDealer, 1);
  });
  it('banker <40 (+2) with 1 penalty → +1', () => {
    const { settlement, updatedTeams } = settle(0, 35, teams(4, 1, 2, 0));
    assert.equal(settlement.actualLevelUp, 1);
    assert.equal(updatedTeams.A.levelIndex, 5);
    assert.equal(updatedTeams.A.penaltyCount, 0);
  });
  it('challengers 120~175 (+0) never absorb penalty', () => {
    const { settlement, updatedTeams } = settle(0, 150, teams(4, 0, 2, 2));
    assert.equal(settlement.penaltyAbsorbed, 0);
    assert.equal(updatedTeams.B.penaltyCount, 2);
  });
  it('penalty of the LOSING team is untouched; 2 penalties vs +1 leaves 1', () => {
    const { settlement, updatedTeams } = settle(0, 60, teams(4, 2, 2, 1));
    assert.equal(settlement.actualLevelUp, 0);
    assert.equal(updatedTeams.A.penaltyCount, 1);
    assert.equal(updatedTeams.B.penaltyCount, 1);
  });
  it('banker 0 points (+3) with 2 penalties → +1', () => {
    const { settlement, updatedTeams } = settle(0, 0, teams(1, 2, 2, 0));
    assert.equal(settlement.actualLevelUp, 1);
    assert.equal(updatedTeams.A.levelIndex, 2);
  });
});

describe('audit A5b: 打 A', () => {
  it('banker at A keeping challengers <120 wins the match', () => {
    const { settlement } = settle(1, 115, teams(3, 0, 10, 0));
    assert.equal(settlement.matchWinner, 'B');
  });
  it('banker at A with 1 penalty and +1 → absorbs, no win, partner continues A', () => {
    const { settlement, updatedTeams } = settle(1, 115, teams(3, 0, 10, 1));
    assert.equal(settlement.matchWinner, null);
    assert.equal(updatedTeams.B.levelIndex, 10);
    assert.equal(updatedTeams.B.penaltyCount, 0);
    assert.equal(settlement.nextDealer, 3);
  });
  it('banker at A with 1 penalty and +2 → still wins', () => {
    const { settlement } = settle(1, 35, teams(3, 0, 10, 1));
    assert.equal(settlement.matchWinner, 'B');
  });
  it('challengers jumping past A are capped at A and do not win', () => {
    const { settlement, updatedTeams } = settle(1, 300, teams(9, 0, 10, 0));
    assert.equal(settlement.matchWinner, null);
    assert.equal(updatedTeams.A.levelIndex, 10);
  });
  it('banker at K with +3 caps at A without winning', () => {
    const { settlement, updatedTeams } = settle(0, 0, teams(9, 0, 0, 0));
    assert.equal(settlement.matchWinner, null);
    assert.equal(updatedTeams.A.levelIndex, 10);
  });
});

describe('audit A6: 级牌序列与轮庄', () => {
  it('level sequence is 2,4,6,7,8,9,10,J,Q,K,A', () => {
    assert.deepEqual([...LEVEL_SEQUENCE], ['2', '4', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A']);
  });
  it('startNextRound uses nextDealer and banker team level as levelRank', () => {
    const base = createInitialMatchState(3);
    const { settlement, updatedTeams } = settle(0, 180, teams(4, 0, 2, 0));
    const next = startNextRound({ ...base, teams: updatedTeams, settlement });
    assert.equal(next.dealer, 1);
    assert.equal(next.bankerTeam, 'B');
    assert.equal(next.levelRank, '7');
    assert.equal(next.isFirstRound, false);
    assert.equal(next.phase, 'CALLING');
    assert.equal(next.currentTurn, 1);
  });
});

/** Engine-level last-trick integration: 1 card per hand. */
function lastTrickState(mode: 'hongxin' | 'heixin', winnerCard: Seat): GameState {
  const base = createInitialMatchState({ seed: 1, mode });
  const hands: Record<Seat, Card[]> = {
    0: [c('C', '4')],
    1: [c('C', winnerCard === 1 ? 'A' : '6')],
    2: [c('C', winnerCard === 2 ? 'A' : '7')],
    3: [c('C', '8')],
  };
  return {
    ...base,
    roundNumber: 2,
    isFirstRound: false,
    phase: 'PLAYING',
    dealer: 0,
    bankerTeam: 'A',
    trumpSuit: 'S',
    levelRank: mode === 'heixin' ? '10' : '2',
    levelIndex: mode === 'heixin' ? 6 : 0,
    bidState: mode === 'heixin' ? { ...base.bidState!, highestBid: 150, highestBidder: 0 } : null,
    currentTurn: 0,
    currentTrickLeadSeat: 0,
    hands,
    bottomCards: [c('D', 'K'), c('D', '10'), c('D', '5'), c('D', '9')], // raw 25
    challengerPoints: 100,
  };
}
function playOut(s: GameState): GameState {
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    s = ok(applyAction(s, { type: 'PLAY_CARDS', seat, cardIds: [s.hands[seat][0].id] }));
  }
  return s;
}

describe('audit A4c: engine last-trick 抠底 integration', () => {
  it('hongxin: challenger (seat 1) wins last trick → bottom 25×2 added', () => {
    const s = playOut(lastTrickState('hongxin', 1));
    assert.equal(s.phase, 'ROUND_OVER');
    assert.equal(s.settlement?.bottomKilled, true);
    assert.equal(s.settlement?.totalChallengerScore, 150);
    assert.equal(s.settlement?.nextDealer, 1);
  });
  it('hongxin: banker partner (seat 2) wins last trick → no bottom bonus', () => {
    const s = playOut(lastTrickState('hongxin', 2));
    assert.equal(s.settlement?.bottomKilled, false);
    assert.equal(s.settlement?.totalChallengerScore, 100);
    assert.equal(s.settlement?.bankerWon, true);
    assert.equal(s.settlement?.nextDealer, 2);
  });
  it('heixin (1v3): seat 2 is a challenger, so winning last trick kills bottom', () => {
    const s = playOut(lastTrickState('heixin', 2));
    assert.equal(s.settlement?.bottomKilled, true);
    assert.equal(s.settlement?.totalChallengerScore, 150);
    assert.equal(s.settlement?.bankerNetScore, 150);
    assert.equal(s.settlement?.bankerWon, true); // 150 >= bid 150
  });
});
