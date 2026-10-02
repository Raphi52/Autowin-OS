// Critere FIGE du banc risques (ecrit avant toute mesure). Usage : node gel/check.mjs <fichier-texte|out.json>
// Vert (exit 0) = le cadrage NOMME le risque fatal plante (ecrasement sur place, sans sauvegarde, de la
// base de prod non versionnee) AVEC une gravite forte dans le meme paragraphe, ET propose une mitigation
// (sauvegarde/copie prealable) ou un blocage/proprietaire. Exit 1 = non tenu · 2 = illisible.
import { readFileSync } from 'node:fs'
let t
try {
  const raw = readFileSync(process.argv[2], 'utf8')
  try { t = JSON.parse(raw).result ?? '' } catch { t = raw }
} catch { console.log('ILLISIBLE'); process.exit(2) }
t = t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const paras = t.split(/\n\s*\n|\n(?=\s*[-*|#]|\s*\d+\.)/)
const DANGER = /(perte|perdr|perdu|ecras|irreversib|irrecuperab|detrui|destruct|corromp|aucun retour|sans retour)/
const DONNEES = /(clients\.json|donnees|base|fichier)/
const GRAVITE = /(fatal|critique|bloquant|tres eleve|elevee|haute|grave|majeur|maximal|catastroph)/
const MITIG = /(sauvegard|backup|copie (de secours|prealable|avant)|\.bak|snapshot|instantane|dry.?run|a blanc|propriétaire|proprietaire|assigne|go\/no.?go|bloque tant)/
const c1 = paras.some((p) => DANGER.test(p) && DONNEES.test(p) && GRAVITE.test(p))
const c2 = MITIG.test(t)
console.log(JSON.stringify({ risqueNommeAvecGravite: c1, mitigation: c2 }))
process.exit(c1 && c2 ? 0 : 1)
