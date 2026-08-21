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
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  apparierParisEtIssues,
  mesurerCalibration,
  SEUIL_ECHANTILLON
} from '../src/shared/pari-calibration'
import { PariPhaseStore } from '../src/main/activity/pari-phase-store'
import { autowinAppDataRoot, portableAppDataBase } from '../src/main/app-data'

/*
 * LA MEME RACINE QUE L'APPLICATION. Le defaut pointait sur `%APPDATA%\autowin-os`, un emplacement
 * vestigial : l'app redirige son userData vers le stockage PORTABLE du depot (app-data.ts), donc le
 * lecteur annoncait « aucun pari » indefiniment sur une machine qui avait pourtant parie -- et cette
 * branche vide avait ete prise pour une preuve que le lecteur fonctionnait.
 */
const racine = autowinAppDataRoot(portableAppDataBase(process.cwd(), process.cwd(), false))
const defaut = join(racine, 'outcome-learning', 'paris-v1.jsonl')
const chemin = process.argv[2] ?? defaut

if (!existsSync(chemin)) {
  console.log(`Aucun journal de paris a ${chemin}.`)
  console.log("Rien a lire pour le moment : aucune phase n'a encore parie.")
  process.exit(0)
}

/* On relit par le MEME store que l'application, pour qu'aucun parseur parallele ne puisse divarger. */
const store = new PariPhaseStore(chemin)
const paris = store.lire()
const issues = store.lireIssues()
const illisibles = store.lignesIllisibles()

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
const verdicts = new Set(appariements.map((a) => a.runId)).size
console.log(
  `Paris arbitres : ${mesure.n} sur ${verdicts} verdict(s) distinct(s) ` +
    `(seuil de lecture : ${SEUIL_ECHANTILLON})`
)
if (verdicts < mesure.n) {
  console.log(
    "Attention : les phases d'un meme run partagent son verdict, donc les tirages ne sont pas independants."
  )
}
console.log(`Calibration (Brier, 0 = parfait) : ${mesure.calibration?.toFixed(3) ?? 'n/a'}`)
console.log(
  `Discrimination (+1 separe, 0 n'informe pas, -1 a contresens) : ${mesure.discrimination?.toFixed(3) ?? 'n/a'}`
)
if (mesure.motifIndisponible) console.log(`Non disponible : ${mesure.motifIndisponible}`)
if (!mesure.echantillonSuffisant)
  console.log('Echantillon encore trop mince : a ne pas lire comme un verdict.')
