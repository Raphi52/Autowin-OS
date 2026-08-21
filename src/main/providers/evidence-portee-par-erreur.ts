import type { ExecutionEvidence } from './types'

/**
 * ACTIONS D'UN SOUS-AGENT QUI A ECHOUE.
 *
 * Mesure du 2026-08-21 sur les 60 traces les plus recentes : un sous-agent `completed` montre ses
 * actions 38 fois sur 39, un sous-agent `failed` ne les montre JAMAIS (0 sur 9, et 0 sur 15 pour un
 * tour interrompu). La cause est structurelle : la pompe du provider accumule les preuves puis fait
 * `throw errored`, donc les dizaines d'actions deja observees partent avec l'exception sans jamais
 * atteindre l'objet de retour.
 *
 * C'est exactement l'inverse du besoin : on veut voir ce qu'un agent a fait SURTOUT quand il a
 * echoue. Ce porteur accroche les preuves a l'erreur elle-meme, seul objet qui traverse le `throw`.
 */
const PORTEUR = Symbol.for('autowin.executionEvidence')

/** Accroche les preuves accumulees a l'erreur qui va etre levee. Best-effort : ne jette jamais. */
export function attacherEvidenceALErreur(erreur: unknown, evidence: ExecutionEvidence[]): void {
  if (!evidence.length || typeof erreur !== 'object' || erreur === null) return
  try {
    Object.defineProperty(erreur, PORTEUR, {
      value: [...evidence],
      enumerable: false,
      configurable: true
    })
  } catch {
    /* erreur gelee (Object.freeze) → on perd la piste plutot que de masquer l'echec reel */
  }
}

/** Relit les preuves portees par une erreur. `undefined` quand il n'y en a pas — jamais un tableau vide. */
export function evidenceDeLErreur(erreur: unknown): ExecutionEvidence[] | undefined {
  if (typeof erreur !== 'object' || erreur === null) return undefined
  const porte = (erreur as Record<symbol, unknown>)[PORTEUR]
  if (!Array.isArray(porte) || porte.length === 0) return undefined
  return porte as ExecutionEvidence[]
}
