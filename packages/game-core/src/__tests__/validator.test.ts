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
  it('enforces ONLY same-category count (NO forced pair, triple, tractor, or triple-tractor follow)', () => {
    const trumpSuit = 'D' as const;
    const level = '2' as const;

    // 1. Lead PAIR ♠QQ -> follower holding pair ♠KK & triple ♠JJJ may play ANY 2 spades!
    const leadPair = parsePlay(mk('S', 'Q', 2), trumpSuit, level)!;
    const kPair = mk('S', 'K', 2);
    const jTriple = mk('S', 'J', 3);
    const s9 = mk('S', '9', 1);
    const s7 = mk('S', '7', 1);
    const h4 = mk('H', '4', 2);
    const hand = [...kPair, ...jTriple, ...s9, ...s7, ...h4];

    assert.equal(
      validateFollowPlay(hand, [s9[0].id, s7[0].id], leadPair, trumpSuit, level).valid,
      true,
    );
    // Must still follow spades when holding spades (cannot play hearts!)
    assert.equal(
      validateFollowPlay(hand, [h4[0].id, h4[1].id], leadPair, trumpSuit, level).valid,
      false,
    );

    // 2. Lead TRIPLE ♠AAA -> follower holding triple ♠JJJ may still keep it and play any 3 spades
    const leadTriple = parsePlay(mk('S', 'A', 3), trumpSuit, level)!;
    assert.equal(
      validateFollowPlay(hand, [kPair[0].id, s9[0].id, s7[0].id], leadTriple, trumpSuit, level).valid,
      true,
    );

    // 3. Lead TRACTOR ♣JJQQ -> follower holding tractor ♣7788 may still play any 4 clubs freely
    const leadTractor = parsePlay([...mk('C', 'J', 2), ...mk('C', 'Q', 2)], 'D', '2')!;
    const c7 = mk('C', '7', 2);
    const c8 = mk('C', '8', 2);
    const c4 = mk('C', '4', 1);
    const c5 = mk('C', '5', 1);
    const clubHand = [...c7, ...c8, ...c4, ...c5];
    assert.equal(
      validateFollowPlay(
        clubHand,
        [c7[0].id, c8[0].id, c4[0].id, c5[0].id],
        leadTractor,
        'D',
        '2',
      ).valid,
      true,
    );

    // 4. Lead TRIPLE_TRACTOR ♠KKKAAA -> follower holding ♠999 + ♠JJ + singles may play any 6 spades
    const leadTT = parsePlay([...mk('S', 'K', 3), ...mk('S', 'A', 3)], trumpSuit, level)!;
    assert.equal(
      validateFollowPlay(
        hand,
        [kPair[0].id, kPair[1].id, jTriple[0].id, jTriple[1].id, s9[0].id, s7[0].id],
        leadTT,
        trumpSuit,
        level,
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

  it('decomposes SLING optimally with F510K (e.g., ♦A + ♦510K succeeds when opponents lack ♦ triples)', () => {
    const trumpSuit = 'S' as const;
    const level = '2' as const;

    // 1. Classic user case: ♦A + ♦5 + ♦10 + ♦K -> MUST decompose as [F510K, SINGLE(♦A)], NOT 4 singles!
    const dA = mk('D', 'A', 1);
    const d5 = mk('D', '5', 1);
    const d10 = mk('D', '10', 1);
    const dK = mk('D', 'K', 1);
    const slingCards = [...dA, ...d5, ...d10, ...dK];

    const parsed = parsePlay(slingCards, trumpSuit, level);
    assert.ok(parsed);
    assert.equal(parsed.patternType, 'SLING');
    assert.equal(parsed.category, 'D');
    assert.equal(parsed.components.some((c) => c.type === 'F510K' && c.length === 1), true);
    assert.equal(parsed.components.some((c) => c.type === 'SINGLE' && c.cards[0].rank === 'A'), true);

    // Opponent holds ♦6, ♦7, ♦K (beats single ♦5, but has NO ♦ triple and cannot beat ♦A) -> MUST SUCCEED!
    const oppWithSix = [...mk('D', '6', 1), ...mk('D', '7', 1), ...mk('D', 'K', 1)];
    const okSling = validateLeadPlay(
      slingCards,
      slingCards.map((c) => c.id),
      [oppWithSix, mk('H', '4', 2), mk('C', '4', 2)],
      trumpSuit,
      level,
    );
    assert.equal(okSling.valid, true);
    assert.equal(okSling.slingFailed, false);
    assert.equal(okSling.effectiveCards?.length, 4);

    // 2. Sling ♦Q + ♦510K when opponent has ♦K (beats ♦Q) but NO triple -> fails with ♦Q, NOT ♦5!
    const dQ = mk('D', 'Q', 1);
    const qSling = [...dQ, ...d5, ...d10, ...dK];
    const failQ = validateLeadPlay(
      qSling,
      qSling.map((c) => c.id),
      [oppWithSix, mk('H', '4', 2), mk('C', '4', 2)],
      trumpSuit,
      level,
    );
    assert.equal(failQ.valid, true);
    assert.equal(failQ.slingFailed, true);
    assert.equal(failQ.effectiveCards?.length, 1);
    assert.equal(failQ.effectiveCards?.[0].rank, 'Q');

    // 3. Off-suit borrowed sling: ♥A + ♥5 + ♥10 + ♥K when trump is ♠ (borrows ♥5)
    const hSling = [...mk('H', 'A', 1), ...mk('H', '5', 1), ...mk('H', '10', 1), ...mk('H', 'K', 1)];
    const hRes = validateLeadPlay(
      hSling,
      hSling.map((c) => c.id),
      [mk('H', '8', 2), mk('C', '4', 2), mk('D', '4', 2)],
      'S',
      '2',
    );
    assert.equal(hRes.valid, true);
    assert.equal(hRes.slingFailed, false);
    assert.equal(hRes.parsed?.category, 'H');

    // 4. Void follower can trump-kill ♦A + ♦510K with trump TRIPLE + trump SINGLE
    const killCards = [...mk('S', '9', 3), ...mk('S', '4', 1)];
    const killCheck = validateFollowPlay(
      killCards,
      killCards.map((c) => c.id),
      okSling.parsed!,
      trumpSuit,
      level,
    );
    assert.equal(killCheck.valid, true);
    assert.equal(killCheck.matchedTrumpKill, true);
    const trickWin = resolveTrickWinner(
      [
        { seat: 0, cards: slingCards, parsed: okSling.parsed! },
        { seat: 1, cards: killCards, parsed: killCheck.parsed! },
      ],
      trumpSuit,
      level,
    );
    assert.equal(trickWin.winnerSeat, 1);
    assert.equal(trickWin.killedByTrump, true);
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

  it('resolves composite sling over-kills by max single-component card count and max-only ties to first-played', () => {
    const trumpSuit = 'D' as const;
    const level = '2' as const;

    // 1. 3-single sling: ♥5 + 2 small trumps is UNBEATABLE even against ♥5 + BJ + SJ!
    const lead3Singles = [...mk('S', 'A', 1), ...mk('S', 'K', 1), ...mk('S', 'Q', 1)];
    const killA = [...mk('H', '5', 1), ...mk('D', '4', 1), ...mk('D', '6', 1)];
    const killB = [...mk('H', '5', 1), ...mk('J', 'BJ', 1), ...mk('J', 'SJ', 1)];
    const rSingles = resolveTrickWinner(
      [
        { seat: 0, cards: lead3Singles, parsed: parsePlay(lead3Singles, trumpSuit, level)! },
        { seat: 1, cards: killA, parsed: parsePlay(killA, trumpSuit, level)! },
        { seat: 2, cards: killB, parsed: parsePlay(killB, trumpSuit, level)! },
      ],
      trumpSuit,
      level,
    );
    assert.equal(rSingles.winnerSeat, 1);

    // 2. 3-pair sling (non-adjacent ♠AA + ♠QQ + ♠99): ♥55 + 2 small trump pairs holds against ♥55 + BJ×2 + SJ×2!
    const lead3Pairs = [...mk('S', 'A', 2), ...mk('S', 'Q', 2), ...mk('S', '9', 2)];
    const parsed3Pairs = parsePlay(lead3Pairs, trumpSuit, level)!;
    assert.equal(parsed3Pairs.components.length, 3);
    assert.equal(parsed3Pairs.components.every((c) => c.type === 'PAIR'), true);
    const pairKillA = [...mk('H', '5', 2), ...mk('D', '4', 2), ...mk('D', '6', 2)];
    const pairKillB = [...mk('H', '5', 2), ...mk('J', 'BJ', 2), ...mk('J', 'SJ', 2)];
    const rPairs = resolveTrickWinner(
      [
        { seat: 0, cards: lead3Pairs, parsed: parsed3Pairs },
        { seat: 1, cards: pairKillA, parsed: parsePlay(pairKillA, trumpSuit, level)! },
        { seat: 2, cards: pairKillB, parsed: parsePlay(pairKillB, trumpSuit, level)! },
      ],
      trumpSuit,
      level,
    );
    assert.equal(rPairs.winnerSeat, 1);

    // 3. Mixed 1-pair + 1-single: 2-card pair decides (ignores single ♥5!), tied pair goes to first-played
    const leadPairSingle = [...mk('S', 'A', 2), ...mk('S', 'K', 1)];
    const psSmallPairH5 = [...mk('D', '4', 2), ...mk('H', '5', 1)];
    const psBigPairLow = [...mk('J', 'BJ', 2), ...mk('D', '6', 1)];
    const rMixed1 = resolveTrickWinner(
      [
        { seat: 0, cards: leadPairSingle, parsed: parsePlay(leadPairSingle, trumpSuit, level)! },
        { seat: 1, cards: psSmallPairH5, parsed: parsePlay(psSmallPairH5, trumpSuit, level)! },
        { seat: 2, cards: psBigPairLow, parsed: parsePlay(psBigPairLow, trumpSuit, level)! },
      ],
      trumpSuit,
      level,
    );
    assert.equal(rMixed1.winnerSeat, 2);

    const psTieA = [...mk('H', '5', 2), ...mk('D', '4', 1)];
    const psTieB = [...mk('H', '5', 2), ...mk('J', 'BJ', 1)];
    const rMixedTie = resolveTrickWinner(
      [
        { seat: 0, cards: leadPairSingle, parsed: parsePlay(leadPairSingle, trumpSuit, level)! },
        { seat: 1, cards: psTieA, parsed: parsePlay(psTieA, trumpSuit, level)! },
        { seat: 2, cards: psTieB, parsed: parsePlay(psTieB, trumpSuit, level)! },
      ],
      trumpSuit,
      level,
    );
    assert.equal(rMixedTie.winnerSeat, 1);

    // 4. Mixed 2-pair tractor (4 cards) + triple (3 cards): 4-card tractor decides over 3-card triple!
    const leadTractTrip = [...mk('S', 'Q', 2), ...mk('S', 'K', 2), ...mk('S', '9', 3)];
    const ttSmallTractBigTrip = [...mk('D', '6', 2), ...mk('D', '7', 2), ...mk('H', '5', 3)];
    const ttBigTractSmallTrip = [...mk('J', 'SJ', 2), ...mk('D', '3', 2), ...mk('D', '4', 3)];
    const rTractTrip = resolveTrickWinner(
      [
        { seat: 0, cards: leadTractTrip, parsed: parsePlay(leadTractTrip, trumpSuit, level)! },
        { seat: 1, cards: ttSmallTractBigTrip, parsed: parsePlay(ttSmallTractBigTrip, trumpSuit, level)! },
        { seat: 2, cards: ttBigTractSmallTrip, parsed: parsePlay(ttBigTractSmallTrip, trumpSuit, level)! },
      ],
      trumpSuit,
      level,
    );
    assert.equal(rTractTrip.winnerSeat, 2);

    // 5. Same-card-count incomparable families: 3-pair tractor (6 cards) + 2-triple tractor (6 cards)
    //    Neither family outranks the other: over-killer must be >= in BOTH and > in at least one!
    const lead66 = [
      ...mk('S', '4', 2), ...mk('S', '5', 2), ...mk('S', '6', 2), // 3-pair tractor (6)
      ...mk('S', 'Q', 3), ...mk('S', 'K', 3),                     // 2-triple tractor (6)
    ];
    const k66A = [
      ...mk('D', '8', 2), ...mk('D', '9', 2), ...mk('D', '10', 2), // medium 3-pair
      ...mk('D', '6', 3), ...mk('D', '7', 3),                      // low 2-triple
    ];
    const k66MixedFail = [
      ...mk('D', '4', 2), ...mk('D', '5', 2), ...mk('D', '6', 2), // LOWER 3-pair!
      ...mk('J', 'SJ', 3), ...mk('J', 'BJ', 3),                    // HUGE 2-triple
    ];
    const r66NoOverkill = resolveTrickWinner(
      [
        { seat: 0, cards: lead66, parsed: parsePlay(lead66, trumpSuit, level)! },
        { seat: 1, cards: k66A, parsed: parsePlay(k66A, trumpSuit, level)! },
        { seat: 2, cards: k66MixedFail, parsed: parsePlay(k66MixedFail, trumpSuit, level)! },
      ],
      trumpSuit,
      level,
    );
    assert.equal(r66NoOverkill.winnerSeat, 1);

    const k66DomWin = [
      ...mk('D', '8', 2), ...mk('D', '9', 2), ...mk('D', '10', 2), // EQUAL 3-pair
      ...mk('J', 'SJ', 3), ...mk('J', 'BJ', 3),                    // GREATER 2-triple
    ];
    const r66Overkill = resolveTrickWinner(
      [
        { seat: 0, cards: lead66, parsed: parsePlay(lead66, trumpSuit, level)! },
        { seat: 1, cards: k66A, parsed: parsePlay(k66A, trumpSuit, level)! },
        { seat: 2, cards: k66DomWin, parsed: parsePlay(k66DomWin, trumpSuit, level)! },
      ],
      trumpSuit,
      level,
    );
    assert.equal(r66Overkill.winnerSeat, 2);
  });
});
