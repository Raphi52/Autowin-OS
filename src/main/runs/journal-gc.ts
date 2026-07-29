import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Ramasse-miettes des journaux de sortie brute (`run-stdout/`).
 *
 * Pourquoi : mesure du 2026-07-29 sur un poste en usage reel — 435 fichiers, 10,6 Mo, dont 31 vides,
 * accumules en 2 jours SANS aucune suppression. Un journal est ecrit a CHAQUE spawn de CLI : la
 * croissance est proportionnelle a l'usage et rien ne la borne.
 *
 * Ce qu'un journal sert encore, une fois son run termine : le diagnostic post-mortem (c'est
 * exactement ce qui a permis d'identifier le `spawn claude ENOENT` du jour). Rien ne le REJOUE — seul
 * le tail live le consomme. On garde donc une fenetre recente, et on jette au-dela.
 *
 * LE risque, et la garde : un CLI spawne DETACHE continue d'ecrire dans son journal alors que l'app
 * est fermee. Supprimer ce fichier casserait un run vivant. Aucune candidature n'est donc retenue si
 * le fichier a ete touche recemment (`minIdleMs`) — un ecrivain actif est, par construction, un
 * fichier recemment modifie.
 *
 * Le PLAN est pur (entrees -> chemins a supprimer) : la politique est testable sans toucher au
 * disque, et `collectStdoutJournals` ne fait que l'appliquer.
 */

export interface JournalEntry {
  path: string
  /** Taille en octets — un journal vide n'a aucune valeur de diagnostic. */
  size: number
  /** Derniere ecriture (ms epoch) : sert a la fois d'age et de detection d'ecrivain actif. */
  modifiedMs: number
}

export interface JournalGcPolicy {
  /** Instant de reference (injecte → test deterministe). */
  nowMs: number
  /** Au-dela de cet age, un journal ne sert plus au diagnostic. */
  maxAgeMs?: number
  /** Plafond dur : on ne garde que les N plus recents, meme s'ils sont jeunes. */
  maxFiles?: number
  /** Un fichier touche depuis moins longtemps que ca est presume EN COURS D'ECRITURE. */
  minIdleMs?: number
}

/** 3 jours : large de quoi diagnostiquer la veille et l'avant-veille, sans accumuler. */
export const DEFAULT_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000
/** 200 journaux ≈ quelques Mo : la fenetre reste consultable a la main. */
export const DEFAULT_MAX_FILES = 200
/** 10 min d'inactivite : un CLI qui n'a rien ecrit depuis si longtemps n'ecrit plus. */
export const DEFAULT_MIN_IDLE_MS = 10 * 60 * 1000

/**
 * Decide quels journaux supprimer. PUR.
 *
 * Ordre des regles : la garde « ecrivain actif » passe AVANT tout le reste — un journal vivant n'est
 * jamais candidat, meme vide, meme si le plafond est depasse.
 */
export function planJournalGc(entries: JournalEntry[], policy: JournalGcPolicy): string[] {
  const maxAgeMs = policy.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const maxFiles = policy.maxFiles ?? DEFAULT_MAX_FILES
  const minIdleMs = policy.minIdleMs ?? DEFAULT_MIN_IDLE_MS

  const idle = entries.filter((entry) => policy.nowMs - entry.modifiedMs >= minIdleMs)
  const doomed = new Set<string>()

  for (const entry of idle) {
    // Un journal vide ne dit rien : ni contenu a relire, ni indice de diagnostic.
    if (entry.size === 0) doomed.add(entry.path)
    else if (policy.nowMs - entry.modifiedMs > maxAgeMs) doomed.add(entry.path)
  }

  // Plafond : on compte ce qui SURVIT (actifs inclus — ils occupent bien une place) et on sacrifie
  // les plus anciens des seuls fichiers qu'on a le droit de toucher.
  const survivors = entries.filter((entry) => !doomed.has(entry.path))
  if (survivors.length > maxFiles) {
    const removable = survivors
      .filter((entry) => policy.nowMs - entry.modifiedMs >= minIdleMs)
      .sort((a, b) => a.modifiedMs - b.modifiedMs)
    for (const entry of removable.slice(0, survivors.length - maxFiles)) doomed.add(entry.path)
  }

  return [...doomed]
}

export interface JournalGcOutcome {
  removed: number
  freedBytes: number
}

/**
 * Applique le plan au disque. Best-effort assume : un journal verrouille par un enfant encore vivant
 * (Windows) fait echouer SA suppression, jamais la passe entiere — le prochain demarrage reessaiera.
 * Un dossier absent n'est pas une erreur (premier lancement).
 */
export function collectStdoutJournals(
  root: string,
  policy: Partial<JournalGcPolicy> = {}
): JournalGcOutcome {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return { removed: 0, freedBytes: 0 }
  }

  const entries: JournalEntry[] = []
  for (const name of names) {
    if (!name.endsWith('.stdout.jsonl')) continue
    const path = join(root, name)
    try {
      const stat = statSync(path)
      if (!stat.isFile()) continue
      entries.push({ path, size: stat.size, modifiedMs: stat.mtimeMs })
    } catch {
      /* disparu entre le listing et le stat : rien a faire */
    }
  }

  const sizeOf = new Map(entries.map((entry) => [entry.path, entry.size]))
  let removed = 0
  let freedBytes = 0
  for (const path of planJournalGc(entries, { nowMs: Date.now(), ...policy })) {
    try {
      rmSync(path, { force: true })
      removed += 1
      freedBytes += sizeOf.get(path) ?? 0
    } catch {
      /* verrouille ou deja parti : le prochain passage s'en chargera */
    }
  }
  return { removed, freedBytes }
}
