#!/usr/bin/env bash
# lance.sh [bras...]  (par defaut : les 6)
#
# Joue les bras du banc EN PARALLELE, chacun dans SA copie isolee (bench/runs/<bras>),
# et journalise tout par bench/log.sh :
#   - `bras`        : le lancement du modele lui-meme (sortie JSON, cout, duree, code de sortie)
#   - `critere-vert`: le critere binaire RELANCE apres le travail du bras
# Le `critere-rouge` de depart a deja ete journalise avant le lancement : sans lui, un vert
# ne prouverait rien (report.sh refuse d'ailleurs de conclure sans les deux).
#
# Exit 0 = tous les bras ont RENDU (leur verdict, lui, se lit dans report.sh) · 1 = usage.
set -u
BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BRAS_TOUS="d1-a d1-x d2-a d2-x d3-a d3-x"
BRAS=${*:-$BRAS_TOUS}

mkdir -p "$BENCH/preuves"
: > "$BENCH/preuves/statut.txt"

for n in $BRAS; do
  d="${n%%-*}"; m="${n##*-}"
  [ -f "$BENCH/prompt-$n.txt" ] || { echo "prompt-$n.txt absent" >&2; exit 1; }
  [ -d "$BENCH/runs/$n" ]       || { echo "copie runs/$n absente" >&2; exit 1; }
  if [ "$m" = "a" ]; then mode=pipeline; else mode=direct; fi
  (
    debut=$(date +%s)
    bash "$BENCH/log.sh" --bras "$n" --defaut "$(echo "$d" | tr a-z A-Z)" --mode "$mode" --role bras \
      --cwd "$BENCH/runs/$n" \
      -- claude -p "$(cat "$BENCH/prompt-$n.txt")" --output-format json --dangerously-skip-permissions
    code_bras=$?
    # Le critere est relance PAR LE BANC, pas par le bras : c'est ce qui compte.
    bash "$BENCH/log.sh" --bras "$n" --defaut "$(echo "$d" | tr a-z A-Z)" --mode "$mode" --role critere-vert \
      --cwd "$BENCH/runs/$n" \
      -- node "$BENCH/check-$d.mjs" "$BENCH/runs/$n"
    code_critere=$?
    echo "$n bras_exit=$code_bras critere_exit=$code_critere mur=$(( $(date +%s) - debut ))s" >> "$BENCH/preuves/statut.txt"
  ) &
done
wait

echo "TOUS LES BRAS TERMINES"
sort "$BENCH/preuves/statut.txt"
