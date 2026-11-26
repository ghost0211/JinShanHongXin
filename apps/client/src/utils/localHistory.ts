import type { LocalRoundRecordedEvent } from '@jinshan/game-core';
import type { GameMode, Seat } from '@jinshan/protocol';

export interface LocalRoundRow {
  roundNumber: number;
  dealerSeat: number;
  challengerTotal: number;
  bankerWon: boolean;
  myWon: boolean;
  myScoreDelta: number;
}

export interface LocalMatchHistoryRow {
  id: number;
  roomId: string;
  mode: GameMode;
  status: string;
  winnerSummary: string | null;
  createdAt: string;
  rounds: LocalRoundRow[];
}

export interface LocalStatsSummary {
  totalMatches: number;
  hongxinRounds: number;
  hongxinWins: number;
  heixinRounds: number;
  heixinWins: number;
  heixinTotalScore: number;
}

const LOCAL_HISTORY_KEY = 'jinshan_local_history_v1';
const MAX_LOCAL_MATCHES = 30;

function getSeatTeamSimple(seat: Seat): 'A' | 'B' {
  return seat % 2 === 0 ? 'A' : 'B';
}

export function loadLocalHistory(
  storage: Pick<Storage, 'getItem'> | undefined = typeof window !== 'undefined'
    ? window.localStorage
    : undefined,
): LocalMatchHistoryRow[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as LocalMatchHistoryRow[];
  } catch {
    return [];
  }
}

export function saveLocalHistory(
  rows: LocalMatchHistoryRow[],
  storage: Pick<Storage, 'setItem'> | undefined = typeof window !== 'undefined'
    ? window.localStorage
    : undefined,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      LOCAL_HISTORY_KEY,
      JSON.stringify(rows.slice(0, MAX_LOCAL_MATCHES)),
    );
  } catch {
    // ignore quota errors
  }
}

export function clearLocalHistory(
  storage: Pick<Storage, 'removeItem'> | undefined = typeof window !== 'undefined'
    ? window.localStorage
    : undefined,
): void {
  if (!storage) return;
  try {
    storage.removeItem(LOCAL_HISTORY_KEY);
  } catch {
    // ignore
  }
}

export function recordLocalRound(
  event: LocalRoundRecordedEvent,
  viewerSeat: Seat = 0,
  storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof window !==
  'undefined'
    ? window.localStorage
    : undefined,
): LocalMatchHistoryRow[] {
  const existing = loadLocalHistory(storage);
  const { settlement, roomId, mode, winnerSummary } = event;
  const myWon =
    settlement.mode === 'heixin'
      ? viewerSeat === settlement.dealer
        ? settlement.bankerWon
        : !settlement.bankerWon
      : getSeatTeamSimple(viewerSeat) === settlement.earningTeam;
  const myScoreDelta =
    settlement.mode === 'heixin'
      ? (settlement.scoreDeltas?.[viewerSeat] ?? 0)
      : 0;

  const roundRow: LocalRoundRow = {
    roundNumber: settlement.roundNumber,
    dealerSeat: settlement.dealer,
    challengerTotal: settlement.totalChallengerScore,
    bankerWon: settlement.bankerWon,
    myWon,
    myScoreDelta,
  };

  // Update most recent match with same roomId if still ongoing & roundNumber increases
  const idx = existing.findIndex(
    (m) =>
      m.roomId === roomId &&
      m.mode === mode &&
      m.status === 'IN_GAME' &&
      !m.rounds.some((r) => r.roundNumber === roundRow.roundNumber),
  );

  const nowIso = new Date().toISOString().replace('T', ' ');
  let next: LocalMatchHistoryRow[];

  if (idx >= 0) {
    const target = existing[idx];
    const updated: LocalMatchHistoryRow = {
      ...target,
      status: winnerSummary ? 'FINISHED' : 'IN_GAME',
      winnerSummary: winnerSummary ?? target.winnerSummary,
      rounds: [...target.rounds, roundRow],
    };
    next = [updated, ...existing.filter((_, i) => i !== idx)];
  } else {
    const nextId = existing.reduce((max, r) => Math.max(max, r.id), 0) + 1;
    const created: LocalMatchHistoryRow = {
      id: nextId,
      roomId,
      mode,
      status: winnerSummary ? 'FINISHED' : 'IN_GAME',
      winnerSummary: winnerSummary ?? null,
      createdAt: nowIso,
      rounds: [roundRow],
    };
    next = [created, ...existing].slice(0, MAX_LOCAL_MATCHES);
  }

  saveLocalHistory(next, storage);
  return next;
}

export function summarizeLocalStats(
  rows: LocalMatchHistoryRow[],
): LocalStatsSummary {
  let hongxinRounds = 0;
  let hongxinWins = 0;
  let heixinRounds = 0;
  let heixinWins = 0;
  let heixinTotalScore = 0;

  for (const match of rows) {
    for (const r of match.rounds) {
      if (match.mode === 'hongxin') {
        hongxinRounds += 1;
        if (r.myWon) hongxinWins += 1;
      } else {
        heixinRounds += 1;
        if (r.myWon) heixinWins += 1;
        heixinTotalScore += r.myScoreDelta ?? 0;
      }
    }
  }

  return {
    totalMatches: rows.length,
    hongxinRounds,
    hongxinWins,
    heixinRounds,
    heixinWins,
    heixinTotalScore,
  };
}
