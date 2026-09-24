#!/usr/bin/env bash
# Lance UN bras du banc arenagame et le mène au bout malgré la limite de session Claude.
# Usage : lance-bras.sh <dossier du tournoi> <bras-replique> <fichier prompt> [fichier sys]
#
# Pourquoi : t2b, t2v et t3 ont eu tous leurs bras coupés (« You've hit your session limit ·
# resets 7pm ») vers 30 min ; `claude -p` rend alors is_error=true et le bras s'arrêtait là.
# Ici, une coupure n'arrête plus le bras : on attend l'heure de remise à zéro annoncée, puis on
# REPREND la même session (`--resume <session_id>`) avec le budget restant.
# Sorties : out-<bras>.json (dernier résultat, coût et tours CUMULÉS, champ `reprises`),
#           out-<bras>.tentatives.jsonl (chaque sortie brute), attente-<bras>.txt (attentes).
# Réglages : ARENA_BUDGET_USD (40), ARENA_REPRISES_MAX (10), ARENA_ATTENTE_S (force l'attente,
#            pour les tests), ARENA_MARGE_S (120 s après l'heure annoncée).
set -u
BANC=$1; BRAS=$2; PROMPT=$3; SYS=${4:-}
BUDGET=${ARENA_BUDGET_USD:-40}
MAX=${ARENA_REPRISES_MAX:-10}
MARGE=${ARENA_MARGE_S:-120}
cd "$BANC/$BRAS" || exit 1
OUT="$BANC/out-$BRAS.json"; TENT="$BANC/out-$BRAS.tentatives.jsonl"; ERR="$BANC/err-$BRAS.txt"
: > "$TENT"
REPRISE_MSG="Ta session a été coupée par la limite d'utilisation. Reprends exactement là où tu t'es arrêté et mène la tâche initiale jusqu'au bout."

champ() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);const v=j[process.argv[1]];console.log(v===undefined?"":v)}catch{console.log("")}})' "$1"; }

sid=""; n=0
while :; do
  depense=$(node -e 'const fs=require("fs");let t=0;for(const l of fs.readFileSync(process.argv[1],"utf8").split("\n"))if(l.trim())try{t+=+JSON.parse(l).total_cost_usd||0}catch{};console.log(t)' "$TENT")
  reste=$(node -e 'console.log(Math.max(0,(+process.argv[1])-(+process.argv[2])).toFixed(2))' "$BUDGET" "$depense")
  if [ "$(node -e 'console.log(+process.argv[1]<0.5?1:0)' "$reste")" = 1 ]; then echo "budget épuisé ($depense \$)" >> "$ERR"; break; fi
  if [ -z "$sid" ]; then
    if [ -n "$SYS" ]; then r=$(claude -p "$(cat "$PROMPT")" --append-system-prompt-file "$SYS" --output-format json --dangerously-skip-permissions --max-budget-usd "$reste" 2>>"$ERR")
    else r=$(claude -p "$(cat "$PROMPT")" --output-format json --dangerously-skip-permissions --max-budget-usd "$reste" 2>>"$ERR"); fi
  else
    r=$(claude -p "$REPRISE_MSG" --resume "$sid" --output-format json --dangerously-skip-permissions --max-budget-usd "$reste" 2>>"$ERR")
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
node -e '
const fs=require("fs");const L=fs.readFileSync(process.argv[1],"utf8").split("\n").filter(l=>l.trim()).map(l=>{try{return JSON.parse(l)}catch{return null}}).filter(Boolean);
if(!L.length){process.exit(1)}
const d={...L[L.length-1]};d.total_cost_usd=L.reduce((a,j)=>a+(+j.total_cost_usd||0),0);d.num_turns=L.reduce((a,j)=>a+(+j.num_turns||0),0);
d.duration_ms=L.reduce((a,j)=>a+(+j.duration_ms||0),0);d.reprises=L.length-1;fs.writeFileSync(process.argv[2],JSON.stringify(d))' "$TENT" "$OUT"
echo "$BRAS exit=$code reprises=$n" >> "$BANC/statut.txt"
