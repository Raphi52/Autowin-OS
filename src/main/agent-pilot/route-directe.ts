// La route SANS modèle : une phase nommée (« /scout … », « /build … ») part droit à l'orchestration,
// précédée du contrôle des deux lectures. Sortie telle quelle de AgentPilot.chat() (lot 2).
import {
  arretAuControleRelancable,
  CONSIGNE_RELANCE_APRES_ARRET,
  formatOrchestrationOutcome,
  formatOrchestrationOutcomePourLeModele,
  type OrchestrationOutcome
} from '../../shared/orchestration-outcome'
import { pagesHtmlEnTexte } from '../../shared/pages-html-pour-le-modele'
import { tacheAvecLectureRetenue } from '../chat/deux-lectures'
import { avecAvisEnTete, avisOrientationsTardives } from '../conversations/orientations-tardives'
import { bornerResultatDeCommande } from '../chat/resultat-de-commande-borne'
import type { ExecutionDeCommande } from './commandes-du-tour'
import type { PilotEventVariant } from './evenements'
import { commandResultSucceeded, failedOrchestrationOutcome } from './issue-des-commandes'
import type { LecturesDuTour } from './lectures-du-tour'

/**
 * Ce que la route rend quand le chat doit REPRENDRE la main au lieu de clore le tour :
 * - le run s'est ARRÊTÉ au contrôle final (`arretAuControleRelancable`) : le modèle lit la cause et
 *   relance une tâche corrigée. Sans cela, une phase nommée finissait toujours sur « reprendre le
 *   travail arrêté », sans qu'aucun modèle n'ait lu pourquoi (run judge-panda-as-fait-lancer-commande-mwasivzu) ;
 * - le run n'a jamais DÉMARRÉ (`lancementBloque`) : le modèle fait la demande lui-même, dans le fil.
 *   Ce cas-là n'a ni issue ni compte rendu de run : la clôture est celle du modèle.
 */
export interface RepriseApresArret {
  /** L'issue entière et la consigne de relance, poussées dans le fil du modèle. */
  pourLeModele: string
  /** Le compte rendu affiché si le modèle ne dit rien (absent : aucun run n'a tourné). */
  compteRendu?: string
  issue?: Record<string, unknown>
}

/**
 * LE RUN N'A PAS DÉMARRÉ : sa copie de travail n'a pas pu être préparée.
 *
 * Toutes les erreurs « Lancement bloqué : … » sont levées AVANT le premier appel de modèle, par la
 * préparation de la copie (`canonicalRemoteBase`, `describeForLaunch`) : rien n'a été fait, rien n'a
 * été payé, et un second `orchestrate` dans le même tour échouerait sur la même cause, qui tient au
 * dépôt (pas de distant `origin`, `main` divergé, origin injoignable sans repli local).
 *
 * Cas réel (18-19/11/2026, lot 4 du plan plan-4021ed92) : la demande du lot commençait
 * par « /build », partait droit en orchestration, et le dépôt visé n'a qu'un distant d'un autre nom. TROIS
 * tours de suite se sont clos sur « Lancement bloqué : le distant origin est absent. » sans
 * qu'aucun modèle ne lise la demande — même après que le chef eut écrit DANS la demande « n'appelle
 * pas orchestrate » : cette consigne ne pouvait pas être lue, la route passe avant le modèle.
 * Alors que le fil, lui, sait faire ce travail : sa propre copie (`copies-de-taches/<fil>`) n'exige
 * aucun distant.
 */
export function lancementBloque(erreur: string | undefined): boolean {
  return erreur !== undefined && /^\s*(?:Error:\s*)?Lancement bloqué\s*:/i.test(erreur)
}

/** Ce que le chat lit quand la tâche séparée n'a pas pu démarrer : faire la demande lui-même. */
export const CONSIGNE_APRES_LANCEMENT_BLOQUE =
  'La tâche séparée n’a PAS DÉMARRÉ : sa copie de travail n’a pas pu être préparée (cause ci-dessus). ' +
  'Rien n’a été fait ni dépensé, et un nouvel `orchestrate` échouerait de la même façon dans ce tour : ' +
  'ne le rappelle pas. Ne rends pas la main sur cet échec : fais toi-même la demande de l’utilisateur ' +
  'dans ce fil, avec tes outils (Read, Grep, Edit, Write, Bash), en suivant la procédure de la skill ' +
  'nommée si elle t’est remise. Si la cause ' +
  'exige un geste que tu ne peux pas faire toi-même (intégrer deux branches divergées, rétablir le réseau), ' +
  'dis-le en tête de ta réponse, avec la cause, avant de faire ce qui reste faisable.'

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
): Promise<RepriseApresArret | undefined> {
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
    return undefined
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
  // Le battement du run (durée, phase, dernier geste) rejoint la carte posée juste au-dessus, comme
  // dans un tour ordinaire (`execution-des-commandes.ts`) : sans lui, la carte d'un lot de plan
  // restait des heures sur « Travail lancé : … », sans durée, alors que le run travaillait.
  const result = await execCommand('orchestrate', args, (text) =>
    emit({ kind: 'action-progress', actionId, text })
  )
  emit({
    kind: 'result',
    actionId,
    name: 'orchestrate',
    ok: commandResultSucceeded(result),
    data: result.ok ? result.data : result.error
  })
  // Le run n'a pas démarré : le tour passe au modèle, qui fait la demande dans le fil. Avant la
  // vidange des orientations tardives : la boucle du modèle les recevra elle-même.
  const erreurAuLancement = result.ok ? undefined : String(result.error ?? '')
  if (!signal?.aborted && lancementBloque(erreurAuLancement)) {
    return {
      pourLeModele: `orchestrate → LA TÂCHE SÉPARÉE N’A PAS DÉMARRÉ :
${bornerResultatDeCommande(
  'orchestrate',
  formatOrchestrationOutcomePourLeModele(false, undefined, erreurAuLancement)
)}

${CONSIGNE_APRES_LANCEMENT_BLOQUE}`
    }
  }
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
  // tous rendus par l'orchestrateur et etaient jetes (18 sous-agents, 10,05 $, le fil
  // n'affichait que « Workflow Autowin execute. »).
  const issueDuRun = result.ok ? (result.data as OrchestrationOutcome | undefined) : undefined
  const erreurDuRun = result.ok ? undefined : String(result.error ?? '')
  const compteRendu = avecAvisEnTete(
    formatOrchestrationOutcome(result.ok, issueDuRun, erreurDuRun),
    directiveNotice
  )
  const issuePourLeModele = bornerResultatDeCommande(
    'orchestrate',
    pagesHtmlEnTexte(
      avecAvisEnTete(
        formatOrchestrationOutcomePourLeModele(result.ok, issueDuRun, erreurDuRun),
        directiveNotice
      )
    )
  )
  if (issueDuRun && !signal?.aborted && arretAuControleRelancable(issueDuRun)) {
    return {
      pourLeModele:
        `orchestrate → ISSUE AUTORITATIVE DU PIPELINE (elle fait foi contre tout rapport ` +
        `provisoire d'un worker) :
${issuePourLeModele}

${CONSIGNE_RELANCE_APRES_ARRET}`,
      compteRendu,
      issue: issueDuRun as Record<string, unknown>
    }
  }
  /**
   * Ce tour n'a JAMAIS atteint le modele : on garde son compte-rendu pour le lui donner au tour
   * suivant. Sans ce depot, il se voit demander « on a bien fait tout le processus ? » a propos
   * d'un tour dont rien, dans sa session, ne porte la trace.
   *
   * Le depot porte le resultat ENTIER, pas la bulle coupee a 4 000 caracteres (6 pistes
   * trouvees, une seule visible pour l'agent). Seule la borne de tout resultat injecte s'applique.
   * Les pages `html-render` du run y passent en texte visible AVANT la borne : ce compte-rendu reste
   * ensuite dans la session du modele pour tous les tours suivants.
   */
  if (conversationId) deposerCompteRendu(conversationId, issuePourLeModele)
  emit({
    kind: 'done',
    text: compteRendu,
    outcome: result.ok
      ? ((result.data as Record<string, unknown> | undefined) ?? undefined)
      : failedOrchestrationOutcome(result.error),
    usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }
  })
  return undefined
}
