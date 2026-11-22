#!/bin/sh
# Heuristic-only quick arena: sh bench/h.sh [n] [start]
cd "$(dirname "$0")/.."
npx tsc -b . 2>&1 | grep -v notice
node bench/arena.mjs --n ${1:-2000} --start ${2:-1} --xopts '{"enabled":false}' | python3 -c 'import json,sys; d=json.load(sys.stdin); print("HEUR margin", d["avgMarginPerDeal"], "+-", d["marginStdErr"], "win", d["xWinRate"], "steps", d["avgStepsPerGame"], "bk", d["bottomKilledByX"], d["bottomKilledAgainstX"], "wall", d["wallSec"])'
