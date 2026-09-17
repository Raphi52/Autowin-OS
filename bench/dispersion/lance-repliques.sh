#!/usr/bin/env bash
# 2e replique des bras a et b : mesure la DISPERSION intra-bras (skill arena, section 4).
set -u
B="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for n in a b; do
  (
    d=$(date +%s); cd "$B/../runs/disp-${n}2" || exit 1
    claude -p "$(cat "$B/prompt-$n.txt")" --output-format json --dangerously-skip-permissions \
      > "$B/out-$n-2.json" 2> "$B/preuves/err-$n-2.txt"
    node "$B/gel/check.mjs" "$B/../runs/disp-${n}2" > "$B/preuves/critere-$n-2.txt" 2>&1
    echo "${n}2 critere_exit=$? mur=$(( $(date +%s) - d ))s" >> "$B/preuves/statut-repliques.txt"
  ) &
done
wait
sort "$B/preuves/statut-repliques.txt"
