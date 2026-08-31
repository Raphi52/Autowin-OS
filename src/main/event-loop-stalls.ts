import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'

/**
 * Détecteur de FREEZE du processus principal. Constaté le 2026-08-31 : les gels d'UI signalés
 * (conv-1511, conv-1539, conv-1581) n'ont jamais pu être attribués, parce qu'AUCUN instrument ne
 * mesurait le blocage de la boucle d'événements — `turn-timing.jsonl` ne mesure que la latence
 * MODÈLE (premier token), donc un tour lent et une UI gelée y sont indiscernables.
 *
 * Ici on mesure la boucle elle-même : dès qu'un tour de boucle dépasse le seuil, une ligne JSONL
 * nomme la durée et la SECTION en cours (posée par `withSection`). Best-effort : jamais bloquant,
 * jamais throw.
 */

const SEUIL_MS_PAR_DEFAUT = 250
const INTERVALLE_MS = 500

let dossier: string | undefined
let sectionCourante: string | undefined
let timer: NodeJS.Timeout | undefined

/** Nom de la section actuellement exécutée — reporté sur le prochain gel détecté. */
export function sectionEnCours(): string | undefined {
  return sectionCourante
}

/** Étiquette un travail synchrone : un gel pendant son exécution portera ce nom. */
export function withSection<T>(nom: string, travail: () => T): T {
  const precedente = sectionCourante
  sectionCourante = nom
  try {
    return travail()
  } finally {
    sectionCourante = precedente
  }
}

function journaliser(ligne: Record<string, unknown>): void {
  if (!dossier) return
  const dir = dossier
  void mkdir(dir, { recursive: true })
    .then(() => appendFile(join(dir, 'event-loop-stalls.jsonl'), JSON.stringify(ligne) + '\n', 'utf8'))
    .catch(() => {
      /* observabilité best-effort */
    })
}

/**
 * Démarre la surveillance. `seuilMs` : durée d'un blocage à partir de laquelle il est journalisé.
 * Rend une fonction d'arrêt (utile en test).
 */
export function surveillerBoucleEvenements(
  dir: string,
  seuilMs = SEUIL_MS_PAR_DEFAUT,
  intervalleMs = INTERVALLE_MS
): () => void {
  dossier = dir
  const histogramme = monitorEventLoopDelay({ resolution: 20 })
  histogramme.enable()
  timer = setInterval(() => {
    const maxMs = histogramme.max / 1e6
    if (maxMs >= seuilMs) {
      journaliser({
        ts: new Date().toISOString(),
        type: 'event-loop-stall',
        blocageMs: Math.round(maxMs),
        p99Ms: Math.round(histogramme.percentile(99) / 1e6),
        section: sectionCourante ?? null
      })
    }
    histogramme.reset()
  }, intervalleMs)
  timer.unref?.()
  return () => {
    if (timer) clearInterval(timer)
    timer = undefined
    histogramme.disable()
  }
}

/** Journalise une opération synchrone lourde (taille + durée) quand elle dépasse le seuil. */
export function mesurerOperationSynchrone<T>(nom: string, octets: number, travail: () => T): T {
  const debut = performance.now()
  try {
    return withSection(nom, travail)
  } finally {
    const dureeMs = Math.round(performance.now() - debut)
    if (dureeMs >= 100) {
      journaliser({ ts: new Date().toISOString(), type: 'sync-io', nom, octets, dureeMs })
    }
  }
}
