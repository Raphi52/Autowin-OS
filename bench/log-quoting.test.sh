#!/usr/bin/env bash
# Garde-fou de bench/log.sh : la ligne « # CMD= » du journal doit se RELANCER telle quelle.
#
# Defaut constate le 2026-09-07 : une detection maison des caracteres a proteger
# (`*[[:space:]\"\'\]*`) avait un crochet fermant echappe, donc ne correspondait a rien.
# Le journal affichait `# CMD=bash -c echo "je travaille"; exit 3` — une ligne qui, rejouee,
# ne refait PAS la meme chose. Ce test relance la ligne journalisee et compare la sortie.
#
# Exit 0 = la commande journalisee est fidele · 1 = elle ne l'est pas.
set -u
BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BAC="$(mktemp -d)"; trap 'rm -rf "$BAC"' EXIT
echecs=0

verifier() {
  local nom="$1"; shift
  local attendu="$1"; shift
  local bras="quoting-$nom"
  rm -f "$BENCH/logs/$bras.log"
  bash "$BENCH/log.sh" --bras "$bras" --role bras -- "$@" >/dev/null 2>&1
  local cmd
  cmd="$(grep -m1 '^# CMD=' "$BENCH/logs/$bras.log" | sed 's/^# CMD=//')"
  local rejeu
  rejeu="$(eval "$cmd" 2>/dev/null)"
  rm -f "$BENCH/logs/$bras.log"
  if [ "$rejeu" = "$attendu" ]; then
    echo "OK   $nom : # CMD=$cmd"
  else
    echo "FAIL $nom"
    echo "     journalise : $cmd"
    echo "     rejeu rend : [$rejeu]"
    echo "     attendu    : [$attendu]"
    echecs=$((echecs + 1))
  fi
}

verifier simple      "bonjour"                  printf '%s' 'bonjour'
verifier espaces     "je travaille"             bash -c 'printf "%s" "je travaille"'
verifier guillemets  'des "guillemets" dedans'  bash -c 'printf "%s" "des \"guillemets\" dedans"'
verifier apostrophe  "l'apostrophe"             bash -c 'printf "%s" "l'"'"'apostrophe"'
verifier pointvirg   "a;b"                      bash -c 'printf "%s" "a;b"'

echo
if [ "$echecs" -eq 0 ]; then
  echo "5/5 : chaque commande journalisee se rejoue a l'identique."
  exit 0
fi
echo "$echecs commande(s) journalisee(s) ne se rejouent PAS a l'identique."
exit 1
