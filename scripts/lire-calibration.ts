/**
 * Lit la calibration des paris de phase au fil de l'eau.
 *
 * La question « nos agents sont-ils calibres ? » demande des dizaines de phases jugees, donc des
 * semaines d'usage reel. Sans ce lecteur, il faudrait attendre a l'aveugle. Il ne calcule rien
 * lui-meme : il appelle le meme calculateur que l'application, pour qu'un ecart entre ce qu'on lit
 * ici et ce que mesure l'app soit impossible.
 *
 *   npx tsx scripts/lire-calibration.ts [chemin-du-journal]
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  apparierParisEtIssues,
  mesurerCalibration,
  SEUIL_ECHANTILLON
} from '../src/shared/pari-calibration'

const defaut = join(
  process.env.APPDATA ?? process.env.HOME ?? '.',
  'autowin-os',
  'outcome-learning',
  'paris-v1.jsonl'
)
const chemin = process.argv[2] ?? defaut

if (!existsSync(chemin)) {
  console.log(`Aucun journal de paris a ${chemin}.`)
  console.log("Rien a lire pour le moment : aucune phase n'a encore parie.")
  process.exit(0)
}

const paris = []
let illisibles = 0
for (const ligne of readFileSync(chemin, 'utf8').split('\n')) {
  if (!ligne.trim()) continue
  try {
    paris.push(JSON.parse(ligne))
  } catch {
    illisibles += 1
  }
}

/**
 * Les issues ne vivent pas dans ce journal : elles sont deduites du verdict, cote application. Ce
 * lecteur ne sait donc rendre l'appariement que si le journal porte deja le champ `reussie` (ecrit
 * par une passe ulterieure). Tant que ce n'est pas le cas, il rend le COMPTE et le dit, plutot que
 * d'inventer une mesure -- un chiffre invente serait pire qu'un silence.
 */
const issues = paris
  .filter((p) => typeof p.reussie === 'boolean')
  .map((p) => ({ runId: p.runId, phase: p.phase, reussie: p.reussie, jugee: true }))

console.log(`Journal : ${chemin}`)
console.log(
  `Paris enregistres : ${paris.length}${illisibles ? ` (+${illisibles} ligne(s) illisible(s))` : ''}`
)

if (!issues.length) {
  console.log(
    'Aucun pari encore arbitre dans ce journal : la mesure se lit dans les traces du run.'
  )
  process.exit(0)
}

const { appariements } = apparierParisEtIssues(paris, issues)
const mesure = mesurerCalibration(appariements)
console.log(`Paris arbitres : ${mesure.n} (seuil de lecture : ${SEUIL_ECHANTILLON})`)
console.log(`Calibration (Brier, 0 = parfait) : ${mesure.calibration?.toFixed(3) ?? 'n/a'}`)
console.log(
  `Discrimination (+1 separe, 0 n'informe pas, -1 a contresens) : ${mesure.discrimination?.toFixed(3) ?? 'n/a'}`
)
if (mesure.motifIndisponible) console.log(`Non disponible : ${mesure.motifIndisponible}`)
if (!mesure.echantillonSuffisant)
  console.log('Echantillon encore trop mince : a ne pas lire comme un verdict.')
