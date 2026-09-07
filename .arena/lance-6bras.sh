#!/usr/bin/env bash
# Lance les SIX bras du banc /arena en meme temps, chacun dans SA copie de travail.
# 3 defauts (banc-watch, banc-couleurs, banc-garde-binaire) x 2 workflows (a = kit complet, b = build direct).
ARENA="/c/Sources/AutoWinOS/.autowin-data/autowin-os/worktrees/846afeda47fa9e64/agent__run-c79f2dd06e2b-1/.arena"
BASE="/c/Sources/AutoWinOS/.autowin-data/autowin-os/worktrees/arena-6bras"
for b in banc-watch banc-couleurs banc-garde-binaire; do
  : > "$ARENA/$b/statut.txt"
  for a in a b; do
    (
      cd "$BASE/$b-$a" || exit 1
      t0=$(date +%s)
      claude -p "$(cat "$ARENA/$b/prompt-$a.txt")" --output-format json --dangerously-skip-permissions \
        > "$ARENA/$b/out-$a.json" 2> "$ARENA/$b/err-$a.txt"
      ec=$?
      t1=$(date +%s)
      echo "$a exit=$ec wall=$((t1 - t0))s" >> "$ARENA/$b/statut.txt"
    ) &
  done
done
wait
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$ARENA/fin-6bras.txt"
echo "six bras termines" >> "$ARENA/fin-6bras.txt"
