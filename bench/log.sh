#!/usr/bin/env bash
# log.sh --bras <bras> [--defaut D1] [--mode pipeline|direct] [--role bras|critere-rouge|critere-vert|hors-critere]
#        [--cwd <dossier>] -- <commande...>
#
# Lance la commande, la journalise dans bench/logs/<bras>.log et rend SON code de sortie
# (donc `bench/log.sh ... -- faux` echoue comme la commande elle-meme : le journal ne blanchit rien).
#
# Ce qui est ecrit pour chaque lancement : horodatage, dossier, commande exacte, sortie standard,
# sortie d'erreur, code de sortie, duree. Le journal est en AJOUT seul : un bras relance garde
# la trace de ses essais precedents — c'est ce qui permet de voir un rouge devenu vert.
#
# --role sert au recapitulatif : `critere-rouge` = le critere AVANT le travail (doit echouer),
# `critere-vert` = le meme critere APRES (doit reussir). report.sh ne lit que ces deux-la pour
# dire si le bras a vraiment fait passer le rouge au vert.
#
# Exit = celui de la commande · 1 = usage invalide.
set -u

BRAS=""; DEFAUT="-"; MODE="-"; ROLE="bras"; CWD=""
while [ $# -gt 0 ]; do
  case "$1" in
    --bras)   BRAS="${2:-}"; shift 2 ;;
    --defaut) DEFAUT="${2:-}"; shift 2 ;;
    --mode)   MODE="${2:-}"; shift 2 ;;
    --role)   ROLE="${2:-}"; shift 2 ;;
    --cwd)    CWD="${2:-}"; shift 2 ;;
    --)       shift; break ;;
    *) echo "option inconnue : $1" >&2; exit 1 ;;
  esac
done

if [ -z "$BRAS" ] || [ $# -eq 0 ]; then
  echo "usage: bench/log.sh --bras <bras> [--defaut D1] [--mode pipeline|direct] [--role bras|critere-rouge|critere-vert|hors-critere] [--cwd <dossier>] -- <commande...>" >&2
  exit 1
fi
case "$ROLE" in
  bras|critere-rouge|critere-vert|hors-critere) ;;
  *) echo "role inconnu : $ROLE (attendu bras, critere-rouge, critere-vert ou hors-critere)" >&2; exit 1 ;;
esac
case "$BRAS" in */*|*\*) echo "nom de bras invalide : $BRAS" >&2; exit 1 ;; esac

BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$BENCH/logs"
JOURNAL="$BENCH/logs/$BRAS.log"
[ -n "$CWD" ] || CWD="$(pwd)"

# La commande telle qu'elle sera relancable a la main, arguments proteges.
# Un argument simple reste lisible tel quel ; des qu'il porte un espace, un guillemet ou un
# caractere special, il passe par `printf %q` — la protection NATIVE de bash. Une detection
# maison a deja laisse passer un `bash -c "..."` non protege : le journal affichait alors une
# commande qui ne se relancait pas. Le test bench/log-quoting.test.sh rejoue ce cas.
CMD_TXT=""
for a in "$@"; do
  case "$a" in
    '') CMD_TXT="$CMD_TXT ''" ;;
    *[!A-Za-z0-9_@%+=:,./-]*) CMD_TXT="$CMD_TXT $(printf '%q' "$a")" ;;
    *) CMD_TXT="$CMD_TXT $a" ;;
  esac
done
CMD_TXT="${CMD_TXT# }"

SORTIE="$(mktemp)"; ERREUR="$(mktemp)"
DEBUT="$(date +%s)"
( cd "$CWD" && "$@" ) >"$SORTIE" 2>"$ERREUR"
CODE=$?
FIN="$(date +%s)"
DUREE=$(( FIN - DEBUT ))

{
  echo "=== ENTREE ==="
  echo "# TS=$(date +%Y-%m-%dT%H:%M:%S%z)"
  echo "# BRAS=$BRAS"
  echo "# DEFAUT=$DEFAUT"
  echo "# MODE=$MODE"
  echo "# ROLE=$ROLE"
  echo "# CWD=$CWD"
  echo "# CMD=$CMD_TXT"
  echo "--- STDOUT ---"
  cat "$SORTIE"
  echo "--- STDERR ---"
  cat "$ERREUR"
  echo "# EXIT=$CODE"
  echo "# DUREE_S=$DUREE"
  echo "=== FIN ENTREE ==="
} >> "$JOURNAL"

rm -f "$SORTIE" "$ERREUR"
echo "[log] $BRAS/$ROLE exit=$CODE duree=${DUREE}s -> ${JOURNAL#$BENCH/}" >&2
exit $CODE
