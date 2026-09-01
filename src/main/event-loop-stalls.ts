import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

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
    .then(() =>
      appendFile(join(dir, 'event-loop-stalls.jsonl'), JSON.stringify(ligne) + '\n', 'utf8')
    )
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
  /*
   * blocage synchrone VOLONTAIRE de 350 ms ressort a 31,8 ms sur le `max` de l'histogramme — onze
   * fois moins que la realite. Un detecteur cale sur cet histogramme ne franchit donc jamais son
   * seuil de 250 ms : il rendait un journal VIDE en pretendant surveiller. On mesure ici la meme
   * chose que le battement de `gel-main.ts` : l'ecart entre l'heure ou le minuteur DEVAIT se
   * reveiller et celle ou il s'est reveille. Cet ecart EST, a la milliseconde pres, la duree
   * pendant laquelle la boucle etait tenue.
   */
  let attendu = Date.now() + intervalleMs
  const local = setInterval(() => {
    const maintenant = Date.now()
    const retardMs = maintenant - attendu
    attendu = maintenant + intervalleMs
    if (retardMs >= seuilMs) {
      journaliser({
        ts: new Date(maintenant).toISOString(),
        type: 'event-loop-stall',
        blocageMs: Math.round(retardMs),
        section: sectionCourante ?? null
      })
    }
  }, intervalleMs)
  local.unref?.()
  timer = local
  return () => {
    clearInterval(local)
    if (timer === local) timer = undefined
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
