#!/bin/sh
# Freeze bot.ts from a git revision as the arena baseline: sh bench/make-baseline.sh <rev>
set -e
cd "$(dirname "$0")/.."
REV="${1:-HEAD}"
mkdir -p bench/baseline
git show "$REV:packages/game-core/src/bot.ts" | sed "s#from '\./\([a-z]*\)\.js'#from '../../dist/\1.js'#" > bench/baseline/bot.ts
echo "baseline <- $REV"
