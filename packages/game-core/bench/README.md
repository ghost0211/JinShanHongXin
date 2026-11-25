# Bot benchmark tools

Run from `packages/game-core` after building (`npx tsc -b .`).

| Command | Purpose |
|---|---|
| `sh bench/make-baseline.sh <git-rev>` | Freeze `src/bot.ts` from a revision as the opponent (`bench/baseline/bot.ts`). |
| `node bench/arena.mjs --n 320` | Duplicate-format arena: every deal is played twice with teams swapped, so luck cancels out. Reports X's average point margin per deal (± std. error), win rate and think time. |
| `node bench/arena.mjs --xopts '{"enabled":false}'` | Pure heuristic (no search) vs baseline: about 400 deals in 3 s, good for quick heuristic tuning (`sh bench/h.sh`). |
| `node bench/arena.mjs --round 3` | Evaluate round 3 (later-round calling, fixed dealer, other levels) after Y-vs-Y warm-up rounds. |
| `node bench/arena.mjs --mode heixin --n 200` | Duplicate 1v3 Heixin arena: Y runs identical bidding/trump, then X plays both dealer-vs-3Y and 3X-challengers-vs-Y. |
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

## Results log (hongxin, vs previous PIMC search bot `305ff7b`)

| Config | Deals | Margin / deal | Win rate | Bottom kills | Speed |
|---|---|---|---|---|---|
| heuristic-only (balanced discard + enemy-win point-dump prune + point-dodge weight 4.2) | 320 | +3.0 ± 1.8 | 50.8% | 109 vs 106 | 14 ms |
| heuristic-only, round 3 | 80 | +1.2 ± 3.6 | 51.9% | 24 vs 27 | 24 ms |
| **PIMC search (12 worlds, Bayesian bottom/dealer sampling + structure-aware eval + balanced discard)** | 120 | **+5.4 ± 3.5** | **51.7%** | **37 vs 30** | **1332 vs 1487 ms/game (-10%)** |
| PIMC search + anchor-low sling trump-kills + triple/pair-preserving bury (vs `b174513`) | 80 | +0.4 ± 2.5 | 49.4% | 22 vs 19 | 1475 vs 1419 ms/game |

## Results log (Phase 1 teammate cooperation + unified EV + Ace-preserving bury + Bayesian signals + score thresholds, vs `e69bdb8`)

| Config | Mode | Deals | Margin / deal | Win rate | Steps / Bid net | Bottom kills | Speed |
|---|---|---:|---:|---:|---:|---:|---:|
| pure heuristic (`enabled:false`) | hongxin R1 | 1000 | **+7.0 ± 1.3** | **51.9%** | +0.048 | 326 vs 320 | 11 vs 10 ms |
| pure heuristic (`enabled:false`) | hongxin R3 | 400 | **+11.1 ± 2.0** | **56.1%** | +0.105 | 152 vs 136 | 12 vs 10 ms |
| pure heuristic (`enabled:false`) | heixin R1 | 1000 | **+2.9 ± 1.0** | **51.5%** | +5.03 | 510 vs 515 | 11 vs 10 ms |
| **PIMC search (12 worlds, default)** | **hongxin R1** | **200** | **+3.0 ± 2.7** | **52.0%** | **+0.025** | **66 vs 59** | 1246 vs 1133 ms |
| **PIMC search (12 worlds, default)** | **heixin R1** | **200** | **+2.3 ± 2.1** | **51.5%** | **+5.00** | **93 vs 94** | 1058 vs 938 ms |
| PIMC search (12 worlds, default) | hongxin R3 | 80 | −5.9 ± 4.3 | 51.2% | −0.044 | 24 vs 22 | 1387 vs 1171 ms |
