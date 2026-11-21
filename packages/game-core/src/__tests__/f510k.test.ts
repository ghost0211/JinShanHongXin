import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findLegalFollowCards,
  parsePlay,
  resolveTrickWinner,
  validateFollowPlay,
} from '../index.js';
import type { Card } from '../index.js';

let nextId = 5000;
function mk(suit: Card['suit'], rank: Card['rank'], count = 1): Card[] {
  const res: Card[] = [];
  for (let i = 0; i < count; i++) {
    res.push({ id: nextId++, deck: (i % 3) as 0 | 1 | 2, suit, rank });
  }
  return res;
}

describe('510K rules (single, double, triple, borrowing, beating, trump penalty)', () => {
  it('allows borrowing ♥5 (when H is not trump), 10 (when playing 10), and K (when playing K) in off-suit 510K', () => {
    // Playing 2, trump D -> ♥5 is TRUMP, yet ♥5+♥10+♥K forms non-trump H 510K
    const h510k = parsePlay(
      [...mk('H', '5'), ...mk('H', '10'), ...mk('H', 'K')],
      'D',
      '2',
    );
    assert.equal(h510k?.patternType, 'F510K');
    assert.equal(h510k?.category, 'H');
    assert.equal(h510k?.components[0].length, 1);

    // Playing 10, trump D -> ♠10 is TRUMP, yet ♠5+♠10+♠K forms S 510K
    const s510k = parsePlay(
      [...mk('S', '5'), ...mk('S', '10'), ...mk('S', 'K')],
      'D',
      '10',
    );
    assert.equal(s510k?.patternType, 'F510K');
    assert.equal(s510k?.category, 'S');

    // Playing K, trump D -> ♣K is TRUMP, yet ♣5+♣10+♣K forms C 510K
    const c510k = parsePlay(
      [...mk('C', '5'), ...mk('C', '10'), ...mk('C', 'K')],
      'D',
      'K',
    );
    assert.equal(c510k?.patternType, 'F510K');
    assert.equal(c510k?.category, 'C');

    // Follower holding ♠10 (trump), ♠5, ♠K, ♠A, ♠9 CAN follow ♠510K with borrowed [♠5, ♠10, ♠K],
    // OR with 3 non-trump spades [♠5, ♠A, ♠9], but CANNOT dump ♠10 without completing 510K!
    const sp5 = mk('S', '5');
    const sp10 = mk('S', '10');
    const spK = mk('S', 'K');
    const spA = mk('S', 'A');
    const sp9 = mk('S', '9');
    const hand = [...sp5, ...sp10, ...spK, ...spA, ...sp9];

    assert.equal(
      validateFollowPlay(
        hand,
        [sp5[0].id, sp10[0].id, spK[0].id],
        s510k!,
        'D',
        '10',
      ).valid,
      true,
    );
    assert.equal(
      validateFollowPlay(
        hand,
        [sp5[0].id, spA[0].id, sp9[0].id],
        s510k!,
        'D',
        '10',
      ).valid,
      true,
    );
    assert.equal(
      validateFollowPlay(
        hand,
        [sp10[0].id, spA[0].id, sp9[0].id],
        s510k!,
        'D',
        '10',
      ).valid,
      false,
    );
  });

  it('resolves single, double, and triple 510K beating vs cancelling correctly', () => {
    const trump = 'D' as const;
    const level = '2' as const;

    // Single 510K: beaten ONLY by TRIPLE (not A single/pair or another 510K)
    const leadS1 = [...mk('S', '5'), ...mk('S', '10'), ...mk('S', 'K')];
    const followS1 = [...mk('S', '5'), ...mk('S', '10'), ...mk('S', 'K')];
    const followJunk = [...mk('S', 'A', 2), ...mk('S', 'J', 1)];
    const followTriple4 = mk('S', '4', 3);

    const singleTie = resolveTrickWinner(
      [
        { seat: 0, cards: leadS1, parsed: parsePlay(leadS1, trump, level)! },
        { seat: 1, cards: followS1, parsed: parsePlay(followS1, trump, level)! },
        { seat: 2, cards: followJunk, parsed: parsePlay(followJunk, trump, level)! },
        { seat: 3, cards: mk('C', '9', 3), parsed: parsePlay(mk('C', '9', 3), trump, level)! },
      ],
      trump,
      level,
    );
    assert.equal(singleTie.winnerSeat, 0);

    const singleBeaten = resolveTrickWinner(
      [
        { seat: 0, cards: leadS1, parsed: parsePlay(leadS1, trump, level)! },
        { seat: 1, cards: followS1, parsed: parsePlay(followS1, trump, level)! },
        { seat: 2, cards: followTriple4, parsed: parsePlay(followTriple4, trump, level)! },
        { seat: 3, cards: mk('C', '9', 3), parsed: parsePlay(mk('C', '9', 3), trump, level)! },
      ],
      trump,
      level,
    );
    assert.equal(singleBeaten.winnerSeat, 2);

    // Double 510K: disconnected triples [♠444, ♠888] do NOT beat; ONLY TRIPLE_TRACTOR(2) beats!
    const leadS2 = [...mk('S', '5', 2), ...mk('S', '10', 2), ...mk('S', 'K', 2)];
    const disconnTriples = [...mk('S', '4', 3), ...mk('S', '8', 3)];
    const tractor3_2 = [...mk('S', '6', 3), ...mk('S', '7', 3)];

    const dblCancelledOnly = resolveTrickWinner(
      [
        { seat: 0, cards: leadS2, parsed: parsePlay(leadS2, trump, level)! },
        { seat: 1, cards: disconnTriples, parsed: parsePlay(disconnTriples, trump, level)! },
        { seat: 2, cards: leadS2, parsed: parsePlay(leadS2, trump, level)! },
        { seat: 3, cards: mk('C', '4', 6), parsed: parsePlay(mk('C', '4', 6), trump, level)! },
      ],
      trump,
      level,
    );
    assert.equal(dblCancelledOnly.winnerSeat, 0);

    const dblBeaten = resolveTrickWinner(
      [
        { seat: 0, cards: leadS2, parsed: parsePlay(leadS2, trump, level)! },
        { seat: 1, cards: disconnTriples, parsed: parsePlay(disconnTriples, trump, level)! },
        { seat: 2, cards: tractor3_2, parsed: parsePlay(tractor3_2, trump, level)! },
        { seat: 3, cards: mk('C', '4', 6), parsed: parsePlay(mk('C', '4', 6), trump, level)! },
      ],
      trump,
      level,
    );
    assert.equal(dblBeaten.winnerSeat, 2);

    // Triple 510K: TRIPLE_TRACTOR(2)+single does NOT beat; ONLY TRIPLE_TRACTOR(3) beats!
    const leadS3 = [...mk('S', '5', 3), ...mk('S', '10', 3), ...mk('S', 'K', 3)];
    const tractor3_3 = [...mk('S', '6', 3), ...mk('S', '7', 3), ...mk('S', '8', 3)];
    const triBeaten = resolveTrickWinner(
      [
        { seat: 0, cards: leadS3, parsed: parsePlay(leadS3, trump, level)! },
        { seat: 1, cards: [...tractor3_2, ...mk('S', 'A', 3)], parsed: parsePlay([...tractor3_2, ...mk('S', 'A', 3)], trump, level)! },
        { seat: 2, cards: tractor3_3, parsed: parsePlay(tractor3_3, trump, level)! },
        { seat: 3, cards: mk('C', '4', 9), parsed: parsePlay(mk('C', '4', 9), trump, level)! },
      ],
      trump,
      level,
    );
    assert.equal(triBeaten.winnerSeat, 2);

    // Off-suit 510K killed by trump 510K and over-killed by trump TRIPLE
    const leadTrump510K = [...mk('D', '5'), ...mk('D', '10'), ...mk('D', 'K')];
    const trumpTriple = mk('D', '4', 3);
    const killed = resolveTrickWinner(
      [
        { seat: 0, cards: leadS1, parsed: parsePlay(leadS1, trump, level)! },
        { seat: 1, cards: followTriple4, parsed: parsePlay(followTriple4, trump, level)! },
        { seat: 2, cards: leadTrump510K, parsed: parsePlay(leadTrump510K, trump, level)! },
        { seat: 3, cards: trumpTriple, parsed: parsePlay(trumpTriple, trump, level)! },
      ],
      trump,
      level,
    );
    assert.equal(killed.winnerSeat, 3);
    assert.equal(killed.killedByTrump, true);
  });

  it('enforces largest trump penalty when following trump 510K (with full or partial cancellation)', () => {
    const trump = 'D' as const;
    const level = '2' as const;

    const leadTrumpSingle = parsePlay(
      [...mk('D', '5'), ...mk('D', '10'), ...mk('D', 'K')],
      trump,
      level,
    )!;
    const leadTrumpDouble = parsePlay(
      [...mk('D', '5', 2), ...mk('D', '10', 2), ...mk('D', 'K', 2)],
      trump,
      level,
    )!;

    const h5 = mk('H', '5');
    const bj = mk('J', 'BJ');
    const sj = mk('J', 'SJ');
    const d3 = mk('D', '3');
    const d9 = mk('D', '9');
    const d4Triple = mk('D', '4', 3);
    const d5 = mk('D', '5');
    const d10 = mk('D', '10');
    const dK = mk('D', 'K');

    const hand = [...h5, ...bj, ...sj, ...d3, ...d9, ...d4Triple, ...d5, ...d10, ...dK];

    // Single trump 510K:
    // Reject playing small trumps [d9, d4[0], d4[1]]
    assert.equal(
      validateFollowPlay(
        hand,
        [d9[0].id, d4Triple[0].id, d4Triple[1].id],
        leadTrumpSingle,
        trump,
        level,
      ).valid,
      false,
    );
    // Allow top 3 largest trumps [h5, bj, sj]
    assert.equal(
      validateFollowPlay(
        hand,
        [h5[0].id, bj[0].id, sj[0].id],
        leadTrumpSingle,
        trump,
        level,
      ).valid,
      true,
    );
    // Allow cancelling with trump 510K [d5, d10, dK]
    assert.equal(
      validateFollowPlay(
        hand,
        [d5[0].id, d10[0].id, dK[0].id],
        leadTrumpSingle,
        trump,
        level,
      ).valid,
      true,
    );
    // Allow beating with trump TRIPLE [d4, d4, d4]
    assert.equal(
      validateFollowPlay(
        hand,
        d4Triple.map((c) => c.id),
        leadTrumpSingle,
        trump,
        level,
      ).valid,
      true,
    );

    // Double trump 510K (6 cards):
    // Partial cancellation: 1 triple [d4, d4, d4] + top 3 remaining trumps [h5, bj, sj] -> VALID
    assert.equal(
      validateFollowPlay(
        hand,
        [...d4Triple.map((c) => c.id), h5[0].id, bj[0].id, sj[0].id],
        leadTrumpDouble,
        trump,
        level,
      ).valid,
      true,
    );
    // 1 triple [d4, d4, d4] + non-top [h5, bj, d9] (skipping sj) -> INVALID
    assert.equal(
      validateFollowPlay(
        hand,
        [...d4Triple.map((c) => c.id), h5[0].id, bj[0].id, d9[0].id],
        leadTrumpDouble,
        trump,
        level,
      ).valid,
      false,
    );
    // 1 triple [d4, d4, d4] + 1 trump 510K [d5, d10, dK] -> 2 exempt units -> VALID
    assert.equal(
      validateFollowPlay(
        hand,
        [...d4Triple.map((c) => c.id), d5[0].id, d10[0].id, dK[0].id],
        leadTrumpDouble,
        trump,
        level,
      ).valid,
      true,
    );

    // Legal candidates generator always produces valid options for trump 510K
    const candidates = findLegalFollowCards(hand, leadTrumpDouble, trump, level);
    assert.ok(candidates.length >= 1);
    for (const cand of candidates) {
      assert.equal(
        validateFollowPlay(hand, cand.map((c) => c.id), leadTrumpDouble, trump, level).valid,
        true,
      );
    }
  });
});
