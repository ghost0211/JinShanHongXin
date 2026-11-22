# Bot benchmark tools

Run from `packages/game-core` after building (`npx tsc -b .`).

| Command | Purpose |
|---|---|
| `sh bench/make-baseline.sh <git-rev>` | Freeze `src/bot.ts` from a revision as the opponent (`bench/baseline/bot.ts`). |
| `node bench/arena.mjs --n 320` | Duplicate-format arena: every deal is played twice with teams swapped, so luck cancels out. Reports X's average point margin per deal (± std. error), win rate and think time. |
| `node bench/arena.mjs --xopts '{"enabled":false}'` | Pure heuristic (no search) vs baseline: about 400 deals in 3 s, good for quick heuristic tuning (`sh bench/h.sh`). |
| `node bench/arena.mjs --round 3` | Evaluate round 3 (later-round calling, fixed dealer, other levels) after Y-vs-Y warm-up rounds. |
| `node bench/trace.mjs <seed>` | Readable trick-by-trick trace of one bot round. |

`--xopts` / `--yopts` accept any `SearchOptions` field from `src/botSearch.ts` (e.g. `{"worlds":12,"alpha":0.2}`).

## Results log (hongxin, search bot vs heuristic-only baseline `a07875e`)

| Config | Deals | Margin / deal | Win rate |
|---|---|---|---|
| search, 24 worlds | 160 | +20.8 ± 4.2 | 59.1% |
| search, 24 worlds + call-display pins | 320 | +20.5 ± 2.9 | 59.2% |
| **search, 12 worlds (default)** | 320 | **+20.1 ± 2.9** | 58.4% |
| search, round 3 | 80 | +15.2 ± 4.7 | 57.5% |
| deeper horizon (`extraTricks: 1`) | 160 | +15.0 ± 4.1 | 56.3% |
| full rollout at ≤14 cards | 160 | +15.8 ± 4.1 | 57.8% |
| bury search (full-round rollouts), vs search bot | 240 | −0.8 ± 1.9 | 49.4% (dropped) |

Deeper rollouts and bury search did not help because the heuristic rollout policy is too crude
for long horizons. A better rollout policy is the next lever.
