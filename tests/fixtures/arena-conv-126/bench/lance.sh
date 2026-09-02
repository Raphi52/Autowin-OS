#!/bin/sh
B="D:/arena-fixture-conv-126/bench"   # chemin NEUTRALISE (voir README.md du dossier)
W="D:/arena-fixture-conv-126/worktrees/arena"   # chemin NEUTRALISE (voir README.md du dossier)
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
