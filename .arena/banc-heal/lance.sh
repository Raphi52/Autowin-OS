#!/bin/sh
B="D:/AutoWinOS/.autowin-data/autowin-os/arena-bench-heal"
W="D:/AutoWinOS/.autowin-data/autowin-os/worktrees/arena-heal"
: > "$B/statut.txt"
for a in a b c x; do
  (
    cd "$W/$a" || exit 1
    start=$(date +%s)
    claude -p "$(cat "$B/prompt-$a.txt")" --output-format json --dangerously-skip-permissions \
      > "$B/out-$a.json" 2> "$B/err-$a.txt"
    echo "$a exit=$? wall=$(( $(date +%s) - start ))s" >> "$B/statut.txt"
  ) &
done
wait
echo "TOUS LES BRAS TERMINES"
cat "$B/statut.txt"
