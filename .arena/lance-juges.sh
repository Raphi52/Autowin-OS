#!/usr/bin/env bash
ARENA="/c/Sources/AutoWinOS/.autowin-data/autowin-os/worktrees/846afeda47fa9e64/agent__run-c79f2dd06e2b-1/.arena"
for b in banc-watch banc-couleurs banc-garde-binaire; do
  (
    cd "$ARENA" || exit 1
    t0=$(date +%s)
    claude -p "$(cat "$ARENA/$b/prompt-judge.txt")" --output-format json --dangerously-skip-permissions \
      > "$ARENA/$b/out-judge.json" 2> "$ARENA/$b/err-judge.txt"
    echo "judge exit=$? wall=$(( $(date +%s) - t0 ))s" >> "$ARENA/$b/statut.txt"
  ) &
done
wait
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$ARENA/fin-juges.txt"
