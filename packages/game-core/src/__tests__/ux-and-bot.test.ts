import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Card, LevelRank, Seat, StandardSuit } from '@jinshan/protocol';
import {
  applyAction,
  chooseBotAction,
  createInitialMatchState,
  getCardCategory,
  getCardPoints,
  getPlayerView,
  parsePlay,
  type GameState,
} from '../index.js';

let nextCardId = 80000;
function resetCardIds(): void {
  nextCardId = 80000;
}
function c(suit: Card['suit'], rank: Card['rank']): Card {
  const id = nextCardId++;
  return { id, deck: (id % 3) as 0 | 1 | 2, suit, rank };
}
function createCleanPlayingState(opts: {
  trumpSuit: StandardSuit | null;
  levelRank: LevelRank;
  dealer?: Seat;
  currentTurn: Seat;
  hands: Record<Seat, Card[]>;
}): GameState {
  const base = createInitialMatchState({ mode: 'hongxin', seed: 1, withDealing: false });
  return {
    ...base,
    phase: 'PLAYING',
    dealer: opts.dealer ?? 0,
    bankerTeam: (opts.dealer ?? 0) % 2 === 0 ? 'A' : 'B',
    trumpSuit: opts.trumpSuit,
    levelRank: opts.levelRank,
    currentTurn: opts.currentTurn,
    hands: opts.hands,
    bottomCards: [],
    currentTrick: [],
    completedTricks: [],
  };
}

function playFullRoundWithBots(mode: 'hongxin' | 'heixin', seed: number): GameState {
  let state = createInitialMatchState({ mode, seed, withDealing: false });
  let steps = 0;
  while (state.phase !== 'ROUND_OVER' && state.phase !== 'MATCH_OVER') {
    steps += 1;
    assert.ok(steps < 400, `Round did not finish within 400 steps (phase=${state.phase})`);
    let actor: Seat;
    if (state.phase === 'CALLING') {
      actor = ([0, 1, 2, 3] as Seat[]).find(
        (s) => !state.callState.passedSeats.includes(s),
      )!;
    } else if (state.phase === 'COUNTER_BIDDING') {
      actor = state.callState.eligibleCounterSeats[0];
    } else {
      actor = state.currentTurn!;
    }
    const action = chooseBotAction(state, actor);
    const res = applyAction(state, action);
    assert.equal(res.ok, true, `Bot produced illegal action ${action.type}: ${!res.ok ? res.error : ''}`);
    state = res.state;
  }
  return state;
}

describe('Smart Bot AI tactical decisions', () => {
  it('last-seat bot feeds high points to winning teammate and never overtakes ally', () => {
    resetCardIds();
    const leadCard = c('D', 'Q');
    const allyCard = c('D', 'A');
    const enemy3Card = c('D', '4');
    const myK = c('D', 'K');
    const my10 = c('D', '10');
    const my6 = c('D', '6');
    const myFiller = c('C', '7');

    // Seat 0 (Team A) leads ♦Q, Seat 1 (Team B) plays ♦A (winning!), Seat 2 (Team A) plays ♦4,
    // now Seat 3 (Team B, ally of Seat 1!) is LAST seat holding ♦K, ♦10, ♦6, ♣7.
    const base = createCleanPlayingState({
      trumpSuit: 'S',
      levelRank: '2',
      currentTurn: 3,
      hands: {
        0: [c('C', '4')],
        1: [c('C', '6')],
        2: [c('C', '8')],
        3: [myK, my10, my6, myFiller],
      },
    });
    const state: GameState = {
      ...base,
      currentTrick: [
        { seat: 0, cards: [leadCard], parsed: parsePlay([leadCard], 'S', '2')! },
        { seat: 1, cards: [allyCard], parsed: parsePlay([allyCard], 'S', '2')! },
        { seat: 2, cards: [enemy3Card], parsed: parsePlay([enemy3Card], 'S', '2')! },
      ],
    };

    const act = chooseBotAction(state, 3);
    assert.equal(act.type, 'PLAY_CARDS');
    if (act.type === 'PLAY_CARDS') {
      assert.equal(act.cardIds.length, 1);
      // Must feed a 10-point card (♦K or ♦10) to winning ally instead of dumping ♦6!
      assert.ok(
        act.cardIds[0] === myK.id || act.cardIds[0] === my10.id,
        'expected last-seat bot to feed ♦K or ♦10 to winning ally',
      );
    }
  });

  it('last-seat bot overtakes enemy for points with minimal card and dodges points when losing', () => {
    resetCardIds();
    const leadCard = c('D', '10'); // 10 points on table
    const p1 = c('D', 'J');
    const p2 = c('D', 'K'); // Team A (enemy of Seat 3) currently winning with 20 pts on table!
    const myA = c('D', 'A');
    const my6 = c('D', '6');

    const baseWin = createCleanPlayingState({
      trumpSuit: 'S',
      levelRank: '2',
      currentTurn: 3,
      hands: {
        0: [c('C', '4')],
        1: [c('C', '6')],
        2: [c('C', '8')],
        3: [myA, my6, c('C', '9')],
      },
    });
    const stateWin: GameState = {
      ...baseWin,
      currentTrick: [
        { seat: 0, cards: [leadCard], parsed: parsePlay([leadCard], 'S', '2')! },
        { seat: 1, cards: [p1], parsed: parsePlay([p1], 'S', '2')! },
        { seat: 2, cards: [p2], parsed: parsePlay([p2], 'S', '2')! },
      ],
    };
    const actWin = chooseBotAction(stateWin, 3);
    assert.equal(actWin.type, 'PLAY_CARDS');
    if (actWin.type === 'PLAY_CARDS') {
      assert.deepEqual(actWin.cardIds, [myA.id], 'last-seat bot should overtake enemy with ♦A to capture 20 points');
    }

    // Now Seat 3 has NO ♦A, only ♦10 and ♦6 -> cannot overtake ♦K, MUST dodge points and play ♦6!
    const my10 = c('D', '10');
    const stateLose: GameState = {
      ...stateWin,
      hands: {
        ...stateWin.hands,
        3: [my10, my6, c('C', '9')],
      },
    };
    const actLose = chooseBotAction(stateLose, 3);
    assert.equal(actLose.type, 'PLAY_CARDS');
    if (actLose.type === 'PLAY_CARDS') {
      assert.deepEqual(actLose.cardIds, [my6.id], 'bot losing to enemy must dump 0-point ♦6 instead of ♦10');
    }
  });

  it('void bot does not waste ♥5 to trump-kill a 0-point early trick', () => {
    resetCardIds();
    const leadCard = c('D', 'A');
    const red5 = c('H', '5');
    const garbageC4 = c('C', '4');

    const base = createCleanPlayingState({
      trumpSuit: 'S',
      levelRank: '2',
      currentTurn: 3,
      hands: {
        0: [c('C', '6'), c('C', '7'), c('C', '8'), c('C', '9'), c('H', '4'), c('H', '6'), c('H', '7'), c('H', '8')],
        1: [c('C', '6'), c('C', '7'), c('C', '8'), c('C', '9'), c('H', '4'), c('H', '6'), c('H', '7'), c('H', '8')],
        2: [c('C', '6'), c('C', '7'), c('C', '8'), c('C', '9'), c('H', '4'), c('H', '6'), c('H', '7'), c('H', '8')],
        3: [red5, garbageC4, c('C', '6'), c('C', '7'), c('H', '4'), c('H', '6'), c('H', '7'), c('H', '8')],
      },
    });
    const state: GameState = {
      ...base,
      currentTrick: [
        { seat: 0, cards: [leadCard], parsed: parsePlay([leadCard], 'S', '2')! },
        { seat: 1, cards: [c('D', '4')], parsed: parsePlay([c('D', '4')], 'S', '2')! },
        { seat: 2, cards: [c('D', '6')], parsed: parsePlay([c('D', '6')], 'S', '2')! },
      ],
    };
    const act = chooseBotAction(state, 3);
    assert.equal(act.type, 'PLAY_CARDS');
    if (act.type === 'PLAY_CARDS') {
      assert.notEqual(act.cardIds[0], red5.id, 'bot should NOT burn ♥5 on a 0-point early trick');
    }
  });

  it('never dumps trump point cards (♣K ♣5 ♣5) into an enemy trump tractor while holding ♣8 and ♣9', () => {
    resetCardIds();
    // Exact reproduction of real-game bug: Banker (seat 2, Team A) leads ♣JJ ♣1010 trump tractor.
    // Challenger (seat 3, Team B) holds 小王×2, ♣3, ♠3, ♣K, ♣9, ♣8, ♣7, ♣5, ♣5 plus off-suits.
    const deck = createInitialMatchState({ mode: 'hongxin', seed: 1, withDealing: false });
    const allCards = [
      ...deck.hands[0],
      ...deck.hands[1],
      ...deck.hands[2],
      ...deck.hands[3],
      ...deck.bottomCards,
    ];
    const used = new Set<number>();
    const take = (suit: Card['suit'], rank: Card['rank']): Card => {
      const card = allCards.find((x) => !used.has(x.id) && x.suit === suit && x.rank === rank)!;
      assert.ok(card, `missing ${suit}:${rank}`);
      used.add(card.id);
      return card;
    };

    const s3Hand: Card[] = [
      take('J', 'SJ'),
      take('J', 'SJ'),
      take('S', '3'),
      take('C', '3'),
      take('C', 'K'),
      take('C', '9'),
      take('C', '8'),
      take('C', '7'),
      take('C', '5'),
      take('C', '5'),
      take('S', 'K'),
      take('S', 'Q'),
      take('S', 'J'),
      take('S', '9'),
      take('S', '9'),
      take('S', '8'),
      take('S', '7'),
      take('S', '4'),
      take('H', 'K'),
      take('H', '9'),
      take('H', '8'),
      take('H', '8'),
      take('H', '7'),
      take('H', '7'),
      take('H', '6'),
      take('H', '4'),
      take('H', '4'),
      take('H', '3'),
      take('D', 'K'),
      take('D', 'K'),
      take('D', 'K'),
      take('D', 'J'),
      take('D', '8'),
      take('D', '7'),
    ];
    const lead = [take('C', 'J'), take('C', 'J'), take('C', '10'), take('C', '10')];
    const prevCards = allCards.filter((x) => !used.has(x.id)).slice(0, 16);
    for (const pc of prevCards) used.add(pc.id);
    const rem = allCards.filter((x) => !used.has(x.id));

    for (let roundNumber = 1; roundNumber <= 10; roundNumber++) {
      const state: GameState = {
        ...deck,
        roundNumber,
        phase: 'PLAYING',
        dealer: 2,
        bankerTeam: 'A',
        trumpSuit: 'C',
        levelRank: '2',
        currentTurn: 3,
        hands: {
          0: rem.slice(0, 34),
          1: rem.slice(34, 68),
          2: rem.slice(68, 98),
          3: s3Hand,
        },
        bottomCards: rem.slice(98, 108),
        completedTricks: [
          {
            trickNumber: 1,
            leadSeat: 2,
            winnerSeat: 2,
            points: 25,
            killedByTrump: false,
            plays: ([0, 1, 2, 3] as Seat[]).map((seat, i) => ({
              seat,
              cards: prevCards.slice(i * 4, i * 4 + 4),
              parsed: parsePlay(prevCards.slice(i * 4, i * 4 + 4), 'C', '2') ?? {
                patternType: 'SLING',
                category: 'D',
                cards: prevCards.slice(i * 4, i * 4 + 4),
                components: [],
              },
            })),
          },
        ],
        currentTrick: [
          { seat: 2, cards: lead, parsed: parsePlay(lead, 'C', '2')! },
        ],
      };

      const act = chooseBotAction(state, 3);
      assert.equal(act.type, 'PLAY_CARDS');
      if (act.type === 'PLAY_CARDS') {
        const chosen = s3Hand.filter((card) => act.cardIds.includes(card.id));
        const pts = chosen.reduce((sum, card) => sum + getCardPoints(card), 0);
        assert.ok(
          pts <= 5,
          `round=${roundNumber}: bot dumped ${pts} pts (${chosen.map((x) => `${x.suit}:${x.rank}`).join(' ')}) into enemy trump tractor`,
        );
        assert.ok(
          chosen.some((x) => x.suit === 'C' && x.rank === '8') &&
            chosen.some((x) => x.suit === 'C' && x.rank === '9'),
          'bot should shed low non-point trumps ♣8 and ♣9 before point trumps',
        );
      }
    }
  });

  it('completes multi-seed hongxin and heixin full rounds with 0 illegal moves and accurate point-card conservation', () => {
    for (const mode of ['hongxin', 'heixin'] as const) {
      for (const seed of [101, 202, 303]) {
        const finalState = playFullRoundWithBots(mode, seed);
        const view = getPlayerView(finalState, 0, false);

        const capPts = view.capturedPointCards.reduce((s, card) => s + getCardPoints(card), 0);
        const escPts = view.escapedPointCards.reduce((s, card) => s + getCardPoints(card), 0);
        const bottomPts = finalState.bottomCards.reduce((s, card) => s + getCardPoints(card), 0);

        assert.equal(
          capPts + escPts + bottomPts,
          300,
          `${mode} seed=${seed}: captured(${capPts}) + escaped(${escPts}) + bottom(${bottomPts}) must equal 300`,
        );

        if (mode === 'hongxin') {
          assert.equal(capPts, finalState.challengerPoints);
          assert.equal(escPts, finalState.bankerPoints);
        } else {
          assert.equal(capPts, finalState.bankerPoints);
          assert.equal(escPts, finalState.challengerPoints);
        }
      }
    }
  });
});

describe('Call & counter seat display tracking', () => {
  it('records CALL, COUNTER, and COUNTER_ACCEPTED/COUNTER_FAILED per seat in PlayerView', () => {
    resetCardIds();
    const base = createInitialMatchState({ mode: 'hongxin', seed: 77, withDealing: false });

    // Give seat 0 three ♠2 (plus low bipai) and seat 1 three ♥2 so calling & countering are deterministic
    const s0CallCards: Card[] = [c('S', '2'), c('S', '2'), c('S', '2')];
    const s1CounterCards: Card[] = [c('H', '2'), c('H', '2'), c('H', '2')];
    const fill = (suit: StandardSuit, count: number): Card[] =>
      Array.from({ length: count }, (_, i) =>
        c(suit, (['4', '6', '7', '8', '9', 'J', 'Q', 'A'][i % 8]) as Card['rank']),
      );

    const state: GameState = {
      ...base,
      hands: {
        0: [...s0CallCards, ...fill('C', 35)],
        1: [...s1CounterCards, ...fill('D', 35)],
        2: fill('C', 38),
        3: fill('D', 38),
      },
    };

    // Seat 0 calls ♠
    const r1 = applyAction(state, {
      type: 'CALL_TRUMP',
      seat: 0,
      suit: 'S',
      cardIds: s0CallCards.map((x) => x.id),
    });
    assert.equal(r1.ok, true);
    if (!r1.ok) return;
    const v1 = getPlayerView(r1.state, 2);
    assert.equal(v1.callState.seatCallDisplays[0]?.kind, 'CALL');
    assert.equal(v1.callState.seatCallDisplays[0]?.suit, 'S');
    assert.equal(v1.callState.seatCallDisplays[0]?.cards.length, 3);

    // Seat 1 counters with ♥ -> enters COUNTER_RESPONSE and displays Seat 1's ♥ counter
    const r2 = applyAction(r1.state, {
      type: 'COUNTER_BID',
      seat: 1,
      suit: 'H',
      cardIds: s1CounterCards.map((x) => x.id),
    });
    assert.equal(r2.ok, true);
    if (!r2.ok) return;
    const v2 = getPlayerView(r2.state, 2);
    assert.equal(v2.phase, 'COUNTER_RESPONSE');
    assert.equal(v2.callState.seatCallDisplays[1]?.kind, 'COUNTER');
    assert.equal(v2.callState.seatCallDisplays[1]?.suit, 'H');
    assert.equal(v2.callState.seatCallDisplays[1]?.cards.length, 3);

    // Seat 0 accepts counter -> Seat 1 display updates to COUNTER_ACCEPTED
    const r3 = applyAction(r2.state, { type: 'ACCEPT_COUNTER', seat: 0 });
    assert.equal(r3.ok, true);
    if (!r3.ok) return;
    const v3 = getPlayerView(r3.state, 2);
    assert.equal(v3.callState.seatCallDisplays[1]?.kind, 'COUNTER_ACCEPTED');
    assert.equal(v3.callState.seatCallDisplays[1]?.suit, 'H');
    assert.equal(v3.callState.seatCallDisplays[0]?.kind, 'CALL');
  });
});

describe('Bot burying strategy', () => {
  it('clears a short non-point off-suit to create a void while keeping trumps and Aces', () => {
    resetCardIds();
    const trumps: Card[] = [
      c('H', '5'),
      c('J', 'BJ'),
      c('J', 'SJ'),
      c('S', '3'),
      c('C', '3'),
      c('S', '2'),
      c('S', 'A'),
      c('S', 'K'),
      c('S', 'Q'),
      c('S', 'J'),
      c('S', '9'),
      c('S', '8'),
      c('S', '7'),
      c('S', '6'),
      c('S', '4'),
      c('H', '2'),
      c('C', '2'),
      c('D', '2'),
    ];
    // Short ♦ suit: 3 non-point cards (should all be buried to create a void!)
    const shortDiamonds: Card[] = [c('D', '4'), c('D', '6'), c('D', '7')];
    const clubs: Card[] = [
      c('C', 'A'),
      c('C', 'A'),
      c('C', 'K'),
      c('C', 'Q'),
      c('C', 'J'),
      c('C', '9'),
      c('C', '8'),
      c('C', '7'),
      c('C', '6'),
      c('C', '4'),
      c('C', '4'),
      c('C', '6'),
      c('C', '7'),
      c('C', '8'),
    ];
    const hearts: Card[] = [
      c('H', 'A'),
      c('H', 'Q'),
      c('H', 'J'),
      c('H', '9'),
      c('H', '8'),
      c('H', '7'),
      c('H', '6'),
      c('H', '4'),
      c('H', '4'),
      c('H', '6'),
      c('H', '7'),
      c('H', '8'),
      c('H', '9'),
    ];
    const full48 = [...trumps, ...shortDiamonds, ...clubs, ...hearts];
    assert.equal(full48.length, 48);

    const base = createCleanPlayingState({
      trumpSuit: 'S',
      levelRank: '2',
      dealer: 0,
      currentTurn: 0,
      hands: {
        0: full48,
        1: [],
        2: [],
        3: [],
      },
    });
    const buryState: GameState = { ...base, phase: 'BURYING' };
    const act = chooseBotAction(buryState, 0);
    assert.equal(act.type, 'BURY_BOTTOM');
    if (act.type === 'BURY_BOTTOM') {
      assert.equal(act.cardIds.length, 10);
      const buriedSet = new Set(act.cardIds);
      const buriedCards = full48.filter((card) => buriedSet.has(card.id));

      // Zero trumps buried, zero Aces buried, and all 3 short diamonds cleared for a void!
      assert.equal(
        buriedCards.filter((card) => getCardCategory(card, 'S', '2') === 'TRUMP').length,
        0,
      );
      assert.equal(
        buriedCards.filter((card) => card.rank === 'A').length,
        0,
      );
      for (const dCard of shortDiamonds) {
        assert.ok(buriedSet.has(dCard.id), `expected short-suit ${dCard.suit}${dCard.rank} to be buried to create a void`);
      }
    }
  });
});
