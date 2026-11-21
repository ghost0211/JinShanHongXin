import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlay } from '../index.js';
import type { Card } from '../index.js';

let nextId = 1;
function mk(suit: Card['suit'], rank: Card['rank'], count = 1): Card[] {
  const res: Card[] = [];
  for (let i = 0; i < count; i++) {
    res.push({ id: nextId++, deck: (i % 3) as 0 | 1 | 2, suit, rank });
  }
  return res;
}

describe('patterns, tractors, and A=1 exception', () => {
  it('recognizes SINGLE, PAIR, TRIPLE, TRACTOR, TRIPLE_TRACTOR, SLING', () => {
    assert.equal(parsePlay(mk('S', 'A', 1), 'D', '2')?.patternType, 'SINGLE');
    assert.equal(parsePlay(mk('S', 'A', 2), 'D', '2')?.patternType, 'PAIR');
    assert.equal(parsePlay(mk('S', 'A', 3), 'D', '2')?.patternType, 'TRIPLE');
    assert.equal(
      parsePlay([...mk('S', '8', 2), ...mk('S', '9', 2)], 'D', '2')?.patternType,
      'TRACTOR',
    );
    assert.equal(
      parsePlay([...mk('S', '8', 3), ...mk('S', '9', 3)], 'D', '2')?.patternType,
      'TRIPLE_TRACTOR',
    );
    assert.equal(
      parsePlay([...mk('S', 'A', 2), ...mk('S', '9', 1)], 'D', '2')?.patternType,
      'SLING',
    );
    // Mixing categories is invalid
    assert.equal(
      parsePlay([...mk('S', 'A', 1), ...mk('H', 'A', 1)], 'D', '2'),
      null,
    );
  });

  it('supports A=1 connecting to the lowest normal rank (including ♦AA♦44 and ♥AA♥44♥66 when playing 2 with ♦ trump)', () => {
    // Playing 2, ♦ trump -> ♦3 is 正参谋, ♦2 is 正级牌 -> ♦4 is lowest normal trump
    const dAA44 = parsePlay([...mk('D', 'A', 2), ...mk('D', '4', 2)], 'D', '2');
    assert.equal(dAA44?.patternType, 'TRACTOR');
    assert.equal(dAA44?.components[0].usedLowAce, true);
    assert.equal(dAA44?.components[0].topOrder, 0);

    // ♥ is off-suit when ♦ is trump: ♥2 level, ♥3 副参谋, ♥5 红五 -> lowest normal ♥ is ♥4, next is ♥6
    const hAA4466 = parsePlay(
      [...mk('H', 'A', 2), ...mk('H', '4', 2), ...mk('H', '6', 2)],
      'D',
      '2',
    );
    assert.equal(hAA4466?.patternType, 'TRACTOR');
    assert.equal(hAA4466?.components[0].length, 3);
    assert.equal(hAA4466?.components[0].usedLowAce, true);

    // ♠ is opposite color off-suit: ♠2 is level, ♠3 is lowest normal rank
    const sAA33 = parsePlay([...mk('S', 'A', 2), ...mk('S', '3', 2)], 'D', '2');
    assert.equal(sAA33?.patternType, 'TRACTOR');
    assert.equal(sAA33?.components[0].usedLowAce, true);

    // Also works for TRIPLE_TRACTOR
    const hTripleAA44 = parsePlay(
      [...mk('H', 'A', 3), ...mk('H', '4', 3)],
      'D',
      '2',
    );
    assert.equal(hTripleAA44?.patternType, 'TRIPLE_TRACTOR');

    // Ordering: ♥AA♥44 < ♥44♥66 < ♥KK♥AA
    const h4466 = parsePlay([...mk('H', '4', 2), ...mk('H', '6', 2)], 'D', '2')!;
    const hKKAA = parsePlay([...mk('H', 'K', 2), ...mk('H', 'A', 2)], 'D', '2')!;
    assert.ok(dAA44!.components[0].topOrder < h4466.components[0].topOrder);
    assert.ok(h4466.components[0].topOrder < hKKAA.components[0].topOrder);
  });

  it('forbids A=1 wrap-around and disables A=1 when playing A', () => {
    // KKAA44 must NOT be a single 3-pair tractor
    const wrap = parsePlay(
      [...mk('D', 'K', 2), ...mk('D', 'A', 2), ...mk('D', '4', 2)],
      'D',
      '2',
    );
    assert.equal(wrap?.patternType, 'SLING');
    assert.equal(wrap?.components[0].type, 'TRACTOR');
    assert.equal(wrap?.components[0].length, 2);

    // Playing A: A is trump level, NOT acting as 1 in off-suit
    const playingA = parsePlay([...mk('S', 'A', 2), ...mk('S', '2', 2)], 'D', 'A');
    assert.equal(playingA, null); // mixed TRUMP (♠A) and S (♠2)
  });

  it('enforces exact tier adjacency for 常主 and forbids equal-tier off-suit level pairs from forming tractors', () => {
    // ♥55 + BJBJ = TRACTOR
    assert.equal(
      parsePlay([...mk('H', '5', 2), ...mk('J', 'BJ', 2)], 'D', '6')?.patternType,
      'TRACTOR',
    );
    // 正参谋 + 副参谋 = TRACTOR
    assert.equal(
      parsePlay([...mk('D', '3', 2), ...mk('H', '3', 2)], 'D', '6')?.patternType,
      'TRACTOR',
    );
    // 副参谋 + 正级牌 = TRACTOR
    assert.equal(
      parsePlay([...mk('H', '3', 2), ...mk('D', '6', 2)], 'D', '6')?.patternType,
      'TRACTOR',
    );
    // 正级牌 + 副级牌 = TRACTOR
    assert.equal(
      parsePlay([...mk('D', '6', 2), ...mk('S', '6', 2)], 'D', '6')?.patternType,
      'TRACTOR',
    );
    // Two DIFFERENT off-suit level pairs share equal tier -> SLING, NOT TRACTOR
    const twoOffLevel = parsePlay(
      [...mk('S', '6', 2), ...mk('C', '6', 2)],
      'D',
      '6',
    );
    assert.equal(twoOffLevel?.patternType, 'SLING');
    assert.equal(twoOffLevel?.components.length, 2);
    assert.equal(twoOffLevel?.components[0].type, 'PAIR');
    assert.equal(twoOffLevel?.components[1].type, 'PAIR');

    // Non-adjacent normal cards cannot be padded into tractor (♠44 + ♠66 when playing 2)
    const gap = parsePlay([...mk('S', '4', 2), ...mk('S', '6', 2)], 'D', '2');
    assert.equal(gap?.patternType, 'SLING');
  });
});
