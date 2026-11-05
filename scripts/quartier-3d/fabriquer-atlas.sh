#!/bin/bash
# Refabrique l'atlas v3 d'un animal du Quartier (conv-1558) depuis les sources du dépôt : sculpture → poses → 303 rendus
# Cycles → montage ×2 en 28 rangées. Prérequis : bash scripts/quartier-3d/environnements.sh (une fois), Node et le
# node_modules du dépôt.
# Reprenable : une case déjà rendue est sautée ; relancer après une coupure reprend où ça s'était arrêté.
# Usage : [ANIMAL=tanuki|renard|panda|panda-roux] bash scripts/quartier-3d/fabriquer-atlas.sh [sortie.avif]
#   TRAVAIL  dossier des produits intermédiaires (défaut <données>/travail/<modèle>)
#   PAR      rendus en parallèle (2 par défaut ; ~20 s par case à deux, ~50 min par animal sur 16 fils)
# Le tanuki a trois visages de plus (content au bain, endormi au bain, surpris) : trois sculptures EXPR de tanuki-v3.py.
# Les autres animaux jouent les mêmes cases avec leur visage habituel.
# À la fin il compare la sortie à l'atlas livré de l'animal, octet pour octet.
set -e
ICI=$(cd "$(dirname "$0")" && pwd)
RACINE=$(cd "$ICI/../.." && pwd)
DONNEES=${QUARTIER3D_DONNEES:-$RACINE/.autowin-data/quartier-3d}
export PY_RENDU=$DONNEES/env-rendu/Scripts/python.exe
PY_SCULPTURE=$DONNEES/env-sculpture/Scripts/python.exe
[ -x "$PY_RENDU" ] && [ -x "$PY_SCULPTURE" ] || { echo "Environnements absents : bash $ICI/environnements.sh"; exit 2; }
ANIMAL=${ANIMAL:-tanuki}
case "$ANIMAL" in
  tanuki) SCULPTURE=tanuki-v3.py; MOD=v3; VISAGES='joie endormi surpris'; LIVRE=atlas.avif ;;
  renard | panda | panda-roux) SCULPTURE=$ANIMAL-v3.py; MOD=$ANIMAL-v3; VISAGES=''; LIVRE=atlas-$ANIMAL.avif ;;
  *) echo "Animal inconnu : $ANIMAL (tanuki, renard, panda, panda-roux)"; exit 2 ;;
esac
TRAVAIL=${TRAVAIL:-$DONNEES/travail/$MOD}
SORTIE=$(realpath -m "${1:-$TRAVAIL/atlas.avif}")
mkdir -p "$TRAVAIL/b3d" "$TRAVAIL/f-$MOD" "$TRAVAIL/f-plus-$MOD" "$TRAVAIL/f-plante-$MOD" "$TRAVAIL/f-visages-$MOD"
cd "$TRAVAIL"
export RES=600 ECH=16
debut=$(date +%s)

# Une sculpture prête à poser : le modèle, la longueur de poil de la queue (effilée, et plus courte au sabre), la base
# (faces, couleurs, matières) que lisent les rendus parallèles.
preparer() { # modèle EXPR
  local m=$1
  if [ ! -s b3d/$m-hd.json ]; then
    FIN=3 EXPR=$2 "$PY_SCULPTURE" -I "$ICI/$SCULPTURE" 1500000 b3d/$m-hd.json.tmp > b3d/sculpture-$m.log 2>&1 \
      || { tail -5 b3d/sculpture-$m.log; exit 3; }
    mv b3d/$m-hd.json.tmp b3d/$m-hd.json
    echo "sculpture $m $(( $(date +%s) - debut )) s"
  fi
  # Queue effilée : 0,30 et 0,3 partout, 0,22 et 0 pour le sabre (queue-effilee.py).
  "$PY_SCULPTURE" -I "$ICI/queue-effilee.py" b3d/$m-hd.json b3d/base-$m.queue.bin > /dev/null
  "$PY_SCULPTURE" -I "$ICI/queue-effilee.py" b3d/$m-hd.json b3d/base-$m.queue-kendo.bin .22 0 > /dev/null
  MODELE=$m node "$ICI/pose-b3d.mjs" b3d/base-$m.pose.bin 0 > /dev/null
  rm -f b3d/base-$m.pose.bin
}
preparer $MOD doux
for v in $VISAGES; do preparer $MOD-$v $v; done

rendre() { # dossier liste [PLANTE]
  F=$1 PLANTE=$3 xargs -d '\n' -P ${PAR:-2} -I{} bash "$ICI/un-case.sh" "{}" < "$2"
}
export MODELE=$MOD
rendre f-$MOD "$ICI/liste-base.txt"
rendre f-plus-$MOD "$ICI/liste-plus.txt"
rendre f-plante-$MOD "$ICI/liste-plante.txt" 1
# Les cases à visage : « visage|case ». Le tanuki prend la sculpture du visage, les autres animaux la leur.
if [ -n "$VISAGES" ]; then
  for v in $VISAGES; do
    grep "^$v|" "$ICI/liste-visages.txt" | cut -d'|' -f2- > b3d/liste-$v.txt
    MODELE=$MOD-$v rendre f-visages-$MOD b3d/liste-$v.txt
  done
else
  grep -v '^#' "$ICI/liste-visages.txt" | cut -d'|' -f2- > b3d/liste-visages.txt
  rendre f-visages-$MOD b3d/liste-visages.txt
fi
echo "rendus finis en $(( $(date +%s) - debut )) s"
# atlas-v3.py vérifie lui-même chaque case de ses 28 rangées : une case manquante (rendu en échec) l'arrête, code 1.
"$PY_RENDU" -I "$ICI/atlas-v3.py" f-$MOD f-plus-$MOD f-plante-$MOD f-visages-$MOD "$SORTIE" 2 || exit 4
REF="$RACINE/src/renderer/src/assets/quartier/$LIVRE"
if cmp -s "$SORTIE" "$REF"; then echo "IDENTIQUE à $REF"; else echo "DIFFÉRENT de $REF"; fi
