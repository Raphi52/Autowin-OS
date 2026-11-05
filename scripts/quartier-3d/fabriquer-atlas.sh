#!/bin/bash
# Refabrique l'atlas du tanuki v3 (conv-1558) depuis les sources du dépôt : sculpture → poses → 279 rendus Cycles
# → montage ×2. Prérequis : bash scripts/quartier-3d/environnements.sh (une fois), Node et le node_modules du dépôt.
# Reprenable : une case déjà rendue est sautée ; relancer après une coupure reprend où ça s'était arrêté.
# Usage : bash scripts/quartier-3d/fabriquer-atlas.sh [sortie.avif]
#   TRAVAIL  dossier des produits intermédiaires (défaut <données>/travail/v3)
#   PAR      rendus en parallèle (2 par défaut, ~2 h 30 pour les 279 cases sur 16 fils)
# À la fin il compare la sortie à src/renderer/src/assets/quartier/atlas.avif, octet pour octet.
set -e
ICI=$(cd "$(dirname "$0")" && pwd)
RACINE=$(cd "$ICI/../.." && pwd)
DONNEES=${QUARTIER3D_DONNEES:-$RACINE/.autowin-data/quartier-3d}
export PY_RENDU=$DONNEES/env-rendu/Scripts/python.exe
PY_SCULPTURE=$DONNEES/env-sculpture/Scripts/python.exe
[ -x "$PY_RENDU" ] && [ -x "$PY_SCULPTURE" ] || { echo "Environnements absents : bash $ICI/environnements.sh"; exit 2; }
TRAVAIL=${TRAVAIL:-$DONNEES/travail/v3}
SORTIE=$(realpath -m "${1:-$TRAVAIL/atlas.avif}")
mkdir -p "$TRAVAIL/b3d" "$TRAVAIL/f-v3" "$TRAVAIL/f-plus-v3" "$TRAVAIL/f-plante-v3"
cd "$TRAVAIL"
export MODELE=v3 RES=600 ECH=16
debut=$(date +%s)
if [ ! -s b3d/v3-hd.json ]; then
  FIN=3 EXPR=doux "$PY_SCULPTURE" -I "$ICI/tanuki-v3.py" 1500000 b3d/v3-hd.json.tmp > b3d/sculpture.log 2>&1 \
    || { tail -5 b3d/sculpture.log; exit 3; }
  mv b3d/v3-hd.json.tmp b3d/v3-hd.json
  echo "sculpture $(( $(date +%s) - debut )) s"
fi
# Queue effilée : 0,30 et 0,3 partout, 0,22 et 0 pour le sabre (queue-effilee.py).
"$PY_SCULPTURE" -I "$ICI/queue-effilee.py" b3d/v3-hd.json b3d/base-v3.queue.bin > /dev/null
"$PY_SCULPTURE" -I "$ICI/queue-effilee.py" b3d/v3-hd.json b3d/base-v3.queue-kendo.bin .22 0 > /dev/null
node "$ICI/pose-b3d.mjs" f-v3/base.bin 0 > /dev/null
rm -f f-v3/base.bin
F=f-v3 xargs -d '\n' -P ${PAR:-2} -I{} bash "$ICI/un-case.sh" "{}" < "$ICI/liste-base.txt"
F=f-plus-v3 xargs -d '\n' -P ${PAR:-2} -I{} bash "$ICI/un-case.sh" "{}" < "$ICI/liste-plus.txt"
F=f-plante-v3 PLANTE=1 xargs -d '\n' -P ${PAR:-2} -I{} bash "$ICI/un-case.sh" "{}" < "$ICI/liste-plante.txt"
n=$(ls f-v3/*.png f-plus-v3/*.png f-plante-v3/*.png | wc -l)
echo "RENDUS $n/279 en $(( $(date +%s) - debut )) s"
[ "$n" -eq 279 ] || exit 4
"$PY_RENDU" -I "$ICI/atlas-v3.py" f-v3 f-plus-v3 f-plante-v3 "$SORTIE" 2
REF="$RACINE/src/renderer/src/assets/quartier/atlas.avif"
if cmp -s "$SORTIE" "$REF"; then echo "IDENTIQUE à $REF"; else echo "DIFFÉRENT de $REF"; fi
