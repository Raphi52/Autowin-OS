import type { CostSink } from './dashboards/cost'
import type { RoleBinding } from './roles'
import type { SendResult } from './providers/types'

/**
 * LA TRACE DES PETITS APPELS (conv-1097, 2026-10-22).
 *
 * Quatre appels courts tournent hors pipeline, sans outil, pour une réponse d'une ligne : le choix
 * du workflow (`os.ts`), les deux lectures et le rangement du premier message (`index.ts`),
 * l'arbitrage d'une dérive (`orchestrator.ts`). Ils partent sur le modèle des petites tâches
 * (Haiku par défaut, `roles.ts`). Mesuré par le scout de conv-1097 : aucun n'écrivait de coût,
 * `cost.jsonl` ne contenait aucune ligne Haiku, et une panne était avalée (`catch → undefined`).
 * L'économie annoncée n'existait que dans un commentaire, et un Haiku qui répondrait au mauvais
 * format éteignait la fonction sans que personne ne le voie.
 *
 * Chaque appel écrit donc UNE ligne dans `cost.jsonl` : son nom, le modèle RÉELLEMENT servi, son
 * coût, et son issue (ce que la réponse a donné). Une panne est nommée dans le journal du processus.
 */

/** Rôle écrit dans `cost.jsonl` pour un appel du modèle des petites tâches. */
export const ROLE_PETITES_TACHES = 'petitesTaches'

export type AppelCourt =
  | 'choixWorkflow'
  | 'compositionWorkflow'
  | 'deuxLectures'
  | 'rangementPremierMessage'
  | 'arbitrageDerive'

/** Longueur gardée de l'issue : de quoi lire un format inattendu, pas de quoi recopier un texte. */
const ISSUE_MAX = 160

export function noterAppelCourt(
  sink: CostSink,
  p: {
    appel: AppelCourt
    /** Absent = un appel du modèle des petites tâches. */
    role?: string
    binding: RoleBinding
    res: Pick<SendResult, 'provider' | 'model' | 'usage'>
    issue: string
    conversationId?: string
  }
): void {
  const usage = p.res.usage
  sink.add({
    provider: p.res.provider || p.binding.provider,
    role: p.role ?? ROLE_PETITES_TACHES,
    appel: p.appel,
    model: p.res.model ?? p.binding.model,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
    ...(usage?.cacheReadTokens !== undefined ? { cacheReadTokens: usage.cacheReadTokens } : {}),
    ...(usage?.cacheCreationTokens !== undefined
      ? { cacheCreationTokens: usage.cacheCreationTokens }
      : {}),
    ...(usage?.costUsd !== undefined ? { costUsd: usage.costUsd } : {}),
    issue: resumerIssue(p.issue),
    ...(p.conversationId ? { conversationId: p.conversationId } : {})
  })
}

/** Une ligne, bornée : un retour à la ligne dans `cost.jsonl` ne casse rien, mais se relit mal. */
export function resumerIssue(texte: string): string {
  const uneLigne = texte.replace(/\s+/g, ' ').trim()
  if (!uneLigne) return '(réponse vide)'
  return uneLigne.length > ISSUE_MAX ? `${uneLigne.slice(0, ISSUE_MAX - 1)}…` : uneLigne
}

/** Une panne n'est plus avalée en silence : elle est NOMMÉE dans le journal du processus. */
export function signalerPanneAppelCourt(appel: AppelCourt, error: unknown): void {
  console.warn(
    `[petites-taches] ${appel} abandonné : ${error instanceof Error ? error.message : String(error)}`
  )
}
