#!/usr/bin/env bash
# Lance les QUATRE bras EN MEME TEMPS, chacun dans SA copie de travail.
BENCH="$(cd "$(dirname "$0")" && pwd)"
for b in a b c x; do
  (
    cd "D:/AutoWinOS/.autowin-data/arena-noms/bras-$b" || exit 1
    claude -p "$(cat "$BENCH/prompt-$b.txt")" --output-format json --dangerously-skip-permissions \
      > "$BENCH/out-$b.json" 2> "$BENCH/err-$b.txt"
  ) &
done
wait
echo "quatre bras termines"
