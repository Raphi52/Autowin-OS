#!/usr/bin/env bash
# lance.sh [bras...] — joue les 4 bras EN PARALLELE, chacun dans SA copie isolee.
# Le critere est rejoue PAR LE BANC depuis gel/check.mjs (copie gelee, hors de portee des bras).
set -u
BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAS=${*:-"a b c x"}
mkdir -p "$BENCH/preuves"
: > "$BENCH/preuves/statut.txt"
for n in $BRAS; do
  [ -f "$BENCH/prompt-$n.txt" ] || { echo "prompt-$n.txt absent" >&2; exit 1; }
  [ -d "$BENCH/../runs/disp-$n" ]       || { echo "copie runs/$n absente" >&2; exit 1; }
  (
    debut=$(date +%s)
    cd "$BENCH/../runs/disp-$n" || exit 1
    claude -p "$(cat "$BENCH/prompt-$n.txt")" --output-format json --dangerously-skip-permissions \
      > "$BENCH/out-$n.json" 2> "$BENCH/preuves/err-$n.txt"
    code_bras=$?
    node "$BENCH/gel/check.mjs" "$BENCH/../runs/disp-$n" > "$BENCH/preuves/critere-$n.txt" 2>&1
    code_critere=$?
    echo "$n bras_exit=$code_bras critere_exit=$code_critere mur=$(( $(date +%s) - debut ))s" >> "$BENCH/preuves/statut.txt"
  ) &
done
wait
echo "TOUS LES BRAS TERMINES"
sort "$BENCH/preuves/statut.txt"
