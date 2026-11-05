// Le texte d'un tour de chat qui se termine. Sorti tel quel de AgentPilot.chat() (conv-1580,
// lot 3) : il lit l'état du tour (`etat-du-tour.ts`) au lieu de capturer ses `let`.
import { avertirSiLeconNonRetenue } from '../lecon-non-retenue'
import type { EtatDuTour } from './etat-du-tour'
import type { PilotEventVariant } from './evenements'
import { texteCmdIlisible } from './jetons-de-commande'

/**
 * Le texte d'un tour qui se termine — JAMAIS vide.
 *
 * Cause racine des « conversations qui echouent » (conv-1141) : un tour ayant AGI sans rien DIRE
 * produisait une bulle vide, et l'utilisateur renvoyait le meme prompt en boucle sans jamais
 * savoir ce qui ratait. Deux sites cloturent un tour ; ils partagent ce repli plutot que d'en
 * garder chacun une copie qui divergerait.
 */
export function texteDeClotureDuTour(
  etat: Pick<
    EtatDuTour,
    'anyActionExecuted' | 'cmdEmisCeTour' | 'refusRememberAuxiliaire' | 'depotMemoireCeTour'
  >,
  spoken: string
): string {
  const texte =
    spoken ||
    (etat.anyActionExecuted
      ? 'J’ai agi mais je n’ai pas produit de conclusion en clair — vois les cartes ' +
        'd’action ci-dessus pour le detail (et leurs eventuels echecs).'
      : etat.cmdEmisCeTour
        ? texteCmdIlisible()
        : 'Aucune reponse produite pour ce tour.')
  /*
   * UN REFUS DE MEMOIRE ENCORE DEBOUT SUIT LE TOUR JUSQU'A SA CLOTURE, QUELLE QU'ELLE SOIT.
   *
   * La mention ne vivait que dans le raccourci `onlyAuxiliaryRemember`. Des que la reprise rend
   * la main au modele (conv-52), le tour se clot ailleurs — branche sans commande, question,
   * repli sur le cap — et le refus disparaissait alors COMPLETEMENT : ni le modele ni
   * l'utilisateur n'apprenaient que rien n'avait ete ecrit. La mention est donc portee par le
   * point de cloture COMMUN, et elle s'efface d'elle-meme quand un depot rejoue reussit.
   */
  // Une « Leçon : » écrite sans AUCUN dépôt dans le tour le dit aussi (conv-335) ; un refus
  // encore debout le dit déjà, d'où l'une OU l'autre mention, jamais les deux.
  return etat.refusRememberAuxiliaire
    ? `${texte}

⚠️ Mémoire NON déposée — ${etat.refusRememberAuxiliaire}`
    : avertirSiLeconNonRetenue(texte, etat.depotMemoireCeTour)
}

/**
 * La fin d'un tour arrivé au cap d'itérations sans réponse finale : la clôture la plus utile, sinon
 * l'erreur. Sortie telle quelle de AgentPilot.chat() (conv-1580, suite du plan, pour ramener
 * `chat()` sous 500 lignes) ; `texteDeCloture(x)` y devient `texteDeClotureDuTour(etat, x)`.
 */
export function fermerAuCapDesIterations(
  etat: Pick<
    EtatDuTour,
    | 'iterationLimit'
    | 'compteRenduOrchestration'
    | 'orchestrationOutcome'
    | 'usage'
    | 'visibleTextThisTurn'
    | 'anyActionExecuted'
    | 'cmdEmisCeTour'
    | 'refusRememberAuxiliaire'
    | 'depotMemoireCeTour'
  >,
  emit: (e: PilotEventVariant) => void
): void {
  // Le cap EFFECTIF, pas le cap initial : `grantRecoveryIteration` en accorde jusqu'a huit de plus
  // (directive tardive, tour muet, chiffre non verifie, conclusion absente, echec taise...). Un tour
  // ayant reellement tourne neuf fois annoncait « Cap d'iterations (6) », donc le seul nombre que
  // l'utilisateur peut utiliser pour comprendre etait faux.
  const capError = `Cap d'itérations (${etat.iterationLimit}) atteint sans réponse finale`
  // REPLI : une orchestration a bel et bien tourne dans ce tour. Mourir sur le cap jetterait son
  // compte-rendu — un resultat paye, deja calcule, que le modele a seulement omis de commenter.
  if (etat.compteRenduOrchestration) {
    emit({
      kind: 'done',
      text: etat.compteRenduOrchestration,
      ...(etat.orchestrationOutcome ? { outcome: etat.orchestrationOutcome } : {}),
      usage: etat.usage
    })
    return
  }
  // Le modèle a PARLÉ pendant ce tour : sa dernière parole EST la clôture. Mourir sur une erreur
  // terminale jetterait un texte déjà payé et déjà diffusé en flux (conv-1485).
  if (etat.visibleTextThisTurn.trim()) {
    emit({
      kind: 'done',
      text: texteDeClotureDuTour(etat, etat.visibleTextThisTurn),
      ...(etat.orchestrationOutcome ? { outcome: etat.orchestrationOutcome } : {}),
      usage: etat.usage
    })
    return
  }
  emit({
    kind: 'error',
    text: capError,
    usage: etat.usage
  })
  throw new Error(capError)
}
