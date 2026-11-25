import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { BotDifficulty, Card, LevelRank, Seat, StandardSuit } from '@jinshan/protocol';
import {
  applyAction,
  chooseBotAction,
  chooseBotDealingCallAction,
  createInitialMatchState,
  getCardCategory,
  getCardPoints,
  getPlayerView,
  parsePlay,
  suggestBuryCards,
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

  it('never breaks a 3-of-a-kind (♥2×3) or pairs when 10 clean off-suit singles exist (Screenshot 2 hand)', () => {
    resetCardIds();
    // Exact 48-card hand from 打6 主♦ screenshot
    const hand48: Card[] = [
      // 12 trumps
      c('H', '5'), c('J', 'BJ'), c('D', '3'), c('D', '6'), c('D', '6'),
      c('D', '8'), c('D', '8'), c('D', '7'), c('D', '7'), c('D', '5'),
      c('D', '4'), c('D', '2'),
      // 14 spades
      c('S', 'A'), c('S', 'K'), c('S', 'Q'), c('S', 'Q'), c('S', '10'),
      c('S', '9'), c('S', '9'), c('S', '8'), c('S', '7'), c('S', '7'),
      c('S', '5'), c('S', '4'), c('S', '3'), c('S', '3'),
      // 11 hearts (includes ♥2×3 triple!)
      c('H', 'A'), c('H', 'K'), c('H', 'K'), c('H', 'Q'), c('H', 'J'),
      c('H', '10'), c('H', '10'), c('H', '8'), c('H', '7'),
      c('H', '2'), c('H', '2'), c('H', '2'),
      // 11 clubs (includes ♣9×2, ♣2×2)
      c('C', 'A'), c('C', 'K'), c('C', 'J'), c('C', '9'), c('C', '9'),
      c('C', '8'), c('C', '7'), c('C', '3'), c('C', '2'), c('C', '2'),
    ];
    // Fix count: 12 + 14 + 12 + 10 = 48
    assert.equal(hand48.length, 48);

    const buriedIds = suggestBuryCards(hand48, 'D', '6', 'hongxin');
    assert.equal(buriedIds.length, 10);
    const buriedSet = new Set(buriedIds);
    const buried = hand48.filter((card) => buriedSet.has(card.id));

    // Must NOT break ♥2×3 triple, must NOT bury trumps, Aces, points, or pairs!
    assert.equal(buried.filter((x) => x.suit === 'H' && x.rank === '2').length, 0);
    assert.equal(buried.filter((x) => getCardCategory(x, 'D', '6') === 'TRUMP').length, 0);
    assert.equal(buried.filter((x) => x.rank === 'A').length, 0);
    assert.equal(buried.reduce((s, x) => s + getCardPoints(x), 0), 0);
  });

  it('keeps off-suit Ace in a short suit to cash on trick 1 and still void on trick 2', () => {
    resetCardIds();
    const trumps: Card[] = [
      c('H', '5'), c('J', 'BJ'), c('J', 'SJ'), c('S', '3'), c('C', '3'),
      c('S', '2'), c('S', 'A'), c('S', 'K'), c('S', 'Q'), c('S', 'J'),
      c('S', '9'), c('S', '8'), c('S', '7'), c('S', '6'), c('S', '4'),
      c('H', '2'), c('C', '2'), c('D', '2'),
    ];
    // Short ♦ suit WITH an Ace: must keep ♦A and bury ♦8 ♦6 ♦4!
    const dAce = c('D', 'A');
    const shortDiamondsTrash = [c('D', '8'), c('D', '6'), c('D', '4')];
    const clubs: Card[] = [
      c('C', 'A'), c('C', 'K'), c('C', 'Q'), c('C', 'J'), c('C', '9'),
      c('C', '8'), c('C', '7'), c('C', '6'), c('C', '4'), c('C', '4'),
      c('C', '6'), c('C', '7'), c('C', '8'),
    ];
    const hearts: Card[] = [
      c('H', 'A'), c('H', 'Q'), c('H', 'J'), c('H', '9'), c('H', '8'),
      c('H', '7'), c('H', '6'), c('H', '4'), c('H', '4'), c('H', '6'),
      c('H', '7'), c('H', '8'), c('H', '9'),
    ];
    const full48 = [...trumps, dAce, ...shortDiamondsTrash, ...clubs, ...hearts];
    assert.equal(full48.length, 48);

    const buriedIds = suggestBuryCards(full48, 'S', '2', 'hongxin');
    assert.equal(buriedIds.length, 10);
    const buriedSet = new Set(buriedIds);
    assert.equal(buriedSet.has(dAce.id), false, 'must NEVER bury ♦A to void a short suit');
    for (const trash of shortDiamondsTrash) {
      assert.equal(
        buriedSet.has(trash.id),
        true,
        `expected non-Ace short diamond ${trash.rank} to be buried so ♦A cashes into a trick-2 void`,
      );
    }
  });
});

describe('Teammate cooperation tactics', () => {
  it('stops pulling trumps to cannibalize teammate when all enemies are confirmed void in TRUMP', () => {
    resetCardIds();
    const base = createInitialMatchState({ mode: 'hongxin', seed: 12, withDealing: false });
    const all = [
      ...base.hands[0],
      ...base.hands[1],
      ...base.hands[2],
      ...base.hands[3],
      ...base.bottomCards,
    ];
    const used = new Set<number>();
    const take = (suit: Card['suit'], rank: Card['rank']): Card => {
      const card = all.find((x) => !used.has(x.id) && x.suit === suit && x.rank === rank)!;
      assert.ok(card, `missing ${suit}:${rank}`);
      used.add(card.id);
      return card;
    };

    // Completed trick 1: Seat 0 led trump ♠4; BOTH enemies (Seat 1 & Seat 3) failed to follow TRUMP -> both enemies void in TRUMP!
    const t1Lead = take('S', '4');
    const t1E1 = take('C', '4');
    const t1Ally = take('S', '6');
    const t1E3 = take('C', '6');

    // Seat 0 (Dealer, Team A) holds strong trumps AND off-suit winners (♦A, ♣A) while Ally (Seat 2) still has trumps.
    const dAce = take('D', 'A');
    const cAce = take('C', 'A');
    const s0Hand: Card[] = [
      take('H', '5'), take('J', 'BJ'), take('J', 'SJ'), take('S', '3'),
      take('S', '2'), take('S', 'A'), take('S', 'K'), take('S', 'Q'),
      dAce, cAce, take('D', '7'), take('C', '7'),
    ];
    const rem = all.filter((x) => !used.has(x.id));
    const prior = rem.slice(0, 96);
    const live = rem.slice(96);

    const state: GameState = {
      ...base,
      phase: 'PLAYING',
      dealer: 0,
      bankerTeam: 'A',
      trumpSuit: 'S',
      levelRank: '2',
      currentTurn: 0,
      hands: {
        0: s0Hand,
        1: live.slice(0, 12),
        2: live.slice(12, 24),
        3: live.slice(24, 36),
      },
      bottomCards: live.slice(36, 46),
      completedTricks: [
        {
          trickNumber: 1,
          leadSeat: 0,
          winnerSeat: 2,
          points: 0,
          killedByTrump: false,
          plays: [
            { seat: 0, cards: [t1Lead], parsed: parsePlay([t1Lead], 'S', '2')! },
            { seat: 1, cards: [t1E1], parsed: parsePlay([t1E1], 'S', '2')! },
            { seat: 2, cards: [t1Ally], parsed: parsePlay([t1Ally], 'S', '2')! },
            { seat: 3, cards: [t1E3], parsed: parsePlay([t1E3], 'S', '2')! },
          ],
        },
        // Mark extra cards as played so unseen pool matches remaining hand sizes cleanly
        {
          trickNumber: 2,
          leadSeat: 2,
          winnerSeat: 0,
          points: 0,
          killedByTrump: false,
          plays: ([2, 3, 0, 1] as Seat[]).map((seat, idx) => {
            const cards = prior.slice(idx * 24, idx * 24 + 24);
            return {
              seat,
              cards,
              parsed: { patternType: 'SLING' as const, category: 'H' as const, cards, components: [] },
            };
          }),
        },
      ],
      currentTrick: [],
    };

    const act = chooseBotAction(state, 0);
    assert.equal(act.type, 'PLAY_CARDS');
    if (act.type === 'PLAY_CARDS') {
      const played = s0Hand.filter((card) => act.cardIds.includes(card.id));
      assert.equal(
        played.every((card) => getCardCategory(card, 'S', '2') !== 'TRUMP'),
        true,
        `when all enemies are void in TRUMP, bot should cash off-suit winners instead of pulling ally trumps, got ${played.map((x) => `${x.suit}:${x.rank}`).join(' ')}`,
      );
    }
  });

  it('3rd-seat bot overtakes with ♦A to protect teammate’s vulnerable ♦10 from 4th-seat enemy (三家上大护分)', () => {
    resetCardIds();
    const base = createInitialMatchState({ mode: 'hongxin', seed: 15, withDealing: false });
    const all = [
      ...base.hands[0],
      ...base.hands[1],
      ...base.hands[2],
      ...base.hands[3],
      ...base.bottomCards,
    ];
    const used = new Set<number>();
    const take = (suit: Card['suit'], rank: Card['rank']): Card => {
      const card = all.find((x) => !used.has(x.id) && x.suit === suit && x.rank === rank)!;
      assert.ok(card, `missing ${suit}:${rank}`);
      used.add(card.id);
      return card;
    };

    // Seat 0 (Teammate of Seat 2) leads ♦10 (10 pts, vulnerable to ♦J/♦Q/♦K/♦A!). Seat 1 (Enemy) follows ♦5 (15 pts on table!).
    // Seat 2 (Bot, 3rd seat) holds ♦A and ♦6 while higher ♦ remain unseen -> must play ♦A to secure 15 points!
    const lead10 = take('D', '10');
    const e1 = take('D', '5');
    const myA = take('D', 'A');
    const my6 = take('D', '6');
    const s2Hand: Card[] = [
      myA, my6, take('C', '4'), take('C', '7'), take('H', '4'), take('H', '7'),
      take('S', '7'), take('S', '8'), take('S', '9'), take('S', 'J'),
    ];
    const rem = all.filter((x) => !used.has(x.id));
    // Keep high diamonds (A/K/Q/J) in live hands (not discarded in prior tricks) so 4th seat genuinely threatens ♦10!
    const highDiamonds = rem.filter(
      (x) => x.suit === 'D' && (x.rank === 'A' || x.rank === 'K' || x.rank === 'Q' || x.rank === 'J'),
    );
    const nonHighD = rem.filter((x) => !highDiamonds.includes(x));
    const livePool = [...highDiamonds, ...nonHighD].slice(0, 38);
    const priorPool = [...highDiamonds, ...nonHighD].slice(38);
    const chunk = Math.floor(priorPool.length / 4);

    const state: GameState = {
      ...base,
      phase: 'PLAYING',
      dealer: 0,
      bankerTeam: 'A',
      trumpSuit: 'S',
      levelRank: '2',
      currentTurn: 2,
      hands: {
        0: livePool.slice(0, 9),
        1: livePool.slice(9, 18),
        2: s2Hand,
        3: livePool.slice(18, 28),
      },
      bottomCards: livePool.slice(28, 38),
      completedTricks: [
        {
          trickNumber: 1,
          leadSeat: 0,
          winnerSeat: 0,
          points: 0,
          killedByTrump: false,
          plays: ([0, 1, 2, 3] as Seat[]).map((seat, idx) => {
            const cards = priorPool.slice(idx * chunk, (idx + 1) * chunk);
            return {
              seat,
              cards,
              parsed: { patternType: 'SLING' as const, category: 'C' as const, cards, components: [] },
            };
          }),
        },
      ],
      currentTrick: [
        { seat: 0, cards: [lead10], parsed: parsePlay([lead10], 'S', '2')! },
        { seat: 1, cards: [e1], parsed: parsePlay([e1], 'S', '2')! },
      ],
    };

    const act = chooseBotAction(state, 2);
    assert.equal(act.type, 'PLAY_CARDS');
    if (act.type === 'PLAY_CARDS') {
      assert.deepEqual(
        act.cardIds,
        [myA.id],
        '3rd-seat bot must overtake with ♦A to protect teammate’s vulnerable ♦10 + ♦5 instead of ducking',
      );
    }
  });

  it('2nd-seat bot feeds points to a confirmed-void 4th-seat teammate who can cleanly ruff', () => {
    resetCardIds();
    const base = createInitialMatchState({ mode: 'hongxin', seed: 18, withDealing: false });
    const all = [
      ...base.hands[0],
      ...base.hands[1],
      ...base.hands[2],
      ...base.hands[3],
      ...base.bottomCards,
    ];
    const used = new Set<number>();
    const take = (suit: Card['suit'], rank: Card['rank']): Card => {
      const card = all.find((x) => !used.has(x.id) && x.suit === suit && x.rank === rank)!;
      assert.ok(card, `missing ${suit}:${rank}`);
      used.add(card.id);
      return card;
    };

    // Trick 1 proved Seat 3 (Team B, ally of Seat 1!) is VOID in ♦ while holding trumps!
    const t1Lead = take('D', 'A');
    const t1P1 = take('D', '4');
    const t1P2 = take('D', '6');
    const t1AllyVoid = take('S', '7'); // Seat 3 ruffed ♦ with trump ♠7 -> Seat 3 void in ♦!

    // Trick 2: Seat 0 (Enemy) leads ♦Q. Seat 1 (Bot, 2nd seat) holds ♦10 (10 pts) and ♦7 (0 pts).
    // Seat 3 (Teammate, 4th seat, LAST TO ACT) is confirmed void in ♦ with trumps out -> Seat 1 feeds ♦10!
    const leadQ = take('D', 'Q');
    const my10 = take('D', '10');
    const my7 = take('D', '7');
    const s1Hand: Card[] = [
      my10, my7, take('C', '4'), take('C', '6'), take('C', '7'),
      take('H', '4'), take('H', '6'), take('H', '7'), take('H', '8'), take('H', '9'),
    ];

    // Keep plenty of unseen ♦ and trumps in live hands so Seat 2 follows ♦ and Seat 3 ruffs cleanly!
    const rem = all.filter((x) => !used.has(x.id));
    const unseenDiamonds = rem.filter((x) => x.suit === 'D');
    const unseenTrumps = rem.filter((x) => getCardCategory(x, 'S', '2') === 'TRUMP');
    const others = rem.filter(
      (x) => x.suit !== 'D' && getCardCategory(x, 'S', '2') !== 'TRUMP',
    );
    const live0 = [...unseenDiamonds.slice(0, 4), ...others.slice(0, 5)];
    const live2 = [...unseenDiamonds.slice(4, 9), ...others.slice(5, 10)];
    const live3 = [...unseenTrumps.slice(0, 8), ...others.slice(10, 12)];
    const liveIds = new Set([...live0, ...live2, ...live3].map((x) => x.id));
    const restPool = rem.filter((x) => !liveIds.has(x.id));
    const bottom = restPool.slice(0, 10);
    const playedPrior = restPool.slice(10);

    const state: GameState = {
      ...base,
      phase: 'PLAYING',
      dealer: 0,
      bankerTeam: 'A',
      trumpSuit: 'S',
      levelRank: '2',
      currentTurn: 1,
      hands: { 0: live0, 1: s1Hand, 2: live2, 3: live3 },
      bottomCards: bottom,
      completedTricks: [
        {
          trickNumber: 1,
          leadSeat: 0,
          winnerSeat: 3,
          points: 0,
          killedByTrump: true,
          plays: [
            { seat: 0, cards: [t1Lead], parsed: parsePlay([t1Lead], 'S', '2')! },
            { seat: 1, cards: [t1P1], parsed: parsePlay([t1P1], 'S', '2')! },
            { seat: 2, cards: [t1P2], parsed: parsePlay([t1P2], 'S', '2')! },
            { seat: 3, cards: [t1AllyVoid], parsed: parsePlay([t1AllyVoid], 'S', '2')! },
          ],
        },
        {
          trickNumber: 2,
          leadSeat: 3,
          winnerSeat: 0,
          points: 0,
          killedByTrump: false,
          plays: ([3, 0, 1, 2] as Seat[]).map((seat, idx) => {
            const chunk = Math.floor(playedPrior.length / 4);
            const cards = playedPrior.slice(idx * chunk, (idx + 1) * chunk);
            return {
              seat,
              cards,
              parsed: { patternType: 'SLING' as const, category: 'C' as const, cards, components: [] },
            };
          }),
        },
      ],
      currentTrick: [
        { seat: 0, cards: [leadQ], parsed: parsePlay([leadQ], 'S', '2')! },
      ],
    };

    const act = chooseBotAction(state, 1);
    assert.equal(act.type, 'PLAY_CARDS');
    if (act.type === 'PLAY_CARDS') {
      assert.deepEqual(
        act.cardIds,
        [my10.id],
        '2nd-seat bot should feed ♦10 into confirmed-void 4th-seat teammate’s clean ruff',
      );
    }
  });

  it('heixin 1v3 challenger avoids firing trump 510K mid-game when fellow challengers still hold trumps', () => {
    resetCardIds();
    const base = createInitialMatchState({ mode: 'heixin', seed: 25, withDealing: false });
    const all = [
      ...base.hands[0],
      ...base.hands[1],
      ...base.hands[2],
      ...base.hands[3],
      ...base.bottomCards,
    ];
    const used = new Set<number>();
    const take = (suit: Card['suit'], rank: Card['rank']): Card => {
      const card = all.find((x) => !used.has(x.id) && x.suit === suit && x.rank === rank)!;
      assert.ok(card, `missing ${suit}:${rank}`);
      used.add(card.id);
      return card;
    };

    // Dealer = Seat 1 (trump = ♠, level = 10). Bot = Seat 0 (challenger, allies = Seat 2 & Seat 3).
    // Seat 0 holds trump 510K (♠5 ♠10 ♠K) AND off-suit ♦A -> must cash ♦A instead of stripping 2 teammates' top trumps!
    const s5 = take('S', '5');
    const s10 = take('S', '10');
    const sK = take('S', 'K');
    const dAce = take('D', 'A');
    const s0Hand: Card[] = [
      s5, s10, sK, take('H', '5'), take('J', 'BJ'), take('S', '3'), take('S', 'A'),
      take('S', '9'), take('S', '8'), take('S', '7'),
      dAce, take('D', '7'), take('C', '4'), take('C', '6'), take('H', '4'), take('H', '6'),
    ];
    const rem = all.filter((x) => !used.has(x.id));
    const state: GameState = {
      ...base,
      phase: 'PLAYING',
      dealer: 1,
      bankerTeam: 'B',
      trumpSuit: 'S',
      levelRank: '10',
      currentTurn: 0,
      hands: {
        0: s0Hand,
        1: rem.slice(0, 16),
        2: rem.slice(16, 32),
        3: rem.slice(32, 48),
      },
      bottomCards: rem.slice(48, 58),
      completedTricks: [
        {
          trickNumber: 1,
          leadSeat: 1,
          winnerSeat: 0,
          points: 0,
          killedByTrump: false,
          plays: ([1, 2, 3, 0] as Seat[]).map((seat, idx) => {
            const cards = rem.slice(58 + idx * 22, 58 + (idx + 1) * 22);
            return {
              seat,
              cards,
              parsed: { patternType: 'SLING' as const, category: 'C' as const, cards, components: [] },
            };
          }),
        },
      ],
      currentTrick: [],
    };

    const act = chooseBotAction(state, 0);
    assert.equal(act.type, 'PLAY_CARDS');
    if (act.type === 'PLAY_CARDS') {
      const fired510k =
        act.cardIds.length === 3 &&
        act.cardIds.includes(s5.id) &&
        act.cardIds.includes(s10.id) &&
        act.cardIds.includes(sK.id);
      assert.equal(
        fired510k,
        false,
        'heixin challenger must not fire trump 510K mid-game and strip 2 fellow challengers’ top trumps',
      );
    }
  });
});

describe('Smart sling trump-kill and dealer bottom peek', () => {
  it('kills a 3-single sling without wasting 大王 alongside two ♥5s (Screenshot 1 hand)', () => {
    const init = createInitialMatchState({ mode: 'hongxin', seed: 9, withDealing: false });
    const all = [
      ...init.hands[0],
      ...init.hands[1],
      ...init.hands[2],
      ...init.hands[3],
      ...init.bottomCards,
    ];
    const used = new Set<number>();
    const take = (suit: Card['suit'], rank: Card['rank']): Card => {
      const card = all.find((x) => !used.has(x.id) && x.suit === suit && x.rank === rank)!;
      used.add(card.id);
      return card;
    };

    // Lead (Seat 0, teammate of Seat 2): ♥K ♥10 ♥8 (20 pts off-suit singles, trump=♣, level=4)
    const lead = [take('H', 'K'), take('H', '10'), take('H', '8')];
    // Seat 1 (Enemy, void in hearts): trump-kills with ♣K ♣10 ♣5 (25 pts -> 45 pts total on table!)
    const p1 = [take('C', 'K'), take('C', '10'), take('C', '5')];
    // Seat 2 (Teammate of Seat 0, void in hearts): holds ♥5×2, 大王, plus small trumps ♣9, ♣7, ♣6 and off-suits!
    const h5a = take('H', '5');
    const h5b = take('H', '5');
    const bj = take('J', 'BJ');
    const c9 = take('C', '9');
    const c7 = take('C', '7');
    const c6 = take('C', '6');
    const s2Hand: Card[] = [
      h5a, h5b, bj, c9, c7, c6,
      take('S', 'A'), take('S', '8'), take('D', '9'), take('D', '7'),
    ];
    const remaining = all.filter((x) => !used.has(x.id));
    const prior = remaining.slice(0, 96); // 24 cards each already played
    const live = remaining.slice(96);

    const state: GameState = {
      ...init,
      phase: 'PLAYING',
      dealer: 0,
      bankerTeam: 'A',
      trumpSuit: 'C',
      levelRank: '4',
      currentTurn: 2,
      hands: {
        0: live.slice(0, 7),
        1: live.slice(7, 14),
        2: s2Hand,
        3: live.slice(14, 24),
      },
      bottomCards: live.slice(24, 34),
      completedTricks: Array.from({ length: 8 }, (_, idx) => ({
        trickNumber: idx + 1,
        leadSeat: 0 as Seat,
        winnerSeat: 0 as Seat,
        points: 0,
        killedByTrump: false,
        plays: ([0, 1, 2, 3] as Seat[]).map((seat, j) => {
          const cards = prior.slice(idx * 12 + j * 3, idx * 12 + j * 3 + 3);
          return {
            seat,
            cards,
            parsed: parsePlay(cards, 'C', '4') ?? {
              patternType: 'SLING',
              category: 'D',
              cards,
              components: [],
            },
          };
        }),
      })),
      currentTrick: [
        { seat: 0, cards: lead, parsed: parsePlay(lead, 'C', '4')! },
        { seat: 1, cards: p1, parsed: parsePlay(p1, 'C', '4')! },
      ],
    };

    const act = chooseBotAction(state, 2);
    assert.equal(act.type, 'PLAY_CARDS');
    if (act.type === 'PLAY_CARDS') {
      const ids = new Set(act.cardIds);
      const chosen = s2Hand.filter((card) => ids.has(card.id));
      // Must over-kill with trumps to capture 45+ points!
      assert.equal(
        chosen.every((card) => getCardCategory(card, 'C', '4') === 'TRUMP'),
        true,
        `expected bot to trump over-kill for 45 pts, got ${chosen.map((x) => `${x.suit}:${x.rank}`).join(' ')}`,
      );
      // MUST NOT waste 大王 alongside two ♥5s — must include at least one cheap small trump!
      assert.equal(
        ids.has(h5a.id) && ids.has(h5b.id) && ids.has(bj.id),
        false,
        'bot must NOT waste ♥5 + ♥5 + 大王 when ♥5 + ♥5 + small trump is already unbeatable',
      );
      assert.ok(
        ids.has(c6.id) || ids.has(c7.id) || ids.has(c9.id),
        'bot should pair high anchor(s) with cheap low trump filler(s)',
      );
    }
  });

  it('reveals buried bottom ONLY to the dealer during PLAYING phase (hidden from non-dealers)', () => {
    const state = createCleanPlayingState({
      trumpSuit: 'S',
      levelRank: '2',
      dealer: 2,
      currentTurn: 2,
      hands: {
        0: [c('S', 'A')],
        1: [c('H', 'A')],
        2: [c('C', 'A')],
        3: [c('D', 'A')],
      },
    });
    const withBottom: GameState = {
      ...state,
      bottomCards: Array.from({ length: 10 }, () => c('D', '4')),
    };

    const dealerView = getPlayerView(withBottom, 2, false);
    const allyView = getPlayerView(withBottom, 0, false);
    const enemyView = getPlayerView(withBottom, 1, false);

    assert.equal(dealerView.revealedBottom?.length, 10);
    assert.equal(allyView.revealedBottom, null);
    assert.equal(enemyView.revealedBottom, null);
  });

  it('supports low, medium, and high bot difficulties across hongxin and heixin with 300-point conservation', () => {
    const pairs: Array<[BotDifficulty, BotDifficulty]> = [
      ['low', 'low'],
      ['medium', 'medium'],
      ['low', 'high'],
      ['medium', 'high'],
    ];
    for (const mode of ['hongxin', 'heixin'] as const) {
      for (const [diffA, diffB] of pairs) {
        let state = createInitialMatchState({ mode, seed: 412, withDealing: false });
        let steps = 0;
        while (state.phase !== 'ROUND_OVER' && state.phase !== 'MATCH_OVER') {
          steps += 1;
          assert.ok(steps < 400, `${mode} ${diffA}/${diffB} stalled in phase=${state.phase}`);
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
          const diff = actor % 2 === 0 ? diffA : diffB;
          const act = chooseBotAction(state, actor, diff);
          const res = applyAction(state, act);
          assert.equal(
            res.ok,
            true,
            `${mode} (${diff}) produced illegal action ${act.type}: ${!res.ok ? res.error : ''}`,
          );
          state = res.state;
        }
        const bottomPts = state.bottomCards.reduce((s, card) => s + getCardPoints(card), 0);
        assert.equal(
          state.bankerPoints + state.challengerPoints + bottomPts,
          300,
          `${mode} ${diffA}/${diffB} must conserve 300 total points`,
        );
      }
    }

    // Low difficulty bot yields dealing-phase calls to human players
    const dealing = createInitialMatchState({ mode: 'hongxin', seed: 12, withDealing: true });
    const withFullHand: GameState = {
      ...dealing,
      dealtCount: 38,
      hands: {
        ...dealing.hands,
        1: [c('S', '2'), c('S', '2'), c('S', '2'), c('H', '5')],
      },
    };
    assert.equal(chooseBotDealingCallAction(withFullHand, 1, 'low'), null);
    assert.notEqual(chooseBotDealingCallAction(withFullHand, 1, 'high'), null);
  });
});
