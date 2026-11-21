import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  countBipai,
  createThreeDecks,
  getCardCategory,
  getCardOrder,
  getCardPoints,
  isBipaiCard,
  isRedFive,
  isTrump,
  LEVEL_SEQUENCE,
} from '../index.js';
import type { Card, StandardSuit } from '../index.js';

function card(suit: Card['suit'], rank: Card['rank'], id = 0): Card {
  return { id, deck: 0, suit, rank };
}

describe('cards & trump hierarchy', () => {
  it('three decks contain 162 cards, 300 total points, and 21 bipai cards at every level', () => {
    const deck = createThreeDecks();
    assert.equal(deck.length, 162);

    const totalPoints = deck.reduce((sum, c) => sum + getCardPoints(c), 0);
    assert.equal(totalPoints, 300);

    for (const lvl of LEVEL_SEQUENCE) {
      assert.equal(
        countBipai(deck, lvl),
        21,
        `expected 21 bipai cards at level ${lvl}`,
      );
    }

    // 3s are never bipai cards
    for (const s of ['S', 'H', 'C', 'D'] as StandardSuit[]) {
      assert.equal(isBipaiCard(card(s, '3'), '2'), false);
    }
    assert.equal(isBipaiCard(card('H', '5'), '2'), true);
    assert.equal(isBipaiCard(card('S', '5'), '2'), false);
    assert.equal(isBipaiCard(card('J', 'BJ'), '2'), true);
    assert.equal(isBipaiCard(card('J', 'SJ'), '2'), true);
  });

  it('only ♥5 is red five, and only same-color 3s are 正/副参谋', () => {
    assert.equal(isRedFive(card('H', '5')), true);
    assert.equal(isRedFive(card('D', '5')), false);
    assert.equal(isRedFive(card('S', '5')), false);
    assert.equal(isRedFive(card('C', '5')), false);

    // Trump = D, level = 6 -> D3 正参谋, H3 副参谋, S3/C3 non-trump
    assert.equal(isTrump(card('D', '3'), 'D', '6'), true);
    assert.equal(isTrump(card('H', '3'), 'D', '6'), true);
    assert.equal(isTrump(card('S', '3'), 'D', '6'), false);
    assert.equal(isTrump(card('C', '3'), 'D', '6'), false);
    assert.equal(getCardCategory(card('S', '3'), 'D', '6'), 'S');
    assert.equal(getCardCategory(card('C', '3'), 'D', '6'), 'C');

    // Trump = S, level = 6 -> S3 正参谋, C3 副参谋, H3/D3 non-trump
    assert.equal(isTrump(card('S', '3'), 'S', '6'), true);
    assert.equal(isTrump(card('C', '3'), 'S', '6'), true);
    assert.equal(isTrump(card('H', '3'), 'S', '6'), false);
    assert.equal(isTrump(card('D', '3'), 'S', '6'), false);

    // ♥5 is ALWAYS trump regardless of trumpSuit (including null)
    assert.equal(isTrump(card('H', '5'), 'S', '6'), true);
    assert.equal(isTrump(card('H', '5'), null, '2'), true);
    assert.equal(isTrump(card('D', '5'), 'S', '6'), false);
  });

  it('orders trumps strictly: ♥5 > BJ > SJ > 正参谋 > 副参谋 > 正级牌 > 副级牌(equal) > 主A..2', () => {
    const trumpSuit: StandardSuit = 'D';
    const level = '6' as const;

    const h5 = getCardOrder(card('H', '5'), trumpSuit, level);
    const bj = getCardOrder(card('J', 'BJ'), trumpSuit, level);
    const sj = getCardOrder(card('J', 'SJ'), trumpSuit, level);
    const zhengCanmou = getCardOrder(card('D', '3'), trumpSuit, level);
    const fuCanmou = getCardOrder(card('H', '3'), trumpSuit, level);
    const zhengLevel = getCardOrder(card('D', '6'), trumpSuit, level);
    const fuLevelS = getCardOrder(card('S', '6'), trumpSuit, level);
    const fuLevelH = getCardOrder(card('H', '6'), trumpSuit, level);
    const fuLevelC = getCardOrder(card('C', '6'), trumpSuit, level);
    const trumpA = getCardOrder(card('D', 'A'), trumpSuit, level);
    const trump7 = getCardOrder(card('D', '7'), trumpSuit, level);
    const trump5 = getCardOrder(card('D', '5'), trumpSuit, level);
    const trump4 = getCardOrder(card('D', '4'), trumpSuit, level);
    const trump2 = getCardOrder(card('D', '2'), trumpSuit, level);

    assert.equal(h5 - bj, 1);
    assert.equal(bj - sj, 1);
    assert.equal(sj - zhengCanmou, 1);
    assert.equal(zhengCanmou - fuCanmou, 1);
    assert.equal(fuCanmou - zhengLevel, 1);
    assert.equal(zhengLevel - fuLevelS, 1);
    assert.equal(fuLevelS, fuLevelH);
    assert.equal(fuLevelH, fuLevelC);
    assert.equal(fuLevelS - trumpA, 1);
    // D5 and D4 are adjacent in D because D6 is level and D3 is 正参谋
    assert.equal(trump7 - trump5, 1);
    assert.equal(trump5 - trump4, 1);
    assert.equal(trump4 - trump2, 1);
    assert.equal(trump2, 0);
  });
});
