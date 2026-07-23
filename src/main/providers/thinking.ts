/** Borne d'un bloc de raisonnement capturé (parité avec le cap stdout des preuves). */
const THINKING_CAP = 20_000

/**
 * Assemble les fragments de raisonnement/thinking capturés au fil du stream en UNE chaîne :
 * jette les fragments vides, joint par saut de ligne, borne à THINKING_CAP, et renvoie `undefined`
 * si rien d'exploitable (pas une chaîne vide). Pur → testable ; partagé par claude.ts et codex.ts.
 */
export function joinThinking(fragments: Array<string | undefined | null>): string | undefined {
  const joined = fragments
    .map((f) => (typeof f === 'string' ? f.trim() : ''))
    .filter(Boolean)
    .join('\n')
    .trim()
  if (!joined) return undefined
  return joined.length > THINKING_CAP ? joined.slice(-THINKING_CAP) : joined
}
