import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction,
  chooseBotAction,
  chooseHeuristicPlayCards,
  configureBotSearch,
  createInitialMatchState,
  getCardPoints,
  searchPlayCards,
} from '../index.js';
import type { GameState } from '../index.js';

function advanceToPlaying(seed: number): GameState {
  let s = createInitialMatchState({ seed, mode: 'hongxin' });
  while (s.phase !== 'PLAYING') {
    const seat = s.currentTurn;
    const a = seat == null ? ({ type: 'DEAL_STEP' } as const) : chooseBotAction(s, seat);
    const r = applyAction(s, a);
    assert.ok(r.ok);
    s = r.state;
  }
  return s;
}

describe('bot search (sampled lookahead)', () => {
  it('plays full rounds legally with search enabled and conserves points', () => {
    configureBotSearch({ enabled: true, timeBudgetMs: 1e9 });
    for (const seed of [11, 22]) {
      let s = advanceToPlaying(seed);
      while (s.phase === 'PLAYING') {
        const seat = s.currentTurn!;
        const r = applyAction(s, chooseBotAction(s, seat));
        assert.ok(r.ok, !r.ok ? r.error : '');
        s = r.state;
      }
      const table = s.completedTricks.reduce((a, t) => a + t.points, 0);
      const bottom = s.bottomCards.reduce((a, c) => a + getCardPoints(c), 0);
      assert.equal(table + bottom, 300);
    }
  });

  it('is deterministic for the same state and never peeks at hidden hands', () => {
    configureBotSearch({ enabled: true, timeBudgetMs: 1e9 });
    const s = advanceToPlaying(33);
    const seat = s.currentTurn!;
    const a = searchPlayCards(s, seat);
    const b = searchPlayCards(s, seat);
    assert.deepEqual(a, b);

    // Shuffle the hidden cards between the other seats (same sizes): decision must not change.
    const others = ([0, 1, 2, 3] as const).filter((x) => x !== seat);
    const pool = others.flatMap((o) => s.hands[o]).reverse();
    const hands = { ...s.hands };
    let k = 0;
    for (const o of others) {
      const n = s.hands[o].length;
      hands[o] = pool.slice(k, k + n);
      k += n;
    }
    const c = searchPlayCards({ ...s, hands }, seat);
    assert.deepEqual(c, a);
  });

  it('falls back to the heuristic when disabled', () => {
    const s = advanceToPlaying(44);
    const seat = s.currentTurn!;
    configureBotSearch({ enabled: false });
    assert.deepEqual(chooseBotAction(s, seat), {
      type: 'PLAY_CARDS',
      seat,
      cardIds: chooseHeuristicPlayCards(s, seat),
    });
    configureBotSearch({ enabled: true });
  });
});
