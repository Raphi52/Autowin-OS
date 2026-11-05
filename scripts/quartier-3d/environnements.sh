#!/bin/bash
# Crée les deux environnements Python épinglés de la chaîne 3D du Quartier (conv-1558), hors du dépôt suivi :
#   <données>/env-sculpture (Python 3.12.10) et <données>/env-rendu (Python 3.11.16, bpy).
# <données> = $QUARTIER3D_DONNEES, sinon D:\AutoWinOS\.autowin-data\quartier-3d (ignoré par git).
# Reprenable : un environnement déjà complet est gardé. Usage : bash scripts/quartier-3d/environnements.sh
set -e
ICI=$(cd "$(dirname "$0")" && pwd)
DONNEES=${QUARTIER3D_DONNEES:-$(cd "$ICI/../.." && pwd)/.autowin-data/quartier-3d}
mkdir -p "$DONNEES"
prepare() { # nom version-python fichier-requirements
  local env="$DONNEES/$1"
  if [ -x "$env/Scripts/python.exe" ] && cmp -s "$ICI/$3" "$env/requirements.txt"; then
    echo "$1 : déjà prêt"; return
  fi
  uv venv --quiet --allow-existing --python "$2" "$env"
  uv pip install --quiet --python "$env/Scripts/python.exe" --no-deps -r "$ICI/$3"
  cp "$ICI/$3" "$env/requirements.txt"
  echo "$1 : prêt ($("$env/Scripts/python.exe" --version))"
}
prepare env-sculpture 3.12.10 requirements-sculpture.txt
prepare env-rendu 3.11.16 requirements-rendu.txt
