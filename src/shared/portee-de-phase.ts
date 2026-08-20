import { PIPELINE_PHASES } from './pipeline-phases'

/**
 * Un run qui n'a joue QUE de l'analyse ne peut pas annoncer que le besoin est fini.
 *
 * DEFAUT VECU le 20/08. L'utilisateur lance `/frame` en ecrivant noir sur blanc : « Ce tour ne joue
 * que la phase frame : la suite (terrain → build → clean → judge) s'enchaine au tour suivant ».
 * L'orchestration rend un cadrage correct, et le tour se clot sur :
 *
 *   ✅ Fait — Le resultat demande a ete produit et valide.
 *   ⏳ Reste a faire : rien.
 *   👉 Recommande : passer a la prochaine demande.
 *
 * Reaction de l'utilisateur au tour suivant : « la vache t'as deja tout fait ? ». Il avait ete
 * induit en erreur par le rapport, pas par le travail — le cadrage etait bon. « Reste a faire :
 * rien » apres une phase d'ANALYSE est faux par construction : tout le build est devant.
 *
 * CE N'EST PAS UNE HALLUCINATION DU MODELE. Le pilote clot ce tour MECANIQUEMENT et le texte vient
 * de `deliveredClosingBlock` — donc du code d'Autowin. Une garde comportementale ou une relance du
 * modele n'y auraient rien change : c'est le gabarit qui mentait, et un gabarit se corrige sans
 * appel supplementaire. La detection de la revendication dans le TEXTE a donc ete ecrite puis
 * RETIREE, faute d'appelant : un module sans appelant est du theatre, defaut recurrent de ce depot.
 *
 * POURQUOI LES GARDES EXISTANTES NE VOYAIENT RIEN. `demoteUnvalidatedSuccessClaims` sort des la
 * premiere ligne sur une issue LIVREE — et un `frame` reussi en est une. La question qu'elle pose
 * est « le travail a-t-il ete valide ? », pas « de quoi ce travail etait-il la portee ? ». Cette
 * garde est donc ORTHOGONALE, pas un doublon : l'issue est vraie, c'est la PORTEE qui est surjouee.
 */

/** Les phases qui MUTENT le depot. Tout le reste lit, cadre, ou juge. */
const PHASES_DE_MUTATION = new Set(['build', 'clean'])

/**
 * Le run n'a-t-il joue que de l'analyse ?
 *
 * `false` quand aucune phase n'est connue : sans information, on n'accuse pas. Une garde qui se
 * declenche sur un doute injecte une fausse correction, ce qui est pire que le silence.
 */
export function runDAnalyseSeule(phases: readonly string[]): boolean {
  const connues = phases.filter((phase) => typeof phase === 'string' && phase.trim())
  if (!connues.length) return false
  return !connues.some((phase) => PHASES_DE_MUTATION.has(phase.trim().toLowerCase()))
}

/**
 * Ce qui reste de la chaine canonique apres la derniere phase jouee.
 *
 * On part de la POSITION la plus avancee atteinte, pas du nombre de phases : un run `/frame` seul a
 * encore terrain, build, clean et judge devant lui, meme s'il a joue plusieurs fois la meme phase.
 */
export function phasesRestantes(phases: readonly string[]): string[] {
  let plusAvancee = -1
  for (const phase of phases) {
    const index = PIPELINE_PHASES.indexOf(phase?.trim?.().toLowerCase() as never)
    if (index > plusAvancee) plusAvancee = index
  }
  if (plusAvancee < 0) return []
  return PIPELINE_PHASES.slice(plusAvancee + 1).filter(
    (phase) => phase !== 'kaizen' && phase !== 'remake'
  )
}
