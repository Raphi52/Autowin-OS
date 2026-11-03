/**
 * GROW PROPOSÉE PAR LE CODE DE FIN DE TOUR (conv-417, 2026-11-02 ; rôle revu conv-1445, 2026-11-03).
 *
 * Depuis conv-1445, la skill `grow` (skills/grow/SKILL.md) agit PENDANT le traitement d'une demande,
 * et son corps est chargé par le code au DÉBUT de chaque demande d'action (`grow-au-debut.ts`, lu par
 * `agent-pilot.ts`). Ce fichier-ci reste la porte d'APRÈS coup : quand un run orchestré a livré une
 * modification, le bouton « /grow sur la demande que tu viens de terminer » relance grow sur cette
 * demande — il crée l'ajout qui aurait manqué, puis rend à nouveau le résultat amélioré par lui.
 * Décidé sur l'issue STRUCTURÉE du run (`run-pilot-chat.ts`, branche `done`), jamais sur les mots
 * du modèle.
 *
 * PROPOSÉE, PAS EXÉCUTÉE : la clôture ajoute une ligne `AUTOWIN_PROMPT_V1`, le canal déjà lu par le
 * champ de saisie (bouton + texte grisé) et retiré de l'affichage (`prompt-suivant.ts`). Rien ne
 * part sans un clic de l'utilisateur, ou sans le mode auto qu'il a lui-même allumé.
 */
import {
  isDeliveredOrchestrationOutcome,
  phasesAbouties,
  type OrchestrationOutcome
} from '../../shared/orchestration-outcome'
import { NOTE_MIN_ALTERNATIVE } from '../../shared/prompt-suivant'

/** Le message que le bouton envoie : `/grow` en tête, donc une invocation de la skill. */
export const PROPOSITION_GROW = '/grow sur la demande que tu viens de terminer'

/**
 * Une ALTERNATIVE, pas la suite principale : notée au plancher des alternatives montrées, elle passe
 * derrière toute suite mieux notée du modèle, mais reste affichée.
 */
const NOTE_GROW = NOTE_MIN_ALTERNATIVE

/** Phases qui MODIFIENT le travail : sans elles, le run n'a livré qu'une analyse. */
const PHASES_D_ACTION = new Set(['build', 'clean'])

/** Le tour de grow lui-même : le reproposer ferait boucler le mode auto, grow après grow. */
function estUnTourDeGrow(demande: string | undefined): boolean {
  return /^\s*\/?grow\b/iu.test(demande ?? '')
}

/**
 * La ligne de proposition à ajouter en fin de tour, ou `undefined`. Proposée seulement quand le run
 * est LIVRÉ (validé, contrôle final passé, travail arrivé chez l'utilisateur) ET qu'une phase
 * d'action y a abouti.
 */
export function ligneDePropositionGrow(
  outcome: OrchestrationOutcome | undefined,
  demandeDuTour: string | undefined
): string | undefined {
  if (!outcome || !isDeliveredOrchestrationOutcome(outcome)) return undefined
  if (estUnTourDeGrow(demandeDuTour)) return undefined
  const action = phasesAbouties(outcome).some((phase) =>
    PHASES_D_ACTION.has(phase.trim().toLowerCase())
  )
  return action ? `AUTOWIN_PROMPT_V1: [${NOTE_GROW}] ${PROPOSITION_GROW}` : undefined
}

/**
 * Même décision pour l'AUTRE fin de run : `orchestrate-turn-persistence.ts` (run lancé depuis les
 * tickets par `os:orchestrate`, run repris après un redémarrage). Cette fin reçoit le résultat BRUT
 * du moteur, pas une issue projetée.
 */
export function ligneDePropositionGrowDuResultat(
  resultat:
    | {
        valid?: boolean
        gateBlocked?: boolean
        phaseOutputs?: unknown
        retainedWorkspace?: unknown
      }
    | undefined,
  demandeDuTour: string | undefined
): string | undefined {
  // Clôture sans exécution (publication déjà acquise, rattachement) : aucun verdict, rien de livré.
  if (!resultat || typeof resultat.valid !== 'boolean') return undefined
  // Même projection que l'issue de `commands.ts` (status, workRetained). `reused: false` : cette fin
  // n'est appelée avec un verdict qu'après une exécution RÉELLE du moteur ; les fins sans exécution
  // n'en portent pas (garde ci-dessus).
  return ligneDePropositionGrow(
    {
      status: resultat.gateBlocked ? 'failed' : 'succeeded',
      valid: resultat.valid,
      gateBlocked: resultat.gateBlocked === true,
      reused: false,
      workRetained: resultat.retainedWorkspace !== undefined,
      phaseOutputs: resultat.phaseOutputs
    } as OrchestrationOutcome,
    demandeDuTour
  )
}
