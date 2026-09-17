import { isTransientOverload } from './transient-overload'

/**
 * REJOUER UN TOUR DE CHAT TUE PAR UNE PANNE SERVEUR TEMPORAIRE.
 *
 * Mesure du 2026-09-12 (`conversations.json`, 2 577 messages utilisateur) : « reprend » est retape
 * 61 fois, et ce qui le precede n'est presque jamais un quota — 11 fois « API Error: 529
 * Overloaded », 13 fois « API Error: 500 Internal server error. This is a server-side issue,
 * usually temporary ». Le pilote de chat retentait UNE seule fois, IMMEDIATEMENT, sans classer
 * l'erreur : un second appel lance dans la seconde retombe sur la meme surcharge, le tour meurt, et
 * c'est l'utilisateur qui fait le backoff a la main.
 *
 * L'orchestrateur, lui, savait deja faire (`transient-overload.ts`, importe par `orchestrator.ts`
 * seul). Ce module porte la MEME politique pour le chat, sous forme PURE : le pilote n'a plus qu'a
 * lire la decision.
 *
 * Ce qui ne change pas : une erreur qui n'est PAS une surcharge garde exactement l'ancien
 * comportement — un seul reessai immediat, puis l'echec remonte. Aucune erreur n'est avalee.
 */

/** Tentatives TOTALES sur une panne serveur explicitement temporaire (1 initiale + 2 rejeux). */
export const TENTATIVES_SURCHARGE = 3

/** Tentatives TOTALES sur toute autre erreur rejouable — la valeur historique, inchangee. */
export const TENTATIVES_ORDINAIRES = 2

/** Attente avant le rejeu n : n x cette base (4 s, puis 8 s), comme l'orchestrateur. */
export const DELAI_BASE_MS = 4000

export interface DecisionRejeu {
  /** Faut-il relancer l'appel ? Faux = l'erreur remonte telle quelle. */
  rejouer: boolean
  /** Combien de tentatives au total pour CETTE famille d'erreur (sert au libelle du fil). */
  maxAttempts: number
  /** Combien de temps dormir avant le rejeu. Zero pour une erreur ordinaire. */
  delaiMs: number
}

/**
 * Le CLI s'est casse en cours d'execution — ce n'est pas un verdict sur le fond, c'est son process
 * qui est tombe. Mesure conv-623, tour `ee2cae40-7dca-4c58-8ebb-9fb9aeadbcbb` : l'appel meurt en
 * `error_during_execution` a 18:51:58.702 en 1,9 s pour 0 token, le rejeu part 10 ms plus tard
 * (event `retry`, at 1789584718704) et remeurt a l'identique en 1,9 s. Le tour ENTIER est jete
 * apres 753 650 tokens et 0,7190 USD deja payes, et ce que le modele avait a dire est perdu.
 *
 * Rejouer dans la meme seconde un CLI encore casse, c'est refaire la meme chose en attendant un
 * autre resultat. Meme politique que la surcharge serveur : on attend, et on laisse deux chances.
 *
 * SURETE : cette famille n'est atteinte QUE si l'adaptateur a deja juge l'erreur rejouable, et il
 * ne le fait que lorsque l'appel n'a RIEN consomme (`providers/claude.ts`, champ `retryable`). Un
 * `error_during_execution` deja facture reste terminal et ne passe jamais par ici.
 */
export function estCrashDExecutionDuCli(message: string): boolean {
  return /error_during_execution/i.test(message)
}

/**
 * Que faire apres l'echec numero `attempt` (0 = le premier appel vient d'echouer) ?
 *
 * `message` est le texte de l'erreur remontee par l'adaptateur — c'est lui qui porte le code HTTP
 * et la phrase « usually temporary » sur laquelle repose la classification.
 */
export function deciderRejeuDeChat(message: string, attempt: number): DecisionRejeu {
  const transitoire = isTransientOverload(message) || estCrashDExecutionDuCli(message)
  const maxAttempts = transitoire ? TENTATIVES_SURCHARGE : TENTATIVES_ORDINAIRES
  const rejouer = attempt < maxAttempts - 1
  return {
    rejouer,
    maxAttempts,
    delaiMs: rejouer && transitoire ? (attempt + 1) * DELAI_BASE_MS : 0
  }
}

/**
 * Dort `ms`, en rendant la main IMMEDIATEMENT si le tour est annule.
 *
 * Sans cette porte, un Stop pendant l'attente laisserait le tour respirer 8 s de plus avant de
 * mourir — le bouton mentirait sur sa promesse.
 */
export function dormirAnnulable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const minuteur = setTimeout(fin, ms)
    function fin(): void {
      clearTimeout(minuteur)
      signal?.removeEventListener('abort', fin)
      resolve()
    }
    signal?.addEventListener('abort', fin, { once: true })
  })
}
