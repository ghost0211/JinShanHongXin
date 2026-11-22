import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyAction,
  chooseBotAction,
  configureBotSearch,
  createInitialMatchState,
  getCardPoints,
  startNextRound,
} from '../index.js';
import type { GameState, Seat } from '../index.js';

// This suite checks rule invariants over many full matches; the fast heuristic policy is
// enough (the sampled-lookahead search is covered by bot-search.test.ts).
configureBotSearch({ enabled: false });

describe('full-match 4-bot simulation (2 -> A)', () => {
  it('completes 5 full seeded matches from level 2 to A with full card & point conservation', () => {
    const seeds = [101, 2026, 7777, 424242, 987654];

    for (const seed of seeds) {
      let state: GameState = createInitialMatchState(seed);
      let roundCounter = 0;
      let stepCounter = 0;
      const MAX_ROUNDS = 80;
      const MAX_STEPS_PER_ROUND = 300;

      while (state.phase !== 'MATCH_OVER' && roundCounter < MAX_ROUNDS) {
        let roundSteps = 0;
        while (
          state.phase !== 'ROUND_OVER' &&
          state.phase !== 'MATCH_OVER' &&
          roundSteps < MAX_STEPS_PER_ROUND
        ) {
          // Verify card conservation at every step
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
          assert.equal(
            handTotal + state.bottomCards.length + playedTotal,
            162,
            `card conservation failed on seed=${seed}, round=${state.roundNumber}, phase=${state.phase}`,
          );

          const turn = state.currentTurn;
          assert.notEqual(turn, null, 'currentTurn must not be null during active round');
          const action = chooseBotAction(state, turn as Seat);
          const res = applyAction(state, action);
          assert.equal(
            res.ok,
            true,
            `bot action failed: ${!res.ok ? res.error : ''} (seed=${seed}, phase=${state.phase}, action=${action.type})`,
          );
          if (!res.ok) break;
          state = res.state;
          roundSteps += 1;
          stepCounter += 1;
        }

        assert.ok(
          state.phase === 'ROUND_OVER' || state.phase === 'MATCH_OVER',
          `round ${state.roundNumber} did not terminate within ${MAX_STEPS_PER_ROUND} steps`,
        );

        // Verify 300-point conservation across completed tricks + bottom cards
        const trickPoints = state.completedTricks.reduce(
          (s, t) => s + t.points,
          0,
        );
        const bottomPoints = state.bottomCards.reduce(
          (s, c) => s + getCardPoints(c),
          0,
        );
        assert.equal(trickPoints + bottomPoints, 300,
          `point conservation failed on seed=${seed}, round=${state.roundNumber}`,
        );
        assert.ok(
          state.completedTricks.length >= 1 && state.completedTricks.length <= 38,
        );
        assert.equal(state.hands[0].length, 0);
        assert.equal(state.hands[1].length, 0);
        assert.equal(state.hands[2].length, 0);
        assert.equal(state.hands[3].length, 0);

        if (state.phase === 'ROUND_OVER') {
          roundCounter += 1;
          state = startNextRound(state, seed + roundCounter * 7919);
        }
      }

      assert.equal(
        state.phase,
        'MATCH_OVER',
        `match with seed=${seed} did not reach MATCH_OVER within ${MAX_ROUNDS} rounds`,
      );
      assert.ok(state.matchWinner === 'A' || state.matchWinner === 'B');
      assert.ok(stepCounter > 0);
    }
  });
});
