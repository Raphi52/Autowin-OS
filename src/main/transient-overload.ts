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

export interface TransientRetryOptions {
  /** Nombre TOTAL de tentatives (1 = aucun réessai). */
  attempts?: number
  /** Délai avant la tentative n (backoff linéaire : n × baseDelayMs). */
  baseDelayMs?: number
  /** Horloge injectable — les tests passent un no-op, la prod dort vraiment. */
  sleep?: (ms: number) => Promise<void>
  /** Observabilité : appelé avant chaque réessai (attempt = numéro de la tentative qui va suivre). */
  onRetry?: (info: { attempt: number; attempts: number; delayMs: number; message: string }) => void
  signal?: AbortSignal
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Rejoue `send` tant que l'échec est une surcharge TRANSITOIRE. Toute autre erreur est relancée
 * IMMÉDIATEMENT (aucune erreur n'est avalée, aucun verdict n'est déguisé) ; à épuisement des
 * tentatives, la DERNIÈRE erreur remonte telle quelle.
 */
export async function retryOnTransientOverload<T>(
  send: () => Promise<T>,
  options: TransientRetryOptions = {}
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const baseDelayMs = options.baseDelayMs ?? 4000
  const sleep = options.sleep ?? realSleep
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await send()
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      const isLast = attempt === attempts
      if (isLast || options.signal?.aborted || !isTransientOverload(message)) throw error
      const delayMs = attempt * baseDelayMs
      options.onRetry?.({ attempt: attempt + 1, attempts, delayMs, message })
      await sleep(delayMs)
    }
  }
  throw lastError
}
