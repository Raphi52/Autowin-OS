/**
 * SONDE du bloc « titres Brain du tour » (src/main/brain-titres-du-tour.ts) sur le Brain VIVANT.
 *
 * Rejoue les 27 questions du jeu d'évaluation de l'entreprise (`entreprise/<nom>/brain/eval/rag-golden.json`,
 * il dépend du contenu de SON Brain) par le chemin réel du chat
 * (candidates -> scopeBrainRetrieval -> selectionnerTitres) et rend : combien de fois la note
 * attendue est dans le bloc, combien de lignes il porte en moyenne, et si les questions hors sujet
 * (`max_dense`, sans note attendue) reçoivent bien un bloc vide. Lecture seule, gratuite (aucun
 * modèle). Usage : npx tsx scripts/sonde-titres-brain.mts
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { retrieveBrainContext } from '../src/main/brain-retrieval'
import { scopeBrainRetrieval, brainCorpusForWorkspace } from '../src/main/brain-corpus-scope'
import { rendreTitres, selectionnerTitres } from '../src/main/brain-titres-du-tour'

type Cas = { id: string; query: string; expected_paths?: string[] }
/** Premier `entreprise/<nom>/brain/eval/rag-golden.json` (ordre alphabetique), absent du depot public. */
function jeuEvaluation(): string {
  const dossiers = existsSync('entreprise') ? readdirSync('entreprise').sort() : []
  const trouve = dossiers
    .map((nom) => join('entreprise', nom, 'brain', 'eval', 'rag-golden.json'))
    .find((chemin) => existsSync(chemin))
  if (!trouve) throw new Error('aucun jeu d evaluation : entreprise/<nom>/brain/eval/rag-golden.json absent')
  return trouve
}
const norm = (p: string): string => p.split(String.fromCharCode(92)).join('/').toLowerCase()
const cas = (
  JSON.parse(readFileSync(jeuEvaluation(), 'utf8')) as { cases: Cas[] }
).cases
const corpus = brainCorpusForWorkspace(process.cwd())
let trouves = 0
let positifs = 0
let lignes = 0
let horsSujetNonVides = 0
let caracteres = 0
for (const c of cas) {
  const brut = await retrieveBrainContext(c.query, {
    ...(corpus ? { corpus } : {}),
    mode: 'candidates',
    timeoutMs: 8000
  })
  const titres = selectionnerTitres(scopeBrainRetrieval(brut, corpus))
  const attendus = (c.expected_paths ?? []).map(norm)
  lignes += titres.length
  caracteres += rendreTitres(titres).length
  if (attendus.length === 0) {
    if (titres.length > 0) horsSujetNonVides++
    continue
  }
  positifs++
  const ok = titres.some((t) =>
    attendus.some((e) => norm(t.path).endsWith(e) || e.endsWith(norm(t.path)))
  )
  if (ok) trouves++
  console.log(`${ok ? 'OK ' : '-- '} ${c.id} (${titres.length} ligne(s))`)
}
console.log(`\nnote attendue dans le bloc : ${trouves}/${positifs}`)
console.log(
  `lignes par tour : ${(lignes / cas.length).toFixed(2)} | caracteres par tour : ${Math.round(caracteres / cas.length)}`
)
console.log(`questions hors sujet avec un bloc : ${horsSujetNonVides}/${cas.length - positifs}`)
