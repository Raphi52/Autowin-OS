import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { causeDInterruption } from '../classe-terminale-echec'
import { isDeliberateAbort } from '../task-manager/watchdog-suppression'

/**
 * CE QUE CHAQUE WORKFLOW A RÉELLEMENT DONNÉ, LU DANS `causal-trace/` (piste 1, conv-1070).
 *
 * La vue Workflows n'affichait que les bancs d'essai (`arena-duels.jsonl`). Or chaque run écrit
 * déjà dans la trace causale sa `quote` — le workflow qui le pilote — et sa clôture : statut, durée,
 * coût, raisons. Ce module les relie par `runId` et les compte par workflow.
 *
 * LES ARRÊTS ÉTRANGERS AU TRAVAIL NE SONT PAS DES ÉCHECS. Mesuré le 2026-10-22 : depuis le 12/10,
 * 9 à 10 échecs sur 20 étaient des limites de session, des Stop ou des fermetures de l'app. Les
 * compter en échec ferait passer un workflow pour mauvais parce que l'abonnement a dit non. Ils
 * tombent dans `interrompues`, hors du taux et des médianes. La cause vient du champ
 * `closure.interruption` (écrit depuis conv-1070) ; une trace plus ancienne est relue par ses
 * raisons, avec les MÊMES détecteurs que le moteur — sauf quand la raison est un refus du juge,
 * qui peut citer une limite de session sans en être une.
 *
 * Les médianes ne portent que sur les runs ALLÉS AU BOUT (aboutis ou en échec) : un run coupé au
 * bout de 2 h par le quota ne dit rien de la durée d'un workflow. Pas de mesure → champ absent,
 * jamais un zéro (même règle que les bancs, commits 2d0bd9ca et d04d76e2).
 *
 * Lecture ASYNCHRONE et ligne à ligne : la trace pèse 175 Mo le 2026-10-22, une lecture synchrone
 * gèlerait la fenêtre. Seules les lignes qui portent `"stage":"quote"` ou `"stage":"closure"` sont
 * analysées, et le résultat de chaque fichier est gardé tant que sa taille et sa date ne bougent pas.
 */
export interface ResultatsReelsWorkflow {
  /** Runs démarrés sous ce workflow (une `quote` vue). */
  runs: number
  /** Clos `green` ou `degraded-closed`. */
  abouties: number
  /** Clos `red` pour une raison du travail lui-même. */
  echecs: number
  /** Clos `red` par Stop, limite de session, panne en face : hors du taux. */
  interrompues: number
  /** Aucune clôture terminale dans la trace. */
  nonCloses: number
  dureeMedianeMs?: number
  coutMedianUsd?: number
  /** Horodatage de la dernière clôture terminale vue. */
  dernierTs?: string
}

type IssueDeRun = {
  workflow?: string
  statut?: string
  interrompu?: boolean
  dureeMs?: number
  coutUsd?: number
  ts?: string
}

type Ligne = {
  timestamp?: unknown
  run?: {
    stage?: unknown
    runId?: unknown
    quote?: { workflow?: { name?: unknown } }
    closure?: {
      status?: unknown
      interruption?: unknown
      totalDurationMs?: unknown
      totalCostUsd?: unknown
      gateReasons?: unknown
    }
  }
}

/** Une raison qui commence ainsi est un refus du juge ou du contrôle, jamais un arrêt extérieur. */
const REFUS_DU_TRAVAIL = /^\s*(?:promis mais pas fait|gate bloqu|objection du juge)/i

/** Trace écrite avant `closure.interruption` : la cause se relit dans les raisons. */
function interrompuSelonLesRaisons(raisons: unknown): boolean {
  if (!Array.isArray(raisons)) return false
  const textes = raisons.filter((r): r is string => typeof r === 'string')
  if (textes.length === 0 || textes.some((r) => REFUS_DU_TRAVAIL.test(r))) return false
  const texte = textes.join(' · ')
  return isDeliberateAbort(texte, '') || causeDInterruption(new Error(texte), false) !== undefined
}

async function lireFichier(chemin: string): Promise<Map<string, IssueDeRun>> {
  const runs = new Map<string, IssueDeRun>()
  const lecteur = createInterface({
    input: createReadStream(chemin, { encoding: 'utf8' }),
    crlfDelay: Infinity
  })
  for await (const brute of lecteur) {
    if (!brute.includes('"stage":"quote"') && !brute.includes('"stage":"closure"')) continue
    let ligne: Ligne
    try {
      ligne = JSON.parse(brute) as Ligne
    } catch {
      continue
    }
    const run = ligne.run
    if (!run || typeof run.runId !== 'string') continue
    const issue = runs.get(run.runId) ?? {}
    if (run.stage === 'quote') {
      const nom = run.quote?.workflow?.name
      if (typeof nom === 'string' && nom.trim()) issue.workflow = nom.trim()
    } else if (run.stage === 'closure' && run.closure) {
      const statut = run.closure.status
      // La clôture d'OUVERTURE (`open`, 0 ms) précède la quote : elle ne dit rien de l'issue.
      if (typeof statut === 'string' && statut !== 'open') {
        issue.statut = statut
        issue.interrompu =
          statut === 'red' &&
          (typeof run.closure.interruption === 'string' ||
            interrompuSelonLesRaisons(run.closure.gateReasons))
        const duree = run.closure.totalDurationMs
        const cout = run.closure.totalCostUsd
        issue.dureeMs = typeof duree === 'number' && duree > 0 ? duree : undefined
        issue.coutUsd = typeof cout === 'number' && cout > 0 ? cout : undefined
        if (typeof ligne.timestamp === 'string') issue.ts = ligne.timestamp
      }
    }
    runs.set(run.runId, issue)
  }
  return runs
}

const memo = new Map<string, { taille: number; date: number; runs: Map<string, IssueDeRun> }>()

function mediane(valeurs: number[]): number | undefined {
  if (valeurs.length === 0) return undefined
  const triees = [...valeurs].sort((a, b) => a - b)
  const milieu = Math.floor(triees.length / 2)
  return triees.length % 2 ? triees[milieu] : (triees[milieu - 1] + triees[milieu]) / 2
}

export async function lireResultatsReelsParWorkflow(
  racineTraces: string
): Promise<Record<string, ResultatsReelsWorkflow>> {
  let fichiers: string[]
  try {
    fichiers = (await readdir(racineTraces)).filter((f) => f.endsWith('.jsonl'))
  } catch {
    return {}
  }
  // Un fichier retiré par `causal-trace-gc` ne doit pas rester en mémoire jusqu'à la fermeture.
  const presents = new Set(fichiers.map((f) => join(racineTraces, f)))
  for (const chemin of memo.keys()) {
    if (chemin.startsWith(racineTraces) && !presents.has(chemin)) memo.delete(chemin)
  }
  const parWorkflow = new Map<string, IssueDeRun[]>()
  for (const fichier of fichiers) {
    const chemin = join(racineTraces, fichier)
    let runs: Map<string, IssueDeRun>
    try {
      const s = await stat(chemin)
      const connu = memo.get(chemin)
      if (connu && connu.taille === s.size && connu.date === s.mtimeMs) runs = connu.runs
      else {
        runs = await lireFichier(chemin)
        memo.set(chemin, { taille: s.size, date: s.mtimeMs, runs })
      }
    } catch {
      continue
    }
    for (const issue of runs.values()) {
      // Un run sans workflow n'est attribué à AUCUN : il n'a rien à dire d'un workflow nommé.
      if (!issue.workflow) continue
      const liste = parWorkflow.get(issue.workflow) ?? []
      liste.push(issue)
      parWorkflow.set(issue.workflow, liste)
    }
  }
  const resultat: Record<string, ResultatsReelsWorkflow> = {}
  for (const [nom, issues] of parWorkflow) {
    const abouties = issues.filter((i) => i.statut === 'green' || i.statut === 'degraded-closed')
    const echecs = issues.filter((i) => i.statut === 'red' && !i.interrompu)
    const allesAuBout = [...abouties, ...echecs]
    const derniers = issues.map((i) => i.ts).filter((t): t is string => Boolean(t))
    const dureeMedianeMs = mediane(allesAuBout.flatMap((i) => (i.dureeMs ? [i.dureeMs] : [])))
    const coutMedianUsd = mediane(allesAuBout.flatMap((i) => (i.coutUsd ? [i.coutUsd] : [])))
    resultat[nom] = {
      runs: issues.length,
      abouties: abouties.length,
      echecs: echecs.length,
      interrompues: issues.filter((i) => i.statut === 'red' && i.interrompu).length,
      nonCloses: issues.filter((i) => !i.statut).length,
      ...(dureeMedianeMs !== undefined ? { dureeMedianeMs } : {}),
      ...(coutMedianUsd !== undefined ? { coutMedianUsd } : {}),
      ...(derniers.length ? { dernierTs: derniers.sort().at(-1) } : {})
    }
  }
  return resultat
}
