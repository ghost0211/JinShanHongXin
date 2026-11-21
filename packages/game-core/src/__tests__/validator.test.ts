import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findLegalFollowCards,
  parsePlay,
  resolveTrickWinner,
  validateFollowPlay,
  validateLeadPlay,
} from '../index.js';
import type { Card } from '../index.js';

let idSeq = 1000;
function mk(suit: Card['suit'], rank: Card['rank'], count = 1): Card[] {
  const res: Card[] = [];
  for (let i = 0; i < count; i++) {
    res.push({ id: idSeq++, deck: (i % 3) as 0 | 1 | 2, suit, rank });
  }
  return res;
}

describe('follow-suit rules, sling validation, and trump kills', () => {
  it('enforces mandatory suit and pair for PAIR, but NO forced pair-padding for TRIPLE or TRIPLE_TRACTOR', () => {
    const trumpSuit = 'D' as const;
    const level = '2' as const;

    // Lead TRIPLE ♠AAA
    const leadTriple = parsePlay(mk('S', 'A', 3), trumpSuit, level)!;

    // Follower has NO ♠ triples, but DOES have pairs ♠KK and ♠QQ plus singles ♠9, ♠7
    const kPair = mk('S', 'K', 2);
    const qPair = mk('S', 'Q', 2);
    const s9 = mk('S', '9', 1);
    const s7 = mk('S', '7', 1);
    const handNoTriple = [...kPair, ...qPair, ...s9, ...s7];

    // Playing 3 unrelated singles [K, 9, 7] MUST be valid (NO forced pair-padding!)
    const followNoPair = validateFollowPlay(
      handNoTriple,
      [kPair[0].id, s9[0].id, s7[0].id],
      leadTriple,
      trumpSuit,
      level,
    );
    assert.equal(followNoPair.valid, true);

    // Now follower DOES have a triple ♠JJJ -> MUST play the triple!
    const jTriple = mk('S', 'J', 3);
    const handWithTriple = [...jTriple, ...kPair, ...s9];
    const breakTriple = validateFollowPlay(
      handWithTriple,
      [jTriple[0].id, jTriple[1].id, s9[0].id],
      leadTriple,
      trumpSuit,
      level,
    );
    assert.equal(breakTriple.valid, false);
    const playTriple = validateFollowPlay(
      handWithTriple,
      jTriple.map((c) => c.id),
      leadTriple,
      trumpSuit,
      level,
    );
    assert.equal(playTriple.valid, true);

    // Lead TRIPLE_TRACTOR ♠KKKAAA (6 cards). Follower has 1 triple ♠999 + pairs ♠JJ, ♠QQ, singles ♠7, ♠4.
    const leadTT = parsePlay(
      [...mk('S', 'K', 3), ...mk('S', 'A', 3)],
      trumpSuit,
      level,
    )!;
    const t9 = mk('S', '9', 3);
    const pJ = mk('S', 'J', 2);
    const pQ = mk('S', 'Q', 2);
    const s4 = mk('S', '4', 1);
    const handOneTriple = [...t9, ...pJ, ...pQ, ...s7, ...s4];

    // Follower plays ♠999 + [J, 7, 4] (NO pair padding for the second triple slot!) -> VALID
    const validTTFollow = validateFollowPlay(
      handOneTriple,
      [...t9.map((c) => c.id), pJ[0].id, s7[0].id, s4[0].id],
      leadTT,
      trumpSuit,
      level,
    );
    assert.equal(validTTFollow.valid, true);

    // Failing to play the 1 triple they DO have -> INVALID
    const invalidTTFollow = validateFollowPlay(
      handOneTriple,
      [...pJ.map((c) => c.id), ...pQ.map((c) => c.id), s7[0].id, s4[0].id],
      leadTT,
      trumpSuit,
      level,
    );
    assert.equal(invalidTTFollow.valid, false);
  });

  it('enforces mandatory tractor & pairs when following TRACTOR', () => {
    const leadTractor = parsePlay(
      [...mk('C', 'J', 2), ...mk('C', 'Q', 2)],
      'D',
      '2',
    )!;
    const c7 = mk('C', '7', 2);
    const c8 = mk('C', '8', 2);
    const c4 = mk('C', '4', 1);
    const c5 = mk('C', '5', 1);
    const hand = [...c7, ...c8, ...c4, ...c5];

    // Must play the 7788 tractor, cannot break it into [7, 8, 4, 5] or [7, 7, 4, 5]
    assert.equal(
      validateFollowPlay(
        hand,
        [c7[0].id, c7[1].id, c4[0].id, c5[0].id],
        leadTractor,
        'D',
        '2',
      ).valid,
      false,
    );
    assert.equal(
      validateFollowPlay(
        hand,
        [...c7.map((c) => c.id), ...c8.map((c) => c.id)],
        leadTractor,
        'D',
        '2',
      ).valid,
      true,
    );
  });

  it('validates SLING success and forces smallest beaten component on SLING failure', () => {
    const sAA = mk('S', 'A', 2);
    const sK = mk('S', 'K', 1);
    const s88 = mk('S', '8', 2);
    const hand = [...sAA, ...sK, ...s88];

    // Opponent holds ♠Q (beats ♠K? No, K > Q) and ♠99 (beats ♠88) and ♠J (no) -> beaten component is ♠88
    const opp1 = [...mk('S', '9', 2), ...mk('S', 'Q', 1)];
    const opp2 = mk('H', '4', 3);
    const opp3 = mk('C', '4', 3);

    const failRes = validateLeadPlay(
      hand,
      hand.map((c) => c.id),
      [opp1, opp2, opp3],
      'D',
      '2',
    );
    assert.equal(failRes.valid, true);
    assert.equal(failRes.slingFailed, true);
    assert.equal(failRes.effectiveCards?.length, 2);
    assert.equal(failRes.effectiveCards?.[0].rank, '8');

    // If no opponent can beat any component -> sling succeeds!
    const okRes = validateLeadPlay(
      hand,
      hand.map((c) => c.id),
      [mk('S', '4', 3), opp2, opp3],
      'D',
      '2',
    );
    assert.equal(okRes.valid, true);
    assert.equal(okRes.slingFailed, false);
    assert.equal(okRes.effectiveCards?.length, 5);
  });

  it('resolves trump kill (毙牌) and over-kill (盖毙) correctly, including equal-rank first-played wins', () => {
    const trumpSuit = 'D' as const;
    const level = '2' as const;

    const leadCards = [...mk('S', 'Q', 2), ...mk('S', 'K', 2)]; // ♠QQKK tractor
    const padCards = [...mk('D', '4', 2), ...mk('D', '8', 1), ...mk('D', '9', 1)]; // NOT a trump tractor!
    const kill1Cards = [...mk('D', '6', 2), ...mk('D', '7', 2)]; // valid trump tractor
    const kill2Cards = [...mk('J', 'SJ', 2), ...mk('D', '3', 2)]; // bigger trump tractor (SJ + 正参谋)

    const p0 = { seat: 0 as const, cards: leadCards, parsed: parsePlay(leadCards, trumpSuit, level)! };
    const p1 = { seat: 1 as const, cards: padCards, parsed: parsePlay(padCards, trumpSuit, level)! };
    const p2 = { seat: 2 as const, cards: kill1Cards, parsed: parsePlay(kill1Cards, trumpSuit, level)! };
    const p3 = { seat: 3 as const, cards: kill2Cards, parsed: parsePlay(kill2Cards, trumpSuit, level)! };

    const res1 = resolveTrickWinner([p0, p1, p2, p3], trumpSuit, level);
    assert.equal(res1.winnerSeat, 3);
    assert.equal(res1.killedByTrump, true);

    // Unmatched trump pad does NOT kill lead
    const sPad2 = [...mk('S', '4', 2), ...mk('S', '6', 2)];
    const cKPad = [...mk('C', 'K', 3), ...mk('C', '9', 1)];
    const resPad = resolveTrickWinner(
      [
        p0,
        p1,
        { seat: 2 as const, cards: sPad2, parsed: parsePlay(sPad2, trumpSuit, level)! },
        { seat: 3 as const, cards: cKPad, parsed: parsePlay(cKPad, trumpSuit, level)! },
      ],
      trumpSuit,
      level,
    );
    assert.equal(resPad.winnerSeat, 0);
    assert.equal(resPad.killedByTrump, false);
    assert.equal(resPad.pointsInTrick, 50); // 2*S_K(20) + 3*C_K(30) = 50

    // Same off-suit level card played later does NOT beat first-played off-suit level card
    const leadS2 = parsePlay(mk('S', '2', 1), trumpSuit, level)!;
    const followH2 = parsePlay(mk('H', '2', 1), trumpSuit, level)!;
    const sameTier = resolveTrickWinner(
      [
        { seat: 0, cards: leadS2.cards, parsed: leadS2 },
        { seat: 1, cards: followH2.cards, parsed: followH2 },
        { seat: 2, cards: mk('D', '4', 1), parsed: parsePlay(mk('D', '4', 1), trumpSuit, level)! },
        { seat: 3, cards: mk('D', '7', 1), parsed: parsePlay(mk('D', '7', 1), trumpSuit, level)! },
      ],
      trumpSuit,
      level,
    );
    assert.equal(sameTier.winnerSeat, 0);

    // findLegalFollowCards always produces valid options
    const sampleFollows = findLegalFollowCards(
      [...mk('S', 'A', 2), ...mk('S', '5', 1), ...mk('H', '10', 1)],
      parsePlay(mk('S', 'Q', 2), trumpSuit, level)!,
      trumpSuit,
      level,
    );
    assert.ok(sampleFollows.length >= 1);
  });
});
