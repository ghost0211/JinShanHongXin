// Print a readable trace of one bot round: node bench/trace.mjs <seed> [mode] [botPath]
import * as core from '../dist/index.js';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const seed = Number(process.argv[2] || 1);
const mode = process.argv[3] || 'hongxin';
const botPath = process.argv[4];
const choose = botPath ? (await import(pathToFileURL(path.resolve(botPath)).href)).chooseBotAction : core.chooseBotAction;
let s = core.createInitialMatchState({ seed, mode });
const L = (cs) => core.sortHandForDisplay(cs, s.trumpSuit, s.levelRank).map(core.formatCardLabel).join(' ');
let printedHands = false;
while (s.phase !== 'ROUND_OVER' && s.phase !== 'MATCH_OVER') {
  const seat = s.currentTurn;
  if (s.phase === 'PLAYING' && !printedHands) {
    printedHands = true;
    console.log(`trump=${s.trumpSuit} level=${s.levelRank} dealer=${s.dealer}`);
    for (const p of [0, 1, 2, 3]) console.log(`hand${p}(${p % 2 ? 'B' : 'A'}): ${L(s.hands[p])}`);
    console.log(`bottom: ${L(s.bottomCards)}`);
  }
  const a = seat == null ? { type: 'DEAL_STEP' } : choose(s, seat);
  if (s.phase !== 'PLAYING' && a.type !== 'DEAL_STEP' && a.type !== 'BURY_BOTTOM') console.log('  ', a.type, seat, a.suit ?? '', a.cardIds ? a.cardIds.length : '');
  const before = s.completedTricks.length;
  const r = core.applyAction(s, a);
  if (!r.ok) throw new Error(r.error);
  s = r.state;
  if (s.completedTricks.length > before) {
    const t = s.completedTricks[s.completedTricks.length - 1];
    const line = t.plays.map((p) => `${p.seat}:[${L(p.cards)}]`).join('  ');
    console.log(`T${s.completedTricks.length} ${line}  => win ${t.winnerSeat} +${t.points}`);
  }
}
const st = s.settlement;
console.log(`challenger total=${st.totalChallengerScore} (table ${st.tableChallengerPoints}, bottom ${st.bottomPointsRaw} killed=${st.bottomKilled}) earn=${st.earningTeam} +${st.earnedSteps}`);
