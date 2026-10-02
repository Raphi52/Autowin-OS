#!/usr/bin/env bash
set -u
B="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for bras in avec sans; do for n in 1 2 3; do (
  R="$B/runs/$bras-$n"; rm -rf "$R"; mkdir -p "$R/.claude/skills/frame"; cp -r "$B/fixture/." "$R/"; mkdir -p "$R/data"; cp "$B/fixture-donnees/clients.json" "$R/data/"
  cp "$B/variantes/$bras.SKILL.md" "$R/.claude/skills/frame/SKILL.md"; cd "$R"; git init -q; git add -A; git commit -qm base
  d=$(date +%s)
  claude -p "/frame $(cat "$B/tache.txt")" --setting-sources project,local --output-format json --dangerously-skip-permissions \
    > "$B/out-$bras-$n.json" 2> "$B/preuves/err-$bras-$n.txt"
  node "$B/gel/check.mjs" "$B/out-$bras-$n.json" > "$B/preuves/critere-$bras-$n.txt" 2>&1
  echo "$bras-$n critere_exit=$? mur=$(( $(date +%s) - d ))s" >> "$B/preuves/statut-repliques.txt"
) & done; done; wait; sort "$B/preuves/statut-repliques.txt"
