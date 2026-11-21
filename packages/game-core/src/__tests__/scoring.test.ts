import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calculateRoundSettlement, LEVEL_SEQUENCE } from '../index.js';
import type { Card, TeamScoreState } from '../index.js';

function makeTeams(
  aLevel = 0,
  bLevel = 0,
  aPenalty = 0,
  bPenalty = 0,
): Record<'A' | 'B', TeamScoreState> {
  return {
    A: { team: 'A', levelIndex: aLevel, levelRank: LEVEL_SEQUENCE[aLevel], penaltyCount: aPenalty },
    B: { team: 'B', levelIndex: bLevel, levelRank: LEVEL_SEQUENCE[bLevel], penaltyCount: bPenalty },
  };
}

function bottomWithPoints(): Card[] {
  // 5(5) + 10(10) + K(10) = 25 points, rest 0 points
  return [
    { id: 1, deck: 0, suit: 'S', rank: '5' },
    { id: 2, deck: 0, suit: 'H', rank: '10' },
    { id: 3, deck: 0, suit: 'C', rank: 'K' },
    { id: 4, deck: 0, suit: 'D', rank: 'A' },
    { id: 5, deck: 0, suit: 'J', rank: 'BJ' },
    { id: 6, deck: 0, suit: 'D', rank: '3' },
    { id: 7, deck: 0, suit: 'S', rank: '2' },
    { id: 8, deck: 0, suit: 'S', rank: '4' },
    { id: 9, deck: 0, suit: 'C', rank: '6' },
    { id: 10, deck: 0, suit: 'D', rank: '7' },
  ];
}

describe('scoring, bottom kill x2, 40/60 thresholds, and penalty offset', () => {
  it('handles banker 40-point jump thresholds (0 -> +3, 5..35 -> +2, 40..115 -> +1) and teammate dealer rotation', () => {
    const emptyBottom = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      deck: 0 as const,
      suit: 'S' as const,
      rank: '4' as const,
    }));

    const zero = calculateRoundSettlement({
      roundNumber: 1,
      dealer: 0,
      teams: makeTeams(),
      tableChallengerPoints: 0,
      bottomCards: emptyBottom,
      challengerWonLastTrick: false,
    });
    assert.equal(zero.settlement.bankerWon, true);
    assert.equal(zero.settlement.earnedSteps, 3);
    assert.equal(zero.settlement.nextDealer, 2);
    assert.equal(zero.updatedTeams.A.levelRank, '7'); // 2->4->6->7

    const thirtyFive = calculateRoundSettlement({
      roundNumber: 1,
      dealer: 0,
      teams: makeTeams(),
      tableChallengerPoints: 35,
      bottomCards: emptyBottom,
      challengerWonLastTrick: false,
    });
    assert.equal(thirtyFive.settlement.earnedSteps, 2);
    assert.equal(thirtyFive.updatedTeams.A.levelRank, '6');

    const forty = calculateRoundSettlement({
      roundNumber: 1,
      dealer: 0,
      teams: makeTeams(),
      tableChallengerPoints: 40,
      bottomCards: emptyBottom,
      challengerWonLastTrick: false,
    });
    assert.equal(forty.settlement.earnedSteps, 1);
    assert.equal(forty.updatedTeams.A.levelRank, '4');

    const hundredFifteen = calculateRoundSettlement({
      roundNumber: 1,
      dealer: 0,
      teams: makeTeams(),
      tableChallengerPoints: 115,
      bottomCards: emptyBottom,
      challengerWonLastTrick: false,
    });
    assert.equal(hundredFifteen.settlement.earnedSteps, 1);
  });

  it('handles challenger 60-point brackets (120 -> swap 0, 180 -> +1, 240 -> +2) and bottom kill x2', () => {
    // Table points 70 + bottom raw 25 * 2 = 120 -> challenger wins table with 0 level-up
    const killed120 = calculateRoundSettlement({
      roundNumber: 2,
      dealer: 0,
      teams: makeTeams(),
      tableChallengerPoints: 70,
      bottomCards: bottomWithPoints(),
      challengerWonLastTrick: true,
    });
    assert.equal(killed120.settlement.bottomPointsRaw, 25);
    assert.equal(killed120.settlement.bottomBonusPoints, 50);
    assert.equal(killed120.settlement.totalChallengerScore, 120);
    assert.equal(killed120.settlement.bankerWon, false);
    assert.equal(killed120.settlement.earnedSteps, 0);
    assert.equal(killed120.settlement.nextDealer, 1);

    // Banker winning last trick means bottom points do NOT count for challenger
    const defended = calculateRoundSettlement({
      roundNumber: 2,
      dealer: 0,
      teams: makeTeams(),
      tableChallengerPoints: 70,
      bottomCards: bottomWithPoints(),
      challengerWonLastTrick: false,
    });
    assert.equal(defended.settlement.bottomBonusPoints, 0);
    assert.equal(defended.settlement.totalChallengerScore, 70);
    assert.equal(defended.settlement.bankerWon, true);
    assert.equal(defended.settlement.earnedSteps, 1);

    // 180 -> +1, 240 -> +2
    const s180 = calculateRoundSettlement({
      roundNumber: 2,
      dealer: 0,
      teams: makeTeams(),
      tableChallengerPoints: 180,
      bottomCards: bottomWithPoints(),
      challengerWonLastTrick: false,
    });
    assert.equal(s180.settlement.earnedSteps, 1);
    assert.equal(s180.updatedTeams.B.levelRank, '4');

    const s240 = calculateRoundSettlement({
      roundNumber: 2,
      dealer: 0,
      teams: makeTeams(),
      tableChallengerPoints: 240,
      bottomCards: bottomWithPoints(),
      challengerWonLastTrick: false,
    });
    assert.equal(s240.settlement.earnedSteps, 2);
    assert.equal(s240.updatedTeams.B.levelRank, '6');
  });

  it('offsets counter-bid penalties in all three confirmed scenarios and handles A-level match victory', () => {
    const emptyBottom = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      deck: 0 as const,
      suit: 'S' as const,
      rank: '4' as const,
    }));

    // Case 1: Banker with 1 penalty wins +1 (40..115) -> stays on same level, penalty cleared to 0
    const case1 = calculateRoundSettlement({
      roundNumber: 3,
      dealer: 0,
      teams: makeTeams(2, 0, 1, 0),
      tableChallengerPoints: 80,
      bottomCards: emptyBottom,
      challengerWonLastTrick: false,
    });
    assert.equal(case1.settlement.earnedSteps, 1);
    assert.equal(case1.settlement.penaltyAbsorbed, 1);
    assert.equal(case1.settlement.actualLevelUp, 0);
    assert.equal(case1.updatedTeams.A.levelIndex, 2);
    assert.equal(case1.updatedTeams.A.penaltyCount, 0);

    // Case 2: Challenger with 1 penalty gets 180 (+1) -> takes dealer, penalty becomes 0, level stays same
    const case2 = calculateRoundSettlement({
      roundNumber: 3,
      dealer: 0,
      teams: makeTeams(2, 1, 0, 1),
      tableChallengerPoints: 180,
      bottomCards: emptyBottom,
      challengerWonLastTrick: false,
    });
    assert.equal(case2.settlement.bankerWon, false);
    assert.equal(case2.settlement.earnedSteps, 1);
    assert.equal(case2.settlement.penaltyAbsorbed, 1);
    assert.equal(case2.settlement.actualLevelUp, 0);
    assert.equal(case2.updatedTeams.B.levelIndex, 1);
    assert.equal(case2.updatedTeams.B.penaltyCount, 0);
    assert.equal(case2.settlement.nextDealer, 1);

    // Case 3: Banker with 1 penalty keeps challenger < 40 (+2) -> offsets 1, levels up +1
    const case3 = calculateRoundSettlement({
      roundNumber: 3,
      dealer: 0,
      teams: makeTeams(2, 0, 1, 0),
      tableChallengerPoints: 30,
      bottomCards: emptyBottom,
      challengerWonLastTrick: false,
    });
    assert.equal(case3.settlement.earnedSteps, 2);
    assert.equal(case3.settlement.penaltyAbsorbed, 1);
    assert.equal(case3.settlement.actualLevelUp, 1);
    assert.equal(case3.updatedTeams.A.levelIndex, 3);
    assert.equal(case3.updatedTeams.A.penaltyCount, 0);

    // Case 4: Double penalty (2) requires 2 steps to clear; +1 reduces penalty from 2 to 1
    const dbl = calculateRoundSettlement({
      roundNumber: 3,
      dealer: 0,
      teams: makeTeams(2, 0, 2, 0),
      tableChallengerPoints: 60,
      bottomCards: emptyBottom,
      challengerWonLastTrick: false,
    });
    assert.equal(dbl.updatedTeams.A.penaltyCount, 1);
    assert.equal(dbl.settlement.actualLevelUp, 0);

    // Playing A (index 10): with 1 penalty and 80 pts (+1), penalty is absorbed -> NOT match victory yet!
    const aWithPenalty = calculateRoundSettlement({
      roundNumber: 10,
      dealer: 0,
      teams: makeTeams(10, 5, 1, 0),
      tableChallengerPoints: 80,
      bottomCards: emptyBottom,
      challengerWonLastTrick: false,
    });
    assert.equal(aWithPenalty.settlement.matchWinner, null);
    assert.equal(aWithPenalty.updatedTeams.A.penaltyCount, 0);
    assert.equal(aWithPenalty.settlement.nextDealer, 2);

    // Playing A with 0 penalty and <120 pts -> MATCH WINNER!
    const aVictory = calculateRoundSettlement({
      roundNumber: 11,
      dealer: 2,
      teams: makeTeams(10, 5, 0, 0),
      tableChallengerPoints: 80,
      bottomCards: emptyBottom,
      challengerWonLastTrick: false,
    });
    assert.equal(aVictory.settlement.matchWinner, 'A');

    // Challenger scoring 240 while at K (index 9) caps at A (index 10), does not win match without sitting as banker
    const capAtA = calculateRoundSettlement({
      roundNumber: 11,
      dealer: 0,
      teams: makeTeams(8, 9, 0, 0),
      tableChallengerPoints: 240,
      bottomCards: emptyBottom,
      challengerWonLastTrick: false,
    });
    assert.equal(capAtA.updatedTeams.B.levelIndex, 10);
    assert.equal(capAtA.settlement.matchWinner, null);
  });
});
