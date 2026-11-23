import assert from 'node:assert/strict';
import { test } from 'node:test';
import { latestNewPlay, makeCardSample, newRecentGameEvents, planCardSound } from '../src/utils/cardAudio.ts';

function play(patternType, count, seat = 0, components = []) {
  const cards = Array.from({ length: count }, (_, id) => ({ id }));
  return { seat, cards, parsed: { patternType, components, cards } };
}

test('single and grouped plays have distinct felt contacts, and tractors cascade', () => {
  const lands = (pattern, count) => planCardSound(play(pattern, count)).filter((stroke) => stroke.kind === 'land');
  assert.equal(lands('SINGLE', 1).length, 1);
  assert.equal(lands('PAIR', 2).length, 2);
  assert.equal(lands('TRIPLE', 3).length, 3);
  const chain = lands('TRACTOR', 8);
  assert.equal(chain.length, 7);
  assert.ok(chain.at(-1).at > 0.18);
  assert.ok(chain.at(-1).strength > chain[0].strength);
  assert.ok(chain.every((stroke, i) => i === 0 || stroke.at > chain[i - 1].at));
  assert.ok(lands('TRIPLE_TRACTOR', 12).at(-1).rate < chain.at(-1).rate);
  assert.ok(lands('F510K', 3)[2].at > lands('TRIPLE', 3)[2].at);
  assert.equal(lands('F510K', 6).length, 6);
  assert.equal(lands('TRACTOR', 38).length, 7);
  assert.deepEqual(planCardSound(play('SINGLE', 0)), []);
});

test('a sling plays a tractor cascade only if it contains a tractor', () => {
  assert.equal(planCardSound(play('SLING', 8, 0, [{ type: 'TRACTOR' }, { type: 'PAIR' }])).length, 8);
  assert.equal(planCardSound(play('SLING', 8, 0, [{ type: 'PAIR' }, { type: 'TRIPLE' }])).length, 3);
  assert.equal(planCardSound(play('SLING', 8)).length, 6);
});

const baseView = { roundNumber: 1, viewerSeat: 0, trickNumber: 1, currentTrick: [], lastTrick: null };

test('one snapshot is silent if unchanged; the fourth play is found in lastTrick', () => {
  const first = play('TRACTOR', 4);
  const firstView = { ...baseView, currentTrick: [first] };
  assert.equal(latestNewPlay(baseView, firstView), first);
  assert.equal(latestNewPlay(firstView, { ...firstView, trickPauseMs: 500 }), undefined);
  const plays = [first, play('SLING', 4, 1), play('TRACTOR', 4, 2), play('TRACTOR', 4, 3)];
  const fourth = { ...baseView, trickNumber: 2, lastTrick: { plays } };
  assert.equal(latestNewPlay({ ...firstView, currentTrick: plays.slice(0, 3) }, fourth), plays[3]);
  assert.equal(latestNewPlay(fourth, fourth), undefined);
  assert.equal(latestNewPlay(fourth, { ...baseView, roundNumber: 2 }), undefined);
  assert.equal(latestNewPlay(firstView, { ...fourth, viewerSeat: 1 }), undefined);
  const nextLead = play('PAIR', 2, 3);
  assert.equal(latestNewPlay(fourth, { ...fourth, currentTrick: [nextLead] }), nextLead);
});

test('recognises fresh announcements after the end of the 20-event window moves', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ type: 'CARD_PLAYED', message: `play ${i}` }));
  const prev = { ...baseView, events: history };
  const event = { type: 'SLING_FAILED', message: 'forced play' };
  const next = { ...prev, events: [...history.slice(1), event] };
  assert.deepEqual(newRecentGameEvents(prev, next), [event]);
  assert.deepEqual(newRecentGameEvents(next, next), []);
  assert.deepEqual(newRecentGameEvents(next, { ...prev, roundNumber: 2, events: [event] }), []);
});

test('synthesised paper slide and felt impact are distinct, bounded and decay to silence', () => {
  for (const rate of [22050, 48000]) {
    const slide = makeCardSample('slide', rate, 1357);
    const land = makeCardSample('land', rate, 1357);
    assert.ok(slide.length > land.length);
    for (const pcm of [slide, land]) {
      assert.ok(pcm.every((frame) => Number.isFinite(frame) && Math.abs(frame) <= 1));
      assert.ok(pcm.some((frame) => Math.abs(frame) > 0.04));
      assert.ok(Math.abs(pcm[0]) < 0.001 && Math.abs(pcm.at(-1)) < 0.001);
    }
    assert.notDeepEqual(land, makeCardSample('land', rate, 27367));
  }
});
