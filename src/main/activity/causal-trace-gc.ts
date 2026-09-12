import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Ramasse-miettes des TRACES CAUSALES (`causal-trace/<convId>.jsonl`).
 *
 * Pourquoi. Rien ne bornait cet arbre : mesure du 2026-09-12 sur le poste de dev — 441 traces,
 * 667 Mo accumulés en 12 jours, dont 254 fichiers / 314 Mo de plus de 7 jours, et 31 fichiers de
 * plus de 5 Mo (le plus gros, conv-439 : 18 Mo). C'est le PREMIER poste de volume de
 * `.autowin-data` et la cause mesurée des blocages d'interface : 83 des 117 gels du 12/09 sont des
 * entrées-sorties disque synchrones.
 *
 * Ce que sert encore une trace ancienne : la rétrospective (`retrospective`, `conversation_read`
 * lisent ces événements). On garde donc une fenêtre récente — la même que les journaux de tour et
 * les sorties brutes (7 jours) — et on jette au-delà. La conversation elle-même, ses messages et
 * son RUN.md ne sont PAS touchés : seule la trace détaillée des outils disparaît.
 *
 * CE QU'ON NE SUPPRIME JAMAIS :
 *  - une trace touchée depuis moins de `maxAgeMs` (7 j) ;
 *  - la trace de la conversation ACTIVE, quel que soit son âge — elle est en cours d'écriture ;
 *  - les `.<convId>.sequence` : ces compteurs pèsent quelques octets et garantissent que les
 *    numéros d'événements restent croissants si la conversation reparle. Les effacer avec la trace
 *    ferait repartir la numérotation à zéro.
 *
 * Le PLAN est PUR (entrées → chemins à supprimer), comme `planJournalGc` et `planWorkspaceGc` :
 * la politique se teste sans toucher au disque. `collectCausalTraces` ne fait que l'appliquer.
 */

export interface CausalTraceEntry {
  path: string
  conversationId: string
  size: number
  modifiedMs: number
}

export interface CausalTraceGcPolicy {
  /** Instant de référence (injecté → test déterministe). */
  nowMs: number
  /** Au-delà de cet âge, la trace détaillée ne sert plus. */
  maxAgeMs?: number
  /** Conversations intouchables quel que soit leur âge (active, épinglées). */
  protectedConversationIds?: readonly string[]
  /** Plafond de travail par passe : le reste attend le prochain démarrage. */
  maxDeletions?: number
}

/** 7 jours — même fenêtre que `JOURNAL_RETENTION_MS`, pour ne pas laisser de trace à demi lisible. */
export const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Borne le coût d'une passe de démarrage. */
const DEFAULT_MAX_DELETIONS = 500

export interface CausalTraceGcPlan {
  doomed: string[]
  /** Candidats écartés par `maxDeletions`. */
  remaining: number
}

/** Décide quelles traces supprimer. PUR. */
export function planCausalTraceGc(
  entries: readonly CausalTraceEntry[],
  policy: CausalTraceGcPolicy
): CausalTraceGcPlan {
  const maxAgeMs = policy.maxAgeMs ?? DEFAULT_MAX_AGE_MS
  const maxDeletions = policy.maxDeletions ?? DEFAULT_MAX_DELETIONS
  const proteges = new Set(
    (policy.protectedConversationIds ?? []).map((id) => id.toLocaleLowerCase('en-US'))
  )

  const doomed: string[] = []
  for (const entry of entries) {
    if (proteges.has(entry.conversationId.toLocaleLowerCase('en-US'))) continue
    if (policy.nowMs - entry.modifiedMs <= maxAgeMs) continue
    doomed.push(entry.path)
  }
  return {
    doomed: doomed.slice(0, maxDeletions),
    remaining: Math.max(0, doomed.length - maxDeletions)
  }
}

/** Inventorie les traces d'un dossier `causal-trace/`. Les sidecars cachés sont ignorés. */
export function inventoryCausalTraces(root: string): CausalTraceEntry[] {
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return []
  }
  const entries: CausalTraceEntry[] = []
  for (const name of names) {
    if (name.startsWith('.') || !name.endsWith('.jsonl')) continue
    const path = join(root, name)
    try {
      const stat = statSync(path)
      if (!stat.isFile()) continue
      entries.push({
        path,
        conversationId: name.slice(0, -'.jsonl'.length),
        size: stat.size,
        modifiedMs: stat.mtimeMs
      })
    } catch {
      /* disparu entre le listing et le stat */
    }
  }
  return entries
}

export interface CausalTraceGcOutcome {
  removed: number
  freedBytes: number
  remaining: number
}

/** Applique le plan. La sûreté vient UNIQUEMENT de `planCausalTraceGc`. */
export function collectCausalTraces(
  root: string,
  policy: Partial<CausalTraceGcPolicy> = {}
): CausalTraceGcOutcome {
  const entries = inventoryCausalTraces(root)
  const tailles = new Map(entries.map((entry) => [entry.path, entry.size]))
  const plan = planCausalTraceGc(entries, { nowMs: Date.now(), ...policy })
  let removed = 0
  let freedBytes = 0
  for (const path of plan.doomed) {
    try {
      rmSync(path, { force: true })
      removed += 1
      freedBytes += tailles.get(path) ?? 0
    } catch {
      /* verrouillé ou déjà parti : le prochain passage s'en chargera */
    }
  }
  return { removed, freedBytes, remaining: plan.remaining }
}
