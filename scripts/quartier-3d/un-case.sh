#!/bin/bash
# Une case d'atlas (conv-1558, ex-un-v3.sh) : la pose (node + marionnette.js), puis le rendu Cycles.
# Lancé par fabriquer-atlas.sh, depuis le dossier de travail (il lit b3d/ et écrit dans $F).
# Lignes acceptées : celles de liste-*.txt (X|…, …|b3d|…, …|etat|…) et, avec PLANTE=1, celles de liste-plante.txt.
# Variables : MODELE, F (dossier de sortie), RES (600 = ×2), ECH (échantillons), PY_RENDU (python de env-rendu).
ICI=$(cd "$(dirname "$0")" && pwd)
B=$PY_RENDU
F=${F:-f-$MODELE}
export SANS_BASE=1 RES=${RES:-600}
E=${ECH:-48}
t0=$(date +%s)
if [ -n "$PLANTE" ]; then
  IFS='|' read -r nom g t d yaw objet <<< "$1"
  [ -f $F/$nom.png ] && exit 0
  node "$ICI/pose-plante.mjs" $F/$nom.bin "$g" "$t" "$d" > /dev/null 2>$F/$nom.err || { echo "ECHEC pose $nom"; exit 0; }
  ECH=$E $B -I "$ICI/sprite-plante-v3.py" $F/$nom.bin $F/$nom.png "$yaw" "$objet" > $F/$nom.log 2>&1 || { echo "ECHEC rendu $nom"; tail -3 $F/$nom.log; exit 0; }
elif [[ "$1" == X\|* ]]; then
  IFS='|' read -r _ nom g t d e yaw objet ph <<< "$1"
  [ -f $F/$nom.png ] && exit 0
  # Le sabre (ke-*) : sa case est décalée de 32 px vers l'avant, la queue y garde un bout plus court (conv-1558).
  [[ "$nom" == ke-* ]] && [ -z "$QUEUE" ] && export QUEUE=b3d/base-$MODELE.queue-kendo.bin
  node "$ICI/pose.mjs" $F/$nom.bin "$g" "$t" "$d" "$e" > /dev/null 2>$F/$nom.err || { echo "ECHEC pose $nom"; exit 0; }
  ECH=$E $B -I "$ICI/sprite-atlas-v3.py" $F/$nom.bin $F/$nom.png "$yaw" "$objet" "$ph" > $F/$nom.log 2>&1 || { echo "ECHEC rendu $nom"; tail -3 $F/$nom.log; exit 0; }
else
  IFS='|' read -r nom k a1 a2 a3 yaw objet ech <<< "$1"
  [ -f $F/$nom.png ] && exit 0
  if [ "$k" = b3d ]; then
    if [ -n "$a2" ]; then node "$ICI/pose-b3d.mjs" $F/$nom.bin "$a1" "$a2" "$a3" > /dev/null 2>$F/$nom.err; else node "$ICI/pose-b3d.mjs" $F/$nom.bin "$a1" > /dev/null 2>$F/$nom.err; fi || { echo "ECHEC pose $nom"; exit 0; }
  else
    node "$ICI/pose-etat.mjs" $F/$nom.bin "$a1" "$a2" "$a3" > /dev/null 2>$F/$nom.err || { echo "ECHEC pose $nom"; exit 0; }
  fi
  if [ -n "$objet" ]; then ECH=$E $B -I "$ICI/sprite-atlas-v3.py" $F/$nom.bin $F/$nom.png "$yaw" "$objet" > $F/$nom.log 2>&1; else ECH=$E $B -I "$ICI/sprite-atlas-v3.py" $F/$nom.bin $F/$nom.png "$yaw" > $F/$nom.log 2>&1; fi || { echo "ECHEC rendu $nom"; tail -3 $F/$nom.log; exit 0; }
fi
echo "ok $nom $(( $(date +%s) - t0 )) s"
rm -f $F/$nom.err $F/$nom.log $F/$nom.bin $F/$nom.bin.json
