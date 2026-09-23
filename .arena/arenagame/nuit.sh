#!/usr/bin/env bash
# Nuit arenagame : enchaîne des tournois SANS humain pour améliorer les workflows vers
# « un jeu parfait en UN SEUL prompt ». Chaque manche : 4 bras (A témoin = meilleur workflow
# connu, B et C = variantes proposées par l'améliorateur, X = appel nu), 1 réplique chacun,
# notés par check.mjs ; puis un améliorateur (claude -p) écrit les sys de la manche suivante.
# Arrêts : budget de nuit NUIT_BUDGET_USD (500 $), heure NUIT_FIN_H (9), NUIT_MANCHES (6).
set -u
ARENE=D:/AutoWinOS/.arena/arenagame
NUIT=$ARENE/essais/nuit-$(date +%F)
BUDGET_NUIT=${NUIT_BUDGET_USD:-500}; FIN_H=${NUIT_FIN_H:-9}; MANCHES=${NUIT_MANCHES:-6}
export ARENA_BUDGET_USD=${ARENA_BUDGET_USD:-40}
mkdir -p "$NUIT"; LOG=$NUIT/journal.txt
SRC=${NUIT_SOURCE:-$ARENE/essais/t3-2026-09-22}
depense() { node -e 'const fs=require("fs"),p=require("path");let t=0;const w=d=>{for(const f of fs.readdirSync(d,{withFileTypes:true})){const q=p.join(d,f.name);if(f.isDirectory()&&/^m\d+$|^ameliore$/.test(f.name))w(q);else if(/^out-.*\.json$/.test(f.name))try{t+=+JSON.parse(fs.readFileSync(q,"utf8")).total_cost_usd||0}catch{}}};w(process.argv[1]);console.log(t.toFixed(2))' "$NUIT"; }
stop() { local h=$(date +%H); h=$((10#$h)); local d=$(depense)
  if [ "$(node -e 'console.log(+process.argv[1]+170>+process.argv[2]?1:0)' "$d" "$BUDGET_NUIT")" = 1 ]; then echo "arrêt : budget ($d \$ dépensés, plafond $BUDGET_NUIT)" >> "$LOG"; return 0; fi
  if [ $h -ge $FIN_H ] && [ $h -lt 18 ]; then echo "arrêt : heure ($h h)" >> "$LOG"; return 0; fi; return 1; }
prec=$SRC
for k in $(seq 1 $MANCHES); do
  stop && break
  M=$NUIT/m$k; mkdir -p "$M"; echo "$(date) manche m$k" >> "$LOG"
  cp "$SRC/tache.txt" "$SRC"/prompt-*.txt "$M/"
  for s in a b c; do cp "$prec/sys-$s.txt" "$M/"; done
  : > "$M/manifeste.txt"
  for b in a b c x; do cp -r "$ARENE/modele" "$M/$b-1"; echo "$M/$b-1" >> "$M/manifeste.txt"; done
  for b in a b c x; do bash "$ARENE/lance-bras.sh" "$M" $b-1 "$M/prompt-$b.txt" $( [ $b = x ] || echo "$M/sys-$b.txt" ) & done; wait
  for b in a b c x; do node "$ARENE/check.mjs" "$M/$b-1" > "$M/note-$b.json" 2>/dev/null
    n=$(node -e 'try{console.log(require(process.argv[1]).auto)}catch{console.log("")}' "$M/note-$b.json")
    c=$(node -e 'try{console.log(require(process.argv[1]).total_cost_usd)}catch{console.log("")}' "$M/out-$b-1.json")
    echo "{\"tournoi\":\"nuit-$(date +%F)-m$k\",\"bras\":\"${b^^}1\",\"jeu\":${n:-null},\"sur\":52,\"cout_usd\":${c:-null}}" >> "$ARENE/historique.jsonl"
    echo "m$k $b note=$n cout=$c" >> "$LOG"; done
  tar -cf "$M.bras.tar" -C "$M" a-1 b-1 c-1 x-1 && tar -tf "$M.bras.tar" >/dev/null && rm -rf "$M"/a-1 "$M"/b-1 "$M"/c-1 "$M"/x-1
  stop && break
  A=$M/ameliore; mkdir -p "$A/moi"
  cat > "$A/prompt.txt" <<P
Tu es l'améliorateur de la nuit arenagame (skill D:/AutoWinOS/skills/arenagame/SKILL.md, lis-la). But final : un jeu Clash Royale PARFAIT produit en UN SEUL prompt.
Manche qui vient de finir : $M (note-*.json = check.mjs, out-*.json = coût/tours, sys-a/b/c.txt = workflows injectés ; bras archivés dans $M.bras.tar, tu peux les extraire dans $A/moi pour lire le code produit). Journal : $LOG. Historique : $ARENE/historique.jsonl.
Écris dans $A : sys-a.txt = le MEILLEUR workflow mesuré jusqu'ici (garde l'ancien A sauf si B ou C le bat d'au moins 2 points à coût comparable) ; sys-b.txt et sys-c.txt = deux NOUVELLES variantes qui visent les points perdus par les bras (lis les échecs de check.mjs), B = variante de texte, C = variante outil/procédure. Puis ajoute à $NUIT/RUN.md une section « ## m$k » : notes, gagnant, hypothèse testée par B et C, causes Autowin OS repérées (fichier + ligne).
INTERDIT : modifier check.mjs, cache/, reference/, modele/, tache.txt, les prompt-*.txt, lancer un tournoi, ouvrir une application à l'écran, commit/push.
P
  ARENA_BUDGET_USD=15 bash "$ARENE/lance-bras.sh" "$A" moi "$A/prompt.txt" >/dev/null 2>&1
  for s in a b c; do [ -s "$A/sys-$s.txt" ] || cp "$M/sys-$s.txt" "$A/sys-$s.txt"; done
  prec=$A
done
echo "$(date) fin, dépensé $(depense) \$" >> "$LOG"; date > "$NUIT/fin.txt"
