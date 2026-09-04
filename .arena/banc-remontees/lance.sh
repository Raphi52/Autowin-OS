#!/usr/bin/env bash
# Lance les QUATRE bras EN MEME TEMPS, chacun dans SA copie de travail (git worktree distinct).
#
# NETTOYAGE attendu en fin de banc — ces quatre dossiers doivent avoir disparu du disque :
#   "C:/Sources/arena-remontees/bras-a"
#   "C:/Sources/arena-remontees/bras-b"
#   "C:/Sources/arena-remontees/bras-c"
#   "C:/Sources/arena-remontees/bras-x"
BENCH="$(cd "$(dirname "$0")" && pwd)"
for b in a b c x; do
  (
    cd "C:/Sources/arena-remontees/bras-$b" || exit 1
    claude -p "$(cat "$BENCH/prompt-$b.txt")" --output-format json --dangerously-skip-permissions \
      > "$BENCH/out-$b.json" 2> "$BENCH/err-$b.txt"
  ) &
done
wait
echo "quatre bras termines"
