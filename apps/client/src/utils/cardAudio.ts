import type { PatternType, PlayerView, TrickPlayView } from '@jinshan/protocol';

export interface CardStroke {
  at: number;
  kind: 'slide' | 'land';
  strength: number;
  rate: number;
}

const MAX_CHAIN_HITS = 7;

// Use the actual played pattern; an unstructured follow is not a tractor just
// because it has as many cards. An actual sling can contain several groups.
export function planCardSound(play: TrickPlayView): CardStroke[] {
  const { patternType, components } = play.parsed;
  const count = play.cards.length;
  if (count === 0) return [];
  const isTractor = (kind: PatternType) => kind === 'TRACTOR' || kind === 'TRIPLE_TRACTOR';
  const chain = isTractor(patternType) || (patternType === 'SLING' && components.some((c) => isTractor(c.type)));
  const heavy = patternType === 'TRIPLE_TRACTOR' || patternType === 'TRIPLE';
  const is510K = patternType === 'F510K';
  const groups = chain
    ? Math.min(MAX_CHAIN_HITS, Math.max(2, count - 1))
    : is510K ? Math.min(6, count)
    : patternType === 'SLING' ? Math.min(5, Math.max(1, components.length || count - 1))
    : Math.min(3, count);
  const interval = chain ? 0.036 : is510K ? 0.049 : 0.024;
  const slide: CardStroke = {
    at: 0, kind: 'slide', strength: chain ? 0.68 : 0.38 + Math.min(4, count) * 0.07,
    rate: chain ? 0.83 : 1.05,
  };
  const contact = Array.from({ length: groups }, (_, i): CardStroke => {
    const last = i === groups - 1;
    return {
      at: (chain ? 0.040 : 0.025) + i * interval - (chain ? 0.0012 * i * i : 0),
      kind: 'land',
      strength: last ? (chain ? 0.86 : heavy || is510K ? 0.77 : 0.62) : (chain ? 0.45 : 0.41) + i * 0.02,
      rate: last ? (heavy ? 0.79 : 0.91) : 1.08 + (i % 3) * 0.06,
    };
  });
  return [slide, ...contact];
}

export function latestNewPlay(previous: PlayerView, next: PlayerView): TrickPlayView | undefined {
  if (previous.roundNumber !== next.roundNumber || previous.viewerSeat !== next.viewerSeat) return undefined;
  if (previous.trickNumber === next.trickNumber) {
    return next.currentTrick.length > previous.currentTrick.length ? next.currentTrick.at(-1) : undefined;
  }
  if (next.trickNumber < previous.trickNumber) return undefined;
  // Trick completion moves its last play out of currentTrick in the same frame.
  return next.currentTrick.at(-1) ?? next.lastTrick?.plays.at(-1);
}

export function newRecentGameEvents(previous: PlayerView, next: PlayerView): PlayerView['events'] {
  if (previous.roundNumber !== next.roundNumber) return [];
  const before = previous.events;
  const after = next.events;
  if (!before.length) return after;
  // Server exposes only the latest 20 events. Find the shared older tail rather
  // than expecting events.length to increase every time a player acts.
  const equal = (a: (typeof before)[number], b: (typeof after)[number]) =>
    a.type === b.type && a.seat === b.seat && a.team === b.team && a.message === b.message;
  for (let size = Math.min(before.length, after.length); size > 0; size--) {
    if (before.slice(-size).every((event, i) => equal(event, after[i]))) return after.slice(size);
  }
  return [];
}

// Two tiny offline-synthesised samples: dry paper sliding, and paper snap over
// a short felt-damped table impact. Deterministic noise, no media download.
export function makeCardSample(kind: CardStroke['kind'], sampleRate: number, seed: number): Float32Array {
  const duration = kind === 'slide' ? 0.105 : 0.082;
  const pcm = new Float32Array(Math.ceil(duration * sampleRate));
  let state = seed | 1;
  let low = 0;
  let mid = 0;
  const lowStep = 1 - Math.exp(-2 * Math.PI * 370 / sampleRate);
  const midStep = 1 - Math.exp(-2 * Math.PI * 2650 / sampleRate);
  for (let i = 0; i < pcm.length; i++) {
    state = Math.imul(state, 1664525) + 1013904223 | 0;
    const white = (state >>> 0) / 2147483648 - 1;
    const time = i / sampleRate;
    const x = time / duration;
    low += (white - low) * lowStep;
    mid += (white - mid) * midStep;
    const paper = (mid - low) * 1.3 + (white - mid) * 0.18;
    const fade = Math.min(1, (1 - x) * 8);
    if (kind === 'slide') {
      const texture = 0.60 + 0.40 * Math.sin(2 * Math.PI * (41 * time + 135 * time * time)) ** 2;
      pcm[i] = paper * Math.sin(Math.PI * x) ** 1.5 * texture * 0.54;
    } else {
      const attack = Math.min(1, time / 0.0012);
      const snap = paper * Math.exp(-time * 145) * 0.88;
      const table = (Math.sin(2 * Math.PI * 132 * time) * 0.31 +
        Math.sin(2 * Math.PI * 209 * time) * 0.11 + low * 0.40) * Math.exp(-time * 63);
      pcm[i] = (snap + table) * attack * fade;
    }
  }
  return pcm;
}
