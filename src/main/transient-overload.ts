/**
 * SURCHARGE API TRANSITOIRE — ne pas perdre un run entier pour une panne de 20 secondes.
 *
 * Constaté (incident Auto-Kaizen ak-9d3fa074346ba9da) : la phase `kaizen`, rôle `subagent` bindé sur
 * claude, remontait `claude result error: API Error: 529 Overloaded. This is a server-side issue,
 * usually temporary` → l'orchestrate ENTIER échouait, alors que l'erreur se déclare elle-même
 * temporaire. Le CLI claude retente déjà les 529 qu'il voit passer en `system/api_retry`
 * (providers/claude.ts:656), mais un 529 rendu dans l'event `result` court-circuite ce backoff : il
 * arrive à l'orchestrateur comme une erreur terminale. C'est ce trou-là que ce module ferme.
 *
 * Module PUR (aucun accès disque/réseau, horloge injectable) → testable sur les chaînes EXACTES
 * jetées par les adaptateurs.
 */

import { isTransportFailure } from './provider-failure-diagnosis'

/**
 * Une panne SERVEUR explicitement temporaire (surcharge/indisponibilité), donc rejouable à
 * l'identique. Volontairement ÉTROIT : tout ce qui n'est pas nommé ici reste terminal (une erreur
 * d'auth ou un CLI manquant ne se répare pas en réessayant — cf. provider-failure-diagnosis.ts).
 */
export function isTransientOverload(message: string): boolean {
  const text = message.toLowerCase()
  if (/\b(429|401|403|404)\b/.test(text)) return false
  return (
    /\b(529|503|502|504)\b/.test(text) ||
    /overloaded/.test(text) ||
    /surcharg/.test(text) ||
    /temporarily unavailable|service unavailable|try again in a moment/.test(text)
  )
}

/**
 * POURQUOI on rejoue : une surcharge serveur, ou un CLI arrêté de l'extérieur avant de répondre.
 * Les deux disent quelque chose du TRANSPORT, rien de la tâche.
 */
export type RetryCause = 'surcharge' | 'cli-arrete'

export interface TransientRetryOptions {
  /** Nombre TOTAL de tentatives sur SURCHARGE (1 = aucun réessai). */
  attempts?: number
  /** Délai avant la tentative n (backoff linéaire : n × baseDelayMs). */
  baseDelayMs?: number
  /**
   * Rejeux accordés à un CLI arrêté de l'extérieur (défaut 1), comptés À PART des tentatives de
   * surcharge : un tour qui a subi les deux garde ses deux filets.
   */
  stoppedCliRetries?: number
  /** Horloge injectable — les tests passent un no-op, la prod dort vraiment. */
  sleep?: (ms: number) => Promise<void>
  /** Observabilité : appelé avant chaque réessai (attempt = numéro de la tentative qui va suivre). */
  onRetry?: (info: {
    attempt: number
    attempts: number
    delayMs: number
    message: string
    cause: RetryCause
  }) => void
  signal?: AbortSignal
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Rejoue `send` tant que l'échec est TRANSITOIRE : une surcharge serveur (avec backoff), ou un CLI
 * arrêté de l'extérieur (UNE fois, sans attente). Toute autre erreur est relancée IMMÉDIATEMENT
 * (aucune erreur n'est avalée, aucun verdict n'est déguisé) ; à épuisement, la DERNIÈRE erreur
 * remonte telle quelle. Un appel que l'utilisateur a arrêté (`signal`) n'est jamais rejoué.
 *
 * CLI ARRÊTÉ DE L'EXTÉRIEUR — incident ak-8142df0fddd513bc : « claude CLI exit 1073807364 »
 * (0x40010004, arrêt demandé par l'hôte) tuait le tour entier, alors que l'appel n'avait jamais
 * atteint le modèle et que `repairHint` conseillait déjà à l'humain de « relancer la phase ». Repris
 * de la branche Azure `autowin/secours/copie-run-fd8d6412055b-1` (2026-09-04), qui rejouait toute
 * sortie classée `crashed`. Adapté au code actuel : on ne rejoue que les statuts de TRANSPORT
 * (`isTransportFailure`) — un crash du CLI (violation d'accès) est un vrai défaut qui se
 * reproduirait, et le rejouer masquerait un bug (cf. `TRANSPORT_EXIT_CODES`). Si la réponse était
 * déjà produite avant l'arrêt, `providers/claude.ts` la garde et rien n'arrive jusqu'ici.
 */
export async function retryOnTransientOverload<T>(
  send: () => Promise<T>,
  options: TransientRetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const baseDelayMs = options.baseDelayMs ?? 4000
  const stoppedCliRetries = Math.max(0, options.stoppedCliRetries ?? 1)
  const sleep = options.sleep ?? realSleep
  let overloadAttempt = 1
  let stoppedCliReplays = 0
  for (;;) {
    try {
      return await send()
    } catch (error) {
      if (options.signal?.aborted) throw error
      const message = error instanceof Error ? error.message : String(error)
      if (isTransportFailure(message)) {
        if (stoppedCliReplays >= stoppedCliRetries) throw error
        stoppedCliReplays += 1
        options.onRetry?.({
          attempt: stoppedCliReplays + 1,
          attempts: stoppedCliRetries + 1,
          delayMs: 0,
          message,
          cause: 'cli-arrete'
        })
        continue
      }
      if (overloadAttempt >= attempts || !isTransientOverload(message)) throw error
      const delayMs = overloadAttempt * baseDelayMs
      overloadAttempt += 1
      options.onRetry?.({
        attempt: overloadAttempt,
        attempts,
        delayMs,
        message,
        cause: 'surcharge'
      })
      await sleep(delayMs)
    }
  }
}
