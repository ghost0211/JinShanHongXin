import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialMatchState,
  createThreeDecks,
  getCardCategory,
  getCardKey,
  getCardOrder,
  isTrump,
  LEVEL_SEQUENCE,
  parsePlay,
  STANDARD_SUITS,
} from '../index.js';
import type { Card, LevelRank, StandardSuit } from '../index.js';
import { cards, pt } from './audit-helpers.js';

const one = (spec: string): Card => cards(spec)[0];
const ord = (spec: string, t: StandardSuit | null, l: LevelRank) => getCardOrder(one(spec), t, l);
const SAME: Record<StandardSuit, StandardSuit> = { S: 'C', C: 'S', H: 'D', D: 'H' };

describe('AUDIT B1: deck, deal, trump hierarchy', () => {
  it('3 decks = 162 cards, 3 copies of every key; deal = 4×38 + 10 bottom with no duplicates', () => {
    const deck = createThreeDecks();
    assert.equal(deck.length, 162);
    const counts = new Map<string, number>();
    for (const c of deck) counts.set(getCardKey(c), (counts.get(getCardKey(c)) ?? 0) + 1);
    assert.equal(counts.size, 54);
    for (const v of counts.values()) assert.equal(v, 3);

    for (const mode of ['hongxin', 'heixin'] as const) {
      const st = createInitialMatchState({ seed: 7, mode });
      const all: Card[] = [...st.hands[0], ...st.hands[1], ...st.hands[2], ...st.hands[3], ...st.bottomCards];
      for (const s of [0, 1, 2, 3] as const) assert.equal(st.hands[s].length, 38);
      assert.equal(st.bottomCards.length, 10);
      assert.equal(new Set(all.map((c) => c.id)).size, 162);
    }
  });

  it('for every trump suit × every level: ♥5 > BJ > SJ > 正参谋 > 副参谋 > 正级 > 副级(同阶) > 主A..; only ♥5 is red five; off-color 3 is side', () => {
    for (const level of LEVEL_SEQUENCE) {
      for (const T of STANDARD_SUITS) {
        const same = SAME[T];
        const offColor = STANDARD_SUITS.filter((s) => s !== T && s !== same);
        const chain = [
          'H:5',
          'J:BJ',
          'J:SJ',
          `${T}:3`,
          `${same}:3`,
          `${T}:${level}`,
        ];
        for (let i = 0; i + 1 < chain.length; i++) {
          assert.ok(
            ord(chain[i], T, level) === ord(chain[i + 1], T, level) + 1,
            `T=${T} L=${level}: ${chain[i]} must be exactly one tier above ${chain[i + 1]}`,
          );
        }
        // all three off-trump-suit level cards share one tier just below 正级
        const subLevels = STANDARD_SUITS.filter((s) => s !== T).map((s) => ord(`${s}:${level}`, T, level));
        assert.equal(new Set(subLevels).size, 1);
        assert.equal(subLevels[0], ord(`${T}:${level}`, T, level) - 1);
        // highest normal trump card sits directly below 副级
        const topNormal = level === 'A' ? 'K' : 'A';
        assert.equal(ord(`${T}:${topNormal}`, T, level), subLevels[0] - 1);
        // off-color 3s are plain side cards
        for (const s of offColor) {
          assert.equal(isTrump(one(`${s}:3`), T, level), false, `T=${T} ${s}3 must be side`);
        }
        // ♠5/♣5/♦5 are never 常主 (only in trump suit as plain trump)
        for (const s of ['S', 'C', 'D'] as const) {
          const c = one(`${s}:5`);
          assert.equal(isTrump(c, T, level), s === T, `T=${T} ${s}5 trump-ness`);
          if (s === T) assert.ok(getCardOrder(c, T, level) < subLevels[0]);
        }
        assert.equal(getCardCategory(one('H:5'), T, level), 'TRUMP');
      }
    }
  });

  it('no-trump (trumpSuit=null): ♥5 > BJ > SJ > 4 suits level (同阶); all 3s and non-♥ 5s are side cards', () => {
    for (const level of LEVEL_SEQUENCE) {
      assert.ok(ord('H:5', null, level) === ord('J:BJ', null, level) + 1);
      assert.ok(ord('J:BJ', null, level) === ord('J:SJ', null, level) + 1);
      const lv = STANDARD_SUITS.map((s) => ord(`${s}:${level}`, null, level));
      assert.equal(new Set(lv).size, 1);
      assert.equal(lv[0], ord('J:SJ', null, level) - 1);
      for (const s of STANDARD_SUITS) {
        assert.equal(isTrump(one(`${s}:3`), null, level), false);
      }
      for (const s of ['S', 'C', 'D'] as const) {
        assert.equal(isTrump(one(`${s}:5`), null, level), false);
      }
    }
  });

  it('side suits drop exactly the extracted cards (level, 同色3, ♥5) and keep A on top', () => {
    // 打7 主♠: ♣ (same color) drops 3 & 7; ♥ drops 5 & 7; ♦ drops only 7
    const L: LevelRank = '7';
    assert.equal(ord('C:2', 'S', L), 0);
    assert.equal(ord('C:4', 'S', L), 1); // ♣3 is 副参谋
    assert.equal(ord('H:4', 'S', L), 2);
    assert.equal(ord('H:6', 'S', L), 3); // ♥5 is red five
    assert.equal(ord('D:5', 'S', L), 3);
    assert.equal(ord('D:6', 'S', L), 4);
    assert.equal(ord('D:8', 'S', L), 5); // ♦7 is 副级
  });
});

describe('AUDIT B2: tractor adjacency = absolute order, A=1 only exception, no wrap', () => {
  it('打2 主♦ (user example): ♦AA44 / ♥AA44 / ♥AA4466 / ♠AA33 are tractors; ♠AA44 is not', () => {
    assert.equal(pt('D:A*2 D:4*2', 'D', '2'), 'TRACTOR');
    assert.equal(pt('H:A*2 H:4*2', 'D', '2'), 'TRACTOR');
    assert.equal(pt('H:A*2 H:4*2 H:6*2', 'D', '2'), 'TRACTOR');
    assert.equal(pt('H:A*3 H:4*3 H:6*3', 'D', '2'), 'TRIPLE_TRACTOR');
    assert.equal(pt('S:A*2 S:3*2', 'D', '2'), 'TRACTOR');
    assert.equal(pt('S:A*2 S:4*2', 'D', '2'), 'SLING');
    assert.equal(pt('S:3*2 S:4*2', 'D', '2'), 'TRACTOR');
    assert.equal(pt('C:A*3 C:3*3', 'D', '2'), 'TRIPLE_TRACTOR');
  });

  it('forbids wrap-around through A in pairs and triples, at several levels', () => {
    assert.equal(pt('C:K*2 C:A*2 C:3*2', 'D', '2'), 'SLING');
    assert.equal(pt('D:K*2 D:A*2 D:4*2', 'D', '2'), 'SLING');
    assert.equal(pt('S:K*2 S:A*2 S:2*2', 'D', '4'), 'SLING');
    assert.equal(pt('S:K*3 S:A*3 S:2*3', 'D', '4'), 'SLING');
    // but each half alone is fine
    assert.equal(pt('S:K*2 S:A*2', 'D', '4'), 'TRACTOR');
    assert.equal(pt('S:A*2 S:2*2', 'D', '4'), 'TRACTOR');
    // 打A: no A=1 at all; ♠2 cannot connect to anything below
    assert.equal(pt('S:2*2 S:3*2', 'D', 'A'), 'TRACTOR');
  });

  it('gaps left by extracted cards close (absolute order), real gaps never close', () => {
    // 打7 主♠: ♠66+♠88 (7 is level), ♥44+♥66 (♥5 red five), ♣22+♣44 (♣3 副参谋)
    assert.equal(pt('S:6*2 S:8*2', 'S', '7'), 'TRACTOR');
    assert.equal(pt('H:4*2 H:6*2', 'S', '7'), 'TRACTOR');
    assert.equal(pt('C:2*2 C:4*2', 'S', '7'), 'TRACTOR');
    // ♦3 and ♦5 are plain side cards here -> no closing
    assert.equal(pt('D:2*2 D:4*2', 'S', '7'), 'SLING');
    assert.equal(pt('D:4*2 D:6*2', 'S', '7'), 'SLING');
    assert.equal(pt('D:4*2 D:5*2 D:6*2', 'S', '7'), 'TRACTOR');
    // genuine gap: ♠99 + ♠JJ (10 missing) is never a tractor
    assert.equal(pt('S:9*2 S:J*2', 'D', '2'), 'SLING');
    // 打4 主♦: ♦22+♦55 adjacent (♦3 参谋, ♦4 level); A=1 + 2
    assert.equal(pt('D:2*2 D:5*2', 'D', '4'), 'TRACTOR');
    assert.equal(pt('D:A*2 D:2*2 D:5*2', 'D', '4'), 'TRACTOR');
    // 打K: Q and A adjacent in every suit (K extracted)
    assert.equal(pt('S:Q*2 S:A*2', 'D', 'K'), 'TRACTOR');
    assert.equal(pt('D:Q*2 D:A*2', 'D', 'K'), 'TRACTOR');
  });

  it('常主 chain by absolute tiers; 副级牌 pairs of different suits never connect to each other', () => {
    // 主♦ 打2: 主A - 副级 - 正级 - 副参谋 - 正参谋 - SJ - BJ - ♥5
    assert.equal(pt('D:A*2 S:2*2', 'D', '2'), 'TRACTOR');
    assert.equal(pt('S:2*2 D:2*2', 'D', '2'), 'TRACTOR');
    assert.equal(pt('D:2*2 H:3*2', 'D', '2'), 'TRACTOR');
    assert.equal(pt('H:3*2 D:3*2', 'D', '2'), 'TRACTOR');
    assert.equal(pt('D:3*2 J:SJ*2', 'D', '2'), 'TRACTOR');
    assert.equal(pt('J:SJ*2 J:BJ*2 H:5*2', 'D', '2'), 'TRACTOR');
    assert.equal(pt('S:2*2 C:2*2', 'D', '2'), 'SLING');
    assert.equal(pt('S:2*3 C:2*3', 'D', '2'), 'SLING');
    // 副级 cannot skip 正级 to reach 副参谋
    assert.equal(pt('S:2*2 H:3*2', 'D', '2'), 'SLING');
    // off-color 3 (♠3 when 主♦) is NOT 参谋 -> cannot join trump chain
    assert.equal(parsePlay(cards('S:3*2 D:3*2'), 'D', '2'), null);
    // 打A 主♠: ♠KK + ♥AA(副级) + ♠AA(正级) + ♣33(副参谋) + ♠33(正参谋)
    assert.equal(pt('S:K*2 H:A*2 S:A*2 C:3*2 S:3*2', 'S', 'A'), 'TRACTOR');
    // 主♥: ♥44+♥66 (♥5 is red five), and ♥5 never acts as plain trump 5
    assert.equal(pt('H:4*2 H:6*2', 'H', '2'), 'TRACTOR');
    assert.equal(pt('H:5*2 H:6*2', 'H', '2'), 'SLING');
    // no-trump: level(同阶)-SJ-BJ-♥5
    assert.equal(pt('S:2*2 J:SJ*2', null, '2'), 'TRACTOR');
    assert.equal(pt('S:2*2 H:2*2', null, '2'), 'SLING');
    assert.equal(pt('J:SJ*2 J:BJ*2 H:5*2', null, '2'), 'TRACTOR');
  });

  it('pairs/triples require identical suit+rank; low-A chain ranks below every normal chain', () => {
    assert.equal(pt('S:2 C:2', 'D', '2'), 'SLING');
    assert.equal(pt('S:2 C:2 H:2', 'D', '2'), 'SLING');
    assert.equal(pt('J:BJ J:SJ', 'D', '2'), 'SLING');
    assert.equal(pt('J:BJ*3', 'D', '2'), 'TRIPLE');
    const low = parsePlay(cards('H:A*2 H:4*2'), 'D', '2')!;
    const mid = parsePlay(cards('H:4*2 H:6*2'), 'D', '2')!;
    const high = parsePlay(cards('H:K*2 H:A*2'), 'D', '2')!;
    assert.ok(low.components[0].topOrder < mid.components[0].topOrder);
    assert.ok(mid.components[0].topOrder < high.components[0].topOrder);
    assert.equal(low.components[0].usedLowAce, true);
  });

  it('mixed-category selections are not a legal single play', () => {
    assert.equal(parsePlay(cards('S:A H:A'), 'D', '2'), null);
    assert.equal(parsePlay(cards('S:A D:A'), 'D', '2'), null);
    // ♥5 is trump even when ♥ is not trump: ♥5+♥6 is mixed
    assert.equal(parsePlay(cards('H:5 H:6'), 'S', '2'), null);
  });
});
