#!/usr/bin/env bash
# Lance UN bras du banc arenagame et le mène au bout malgré la limite de session Claude.
# Usage : lance-bras.sh <dossier du tournoi> <bras-replique> <fichier prompt> [fichier sys]
#
# Pourquoi (bras coupés vers 30 min en t2b, t2v, t3) : voir skills/arenagame/SKILL.md. Une coupure
# n'arrête plus le bras : on attend la remise à zéro annoncée puis on REPREND la session (--resume).
# Sorties : out-<bras>.json (dernier résultat, coût et tours CUMULÉS, champ `reprises`),
#           out-<bras>.tentatives.jsonl (chaque sortie brute), attente-<bras>.txt (attentes).
# Réglages : ARENA_BUDGET_USD (40), ARENA_REPRISES_MAX (10), ARENA_ATTENTE_S (force l'attente,
#            pour les tests), ARENA_MARGE_S (120 s après l'heure annoncée).
set -u
BANC=$1; BRAS=$2; PROMPT=$3; SYS=${4:-}
BUDGET=${ARENA_BUDGET_USD:-40}
MAX=${ARENA_REPRISES_MAX:-10}
MARGE=${ARENA_MARGE_S:-120}
# Bras ISOLÉS des réglages personnels (~/.claude/settings.json) : son hook Brain injectait des notes
# d'un vrai projet voisin dans chaque bras depuis le 24/09 (X délégué, +25 % de coût). Opt-out :
# ARENA_AVEC_HOOKS_PERSO=1.                                                                                                      
ISOLE='--setting-sources project,local'; [ -n "${ARENA_AVEC_HOOKS_PERSO:-}" ] && ISOLE=''
ARENE=$(cd "$(dirname "$0")" && pwd)   # AVANT le cd : $0 peut être relatif
MOD=${ARENA_MODELE:+--model $ARENA_MODELE}   # tests à blanc sur un modèle bon marché ; vide = modèle par défaut
[ -d "$BANC/$BRAS" ] || exit 1
ERR="$BANC/err-$BRAS.txt"
# BRAS HORS DU DÉPÔT (2026-09-26, conv-826). Le bras tournait dans $BANC/$BRAS, DANS D:\AutoWinOS : son chemin
# menait au banc (nuit-2026-09-26 m1 : un bras a lu .arena/arenagame/lance-bras.sh) et son RUN.md vivait sous
# ~\.claude\runs, où il listait les bras voisins et les runs des autres conversations. Désormais :
#  (1) sa copie part hors du dépôt le temps du bras (renommage, même disque), puis revient pour la notation ;
#  (2) son RUN.md vit sous une racine à lui, écrite dans out.json (`runs_racine`) pour clore-run.mjs ;
#  (3) des interdictions (--settings) ferment le dépôt, ~\.claude\runs et ~\.claude\projects aux outils de
#      fichiers ET aux commandes qui les nomment — elles valent aussi en --dangerously-skip-permissions.
#      Limite (https://code.claude.com/docs/en/permissions) : un script qui ouvre ces fichiers lui-même n'est
#      pas bloqué ; seul un bac à sable du système le serait.
# ARENA_ISOLER=0 désactive : l'améliorateur de nuit.sh DOIT lire le banc. ARENA_ISOLES = racine (D:/bras-isoles).
TRAVAIL="$BANC/$BRAS"; EXT=""; RUNS=""; REGLES=""
if [ "${ARENA_ISOLER:-1}" != 0 ]; then
  EXT=${ARENA_ISOLES:-D:/bras-isoles}/$(basename "$(dirname "$BANC")")-$(basename "$BANC")-$BRAS
  [ -e "$EXT" ] && EXT="$EXT-$$"   # jamais d'écrasement d'un reste de bras précédent
  mkdir -p "$EXT/runs" && mv "$BANC/$BRAS" "$EXT/jeu" || { echo "isolement impossible ($EXT)" >> "$ERR"; exit 1; }
  TRAVAIL="$EXT/jeu"; RUNS="$EXT/runs"
  REPO=$(cd "$ARENE/../.." && pwd); PERSO=$(cygpath -u "$USERPROFILE")
  REGLES="$BANC/isolement-$BRAS.json"   # dans le dépôt : le bras ne peut pas le lire
  # Forme exigée par Claude Code sous Windows : C:\Users\x → /c/Users/x, préfixé de / pour un chemin absolu (//c/…).
  node -e 'const px=(p)=>"/"+p.replace(/\\/g,"/").replace(/^\/?([A-Za-z]):?\//,(m,l)=>"/"+l.toLowerCase()+"/");
    const [r,h,f]=process.argv.slice(1).map((a,i)=>i<2?px(a):a);const d=[];
    for(const p of [r,h+"/.claude/runs"])d.push(`Read(${p}/**)`,`Edit(${p}/**)`);d.push(`Read(${h}/.claude/projects/**)`);
    for(const t of ["Bash","PowerShell"])for(const m of ["*AutoWinOS*",            "*.claude*runs*","*.claude*projects*"])d.push(`${t}(${m})`);
    require("fs").writeFileSync(f,JSON.stringify({permissions:{deny:d}},null,1))' "$REPO" "$PERSO" "$REGLES"
  for v in $(compgen -e | grep '^NUIT_'); do unset "$v"; done   # NUIT_DIR, NUIT_SOURCE… pointaient vers le banc
fi
# Rendre la copie à sa place : avant la notation, et aussi si le script est interrompu.
rendre() {
  [ -n "$EXT" ] && [ -d "$EXT/jeu" ] || return 0
  for i in 1 2 3 4 5 6; do mv "$EXT/jeu" "$BANC/$BRAS" 2>/dev/null && return 0; sleep 10; done
  cp -r "$EXT/jeu" "$BANC/$BRAS" && echo "copie isolée RECOPIÉE (renommage refusé), reste : $EXT/jeu" >> "$ERR"
}
trap rendre EXIT; trap 'rendre; exit 143' TERM INT
cd "$TRAVAIL" || exit 1
# BRAS ISOLÉS DE LA MÉMOIRE D'AUTOWIN (2026-09-26, conv-826). Le dossier du bras est DANS le dépôt git
# D:\AutoWinOS ; or la mémoire automatique de Claude Code est partagée par tout un dépôt, sous-dossiers
# compris (https://code.claude.com/docs/en/memory : « all worktrees and subdirectories within the same
# git repository share one auto memory directory »). Mesuré nuit-2026-09-25 m2 à m5 : les 4 bras, appel nu
# compris, lisaient d'abord ~\.claude\projects\D--AutoWinOS\memory\arenagame-*.md, et b-1 / c-1 y
# écrivaient leurs leçons — X n'était plus un appel nu, et les manches n'étaient plus indépendantes.
export CLAUDE_CODE_DISABLE_AUTO_MEMORY=1
# CONSIGNE À 4 SKILLS : copie du sys complétée par clean + judge (voir SKILL.md). Opt-out : ARENA_SANS_CLEAN_JUDGE=1.
SKILLS=D:/AutoWinOS/skills
if [ -n "$SYS" ] && [ -z "${ARENA_SANS_CLEAN_JUDGE:-}" ]; then
  EFF="$BANC/sys-effectif-$BRAS.txt"; cp "$SYS" "$EFF"
  grep -q '^=== CLEAN ===$' "$EFF" || { printf '
=== CLEAN ===
' >> "$EFF"; cat "$SKILLS/clean/SKILL.md" >> "$EFF"; }
  grep -q '^=== JUDGE ===$' "$EFF" || { printf '
=== JUDGE ===
' >> "$EFF"; cat "$SKILLS/judge/SKILL.md" >> "$EFF"; }
  printf '
Applique aussi, après build : clean (trace CLEAN-VERIFIED ou CLEAN-NOOP dans le RUN.md), puis judge (coche chaque case de ## Besoin prouvée).
Là où ton workflow (le texte AVANT === CLEAN ===) contredit CLEAN ou JUDGE — sous-agents, nombre ou modèle des juges —, ton workflow prime. Des juges « en parallèle » se lancent dans UN seul message, au premier plan : jamais run_in_background, jamais ScheduleWakeup.
' >> "$EFF"
  SYS=$EFF
fi
if [ -n "$SYS" ] && [ -n "$RUNS" ]; then
  [ "$SYS" = "$BANC/sys-effectif-$BRAS.txt" ] || { cp "$SYS" "$BANC/sys-effectif-$BRAS.txt"; SYS="$BANC/sys-effectif-$BRAS.txt"; }
  RW=$(cygpath -w "$RUNS")
  printf '\n=== BANC ISOLÉ (prime sur tout chemin de RUN.md cité plus haut) ===\nIci la racine des runs n'\''est PAS ~\\.claude\\runs mais %s : ton RUN.md est %s\\<session_id>\\<sujet>-workspace\\RUN.md, même forme et même en-tête. Ton dossier de travail est ta copie du projet.\n' "$RW" "$RW" >> "$SYS"
fi
PERM=""; [ -n "$REGLES" ] && PERM="--settings $REGLES"
OUT="$BANC/out-$BRAS.json"; TENT="$BANC/out-$BRAS.tentatives.jsonl"
: > "$TENT"
REPRISE_MSG="Ta session a été coupée par la limite d'utilisation. Reprends exactement là où tu t'es arrêté et mène la tâche initiale jusqu'au bout."

champ() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const v=j[process.argv[1]];console.log(v===undefined?"":v)}catch{console.log("")}})' "$1"; }

sid=""; n=0
while :; do
  # Coût déjà dépensé = le PLUS GRAND total_cost_usd des segments, pas leur somme : `--resume` rend un
  # coût CUMULÉ sur toute la session (voir la note au-dessus du calcul de out-<bras>.json).
  depense=$(node -e 'const fs=require("fs");let t=0;for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n"))if(l.trim())try{t=Math.max(t,+JSON.parse(l).total_cost_usd||0)}catch{};console.log(t)' "$TENT")
  reste=$(node -e 'console.log(Math.max(0,(+process.argv[1])-(+process.argv[2])).toFixed(2))' "$BUDGET" "$depense")
  if [ "$(node -e 'console.log(+process.argv[1]<0.5?1:0)' "$reste")" = 1 ]; then echo "budget épuisé ($depense \$)" >> "$ERR"; break; fi
  if [ -z "$sid" ]; then
    if [ -n "$SYS" ]; then r=$(claude $ISOLE $PERM $MOD -p "$(cat "$PROMPT")" --append-system-prompt-file "$SYS" --output-format json --dangerously-skip-permissions --max-budget-usd "$reste" 2>>"$ERR")
    else r=$(claude $ISOLE $PERM $MOD -p "$(cat "$PROMPT")" --output-format json --dangerously-skip-permissions --max-budget-usd "$reste" 2>>"$ERR"); fi
  else
    r=$(claude $ISOLE $PERM $MOD -p "$REPRISE_MSG" --resume "$sid" --output-format json --dangerously-skip-permissions --max-budget-usd "$reste" 2>>"$ERR")
  fi
  code=$?
  echo "$r" | tr -d '\n' >> "$TENT"; echo >> "$TENT"
  s=$(echo "$r" | champ session_id); [ -n "$s" ] && sid=$s
  res=$(echo "$r" | champ result)
  if echo "$res" | grep -qiE "session limit|usage limit|limit reached|hit your .*limit"; then
    n=$((n+1))
    if [ "$n" -gt "$MAX" ] || [ -z "$sid" ]; then echo "coupé, reprise impossible (n=$n, sid='$sid')" >> "$ERR"; break; fi
    if [ -n "${ARENA_ATTENTE_S:-}" ]; then att=$ARENA_ATTENTE_S
    else att=$(node -e '
      const m=/resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(process.argv[1]);const now=new Date();
      if(!m){console.log(3600);process.exit()}
      let h=+m[1]%12;if((m[3]||"").toLowerCase()==="pm")h+=12;if(!m[3]&&+m[1]===12)h=12;
      const t=new Date(now);t.setHours(h,+(m[2]||0),0,0);if(t<=now)t.setDate(t.getDate()+1);
      console.log(Math.round((t-now)/1000)+(+process.argv[2]))' "$res" "$MARGE"); fi
    echo "$(date '+%F %T') coupure $n : « $res » → attente ${att}s puis reprise de $sid" >> "$BANC/attente-$BRAS.txt"
    sleep "$att"
    continue
  fi
  break
done

# out-<bras>.json = dernier résultat, avec coût, tours et durée CUMULÉS sur toutes les reprises.
# COÛT = le plus grand total_cost_usd des segments, TOURS et DURÉE = leur somme (2026-09-26, conv-826).
# `claude -p --resume` rend un total_cost_usd et un modelUsage déjà cumulés sur toute la session, alors
# que num_turns, duration_ms et usage ne couvrent que le segment. Preuve, m5 a-1 de nuit-2026-09-25 :
# segment 2 modelUsage.cacheReadInputTokens 7 439 605 = 3 236 245 (segment 1) + 4 203 360 (usage du
# segment 2) ; coût 3,78 $ puis 9,03 $. L'ancienne somme annonçait 12,80 $ pour 9,03 $ réels.
# Limite connue : un bras qui lance des tâches de fond ne rend que le dernier segment dans num_turns et
# duration_ms (m1 à m4) — les tours réels se lisent alors dans le journal de session.
node -e '
const fs=require("fs");const L=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(l=>l.trim()).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
if(!L.length){process.exit(1)}
const d={...L[L.length-1]};d.total_cost_usd=L.reduce((a,j)=>Math.max(a,+j.total_cost_usd||0),0);d.num_turns=L.reduce((a,j)=>a+(+j.num_turns||0),0);
d.duration_ms=L.reduce((a,j)=>a+(+j.duration_ms||0),0);d.reprises=L.length-1;if(process.argv[3])d.runs_racine=process.argv[3];fs.writeFileSync(process.argv[2],JSON.stringify(d))' "$TENT" "$OUT" "$( [ -n "$RUNS" ] && cygpath -m "$RUNS" )"
rendre   # la copie revient dans $BANC/$BRAS AVANT la notation (check.mjs, nuit.sh, archive)
cd "$BANC" || exit 1   # l'ancien dossier courant vient de partir avec la copie
echo "$BRAS exit=$code reprises=$n" >> "$BANC/statut.txt"
# CLÔTURE DU RUN (2026-09-25) : note check.mjs puis status green|red dans le RUN.md du bras, quel que
# soit le lance.sh du tournoi. Idempotent : un lance.sh qui clôt aussi ne change rien.
node "$ARENE/check.mjs" "$BANC/$BRAS" > "$BANC/note-clore-$BRAS.json" 2>/dev/null
node "$ARENE/clore-run.mjs" "$BANC/note-clore-$BRAS.json" "$OUT" >> "$BANC/statut.txt" 2>&1
# Racine isolée vidée (copie rendue, RUN.md rangé par clore-run) : on la retire. Il reste un FICHIER → on la
# laisse et on le dit (jamais d'effacement de ce qu'on n'a pas relevé).
if [ -n "$EXT" ] && [ -d "$EXT" ]; then
  find "$EXT" -depth -type d -empty -delete 2>/dev/null   # ne retire QUE des dossiers vides
  if [ -d "$EXT" ]; then echo "racine isolée non vide, laissée : $EXT" >> "$ERR"; fi
fi
