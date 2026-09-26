#!/bin/sh
# Usage : note.sh <chemin/RechercheArbre.cs candidat>  -> derniere ligne « NOTE n/100 »
C=$(cygpath -w "$(realpath "$1")")
D=$(dirname "$0")/correcteur
dotnet build "$D/Correcteur.csproj" -nologo -v q -p:Candidat="$C" -o "$D/bin/out" > "$D/build.log" 2>&1 \
  || { grep -E "error CS" "$D/build.log" | head -20; echo "NOTE 0/100 (ne compile pas)"; exit 1; }
timeout 300 dotnet "$D/bin/out/Correcteur.dll"
