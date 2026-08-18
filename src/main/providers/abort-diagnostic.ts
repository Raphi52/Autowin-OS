/**
 * POURQUOI un appel provider s'est arrêté — la seule construction de ce message.
 *
 * Défaut mesuré le 2026-08-18. L'utilisateur lit « Phase frame — le rôle subagent est bindé sur
 * codex (gpt-5.6-sol) : codex exec annulé », demande la cause, et l'agent n'a rien à lui donner : il
 * énumère des hypothèses, puis affirme « quota Codex épuisé » d'après des traces d'AUTRES appels,
 * avant de se rétracter. Trois tours perdus et une fausse cause affirmée, pour une information qui
 * existait à trois couches de là.
 *
 * `execution-supervisor` appelle `controller.abort(reason)` avec une raison PRÉCISE — « budget duree
 * depasse (600000 ms) », « Budget USD depasse (…) », « Reprise refusee : 2 appel(s) provider encore
 * actif(s). » — et les quatre providers la remplaçaient chacun par une constante : « codex exec
 * annulé », « claude CLI annulé », « Kimi Code annulé », « Envoi Gemini annulé. ». `AbortSignal`
 * porte pourtant `reason` : la réponse était là, personne ne la lisait.
 *
 * Deux principes tenus ici :
 *   — on ne dit JAMAIS plus que ce qu'on sait : sans raison, on écrit qu'elle manque, on n'invente
 *     ni quota ni timeout (c'est exactement l'erreur que l'agent a commise faute de données) ;
 *   — l'absence se NOMME (`none`) au lieu de laisser un trou, pour qu'un lecteur distingue « rien
 *     n'a été capturé » de « rien ne s'est passé ».
 *
 * Le format reprend celui du chemin de sortie non nulle de `codex.ts` (`exit-code=`, `last-event=`,
 * `stderr=`) : un seul format de diagnostic à lire, quelle que soit la façon dont l'appel est mort.
 */

/** Ce qu'un provider a pu accumuler avant de mourir. Tout est optionnel : seul codex tient un tampon. */
export interface AbortDiagnosticExtras {
  /** Dernier événement structuré d'erreur reçu du provider — c'est lui qui porte « usage limit ». */
  lastStructuredError?: string
  /** Sortie d'erreur du processus, si elle est collectée. */
  stderr?: string
}

/** La raison d'un `AbortSignal`, rendue lisible sans jamais rien inventer. */
export function abortReasonText(signal: AbortSignal | undefined): string | undefined {
  if (!signal) return undefined
  const raison: unknown = signal.reason
  if (raison === undefined || raison === null) return undefined
  if (typeof raison === 'string') return raison.trim() || undefined
  // `abort()` sans argument met une `AbortError` GENERIQUE, dont le texte varie selon le runtime
  // (« This operation was aborted », « The operation was aborted », « signal is aborted without
  // reason »). Elle ne dit rien de plus que « abort » : la traiter comme une raison ferait passer
  // une absence d'information pour une information.
  if (raison instanceof Error) {
    const generique = /(this|the) operation was aborted|aborted without reason|signal is aborted/i
    if (raison.name === 'AbortError' && generique.test(raison.message)) return undefined
    return raison.message.trim() || undefined
  }
  try {
    const rendu = JSON.stringify(raison)
    return rendu && rendu !== '{}' ? rendu : undefined
  } catch {
    return undefined
  }
}

/**
 * L'erreur à rejeter quand un appel provider est interrompu par son signal.
 *
 * `action` situe l'appel (« codex exec », « claude CLI »…) ; le reste vient des faits observés.
 */
export function abortFailure(
  action: string,
  signal: AbortSignal | undefined,
  extras: AbortDiagnosticExtras = {}
): Error {
  const raison = abortReasonText(signal) ?? "raison non rapportee par l'appelant"
  const details = [
    `last-event=${extras.lastStructuredError?.trim() || 'none'}`,
    `stderr=${extras.stderr?.trim().slice(-800) || 'none'}`
  ].join('\n')
  return new Error(`${action} interrompu : ${raison}\n${details}`)
}
