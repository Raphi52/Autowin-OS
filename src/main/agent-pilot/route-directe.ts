// La route SANS modèle : une phase nommée (« /scout … », « /build … ») part droit à l'orchestration,
// précédée du contrôle des deux lectures. Sortie telle quelle de AgentPilot.chat() (conv-1580, lot 2).
import {
  formatOrchestrationOutcome,
  formatOrchestrationOutcomePourLeModele,
  type OrchestrationOutcome
} from '../../shared/orchestration-outcome'
import { pagesHtmlEnTexte } from '../../shared/pages-html-pour-le-modele'
import { tacheAvecLectureRetenue } from '../deux-lectures'
import { avecAvisEnTete, avisOrientationsTardives } from '../orientations-tardives'
import { bornerResultatDeCommande } from '../resultat-de-commande-borne'
import type { ExecutionDeCommande } from './commandes-du-tour'
import type { PilotEventVariant } from './evenements'
import { commandResultSucceeded, failedOrchestrationOutcome } from './issue-des-commandes'
import type { LecturesDuTour } from './lectures-du-tour'

export async function jouerLaRouteSansModele(
  entree: Pick<
    LecturesDuTour,
    'deuxLecturesDuTour' | 'fermerSurLaQuestionDesLectures' | 'annoncerLaLectureRetenue'
  > & {
    /** La tâche de la route (`directRoute.task`). */
    tache: string
    emit: (e: PilotEventVariant) => void
    signal: AbortSignal | undefined
    execCommand: ExecutionDeCommande
    drainDirectives: (() => string[]) | undefined
    conversationId: string | undefined
    deposerCompteRendu: (conversationId: string, texte: string) => void
  }
): Promise<void> {
  const {
    deuxLecturesDuTour,
    fermerSurLaQuestionDesLectures,
    annoncerLaLectureRetenue,
    tache,
    emit,
    signal,
    execCommand,
    drainDirectives,
    conversationId,
    deposerCompteRendu
  } = entree
  let tacheDeLaRoute = tache
  const issueDeLaRoute = await deuxLecturesDuTour('avant-d-agir')
  if (issueDeLaRoute?.kind === 'question') {
    await fermerSurLaQuestionDesLectures('lectures:0', issueDeLaRoute.lectures)
    return
  }
  if (issueDeLaRoute?.kind === 'retenue') {
    annoncerLaLectureRetenue(issueDeLaRoute)
    tacheDeLaRoute = tacheAvecLectureRetenue(
      tacheDeLaRoute,
      issueDeLaRoute.retenue,
      issueDeLaRoute.ecartee
    )
  }
  const actionId = 'route:0'
  const args = { task: tacheDeLaRoute }
  emit({ kind: 'command', actionId, name: 'orchestrate', args })
  signal?.throwIfAborted()
  const result = await execCommand('orchestrate', args)
  emit({
    kind: 'result',
    actionId,
    name: 'orchestrate',
    ok: commandResultSucceeded(result),
    data: result.ok ? result.data : result.error
  })
  // Le /skill vient déjà de consommer l'unique orchestration autorisée pour ce tour. Une
  // orientation arrivée pendant l'attente ne peut pas être injectée rétroactivement dans ce
  // run : surtout ne pas la transformer silencieusement en second run payant.
  const lateDirectives: string[] = []
  for (;;) {
    const directives = drainDirectives?.() ?? []
    if (!directives.length) break
    lateDirectives.push(...directives)
  }
  const directiveNotice = avisOrientationsTardives(lateDirectives)
  // Les FAITS, pas une formule : statut, validite, blocage de gate, cout, run et resultat sont
  // tous rendus par l'orchestrateur et etaient jetes (conv-76 : 18 sous-agents, 10,05 $, le fil
  // n'affichait que « Workflow Autowin execute. »).
  const issueDuRun = result.ok ? (result.data as OrchestrationOutcome | undefined) : undefined
  const erreurDuRun = result.ok ? undefined : String(result.error ?? '')
  const compteRendu = avecAvisEnTete(
    formatOrchestrationOutcome(result.ok, issueDuRun, erreurDuRun),
    directiveNotice
  )
  /**
   * Ce tour n'a JAMAIS atteint le modele : on garde son compte-rendu pour le lui donner au tour
   * suivant. Sans ce depot, il se voit demander « on a bien fait tout le processus ? » a propos
   * d'un tour dont rien, dans sa session, ne porte la trace.
   *
   * Le depot porte le resultat ENTIER, pas la bulle coupee a 4 000 caracteres (conv-914 : 6 pistes
   * trouvees, une seule visible pour l'agent). Seule la borne de tout resultat injecte s'applique.
   * Les pages `html-render` du run y passent en texte visible AVANT la borne : ce compte-rendu reste
   * ensuite dans la session du modele pour tous les tours suivants (conv-1074).
   */
  if (conversationId)
    deposerCompteRendu(
      conversationId,
      bornerResultatDeCommande(
        'orchestrate',
        pagesHtmlEnTexte(
          avecAvisEnTete(
            formatOrchestrationOutcomePourLeModele(result.ok, issueDuRun, erreurDuRun),
            directiveNotice
          )
        )
      )
    )
  emit({
    kind: 'done',
    text: compteRendu,
    outcome: result.ok
      ? ((result.data as Record<string, unknown> | undefined) ?? undefined)
      : failedOrchestrationOutcome(result.error),
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }
  })
  return
}
