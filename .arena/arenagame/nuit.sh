#!/usr/bin/env bash
# Nuit arenagame : enchaîne des tournois SANS humain pour améliorer les workflows vers
# « un jeu parfait en UN SEUL prompt ». Chaque manche : 4 bras (A témoin = meilleur workflow
# connu, B et C = variantes proposées par l'améliorateur, X = appel nu), 1 réplique chacun,
# notés par check.mjs ; puis un améliorateur (claude -p) écrit les sys de la manche suivante.
# Arrêts : budget de nuit NUIT_BUDGET_USD (500 $), heure NUIT_FIN_H (9), NUIT_MANCHES (6).
# NUIT_SOURCE = tournoi de départ. S'il est DÉJÀ noté (note-*.json présents), l'améliorateur passe
# AVANT la première manche (m0) : sinon m1 rejouait tel quel les workflows déjà mesurés (conv-826,
# 2026-09-25 : relancer depuis t4 aurait payé ~45 $ pour refaire t4). NUIT_DIR = dossier (tests).
# NUIT_A_FIXE = un sys imposé comme A par l'humain à la PREMIÈRE manche (conv-826, 2026-09-26 : A = B12) ;
# l'améliorateur m0 écrit B et C sur ce texte, les suivants reprennent la règle d'adoption.
set -u
ARENE=D:/AutoWinOS/.arena/arenagame
NUIT=${NUIT_DIR:-$ARENE/essais/nuit-$(date +%F)}
BUDGET_NUIT=${NUIT_BUDGET_USD:-500}; FIN_H=${NUIT_FIN_H:-9}; MANCHES=${NUIT_MANCHES:-6}
export ARENA_BUDGET_USD=${ARENA_BUDGET_USD:-40}
mkdir -p "$NUIT"; LOG=$NUIT/journal.txt
SRC=${NUIT_SOURCE:-$ARENE/essais/nuit-2026-09-25/m6}   # dernière manche notée (conv-826) ; A adopté = son sys-b.txt (B12)
depense() { node -e 'const fs=require("fs"),p=require("path");let t=0;const w=d=>{for(const f of fs.readdirSync(d,{withFileTypes:true})){const q=p.join(d,f.name);if(f.isDirectory()&&/^m\d+$|^ameliore$/.test(f.name))w(q);else if(/^out-.*\.json$/.test(f.name))try{t+=+JSON.parse(fs.readFileSync(q,"utf8")).total_cost_usd||0}catch{}}};w(process.argv[1]);console.log(t.toFixed(2))' "$NUIT"; }
stop() { local h=$(date +%H); h=$((10#$h)); local d=$(depense)
  if [ "$(node -e 'console.log(+process.argv[1]+170>+process.argv[2]?1:0)' "$d" "$BUDGET_NUIT")" = 1 ]; then echo "arrêt : budget ($d \$ dépensés, plafond $BUDGET_NUIT)" >> "$LOG"; return 0; fi
  if [ $h -ge $FIN_H ] && [ $h -lt 18 ]; then echo "arrêt : heure ($h h)" >> "$LOG"; return 0; fi; return 1; }
# ameliorer <manche finie> <archive des bras> <dossier de sortie> <étiquette> : écrit sys-a/b/c dans la sortie.
ameliorer() { local M=$1 TAR=$2 A=$3 k=$4; mkdir -p "$A/moi"
  local fixe=""; [ -n "${A_FIXE:-}" ] && fixe="A est IMPOSÉ par l'humain pour la prochaine manche : sys-a.txt sera la copie exacte de $A_FIXE (le script l'écrit, pas toi). Écris sys-b.txt et sys-c.txt comme variantes de CE texte, et dis-le dans ta section."
  cat > "$A/prompt.txt" <<P
Tu es l'améliorateur de la nuit arenagame (skill D:/AutoWinOS/skills/arenagame/SKILL.md, lis-la). But final : un jeu Clash Royale PARFAIT produit en UN SEUL prompt.
Manche qui vient de finir : $M (note-*.json = check.mjs, out-*.json = coût/tours, sys-a/b/c.txt = workflows injectés ; bras archivés dans $TAR, tu peux les extraire dans $A/moi pour lire le code produit). Journal : $LOG. Historique : $ARENE/historique.jsonl.
Écris dans $A : sys-a.txt = le MEILLEUR workflow mesuré jusqu'ici ; sys-b.txt et sys-c.txt = deux NOUVELLES variantes qui visent les points perdus par les bras (lis les échecs de check.mjs), B = variante de texte, C = variante outil/procédure. Règle pour A : garde l'ancien A sauf si B ou C le bat d'au moins 2 points à coût comparable, OU si B ou C a une note à moins de 1 point de A pour un coût inférieur d'au moins 30 % — la note auto sature près de 52/52 depuis t4 (8 bras entre 50,1 et 52), à note égale c'est le rendement qui départage, OU si la même lignée (les B successifs, ou les C successifs) a battu A en note ET en coût dans chacune des 3 dernières manches (décision humaine conv-826, 2026-09-26 : la lignée B a battu B6 sur les deux axes 5 manches sur 5, et la règle par manche, noyée dans le bruit, ne pouvait pas le voir). Coût d'un bras = total_cost_usd de out-<bras>.json (cumulé sur les reprises) ; pour le décomposer, lis modelUsage dans out-<bras>.tentatives.jsonl, ne suppose aucun prix. Toute règle de JEU chiffrée ou géométrique que tu écris dans une variante (un seuil, une emprise, un délai, une recharge) cite la ligne d'un bras qui passe le test correspondant (fichier:ligne du code extrait) ; sans cette ligne, ne l'écris pas : deux règles écrites de mémoire par l'améliorateur ont fait perdre des points (nuit-2026-09-25 m1 : recharge « +2 en prolongation seulement », −0,4 ; m3 : « teste un point du bord de la tour », −0,9). Puis ajoute à $NUIT/RUN.md une section « ## $k » : notes, gagnant, hypothèse testée par B et C, causes Autowin OS repérées (fichier + ligne).
INTERDIT : modifier check.mjs, cache/, reference/, modele/, tache.txt, les prompt-*.txt, lancer un tournoi, ouvrir une application à l'écran, commit/push.
$fixe
P
  ARENA_ISOLER=0 ARENA_BUDGET_USD=15 bash "$ARENE/lance-bras.sh" "$A" moi "$A/prompt.txt" >/dev/null 2>&1
  for s in a b c; do [ -s "$A/sys-$s.txt" ] || cp "$M/sys-$s.txt" "$A/sys-$s.txt"; done
  if [ -n "${A_FIXE:-}" ]; then cp "$A_FIXE" "$A/sys-a.txt"; echo "$(date) A imposé : $A_FIXE" >> "$LOG"; fi; }
prec=$SRC
if ls "$SRC"/note-*.json >/dev/null 2>&1; then
  TAR0=$(ls "$SRC".bras.tar* 2>/dev/null | head -1)
  echo "$(date) m0 : améliorateur sur la source déjà notée $SRC" >> "$LOG"
  A_FIXE=${NUIT_A_FIXE:-} ameliorer "$SRC" "${TAR0:-$SRC.bras.tar}" "$NUIT/m0/ameliore" m0; prec=$NUIT/m0/ameliore
fi
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
    echo "{\"tournoi\":\"$(basename "$NUIT")-m$k\",\"bras\":\"${b^^}1\",\"jeu\":${n:-null},\"sur\":52,\"cout_usd\":${c:-null}}" >> "$ARENE/historique.jsonl"
    node "$ARENE/clore-run.mjs" "$M/note-$b.json" "$M/out-$b-1.json" >> "$LOG" 2>&1
    echo "m$k $b note=$n cout=$c" >> "$LOG"; done
  tar --force-local -cf "$M.bras.tar" -C "$M" a-1 b-1 c-1 x-1 && tar --force-local -tf "$M.bras.tar" >/dev/null && rm -rf "$M"/a-1 "$M"/b-1 "$M"/c-1 "$M"/x-1
  stop && break
  [ "$k" -lt "$MANCHES" ] || break   # pas d'améliorateur après la dernière manche : ses workflows ne serviraient à aucune
  ameliorer "$M" "$M.bras.tar" "$M/ameliore" "m$k"; prec=$M/ameliore
done
echo "$(date) fin, dépensé $(depense) \$" >> "$LOG"; date > "$NUIT/fin.txt"
