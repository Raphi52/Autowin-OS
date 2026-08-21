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

/** Verdicts de MEMBRE de panel, poussés avant la synthèse — ce ne sont pas des verdicts de run. */
const PREFIXE_VOTE = 'vote:'

/**
 * `true` validé · `false` défaut · `null` indéterminé (jamais une supposition).
 *
 * Trois pièges, tous trouvés par audit et couverts par les tests :
 * 1. UN VOTE N'EST PAS LE VERDICT. Le panel pousse un événement par juge avec
 *    `detail: 'vote: VALIDE|DEFAUT'` (orchestrator.ts:4618) AVANT la synthèse, qui dit
 *    'validé'/'défaut' (orchestrator.ts:4722). Sans cette porte, le premier vote arrivé gagnait la
 *    course et l'arbitrage devenait irrévocable : un panel dont le premier membre valide et dont la
 *    synthèse conclut au défaut enregistrait une réussite, mesurant le pari contre une minorité.
 * 2. « INVALIDE » CONTIENT « VALIDE ». Un detail « défaut : preuve invalide » était lu comme une
 *    réussite. Le défaut est donc testé EN PREMIER, et « validé » n'est reconnu qu'en mot entier.
 * 3. « NON VALIDÉ » N'EST PAS « VALIDÉ ».
 */
export function verdictEstReussi(detail: string | undefined, texteVerdict: string): boolean | null {
  const marque = (detail ?? '').trim().toLowerCase()
  if (marque.startsWith(PREFIXE_VOTE)) return null
  if (marque.includes('defaut') || marque.includes('défaut')) return false
  if (contientValideEnMotEntier(marque)) return true
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

/** « validé » comme MOT : ni « invalide », ni « non validé ». Sans regex, pour rester lisible. */
function contientValideEnMotEntier(marque: string): boolean {
  const lettre = (caractere: string | undefined): boolean =>
    caractere !== undefined && /[a-zà-ÿ]/.test(caractere)
  for (const forme of ['validé', 'validee', 'validée', 'valide']) {
    let depuis = 0
    for (;;) {
      const position = marque.indexOf(forme, depuis)
      if (position < 0) break
      depuis = position + 1
      if (lettre(marque[position - 1])) continue
      if (lettre(marque[position + forme.length])) continue
      const avant = marque.slice(0, position).trimEnd()
      if (avant.endsWith('non')) continue
      return true
    }
  }
  return false
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
