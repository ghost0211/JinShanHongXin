import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  findLegalFollowCards,
  parsePlay,
  resolveTrickWinner,
  validateFollowPlay,
  validateLeadPlay,
} from '../index.js';
import type { Card, LevelRank, ParsedPlay, Seat, StandardSuit } from '../index.js';
import { cards, ids, parsed, pick, trick } from './audit-helpers.js';

function win(
  t: StandardSuit | null,
  l: LevelRank,
  plays: Array<[Seat, Card[]]>,
  leadOverride?: ParsedPlay,
): Seat {
  const tp = plays.map(([s, cs], i): [Seat, Card[], ParsedPlay] => [
    s,
    cs,
    i === 0 && leadOverride ? leadOverride : parsePlay(cs, t, l) ?? {
      patternType: 'SLING',
      category: 'TRUMP',
      cards: cs,
      components: [],
    },
  ]);
  return resolveTrickWinner(trick(tp), t, l).winnerSeat;
}

describe('AUDIT B4: 510K parsing & borrowing (step 143)', () => {
  it('5+10+K of one suit → 单/双/三 510K; wrong counts / mixed suits are not 510K', () => {
    assert.equal(parsePlay(cards('S:5 S:10 S:K'), 'D', '2')?.patternType, 'F510K');
    const d = parsePlay(cards('S:5*2 S:10*2 S:K*2'), 'D', '2')!;
    assert.equal(d.patternType, 'F510K');
    assert.equal(d.components[0].length, 2);
    assert.equal(parsePlay(cards('S:5*3 S:10*3 S:K*3'), 'D', '2')?.components[0].length, 3);
    assert.notEqual(parsePlay(cards('S:5*2 S:10 S:K*3'), 'D', '2')?.patternType, 'F510K');
    assert.equal(parsePlay(cards('S:5 C:10 S:K'), 'D', '2'), null);
  });

  it('borrowing: ♥5 (♥ not trump), level 10 (打10), level K (打K) still form a SIDE 510K', () => {
    assert.equal(parsePlay(cards('H:5 H:10 H:K'), 'S', '2')?.category, 'H');
    assert.equal(parsePlay(cards('H:5 H:10 H:K'), null, '2')?.category, 'H');
    assert.equal(parsePlay(cards('C:5 C:10 C:K'), 'S', '10')?.category, 'C');
    assert.equal(parsePlay(cards('H:5 H:10 H:K'), 'S', 'K')?.category, 'H');
    // trump-suit 510K is TRUMP (incl. ♥ trump with the red five)
    assert.equal(parsePlay(cards('H:5 H:10 H:K'), 'H', '2')?.category, 'TRUMP');
    assert.equal(parsePlay(cards('S:5 S:10 S:K'), 'S', '10')?.category, 'TRUMP');
    // a 510K lead is always legal (no sling check)
    const hand = cards('H:5 H:10 H:K');
    const res = validateLeadPlay(hand, ids(hand), [cards('H:A*3'), cards('J:BJ*3'), cards('S:4')], 'S', '10');
    assert.equal(res.valid, true);
    assert.equal(res.slingFailed, false);
  });

  it('borrowed trump cards may be used ONLY to complete a 510K when following', () => {
    // 打10 主♦: lead ♠510K; follower holds ♠10 (trump) + 3 side spades
    const lead = parsed(cards('S:5 S:10 S:K'), 'D', '10');
    const hand = cards('S:5 S:10 S:K S:A S:9');
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'S:5 S:10 S:K')), lead, 'D', '10').valid, true);
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'S:5 S:A S:9')), lead, 'D', '10').valid, true);
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'S:10 S:A S:9')), lead, 'D', '10').valid, false);
  });
});

describe('AUDIT B4: side 510K beating / offsetting', () => {
  const t: StandardSuit = 'D';
  const l: LevelRank = '2';
  it('单510K: only a same-suit triple beats; another 510K / pairs / higher singles do not', () => {
    const lead = cards('S:5 S:10 S:K');
    assert.equal(win(t, l, [[0, lead], [1, cards('S:4*3')]]), 1, 'even a small triple beats 510K');
    assert.equal(win(t, l, [[0, lead], [1, cards('S:5 S:10 S:K')]]), 0, 'same 510K only offsets');
    assert.equal(win(t, l, [[0, lead], [1, cards('S:A*2 S:Q')]]), 0);
    assert.equal(win(t, l, [[0, lead], [1, cards('S:A S:Q S:J')]]), 0);
    assert.equal(win(t, l, [[0, lead], [1, cards('S:4*3')], [2, cards('S:A*3')]]), 2, 'bigger triple over triple');
  });

  it('void follower kills with trump triple or trump 510K; trump triple > trump 510K; random trumps do not kill', () => {
    const lead = cards('S:5 S:10 S:K');
    assert.equal(win(t, l, [[0, lead], [1, cards('D:4*3')]]), 1);
    assert.equal(win(t, l, [[0, lead], [1, cards('D:5 D:10 D:K')]]), 1);
    assert.equal(win(t, l, [[0, lead], [1, cards('D:5 D:10 D:K')], [2, cards('D:4*3')]]), 2);
    assert.equal(win(t, l, [[0, lead], [1, cards('J:BJ H:5 J:SJ')]]), 0);
    // follower who still holds spades may not kill with a trump triple
    const hand = cards('S:4 D:4*3');
    assert.equal(
      validateFollowPlay(hand, ids(pick(hand, 'D:4*3')), parsed(lead, t, l), t, l).valid,
      false,
    );
  });

  it('双510K: only a same-suit 2-connected triple tractor beats; loose triples / double 510K only offset', () => {
    const lead = cards('S:5*2 S:10*2 S:K*2');
    assert.equal(win(t, l, [[0, lead], [1, cards('S:3*3 S:4*3')]]), 1);
    assert.equal(win(t, l, [[0, lead], [1, cards('S:4*3 S:9*3')]]), 0);
    assert.equal(win(t, l, [[0, lead], [1, cards('S:5*2 S:10*2 S:K*2')]]), 0);
    // A=1 triple tractor counts as connected (打2 主♦: ♠AAA333)
    assert.equal(win(t, l, [[0, lead], [1, cards('S:A*3 S:3*3')]]), 1);
  });

  it('三510K: only a same-suit 3-connected triple tractor beats', () => {
    const lead = cards('S:5*3 S:10*3 S:K*3');
    assert.equal(win(t, l, [[0, lead], [1, cards('S:3*3 S:4*3 S:6*3')]]), 0, '♠5 is not extracted: 4-6 not adjacent');
    assert.equal(win(t, l, [[0, lead], [1, cards('S:6*3 S:7*3 S:8*3')]]), 1);
    assert.equal(win(t, l, [[0, lead], [1, cards('S:6*3 S:7*3 S:9*3')]]), 0);
  });
});

describe('AUDIT B4: TRUMP 510K special rule (出 3 张最大的牌)', () => {
  const t: StandardSuit = 'S';
  const l: LevelRank = '2';
  const leadCards = cards('S:5 S:10 S:K');
  const lead = parsed(leadCards, t, l);

  it('without triple/510K the follower must play his 3 biggest trumps', () => {
    const hand = cards('H:5 J:BJ J:SJ S:A S:4 S:6 H:9');
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'H:5 J:BJ J:SJ')), lead, t, l).valid, true);
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'S:A S:4 S:6')), lead, t, l).valid, false);
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'H:5 J:BJ S:4')), lead, t, l).valid, false);
    // ties on the 3rd card (副级 同阶) – any of them is OK
    const tie = cards('J:BJ J:SJ H:2 C:2 S:4');
    assert.equal(validateFollowPlay(tie, ids(pick(tie, 'J:BJ J:SJ C:2')), lead, t, l).valid, true);
    assert.equal(validateFollowPlay(tie, ids(pick(tie, 'J:BJ J:SJ H:2')), lead, t, l).valid, true);
    // ≤3 trumps: play them all
    const few = cards('S:4 S:6 H:9 H:8');
    assert.equal(validateFollowPlay(few, ids(pick(few, 'S:4 S:6 H:9')), lead, t, l).valid, true);
    assert.equal(validateFollowPlay(few, ids(pick(few, 'S:4 H:9 H:8')), lead, t, l).valid, false);
    // findLegalFollowCards suggests only legal plays
    for (const o of findLegalFollowCards(hand, lead, t, l)) {
      assert.equal(validateFollowPlay(hand, ids(o), lead, t, l).valid, true);
    }
  });

  it('triple (beats) or trump 510K (offsets) may be played instead; winner resolution', () => {
    const hand = cards('H:5 J:BJ S:4*3 S:5 S:10 S:K');
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'S:4*3')), lead, t, l).valid, true);
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'S:5 S:10 S:K')), lead, t, l).valid, true);
    assert.equal(win(t, l, [[0, leadCards], [1, cards('S:4*3')]]), 1);
    assert.equal(win(t, l, [[0, leadCards], [1, cards('S:5 S:10 S:K')]]), 0);
    assert.equal(win(t, l, [[0, leadCards], [1, cards('H:5 J:BJ J:SJ')]]), 0, 'forced big cards do not win');
  });

  it('双主510K: TT(2) beats; one triple/510K offsets one unit, the remaining 3 must be the biggest', () => {
    const dLead = cards('S:5*2 S:10*2 S:K*2');
    const dl = parsed(dLead, t, l);
    const hand = cards('H:5 J:BJ J:SJ S:7*3 S:A S:4');
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'S:7*3 H:5 J:BJ J:SJ')), dl, t, l).valid, true);
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'S:7*3 S:A S:4 J:SJ')), dl, t, l).valid, false);
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'H:5 J:BJ J:SJ S:A S:7*2')), dl, t, l).valid, true, 'top-6');
    assert.equal(win(t, l, [[0, dLead], [1, cards('S:7*3 S:8*3')]]), 1);
    assert.equal(win(t, l, [[0, dLead], [1, cards('S:7*3 S:9*3')]]), 0);
  });
});

describe('AUDIT B5: 打黑心 (fixed level 10) shares the same pattern rules', () => {
  const t: StandardSuit = 'S';
  const l: LevelRank = '10';
  it('10 extracted: ♦99+♦JJ is a tractor; side 510K borrows the trump 10; trump 510K special rule applies', () => {
    assert.equal(parsePlay(cards('D:9*2 D:J*2'), t, l)?.patternType, 'TRACTOR');
    assert.equal(parsePlay(cards('D:5 D:10 D:K'), t, l)?.category, 'D');
    assert.equal(parsePlay(cards('S:5 S:10 S:K'), t, l)?.category, 'TRUMP');
    // 主10 > 副10 (同阶) > 主A
    assert.equal(parsePlay(cards('S:A*2 D:10*2 S:10*2'), t, l)?.patternType, 'TRACTOR');
    assert.equal(parsePlay(cards('D:10*2 H:10*2'), t, l)?.patternType, 'SLING');
  });
});

describe('AUDIT B4 (pending user confirmation – documents CURRENT behaviour)', () => {
  it('[待确认] side 510K lead: follower holding a same-suit triple is NOT forced to play it', () => {
    const lead = parsed(cards('S:5 S:10 S:K'), 'D', '2');
    const hand = cards('S:4*3 S:9 S:7');
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'S:4 S:9 S:7')), lead, 'D', '2').valid, true);
  });

  it('[待确认] trump 510K lead: holding a triple, playing the 3 biggest trumps is still allowed', () => {
    const lead = parsed(cards('S:5 S:10 S:K'), 'S', '2');
    const hand = cards('H:5 J:BJ J:SJ S:4*3');
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'H:5 J:BJ J:SJ')), lead, 'S', '2').valid, true);
  });

  it('[待确认] trump 510K lead with < 3 trumps: fillers are free (not forced to be biggest side cards)', () => {
    const lead = parsed(cards('S:5 S:10 S:K'), 'S', '2');
    const hand = cards('J:BJ H:A H:4 C:3');
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'J:BJ H:4 C:3')), lead, 'S', '2').valid, true);
  });

  it('[待确认] 打10: ♠10×3 is a TRUMP triple, cannot be used as a same-suit beater of ♠510K while holding side spades', () => {
    const lead = parsed(cards('S:5 S:10 S:K'), 'D', '10');
    const hand = cards('S:10*3 S:4 S:6 S:7');
    assert.equal(validateFollowPlay(hand, ids(pick(hand, 'S:10*3')), lead, 'D', '10').valid, false);
  });
});
