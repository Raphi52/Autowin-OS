#!/usr/bin/env node
/**
 * LES ÉTATS DE CAUSE DES RUNS TERMINÉS, POUR LE `/gc` QUOTIDIEN.
 *
 * Le signal « cause en cours » (`src/main/providers/cause-en-cours.ts`) écrit un fichier par run dans
 * `.autowin-data/autowin-os/cause-en-cours/`. Rien ne le retirait : un fichier de plus à chaque run.
 *
 * LA PREUVE DE MORT, celle qu'exige le `/gc` pour les données d'Autowin : un run est réglé quand
 * l'orchestrateur n'en tient plus l'état reprenable, c'est-à-dire quand `run-state/<runId>.json` a été
 * effacé (`onRunSettled`, `src/main/app/os.ts`). Un run suspendu par quota garde le sien : il reste.
 *
 * LE NOM donne le run : `identifiantBureauCache(runId)` (`src/main/consignes/consigne-bureau-cache.ts`)
 * rend `run-` suivi du runId. Un nom qui ne suit pas ce motif reste, faute de preuve.
 *
 * GARDE-FOUS : un fichier modifié depuis moins de 24 h reste, comme partout dans le `/gc`. Un dossier
 * `run-state` illisible ne condamne rien : ce jour-là, aucun run n'est jugé réglé, et le bilan le dit.
 *
 * CE QUI PART : déplacé dans la corbeille datée (`gc-corbeille/AAAA-MM-JJ/`), avec sa ligne de
 * MANIFEST, par `balayer` de `gc-disque.mjs`. Rien n'est supprimé : la purge reste à
 * `scripts/gc-purger-corbeilles.mjs`, sur accord.
 *
 * Usage, depuis le dépôt Autowin :
 *   node --no-warnings scripts/gc-causes-en-cours.mjs [--balayer] [--donnees <chemin>]
 *
 * Sans `--balayer`, c'est une lecture seule. Sortie : JSON. Code 0 = passe faite, 1 = une sonde a
 * échoué ou un déplacement a échoué (dit dans le bilan), 2 = commande refusée.
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import { balayer, depotEtDonnees } from './gc-disque.mjs'

const JOUR_MS = 86_400_000
const PREFIXE_DU_RUN = 'run-'
/** Même motif que `RUN_ID_PATTERN` (`src/main/runs/orchestration-state.ts`). */
const MOTIF_RUN_ID = /^[A-Za-z0-9._-]{1,120}$/
const ZONE = 'cause en cours (run réglé)'

/** Le runId d'un fichier de cause, ou `null` si son nom ne suit pas `run-` + runId. Pure. */
export function runDuFichier(nom) {
  if (!nom.endsWith('.json')) return null
  const base = nom.slice(0, -'.json'.length)
  if (!base.startsWith(PREFIXE_DU_RUN)) return null
  const runId = base.slice(PREFIXE_DU_RUN.length)
  return MOTIF_RUN_ID.test(runId) ? runId : null
}

/** Un dossier absent n'est pas une panne : rien n'y est tenu, ou rien n'y est posé. */
function listerOuVide(dossier) {
  try {
    return { noms: readdirSync(dossier) }
  } catch (erreur) {
    if (erreur?.code === 'ENOENT') return { noms: [] }
    return { noms: [], sondeEnEchec: String(erreur?.code ?? erreur) }
  }
}

/**
 * Les fichiers de cause dont le run est réglé et calme. Lecture seule. `ctx` : `{ donnees, maintenant }`.
 * Rend `{ candidats, gardes }`, plus `sondeEnEchec` si une lecture a échoué (aucun candidat alors).
 */
export function causesDesRunsTermines(ctx) {
  const dossierCauses = join(ctx.donnees, 'autowin-os', 'cause-en-cours')
  const dossierEtat = join(ctx.donnees, 'autowin-os', 'run-state')
  const gardes = { encoreTenu: 0, recent: 0, nomInconnu: 0, illisible: 0 }

  // L'état tenu d'abord : si le lire échoue, aucun run ne peut être jugé réglé.
  const etat = listerOuVide(dossierEtat)
  if (etat.sondeEnEchec) return { candidats: [], gardes, sondeEnEchec: etat.sondeEnEchec }
  const tenus = new Set(etat.noms)

  const causes = listerOuVide(dossierCauses)
  if (causes.sondeEnEchec) return { candidats: [], gardes, sondeEnEchec: causes.sondeEnEchec }

  const candidats = []
  for (const nom of causes.noms) {
    const runId = runDuFichier(nom)
    if (!runId) {
      gardes.nomInconnu += 1
      continue
    }
    if (tenus.has(`${runId}.json`)) {
      gardes.encoreTenu += 1
      continue
    }
    const chemin = join(dossierCauses, nom)
    let taille
    let modifie
    try {
      const stat = statSync(chemin)
      taille = stat.size
      modifie = stat.mtimeMs
    } catch {
      gardes.illisible += 1
      continue
    }
    if (ctx.maintenant - modifie < JOUR_MS) {
      gardes.recent += 1
      continue
    }
    candidats.push({
      chemin,
      taille,
      zone: ZONE,
      motif: `run ${runId} réglé, fichier calme depuis plus de 24 h`
    })
  }
  return { candidats, gardes }
}

function main() {
  let options
  try {
    options = parseArgs({
      options: {
        balayer: { type: 'boolean', default: false },
        donnees: { type: 'string' }
      },
      strict: true
    }).values
  } catch (erreur) {
    console.error(`commande refusée : ${erreur.message}`)
    process.exit(2)
  }
  const donnees = options.donnees ?? depotEtDonnees(dirname(fileURLToPath(import.meta.url))).donnees
  if (!existsSync(donnees)) {
    console.error(`commande refusée : dossier de données introuvable : ${donnees}`)
    process.exit(2)
  }
  const ctx = { donnees, maintenant: Date.now() }
  const bilan = causesDesRunsTermines(ctx)
  if (options.balayer) bilan.balayage = balayer(bilan.candidats, ctx)
  console.log(JSON.stringify(bilan, null, 2))
  const echec = bilan.sondeEnEchec !== undefined || (bilan.balayage?.echecs.length ?? 0) > 0
  process.exit(echec ? 1 : 0)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
