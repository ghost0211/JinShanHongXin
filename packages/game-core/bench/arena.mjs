#!/usr/bin/env node
/**
 * Bot arena: duplicate-format head-to-head between two bot implementations.
 *
 * Each deal is played twice with identical cards: once with bot X on team A (seats 0/2)
 * and bot Y on team B (seats 1/3), then with teams swapped. Luck of the deal cancels out,
 * so the summed difference measures pure play strength.
 *
 * Usage:
 *   node bench/arena.mjs [--x dist/bot.js] [--y bench/baseline/bot.ts] [--n 40] [--start 1]
 *                        [--round 1] [--mode hongxin] [--jobs 8]
 *
 *   --round k : play k-1 warm-up rounds (Y vs Y) first, then evaluate round k
 *               (round >= 2 exercises non-first-round calling, fixed dealer, other levels).
 *   Build baseline first:  sh bench/make-baseline.sh <git-rev>
 */
import { fork } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, '..');

function parseArgs(argv) {
  const out = { x: 'dist/bot.js', y: 'bench/baseline/bot.ts', n: 40, start: 1, round: 1, mode: 'hongxin', jobs: 8, xopts: '', yopts: '' };
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i].replace(/^--/, '');
    const v = argv[i + 1];
    out[k] = ['n', 'start', 'round', 'jobs'].includes(k) ? Number(v) : v;
  }
  return out;
}

const SEATS = [0, 1, 2, 3];
const teamOf = (s) => (s % 2 === 0 ? 'A' : 'B');

async function loadBot(p, optsJson) {
  const url = pathToFileURL(path.resolve(pkgRoot, p)).href;
  const mod = await import(url);
  // Search tuning: '{"alpha":0.2}' or '{"enabled":false}'. Deterministic (no wall-clock cutoff) by default.
  const searchMod = await import(new URL('./botSearch.js', url).href).catch(() => null);
  if (searchMod?.configureBotSearch) {
    searchMod.configureBotSearch({ timeBudgetMs: 1e9, ...(optsJson ? JSON.parse(optsJson) : {}) });
  }
  return mod.chooseBotAction;
}

function playRound(core, state, policyForSeat, maxSteps = 600) {
  let steps = 0;
  const think = { X: 0, Y: 0 };
  while (state.phase !== 'ROUND_OVER' && state.phase !== 'MATCH_OVER' && steps < maxSteps) {
    const seat = state.currentTurn;
    let action;
    if (seat === null || seat === undefined) {
      action = { type: 'DEAL_STEP' };
    } else {
      const { fn, tag } = policyForSeat(seat);
      const t0 = performance.now();
      action = fn(state, seat);
      think[tag] += performance.now() - t0;
    }
    const res = core.applyAction(state, action);
    if (!res.ok) throw new Error(`illegal action ${action.type} by seat ${seat}: ${res.error}`);
    state = res.state;
    steps += 1;
  }
  if (state.phase !== 'ROUND_OVER' && state.phase !== 'MATCH_OVER') throw new Error('round did not finish');
  return { state, think };
}

/** Value of the finished round from team `xTeam`'s perspective. */
function evaluate(state, xTeam) {
  const st = state.settlement;
  const sign = st.earningTeam === xTeam ? 1 : -1;
  const xIsChallenger = st.challengerTeam === xTeam;
  const pts = st.totalChallengerScore;
  return {
    steps: sign * st.earnedSteps,
    // positive = good for X
    margin: xIsChallenger ? pts - 120 : 120 - pts,
    win: st.earningTeam === xTeam ? 1 : 0,
    bottomKilledByX: st.bottomKilled && xIsChallenger ? 1 : 0,
    bottomKilledVsX: st.bottomKilled && !xIsChallenger ? 1 : 0,
  };
}

async function worker() {
  const core = await import(pathToFileURL(path.resolve(pkgRoot, 'dist/index.js')).href);
  process.on('message', async (job) => {
    const X = await loadBot(job.x, job.xopts);
    const Y = await loadBot(job.y, job.yopts);
    const rows = [];
    for (const seed of job.seeds) {
      // Build the evaluation start state (identical for both orientations)
      let base = core.createInitialMatchState({ seed, mode: job.mode });
      for (let r = 1; r < job.round; r++) {
        const { state } = playRound(core, base, () => ({ fn: Y, tag: 'Y' }));
        if (state.phase === 'MATCH_OVER') break;
        base = core.startNextRound(state, seed * 7919 + r);
      }
      const row = { seed, X: {}, thinkX: 0, thinkY: 0 };
      for (const xTeam of ['A', 'B']) {
        const policy = (seat) => (teamOf(seat) === xTeam ? { fn: X, tag: 'X' } : { fn: Y, tag: 'Y' });
        const { state, think } = playRound(core, base, policy);
        row[xTeam] = evaluate(state, xTeam);
        row.thinkX += think.X;
        row.thinkY += think.Y;
      }
      rows.push(row);
    }
    process.send(rows);
    process.exit(0);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seeds = Array.from({ length: args.n }, (_, i) => args.start + i);
  const jobs = Math.max(1, Math.min(args.jobs, seeds.length));
  const chunks = Array.from({ length: jobs }, () => []);
  seeds.forEach((s, i) => chunks[i % jobs].push(s));
  const t0 = Date.now();
  const results = (
    await Promise.all(
      chunks.map(
        (chunk) =>
          new Promise((resolve, reject) => {
            const child = fork(fileURLToPath(import.meta.url), ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
            child.on('message', resolve);
            child.on('exit', (code) => code !== 0 && reject(new Error(`worker exit ${code}`)));
            child.send({ ...args, seeds: chunk });
          }),
      ),
    )
  ).flat();

  const agg = { steps: 0, margin: 0, win: 0, bkX: 0, bkVsX: 0, thinkX: 0, thinkY: 0 };
  const perDeal = [];
  for (const r of results) {
    for (const t of ['A', 'B']) {
      agg.steps += r[t].steps;
      agg.margin += r[t].margin;
      agg.win += r[t].win;
      agg.bkX += r[t].bottomKilledByX;
      agg.bkVsX += r[t].bottomKilledVsX;
    }
    agg.thinkX += r.thinkX;
    agg.thinkY += r.thinkY;
    perDeal.push(r.A.margin + r.B.margin);
  }
  const games = results.length * 2;
  const mean = perDeal.reduce((a, b) => a + b, 0) / perDeal.length;
  const sd = Math.sqrt(perDeal.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, perDeal.length - 1));
  const se = sd / Math.sqrt(perDeal.length);
  console.log(
    JSON.stringify(
      {
        x: args.x + (args.xopts ? ' ' + args.xopts : ''),
        y: args.y + (args.yopts ? ' ' + args.yopts : ''),
        mode: args.mode,
        round: args.round,
        deals: results.length,
        xWinRate: +(agg.win / games).toFixed(3),
        avgStepsPerGame: +(agg.steps / games).toFixed(3),
        avgMarginPerDeal: +mean.toFixed(1),
        marginStdErr: +se.toFixed(1),
        bottomKilledByX: agg.bkX,
        bottomKilledAgainstX: agg.bkVsX,
        msPerDecisionHint: { X: +(agg.thinkX / games).toFixed(0), Y: +(agg.thinkY / games).toFixed(0) },
        wallSec: (Date.now() - t0) / 1000,
      },
      null,
      1,
    ),
  );
}

if (process.argv.includes('--worker')) worker();
else main();
