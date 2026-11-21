// Audit helpers (domain B): deterministic card construction from compact specs.
// Spec token format: `<suit>:<rank>[*count]`, e.g. `S:A*2 H:5 J:BJ*3`.
import type { Card, LevelRank, ParsedPlay, StandardSuit, TrickPlay, Seat } from '../index.js';
import { parsePlay } from '../index.js';

let auditId = 900000;

export function cards(spec: string): Card[] {
  const res: Card[] = [];
  for (const token of spec.trim().split(/\s+/).filter(Boolean)) {
    const [body, countStr] = token.split('*');
    const [suit, rank] = body.split(':');
    const count = countStr ? Number(countStr) : 1;
    for (let i = 0; i < count; i++) {
      res.push({
        id: auditId++,
        deck: (i % 3) as 0 | 1 | 2,
        suit: suit as Card['suit'],
        rank: rank as Card['rank'],
      });
    }
  }
  return res;
}

export function ids(cs: readonly Card[]): number[] {
  return cs.map((c) => c.id);
}

/** Pick cards from a hand matching a spec (by suit/rank, in order, without reuse). */
export function pick(hand: readonly Card[], spec: string): Card[] {
  const used = new Set<number>();
  const res: Card[] = [];
  for (const token of spec.trim().split(/\s+/).filter(Boolean)) {
    const [body, countStr] = token.split('*');
    const [suit, rank] = body.split(':');
    const count = countStr ? Number(countStr) : 1;
    for (let i = 0; i < count; i++) {
      const c = hand.find((x) => !used.has(x.id) && x.suit === suit && x.rank === rank);
      if (!c) throw new Error(`pick: ${token} not in hand`);
      used.add(c.id);
      res.push(c);
    }
  }
  return res;
}

export function pt(
  spec: string,
  trump: StandardSuit | null,
  level: LevelRank,
): string | undefined {
  return parsePlay(cards(spec), trump, level)?.patternType;
}

export function parsed(
  cs: readonly Card[],
  trump: StandardSuit | null,
  level: LevelRank,
): ParsedPlay {
  const p = parsePlay(cs, trump, level);
  if (!p) throw new Error('parsed: invalid play');
  return p;
}

export function trick(
  plays: Array<[Seat, Card[], ParsedPlay]>,
): TrickPlay[] {
  return plays.map(([seat, cs, p]) => ({ seat, cards: cs, parsed: p }));
}
