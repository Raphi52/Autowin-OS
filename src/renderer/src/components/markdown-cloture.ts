/**
 * LE BLOC DE CLOTURE, isole du rendu.
 *
 * Pourquoi ce fichier (2026-09-12) : `splitFinalSummary` vivait dans `Markdown.tsx`, un fichier de
 * COMPOSANTS. Exporter une fonction pure a cote d'un composant casse le rechargement a chaud de
 * React (`react-refresh/only-export-components`, erreur de lint) et obligeait chaque test qui
 * doublait `./Markdown` a penser a la re-exporter -- deux tests sont tombes pour cette seule
 * raison. Meme decoupe que `markdown-recommandation.ts`, deja voisin.
 */
import { markdownCodeLineProtection } from '../../../shared/orchestration-outcome'

export type FinalSummaryParts = {
  before: string
  summary: string
  /** Ce qui suit le bloc : rendu NORMALEMENT, hors du lisere, jamais perdu. */
  after: string
}

/**
 * LE DEPOUILLEMENT DU DECOR, avant toute reconnaissance de libelle.
 *
 * Signale par l'utilisateur : « des fois il s'affiche pas ». Deux formes reelles echappaient a la
 * detection, donc au lisere. La PUCE, d'abord : un bloc de cloture ecrit en liste n'etait pas vu.
 * Et surtout le bloc RETROGRADE par le main — sur un run non valide,
 * `demoteUnvalidatedSuccessClaims` remplace `✅ Fait` par `⚠️ Fait — AUTO-DECLARE`, et l'emoji
 * n'etait plus reconnu. Le cadre disparaissait donc exactement sur les reponses ou l'etat est le
 * plus important a lire.
 */
function sansDecorDeLibelle(line: string): string {
  return line
    .trim()
    .replace(/^(?:[-*+]|\d+[.)])\s+/u, '')
    .replace(/^#+\s*/u, '')
    .replace(/^(?:\*\*|__)/u, '')
    .trim()
}

/** `✅` sur un run livre, `⚠️` quand le main a retrograde l'etiquette : le meme bloc, deux etats. */
const MARQUE_FAIT = /^(?:✅|⚠)️?\s*(?:\*\*)?Fait(?:\*\*)?(?:\s*(?:[:：]|[—–-]).*|\s*\*\*)?$/u

const FINAL_SUMMARY_LABELS = [
  MARQUE_FAIT,
  /^📍️?\s*(?:\*\*)?Maintenant(?:\*\*)?(?:\s*(?:[:：]|[—–-]).*|\s*\*\*)?$/u,
  /^⏳️?\s*(?:\*\*)?Reste à faire(?:\*\*)?(?:\s*(?:[:：]|[—–-]).*|\s*\*\*)?$/u,
  /^👉️?\s*(?:\*\*)?Recommandé(?:\*\*)?(?:\s*(?:[:：]|[—–-]).*|\s*\*\*)?$/u
]

export function splitFinalSummary(text: string): FinalSummaryParts | null {
  const lines = text.split('\n')
  const protectedLines = markdownCodeLineProtection([text])[0]
  let markerIndex = -1
  let candidateIndex = -1
  let nextLabelIndex = 0

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (!protectedLines.has(index + 1)) {
      const nu = sansDecorDeLibelle(line)
      const labelIndex = FINAL_SUMMARY_LABELS.findIndex((pattern) => pattern.test(nu))
      if (labelIndex === 0) {
        candidateIndex = index
        nextLabelIndex = 1
      } else if (labelIndex >= 0 && candidateIndex >= 0) {
        if (labelIndex === nextLabelIndex) {
          nextLabelIndex += 1
          if (nextLabelIndex === FINAL_SUMMARY_LABELS.length) {
            markerIndex = candidateIndex
            candidateIndex = -1
            nextLabelIndex = 0
          }
        } else {
          candidateIndex = -1
          nextLabelIndex = 0
        }
      }
    }
  }

  if (markerIndex < 0) return null

  let beforeEnd = markerIndex
  let separatorIndex = markerIndex - 1
  while (separatorIndex >= 0 && lines[separatorIndex].trim() === '') separatorIndex -= 1
  if (separatorIndex >= 0 && lines[separatorIndex].trim() === '---') beforeEnd = separatorIndex

  /*
   * LA BORNE DE FIN, qui n'existait pas.
   *
   * Signale par l'utilisateur : « des fois il encadre tout ce qui vient apres la ligne
   * recommande ». `lines.slice(markerIndex)` prenait tout jusqu'au bout du texte : n'importe quelle
   * ligne ecrite apres la recommandation — une note, un avertissement d'Autowin, un bloc de code —
   * se retrouvait enfermee dans le lisere et presentee comme « resume final ».
   *
   * Le bloc s'arrete a la fin du PARAGRAPHE de la recommandation : sa ligne, plus celles qui la
   * suivent sans coupure (un conseil peut tenir sur deux lignes). La premiere ligne vide ferme.
   * Ce qui suit reste dans la reponse, simplement hors du cadre — jamais perdu.
   */
  const marqueRecommande = FINAL_SUMMARY_LABELS[FINAL_SUMMARY_LABELS.length - 1]
  let summaryEnd = lines.length
  for (let index = markerIndex; index < lines.length; index += 1) {
    if (!marqueRecommande.test(sansDecorDeLibelle(lines[index]))) continue
    let fin = index + 1
    while (fin < lines.length && lines[fin].trim() !== '') fin += 1
    summaryEnd = fin
    break
  }

  return {
    before: lines.slice(0, beforeEnd).join('\n').replace(/\n+$/u, ''),
    summary: lines.slice(markerIndex, summaryEnd).join('\n'),
    after: lines.slice(summaryEnd).join('\n').replace(/^\n+/u, '')
  }
}
