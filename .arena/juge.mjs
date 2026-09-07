#!/usr/bin/env node
/**
 * Ecrit les 3 prompts de juge ADVERSE (un par banc) a partir de `mesures.json`.
 * Ma these est donnee A REFUTER, jamais en postulat (reflexe 17).
 * Usage : node juge.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ARENA = path.resolve(import.meta.dirname)
const mesures = JSON.parse(readFileSync(path.join(ARENA, 'mesures.json'), 'utf8'))
const BANCS = [...new Set(mesures.map((m) => m.banc))]

for (const banc of BANCS) {
  const a = mesures.find((m) => m.banc === banc && m.bras === 'a')
  const b = mesures.find((m) => m.banc === banc && m.bras === 'b')
  const these =
    a.critereAtteint === b.critereAtteint
      ? `les deux bras finissent au MEME etat de critere (${a.critereAtteint ? 'atteint' : 'rate'}) : sur ce defaut, le workflow ne fait pas la difference`
      : `le bras ${a.critereAtteint ? 'a (kit complet)' : 'b (build direct)'} atteint le critere et l'autre non`
  const coupe = (t, n) => (t.length > n ? t.slice(0, n) + `\n[...tronque, ${t.length} caracteres au total]` : t)
  const diff = (bras) => coupe(readFileSync(path.join(ARENA, banc, `diff-${bras}.txt`), 'utf8'), 12000)
  const critere = (bras) => readFileSync(path.join(ARENA, banc, `critere-${bras}.txt`), 'utf8')
  const rouge = readFileSync(path.join(ARENA, banc, 'rouge.txt'), 'utf8')
  const txt = `/judge en mode ADVERSE. Tu ne valides rien : tu essaies de faire TOMBER ce resultat.

CONTEXTE — banc /arena "${banc}". Meme tache mot pour mot dans les deux bras, meme commit de depart
(a2499eb3), copies de travail separees. Bras a = kit complet (scout→frame→terrain→build→clean→judge).
Bras b = build direct + verification ciblee, sans phases amont.

Depart ROUGE constate avant les bras :
${rouge}
CRITERE DU BANC (script externe que les deux bras ont recu, et que J'AI rejoue moi-meme apres coup) :
${readFileSync(path.join(ARENA, banc, 'check.mjs'), 'utf8').split('\n').slice(1, 14).join('\n')}

RESULTAT REJOUE PAR MOI, bras a (exit ${a.critereExit}) :
${critere('a')}
RESULTAT REJOUE PAR MOI, bras b (exit ${b.critereExit}) :
${critere('b')}
Chiffres lus dans les artefacts (jamais dans le rapport des bras) :
- bras a : cout ${a.coutUsd} USD, duree ${a.dureeMs} ms, tours ${a.tours}, fichiers modifies ${a.fichiersTouches.join(', ') || '(aucun)'}
- bras b : cout ${b.coutUsd} USD, duree ${b.dureeMs} ms, tours ${b.tours}, fichiers modifies ${b.fichiersTouches.join(', ') || '(aucun)'}

DIFF DU BRAS A :
${diff('a')}

DIFF DU BRAS B :
${diff('b')}

MA THESE, A REFUTER (ne la reprends pas en postulat) : ${these}.

Reponds a ces quatre questions, chacune avec la ligne de diff ou le code de sortie qui la fonde :
1. Un "vert" ci-dessus est-il en realite un FAUX vert (assertion desserree, erreur avalee, garde qui
   contourne le defaut, cible deplacee au lieu d'etre corrigee) ?
2. Le critere de ce banc a-t-il ete choisi ou ecrit de facon a favoriser un des deux bras ?
3. L'ecart mesure entre les deux bras est-il du BRUIT (n=1 sur ce banc, moins de 30 % d'ecart) ?
4. Quel resultat aurait-il fallu observer pour que le gagnant PERDE ? A-t-on regarde ?

Rends : VERDICT (valide / invalide / non concluant) puis les 4 reponses, puis CE QUI RESTE NON PROUVE.
N'ecris aucun fichier, ne modifie rien : tu ne fais que lire et juger.
`
  writeFileSync(path.join(ARENA, banc, 'prompt-judge.txt'), txt)
  console.log(`${banc}/prompt-judge.txt ecrit (${txt.length} caracteres)`)
}
