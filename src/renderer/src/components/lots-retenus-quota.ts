/**
 * LES LOTS D'UNE SÉLECTION SCOUT NE PARTENT PAS DANS LE MUR DE QUOTA (conv-1080, 2026-10-22).
 *
 * Le panneau des candidats découpe une sélection en lots, envoyés un par tour par la file du fil.
 * Quand un lot bute sur la limite d'abonnement (« You've hit your session limit · resets 11:30am »,
 * conv-1055 à 11:01), la fin de son tour relâchait aussitôt le lot suivant : refusé à son tour par le
 * même mur, il retombait en quelques secondes, relâchait le troisième, et la file se vidait en une
 * cascade d'échecs — chaque lot « parti », aucun traité. Sur les 49 runs lancés depuis le panneau,
 * 16 avaient été coupés par cette limite.
 *
 * Ce module ne fait QUE trancher ; la vue garde la file et la relâche à la reprise.
 *
 * DEUX FORMES DE COUPURE, toutes deux réelles :
 * - le tour du chat échoue sur le mur (`status: 'failed'`, erreur « Claude a interrompu l'appel :
 *   You've hit your session limit… », conv-1055) ;
 * - le RUN du lot bute sur le mur, mais le tour du chat se clôt quand même (`agent-pilot.ts` rend
 *   la parole au modèle après `orchestrate`, éventuellement sur un autre compte) : l'action
 *   `orchestrate` porte alors `ok: false` et le refus en `data` — le travail est suspendu
 *   (`orchestrator.ts`, `murDeQuotaDuRun`), pas fini.
 *
 * Le vocabulaire du mur est celui de `estMurDeQuota` (le rate-limit passager n'y entre pas).
 */
import { estMurDeQuota } from '../../../shared/reprise-quota'

/** Ce que la règle lit d'un message du fil — un sous-ensemble de `Msg`. */
export interface MessageDuFilLu {
  role: string
  status?: string
  error?: string
  parts?: readonly unknown[]
}

/** Ce que la règle lit d'une entrée de la file — un sous-ensemble de `QueuedDirective`. */
export interface EntreeDeFileLue {
  lot?: boolean
}

/** Le texte d'erreur d'un résultat d'`orchestrate` : la chaîne nue, ou le champ `error` de l'issue. */
function texteDErreur(data: unknown): string | undefined {
  if (typeof data === 'string') return data
  if (data && typeof data === 'object') {
    const erreur = (data as { error?: unknown }).error
    if (typeof erreur === 'string') return erreur
  }
  return undefined
}

/**
 * Le refus de quota qui a coupé le DERNIER tour du fil, ou rien.
 *
 * « Dernier tour » = la dernière réponse de l'agent, à condition qu'aucune demande ne la suive : un
 * message parti après elle ouvre un tour qui n'a pas encore rendu son issue.
 */
export function coupureParQuotaDuDernierTour(fil: readonly MessageDuFilLu[]): string | undefined {
  for (let rang = fil.length - 1; rang >= 0; rang--) {
    const message = fil[rang]
    if (message.role === 'user') return undefined
    if (message.role !== 'assistant') continue
    if (message.status === 'failed' && estMurDeQuota(message.error)) return message.error
    for (const part of message.parts ?? []) {
      if (!part || typeof part !== 'object') continue
      const lue = part as {
        kind?: unknown
        name?: unknown
        ok?: unknown
        data?: unknown
        message?: unknown
      }
      // L'échec rendu par la RÉPONSE de `pilotChat` (et non par l'événement `error`) ne remplit
      // que sa part d'erreur structurée : `error` reste vide (ChatView.tsx, `send`).
      if (lue.kind === 'error' && message.status === 'failed') {
        const refus = typeof lue.message === 'string' ? lue.message : undefined
        if (estMurDeQuota(refus)) return refus
        continue
      }
      if (lue.kind !== 'action' || lue.name !== 'orchestrate' || lue.ok !== false) continue
      const refus = texteDErreur(lue.data)
      if (estMurDeQuota(refus)) return refus
    }
    return undefined
  }
  return undefined
}

/**
 * La file du fil est-elle RETENUE par le quota : sa tête est un lot de sélection, et le dernier tour
 * a buté sur la limite ? Un texte tapé en tête de file part, lui : c'est une demande de
 * l'utilisateur, pas une suite que l'app relâche toute seule.
 */
export function lotsRetenusParLeQuota(
  file: readonly EntreeDeFileLue[],
  fil: readonly MessageDuFilLu[]
): boolean {
  return file[0]?.lot === true && coupureParQuotaDuDernierTour(fil) !== undefined
}
