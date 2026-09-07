#!/usr/bin/env bash
# report.sh [--csv]
#
# Agrege tous les journaux bench/logs/*.log en un tableau : un bras par ligne.
# Colonnes : bras, defaut, mode, critere rouge->vert (oui/non), hors-critere, duree.
#
# La colonne hors-critere est le SECOND axe : formatage, lint, tests voisins et stabilite des
# tests modifies (bench/hors-critere.mjs). Les 6 bras peuvent atteindre le critere ; c'est la
# que se voit ce qu'un bras a laisse derriere lui.
#
# La colonne « rouge->vert » n'est `oui` que si le journal contient LES DEUX preuves :
# un lancement `--role critere-rouge` qui a ECHOUE avant le travail, et un lancement
# `--role critere-vert` qui a REUSSI apres. Un bras qui n'a jamais montre son rouge de
# depart est marque `non (rouge jamais montre)` : sans le rouge, le vert ne prouve rien.
#
# Exit 0 = tableau rendu · 3 = aucun journal a agreger.
set -u

BENCH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORMAT="table"
[ "${1:-}" = "--csv" ] && FORMAT="csv"

shopt -s nullglob
JOURNAUX=( "$BENCH"/logs/*.log )
if [ ${#JOURNAUX[@]} -eq 0 ]; then
  echo "aucun journal dans bench/logs/ — lance d'abord bench/log.sh" >&2
  exit 3
fi

LIGNES="$(
  for j in "${JOURNAUX[@]}"; do
    awk -v fichier="$j" '
      /^# BRAS=/   { bras   = substr($0, 8) }
      /^# DEFAUT=/ { if (substr($0,10) != "-") defaut = substr($0,10) }
      /^# MODE=/   { if (substr($0,8)  != "-") mode   = substr($0,8)  }
      /^# ROLE=/   { role = substr($0, 8) }
      /^# EXIT=/   {
        code = substr($0, 8) + 0
        entrees++
        if (role == "critere-rouge") { rouge_vu = 1; if (code != 0) rouge_ok = 1 }
        if (role == "critere-vert")  { vert_vu  = 1; vert_code = code }
        if (role == "hors-critere")  { hors_vu  = 1; hors_code = code }
      }
      /^# DUREE_S=/ { duree += substr($0, 11) + 0 }
      END {
        if (bras == "") { bras = fichier }
        if (defaut == "") defaut = "-"
        if (mode == "")   mode   = "-"
        if (!hors_vu)            hors = "non mesure"
        else if (hors_code == 0) hors = "propre"
        else                     hors = "defauts (exit " hors_code ")"
        if (!rouge_vu)              verdict = "non (rouge jamais montre)"
        else if (!rouge_ok)         verdict = "non (le rouge de depart passait deja)"
        else if (!vert_vu)          verdict = "non (critere final jamais relance)"
        else if (vert_code == 0)    verdict = "oui"
        else                        verdict = "non (critere final exit " vert_code ")"
        printf "%s\t%s\t%s\t%s\t%s\t%ds\t%d\n", bras, defaut, mode, verdict, hors, duree, entrees
      }
    ' "$j"
  done | sort
)"

if [ "$FORMAT" = "csv" ]; then
  echo "bras,defaut,mode,rouge_vers_vert,hors_critere,duree,lancements"
  printf '%s\n' "$LIGNES" | awk -F'\t' '{ printf "%s,%s,%s,\"%s\",\"%s\",%s,%s\n", $1,$2,$3,$4,$5,$6,$7 }'
  exit 0
fi

echo "RECAPITULATIF DU BANC — $(date +%Y-%m-%dT%H:%M:%S%z)"
echo
{
  printf 'BRAS\tDEFAUT\tMODE\tROUGE->VERT\tHORS-CRITERE\tDUREE\tLANCEMENTS\n'
  printf '%s\n' "$LIGNES"
} | column -t -s $'\t'
echo
echo "$(printf '%s\n' "$LIGNES" | grep -c $'\toui\t') bras sur ${#JOURNAUX[@]} ont fait passer leur critere du rouge au vert."
echo "$(printf '%s\n' "$LIGNES" | grep -c $'\tpropre\t') bras sur ${#JOURNAUX[@]} n'ont rien laisse derriere eux hors du critere (formatage, lint, tests voisins, stabilite)."
