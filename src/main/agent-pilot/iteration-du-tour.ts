// État d'UNE itération de la boucle de AgentPilot.chat(), partagé entre l'envoi au modèle, la
// lecture de la réponse, l'exécution des `<cmd>` et les relances. Sorti tel quel de chat()
// (lot 4) : ces modules le lisent et l'écrivent sous `iter.<nom>`.
import type { EtatDuTour } from './etat-du-tour'
import type { PilotEventVariant, RecoveredPilotProviderCall } from './evenements'

export interface IterationDuTour {
  i: number
  /** Appel déjà payé, repris à cette itération après un redémarrage. */
  recoveredHere: RecoveredPilotProviderCall | undefined
  successfulStreamedPrefix: string
  successfulAttempt: number
  /**
   * LES FLUX DE TEXTE QUE CETTE ITERATION A AFFICHES — pour pouvoir REMPLACER sa reponse (D2).
   *
   * Mesure du 2026-10-11 (tours reels) : une relance qui fait REFAIRE la reponse
   * (« conclusion absente », « chiffre non verifie ») laissait l'ancienne affichee et la nouvelle
   * s'y ajoutait — la premiere phrase deux fois, puis deux blocs « ✅ Fait ». Le moteur ne rendait
   * pourtant qu'UNE reponse : le doublon naissait dans le fil, qui assemble les flux diffuses.
   * Le fil efface un flux par son identifiant EXACT (`reduceChatTurn`, `stream-reset`), et une
   * iteration ecrit sous plusieurs : le direct, `:remainder`, `:sans-bloc`, `:ordered:N`, le
   * repli `fallback:<i>`. On les note donc a l'emission, au lieu d'en deviner la liste.
   */
  fluxAffichesCetteIteration: Set<string>
  /**
   * Retire du fil la reponse de CETTE iteration : la reponse relancee la remplacera.
   *
   * Le direct d'un appel qui a AGI (outil direct, image) porte le RECIT du travail, entrecoupe
   * de ses gestes : seul son dernier passage — la conclusion que la relance fait refaire — part.
   * Avant (tour 79a873fa, 2026-10-31) : le flux ENTIER partait, 3 h de recit et
   * 8 384 caracteres, pour une conclusion de quelques lignes.
   */
  effacerReponseRelancee: () => void
}

export function iterationDuTour(entree: {
  i: number
  recoveredHere: RecoveredPilotProviderCall | undefined
  etat: EtatDuTour
  emit: (e: PilotEventVariant) => void
}): IterationDuTour {
  const { i, recoveredHere, etat, emit } = entree
  const iter: IterationDuTour = {
    i,
    recoveredHere,
    successfulStreamedPrefix: recoveredHere?.streamedPrefix ?? '',
    successfulAttempt: recoveredHere?.attempt ?? 0,
    fluxAffichesCetteIteration: new Set<string>(),
    effacerReponseRelancee: (): void => {
      const direct = `${i}:${iter.successfulAttempt}`
      for (const streamId of iter.fluxAffichesCetteIteration) {
        if (streamId === direct && etat.gesteDansLAppel) {
          if (etat.texteApresLeDernierGeste)
            emit({ kind: 'stream-reset', streamId, iteration: i, conclusionSeule: true })
          continue
        }
        emit({ kind: 'stream-reset', streamId, iteration: i })
      }
      iter.fluxAffichesCetteIteration.clear()
      iter.successfulStreamedPrefix = ''
    }
  }
  return iter
}
