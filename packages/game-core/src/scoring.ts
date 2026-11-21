import type {
  Card,
  RoundSettlement,
  Seat,
  TeamId,
  TeamScoreState,
} from '@jinshan/protocol';
import { getCardPoints, getOtherTeam, getSeatTeam, LEVEL_SEQUENCE } from './cards.js';

export interface SettlementInput {
  roundNumber: number;
  dealer: Seat;
  teams: Record<TeamId, TeamScoreState>;
  tableChallengerPoints: number;
  bottomCards: readonly Card[];
  challengerWonLastTrick: boolean;
}

export interface SettlementOutput {
  settlement: RoundSettlement;
  updatedTeams: Record<TeamId, TeamScoreState>;
}

export function calculateRoundSettlement(input: SettlementInput): SettlementOutput {
  const bankerTeam = getSeatTeam(input.dealer);
  const challengerTeam = getOtherTeam(bankerTeam);

  const bottomPointsRaw = input.bottomCards.reduce(
    (sum, card) => sum + getCardPoints(card),
    0,
  );
  const bottomKilled = input.challengerWonLastTrick;
  const bottomBonusPoints = bottomKilled ? bottomPointsRaw * 2 : 0;
  const totalChallengerScore = input.tableChallengerPoints + bottomBonusPoints;

  const bankerWon = totalChallengerScore < 120;
  const earningTeam = bankerWon ? bankerTeam : challengerTeam;

  let earnedSteps: number;
  let nextDealer: Seat;
  if (bankerWon) {
    if (totalChallengerScore === 0) {
      earnedSteps = 3;
    } else if (totalChallengerScore < 40) {
      earnedSteps = 2;
    } else {
      earnedSteps = 1;
    }
    nextDealer = ((input.dealer + 2) % 4) as Seat;
  } else {
    earnedSteps = Math.floor((totalChallengerScore - 120) / 60);
    nextDealer = ((input.dealer + 1) % 4) as Seat;
  }

  const previousLevels: Record<TeamId, number> = {
    A: input.teams.A.levelIndex,
    B: input.teams.B.levelIndex,
  };
  const previousPenalties: Record<TeamId, number> = {
    A: input.teams.A.penaltyCount,
    B: input.teams.B.penaltyCount,
  };

  const earningPrevPenalty = input.teams[earningTeam].penaltyCount;
  const penaltyAbsorbed = Math.min(earnedSteps, earningPrevPenalty);
  const actualLevelUp = earnedSteps - penaltyAbsorbed;

  const updatedTeams: Record<TeamId, TeamScoreState> = {
    A: { ...input.teams.A },
    B: { ...input.teams.B },
  };

  updatedTeams[earningTeam].penaltyCount = earningPrevPenalty - penaltyAbsorbed;

  let matchWinner: TeamId | null = null;
  if (
    bankerWon &&
    previousLevels[bankerTeam] === LEVEL_SEQUENCE.length - 1 &&
    actualLevelUp >= 1
  ) {
    matchWinner = bankerTeam;
  } else if (actualLevelUp > 0) {
    const nextIdx = Math.min(
      LEVEL_SEQUENCE.length - 1,
      previousLevels[earningTeam] + actualLevelUp,
    );
    updatedTeams[earningTeam].levelIndex = nextIdx;
    updatedTeams[earningTeam].levelRank = LEVEL_SEQUENCE[nextIdx];
  }

  const newLevels: Record<TeamId, number> = {
    A: updatedTeams.A.levelIndex,
    B: updatedTeams.B.levelIndex,
  };
  const newPenalties: Record<TeamId, number> = {
    A: updatedTeams.A.penaltyCount,
    B: updatedTeams.B.penaltyCount,
  };

  return {
    settlement: {
      mode: 'hongxin',
      roundNumber: input.roundNumber,
      dealer: input.dealer,
      bankerTeam,
      challengerTeam,
      tableChallengerPoints: input.tableChallengerPoints,
      bottomPointsRaw,
      bottomKilled,
      bottomBonusPoints,
      totalChallengerScore,
      bankerWon,
      earningTeam,
      earnedSteps,
      penaltyAbsorbed,
      actualLevelUp,
      previousLevels,
      newLevels,
      previousPenalties,
      newPenalties,
      nextDealer,
      matchWinner,
      revealedBottom: [...input.bottomCards],
    },
    updatedTeams,
  };
}

export interface HeixinSettlementInput {
  roundNumber: number;
  dealer: Seat;
  bidScore: number;
  tableChallengerPoints: number;
  bottomCards: readonly Card[];
  challengerWonLastTrick: boolean;
  previousPlayerScores: Record<Seat, number>;
  teams: Record<TeamId, TeamScoreState>;
}

export interface HeixinSettlementOutput {
  settlement: RoundSettlement;
  updatedPlayerScores: Record<Seat, number>;
}

export function calculateHeixinSettlement(
  input: HeixinSettlementInput,
): HeixinSettlementOutput {
  const bankerTeam = getSeatTeam(input.dealer);
  const challengerTeam = getOtherTeam(bankerTeam);

  const bottomPointsRaw = input.bottomCards.reduce(
    (sum, card) => sum + getCardPoints(card),
    0,
  );
  const bottomKilled = input.challengerWonLastTrick;
  const bottomBonusPoints = bottomKilled ? bottomPointsRaw * 2 : 0;
  const totalChallengerScore = input.tableChallengerPoints + bottomBonusPoints;
  const bankerNetScore = 300 - totalChallengerScore;
  const bankerWon = bankerNetScore >= input.bidScore;

  const scoreDeltas: Record<Seat, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const seat of [0, 1, 2, 3] as Seat[]) {
    if (seat === input.dealer) {
      scoreDeltas[seat] = bankerWon ? input.bidScore * 3 : -input.bidScore * 3;
    } else {
      scoreDeltas[seat] = bankerWon ? -input.bidScore : input.bidScore;
    }
  }

  const updatedPlayerScores: Record<Seat, number> = {
    0: input.previousPlayerScores[0] + scoreDeltas[0],
    1: input.previousPlayerScores[1] + scoreDeltas[1],
    2: input.previousPlayerScores[2] + scoreDeltas[2],
    3: input.previousPlayerScores[3] + scoreDeltas[3],
  };

  const levels: Record<TeamId, number> = {
    A: input.teams.A.levelIndex,
    B: input.teams.B.levelIndex,
  };
  const penalties: Record<TeamId, number> = {
    A: input.teams.A.penaltyCount,
    B: input.teams.B.penaltyCount,
  };

  return {
    settlement: {
      mode: 'heixin',
      roundNumber: input.roundNumber,
      dealer: input.dealer,
      bankerTeam,
      challengerTeam,
      tableChallengerPoints: input.tableChallengerPoints,
      bottomPointsRaw,
      bottomKilled,
      bottomBonusPoints,
      totalChallengerScore,
      bankerWon,
      earningTeam: bankerWon ? bankerTeam : challengerTeam,
      earnedSteps: 0,
      penaltyAbsorbed: 0,
      actualLevelUp: 0,
      previousLevels: levels,
      newLevels: levels,
      previousPenalties: penalties,
      newPenalties: penalties,
      nextDealer: ((input.dealer + 1) % 4) as Seat,
      matchWinner: null,
      revealedBottom: [...input.bottomCards],
      bidScore: input.bidScore,
      bankerNetScore,
      scoreDeltas,
      playerScores: { ...updatedPlayerScores },
    },
    updatedPlayerScores,
  };
}
