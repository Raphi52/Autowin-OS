#!/usr/bin/env bash
# Le JUGE : un appel DISTINCT des quatre bras, sur les livrables ANONYMISES.
BENCH="$(cd "$(dirname "$0")" && pwd)"
cd "$BENCH" || exit 1
claude -p "$(cat "$BENCH/prompt-judge.txt")" --output-format json --dangerously-skip-permissions \
  > "$BENCH/out-judge.json" 2> "$BENCH/err-judge.txt"
echo "juge termine"
