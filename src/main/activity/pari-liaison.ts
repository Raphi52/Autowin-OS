import type { IssuePhase, PariPhase } from '../../shared/pari-calibration'

/**
 * Liaison entre le pari d'une phase et le verdict du juge, dans le même run.
 *
 * Le pari émis par BUILD porte sur « mon travail passera le juge » : son arbitre est donc le verdict
 * de ce run, et rien d'autre. On ne dérive JAMAIS une issue d'un run non jugé — une phase sans verdict
 * n'a pas d'issue falsifiable, et l'apparier à un néant fabriquerait de la mesure à partir de rien.
 *
 * `null` est un résultat légitime : un verdict illisible reste illisible. Deviner « réussi » par
 * défaut gonflerait mécaniquement la calibration de tous les agents.
 */

/** `true` validé · `false` défaut · `null` indéterminé (jamais une supposition). */
export function verdictEstReussi(detail: string | undefined, texteVerdict: string): boolean | null {
  const marque = (detail ?? '').toLowerCase()
  if (marque.includes('validé') || marque.includes('valide')) return true
  if (marque.includes('défaut') || marque.includes('defaut')) return false
  /*
   * Le contrat du juge met le verdict sur la PREMIÈRE ligne, et son brief l'avertit que le mot DEFAUT
   * ailleurs serait pris pour un rejet. On respecte ce contrat à la lettre : lire tout le texte
   * ferait basculer en échec un verdict validé dont une objection mentionne un défaut mineur.
   */
  const premiere = texteVerdict.split('\n')[0]?.trim().toUpperCase() ?? ''
  if (premiere.startsWith('VALIDE')) return true
  if (premiere.startsWith('DEFAUT')) return false
  return null
}

export function issuesDepuisVerdict(
  paris: readonly PariPhase[],
  runId: string,
  reussie: boolean
): IssuePhase[] {
  return paris
    .filter((pari) => pari.runId === runId)
    .map((pari) => ({ runId: pari.runId, phase: pari.phase, reussie, jugee: true }))
}
