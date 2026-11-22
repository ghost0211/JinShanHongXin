// Quick look at single bot-vs-bot rounds: node bench/inspect.mjs [mode] [seeds...]
import * as core from '../dist/index.js';
const mode = process.argv[2] || 'hongxin';
const seeds = process.argv.slice(3).map(Number);
for (const seed of seeds.length ? seeds : [1, 2, 3, 4, 5, 6]) {
  let s = core.createInitialMatchState({ seed, mode });
  let n = 0; const phases = {};
  while (s.phase !== 'ROUND_OVER' && s.phase !== 'MATCH_OVER') {
    phases[s.phase] = (phases[s.phase] || 0) + 1;
    const seat = s.currentTurn;
    const a = seat == null ? { type: 'DEAL_STEP' } : core.chooseBotAction(s, seat);
    const r = core.applyAction(s, a);
    if (!r.ok) throw new Error(r.error);
    s = r.state; n++;
  }
  const st = s.settlement;
  console.log(seed, n, JSON.stringify(phases), 'tricks', s.completedTricks.length, 'trump', s.trumpSuit, 'dealer', s.dealer,
    'table', st.tableChallengerPoints, 'bottomRaw', st.bottomPointsRaw, 'killed', st.bottomKilled, 'total', st.totalChallengerScore, 'earn', st.earningTeam, st.earnedSteps);
}
