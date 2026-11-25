/**
 * Search layer for the card-play bot (PIMC: Perfect-Information Monte Carlo).
 *
 * For each candidate play, sample several "worlds" (possible distributions of the unseen
 * cards that are consistent with everything public: hand sizes, known voids, own hand and,
 * for the dealer, the buried bottom). In every world, play the candidate and let all four
 * seats continue with the fast heuristic policy for a limited horizon (the rest of the
 * current trick early on, the whole remaining round in the endgame). The candidate with the
 * best average outcome for our side wins.
 *
 * The bot never peeks at real hidden hands: worlds are drawn only from public information.
 */
import type { Card, CardCategory, Seat } from '@jinshan/protocol';
import {
  createThreeDecks,
  getCardCategory,
  getCardKey,
  getCardPoints,
  getSeatTeam,
  STANDARD_SUITS,
} from './cards.js';
import { applyAction } from './engine.js';
import type { GameState } from './types.js';
import {
  buildPublicCardTracker,
  chooseHeuristicPlayCards,
  getCardValueCost,
  isSameSide,
  rankFollowCandidates,
  rankLeadCandidates,
} from './bot.js';

export interface SearchOptions {
  /** Max sampled worlds per decision. */
  worlds: number;
  /** Max candidate plays examined (heuristic best-first). */
  maxCandidates: number;
  /** Tricks simulated beyond the current one in the midgame (0 = finish current trick only). */
  extraTricks: number;
  /** When our hand has at most this many cards, roll out to the end of the round. */
  fullRolloutCards: number;
  /** Weight of remaining-hand strength (resource balance) at the horizon, in points per cost unit. */
  alpha: number;
  /** Bonus for our side holding the lead after the horizon. */
  leadBonus: number;
  /** Soft wall-clock budget per decision (ms). At least `minWorlds` worlds are always evaluated. */
  timeBudgetMs: number;
  minWorlds: number;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  worlds: 12,
  maxCandidates: 10,
  extraTricks: 0,
  fullRolloutCards: 8,
  alpha: 0.35,
  leadBonus: 4,
  timeBudgetMs: 200,
  minWorlds: 4,
};

let activeOptions: SearchOptions = { ...DEFAULT_SEARCH_OPTIONS };
let searchEnabled = true;

/** Tune or disable the search globally (used by benchmarks and tests). */
export function configureBotSearch(opts: Partial<SearchOptions> & { enabled?: boolean }): void {
  const { enabled, ...rest } = opts;
  if (enabled !== undefined) searchEnabled = enabled;
  activeOptions = { ...activeOptions, ...rest };
}

export function getBotSearchOptions(): SearchOptions & { enabled: boolean } {
  return { ...activeOptions, enabled: searchEnabled };
}

const SEATS: readonly Seat[] = [0, 1, 2, 3];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic per-decision seed so bot behaviour is reproducible. */
function decisionSeed(state: GameState, seat: Seat): number {
  let h = 2166136261 ^ (state.roundNumber * 131 + seat * 17 + state.completedTricks.length * 7);
  for (const c of state.hands[seat]) h = Math.imul(h ^ c.id, 16777619);
  for (const p of state.currentTrick) for (const c of p.cards) h = Math.imul(h ^ (c.id + 977), 16777619);
  return h >>> 0;
}

interface World {
  hands: Record<Seat, Card[]>;
  bottom: Card[];
}

/**
 * Draw one distribution of unseen cards consistent with public information.
 * Returns null if constraints could not be satisfied (caller retries / relaxes).
 */
function sampleWorld(
  state: GameState,
  seat: Seat,
  voids: (s: Seat, cat: CardCategory) => boolean,
  rng: () => number,
  respectVoids: boolean,
): World | null {
  const { trumpSuit, levelRank } = state;
  const iAmDealer = state.dealer === seat;
  const known = new Set<number>();
  for (const c of state.hands[seat]) known.add(c.id);
  for (const t of state.completedTricks) for (const p of t.plays) for (const c of p.cards) known.add(c.id);
  for (const p of state.currentTrick) for (const c of p.cards) known.add(c.id);
  if (iAmDealer) for (const c of state.bottomCards) known.add(c.id);

  // Slots: other seats (0..3 except me) + bottom pseudo-slot (index 4) when bottom is unknown
  const BOTTOM = 4;
  const cap = [0, 0, 0, 0, 0];
  for (const s of SEATS) if (s !== seat) cap[s] = state.hands[s].length;
  if (!iAmDealer) cap[BOTTOM] = state.bottomCards.length;
  const out: Card[][] = [[], [], [], [], []];

  // Cards shown publicly while calling / countering trump and not played yet are still in
  // that player's hand (the dealer may have buried them, so dealer displays are not pinned).
  for (const s of SEATS) {
    if (s === seat || s === state.dealer) continue;
    const shown = state.callState.seatCallDisplays?.[s]?.cards ?? [];
    for (const c of shown) {
      if (known.has(c.id) || cap[s] <= 0) continue;
      out[s].push(c);
      cap[s] -= 1;
      known.add(c.id);
    }
  }

  const pool = createThreeDecks().filter((c) => !known.has(c.id));
  const totalCap = cap.reduce((a, b) => a + b, 0);
  if (totalCap !== pool.length) return null;

  const eligible = (card: Card, slot: number): boolean => {
    if (cap[slot] <= 0) return false;
    if (slot === BOTTOM) return !(state.mode === 'heixin' && card.rank === '10');
    if (slot === seat) return false;
    if (!respectVoids) return true;
    return !voids(slot as Seat, getCardCategory(card, trumpSuit, levelRank));
  };

  // Shuffle, then place the most constrained cards first
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const slotsFor = (card: Card) => [0, 1, 2, 3, BOTTOM].filter((sl) => eligible(card, sl)).length;
  const order = pool
    .map((card) => ({ card, freedom: slotsFor(card) }))
    .sort((a, b) => a.freedom - b.freedom);

  // Bayesian public-info slot weight: dealers almost never bury trumps or Aces,
  // and the dealer / trump caller typically holds more trumps than non-callers.
  const slotWeight = (card: Card, sl: number): number => {
    const cat = getCardCategory(card, trumpSuit, levelRank);
    if (sl === BOTTOM) {
      if (cat === 'TRUMP') return 0.06;
      if (card.rank === 'A') return 0.2;
      if (getCardPoints(card) > 0) return 0.7;
      return 1.35;
    }
    if (cat === 'TRUMP') {
      if (sl === state.dealer || sl === state.callState.callerSeat) return 1.35;
      return 1.0;
    }
    return 1.0;
  };

  for (const { card } of order) {
    const options = [0, 1, 2, 3, BOTTOM].filter((sl) => eligible(card, sl));
    if (options.length === 0) return null;
    let total = 0;
    for (const sl of options) total += cap[sl] * slotWeight(card, sl);
    let r = rng() * total;
    let pick = options[options.length - 1];
    for (const sl of options) {
      r -= cap[sl] * slotWeight(card, sl);
      if (r < 0) {
        pick = sl;
        break;
      }
    }
    out[pick].push(card);
    cap[pick] -= 1;
  }

  const hands = {
    0: seat === 0 ? state.hands[0] : out[0],
    1: seat === 1 ? state.hands[1] : out[1],
    2: seat === 2 ? state.hands[2] : out[2],
    3: seat === 3 ? state.hands[3] : out[3],
  } as Record<Seat, Card[]>;
  return { hands, bottom: iAmDealer ? state.bottomCards : out[BOTTOM] };
}

function isChallengerSide(state: GameState, seat: Seat): boolean {
  return state.mode === 'heixin' ? seat !== state.dealer : getSeatTeam(seat) !== state.bankerTeam;
}

function handResourceStrength(
  hand: readonly Card[],
  trumpSuit: GameState['trumpSuit'],
  levelRank: GameState['levelRank'],
): number {
  let strength = 0;
  const keyCounts = new Map<string, number>();
  const keyHigh = new Map<string, boolean>();
  let trumpCount = 0;
  let suitMask = 0;

  for (const c of hand) {
    const cost = getCardValueCost(c, trumpSuit, levelRank);
    strength += cost;
    const cat = getCardCategory(c, trumpSuit, levelRank);
    if (cat === 'TRUMP') {
      trumpCount += 1;
    } else {
      const idx = STANDARD_SUITS.indexOf(cat);
      if (idx >= 0) suitMask |= 1 << idx;
    }
    const k = getCardKey(c);
    keyCounts.set(k, (keyCounts.get(k) ?? 0) + 1);
    if (cost >= 16) keyHigh.set(k, true);
  }

  for (const [k, cnt] of keyCounts) {
    const high = keyHigh.get(k) === true;
    if (cnt === 3) strength += high ? 24 : 16;
    else if (cnt === 2) strength += high ? 10 : 6;
  }

  if (trumpCount >= 2 && hand.length >= 4) {
    for (let i = 0; i < STANDARD_SUITS.length; i++) {
      const s = STANDARD_SUITS[i];
      if (s === trumpSuit) continue;
      if ((suitMask & (1 << i)) === 0) {
        strength += 4;
      }
    }
  }

  return strength;
}

function evaluateOutcome(
  start: GameState,
  end: GameState,
  seat: Seat,
  opts: SearchOptions,
): number {
  let dCh = end.challengerPoints - start.challengerPoints;
  const dBk = end.bankerPoints - start.bankerPoints;
  if (end.settlement) {
    dCh += end.settlement.totalChallengerScore - end.settlement.tableChallengerPoints;
  }
  let v = isChallengerSide(start, seat) ? dCh - dBk : dBk - dCh;

  if (end.phase === 'PLAYING') {
    const { trumpSuit, levelRank } = end;
    for (const s of SEATS) {
      const strength = handResourceStrength(end.hands[s], trumpSuit, levelRank);
      v += (isSameSide(start, seat, s) ? 1 : -1) * opts.alpha * strength;
    }
    if (end.currentTrick.length === 0 && end.currentTurn !== null) {
      v += (isSameSide(start, seat, end.currentTurn) ? 1 : -1) * opts.leadBonus;
    }
  }
  return v;
}

function simulate(
  world: GameState,
  seat: Seat,
  cardIds: number[],
  horizonTricks: number,
): GameState | null {
  let res = applyAction(world, { type: 'PLAY_CARDS', seat, cardIds });
  if (!res.ok) return null;
  let s = res.state;
  const target = world.completedTricks.length + horizonTricks;
  let guard = 0;
  while (s.phase === 'PLAYING' && s.completedTricks.length < target && guard++ < 400) {
    const turn = s.currentTurn;
    if (turn === null) break;
    res = applyAction(s, { type: 'PLAY_CARDS', seat: turn, cardIds: chooseHeuristicPlayCards(s, turn) });
    if (!res.ok) return null;
    s = res.state;
  }
  return s;
}

/**
 * Choose the card ids to play for `seat` (lead or follow) using sampled lookahead.
 * Falls back to the pure heuristic when there is nothing to decide.
 */
export function searchPlayCards(
  state: GameState,
  seat: Seat,
  overrides?: Partial<SearchOptions>,
): number[] {
  if (!searchEnabled && !overrides) return chooseHeuristicPlayCards(state, seat);
  const opts = overrides ? { ...activeOptions, ...overrides } : activeOptions;

  const isLead = state.currentTrick.length === 0;
  const ranked = isLead ? rankLeadCandidates(state, seat) : rankFollowCandidates(state, seat);
  const candidates = ranked.slice(0, Math.max(1, opts.maxCandidates));
  if (candidates.length <= 1) return candidates[0].map((c) => c.id);

  const handSize = state.hands[seat].length;
  const fullRollout = handSize <= opts.fullRolloutCards;
  const horizon = fullRollout ? 1000 : 1 + opts.extraTricks;

  // If nobody acts after us in this trick and we only look at this trick, one world suffices.
  const seatsAfterMe = 3 - state.currentTrick.length;
  const deterministic = seatsAfterMe === 0 && horizon === 1;
  const maxWorlds = deterministic ? 1 : opts.worlds;

  const tracker = buildPublicCardTracker(state, seat);
  const rng = mulberry32(decisionSeed(state, seat));
  const base: GameState = { ...state, events: [] };
  const totals = new Array<number>(candidates.length).fill(0);
  const ids = candidates.map((cards) => cards.map((c) => c.id));
  const t0 = Date.now();
  let worldsDone = 0;

  for (let w = 0; w < maxWorlds; w++) {
    if (worldsDone >= opts.minWorlds && Date.now() - t0 > opts.timeBudgetMs) break;
    let world: World | null = null;
    for (let attempt = 0; attempt < 12 && !world; attempt++) {
      world = sampleWorld(state, seat, tracker.isSeatVoid, rng, attempt < 8);
    }
    if (!world) break;
    const worldState: GameState = { ...base, hands: world.hands, bottomCards: world.bottom };

    const values: number[] = [];
    let failed = false;
    for (let i = 0; i < candidates.length; i++) {
      const end = simulate(worldState, seat, ids[i], horizon);
      if (!end) {
        failed = true;
        break;
      }
      values.push(evaluateOutcome(worldState, end, seat, opts));
    }
    if (failed) continue;
    for (let i = 0; i < values.length; i++) totals[i] += values[i];
    worldsDone += 1;
  }

  if (worldsDone === 0) return ids[0];
  let best = 0;
  for (let i = 1; i < candidates.length; i++) {
    // tiny tie-break toward the heuristic's preference order
    if (totals[i] - i * 1e-6 > totals[best] - best * 1e-6) best = i;
  }
  return ids[best];
}

