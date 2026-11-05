// Les deux lectures d'une demande (`deux-lectures.ts`, conv-1092) pour UN tour de chat : appel
// unique au petit modèle, question à boutons, ligne « Lecture retenue ». Sorti tel quel de
// AgentPilot.chat() (conv-1580, lot 2).
import { estUnMessageDuPlan } from '../../shared/plan-de-lots'
import { FLUX_LECTURE_RETENUE } from '../../shared/lecture-retenue'
import { estUneRepriseAutomatique } from '../chat/relance-taches-de-fond'
import {
  AVIS_DEUX_LECTURES,
  CONSIGNE_DEUX_LECTURES,
  annonceDeLaLectureRetenue,
  chargeDeuxLectures,
  commandesNommees,
  demandeDeChangementDeRendu,
  demandesResteesSansReponse,
  dernierMessageAgent,
  issueDesLecturesPourLaTrace,
  lectureAAnnoncer,
  lireLesLectures,
  meriteUneLecture,
  questionDesDeuxLectures,
  suitUneQuestionDesLectures,
  type IssueDesLectures,
  type MomentDeLaLecture,
  type TraceDesLectures
} from '../deux-lectures'
import { estUnPromptDOrdre } from '../messages-entre-fils-app'
import type { Message } from '../providers/types'
import { descriptionsDesCommandes } from './aides-du-tour'
import type { ExecutionDeCommande } from './commandes-du-tour'
import type { PilotEventVariant } from './evenements'
import { commandResultSucceeded } from './issue-des-commandes'

export type LectureRetenue = Extract<IssueDesLectures, { kind: 'retenue' }>

export type LecturesDuTour = {
  deuxLecturesDuTour: (moment: MomentDeLaLecture) => Promise<IssueDesLectures | undefined>
  poserLaQuestionDesLectures: (actionId: string, lectures: [string, string]) => Promise<void>
  fermerSurLaQuestionDesLectures: (actionId: string, lectures: [string, string]) => Promise<void>
  annoncerLaLectureRetenue: (issue: LectureRetenue) => void
  /** Lecture attendue avant le modèle (changement d'affichage), sinon lancée en parallèle. */
  lancerAvantLeModele: () => Promise<IssueDesLectures | undefined> | undefined
  /** La lecture annoncée dans ce tour, lue au moment de l'appel. */
  lectureRetenue: () => LectureRetenue | undefined
}

export function lecturesDuTour(entree: {
  demanderDeuxLectures:
    ((systeme: string, charge: string, trace: TraceDesLectures) => Promise<string>) | undefined
  routingUserMessageOverride: string | undefined
  sendLimits: { systemProfile?: 'watchdog-read-only'; tourDeFond?: boolean } | undefined
  latestUserMessage: string | undefined
  history: Message[]
  conversationId: string | undefined
  emit: (e: PilotEventVariant) => void
  execCommand: ExecutionDeCommande
  tourEstClos: () => boolean
}): LecturesDuTour {
  const {
    demanderDeuxLectures,
    routingUserMessageOverride,
    sendLimits,
    latestUserMessage,
    history,
    conversationId,
    emit,
    execCommand,
    tourEstClos
  } = entree
  /*
   * DEUX LECTURES PLAUSIBLES → UNE QUESTION, AVANT DE PAYER (deux-lectures.ts, conv-1092).
   *
   * Trois points de passage, un seul appel au petit modèle par tour (promesse mémorisée) :
   * le `/scout …` routé ci-dessous SANS modèle (conv-767 : 2,47 $ sur une mauvaise lecture), une
   * demande qui change l'affichage (lue AVANT de passer la main au modèle, dont les éditions
   * natives ne sont pas interceptables), et l'`orchestrate` émis par le modèle. Jamais sur une
   * reprise interne, un tour de fond ni la réponse à cette même question.
   */
  /*
   * LUE À CHAQUE MESSAGE D'UN HUMAIN (conv-1240) : la ligne « Lecture retenue » s'affiche à chaque
   * tour, demande de l'utilisateur (« met le tout le temps »). La QUESTION garde ses filtres
   * d'avant : jamais sur une relance ou un message de moins de quatre mots, jamais deux fois.
   */
  const lectureDuTourArmee =
    Boolean(demanderDeuxLectures) &&
    routingUserMessageOverride === undefined &&
    !sendLimits?.tourDeFond &&
    sendLimits?.systemProfile !== 'watchdog-read-only' &&
    // Le tour de reprise d'une tâche de fond est écrit par Autowin, pas par l'utilisateur
    // (conv-1118) : il n'a rien à départager.
    !estUneRepriseAutomatique(latestUserMessage) &&
    // Même chose pour le message d'un lot, d'un ordre entre fils ou du réveil du chef : composé par
    // l'app ou un agent, sans humain pour cliquer. conv-1192 (2026-10-27) s'y est arrêté net.
    !estUnMessageDuPlan(latestUserMessage) &&
    !estUnPromptDOrdre(latestUserMessage)
  const questionPermise =
    meriteUneLecture(latestUserMessage) && !suitUneQuestionDesLectures(history)
  let lecturesMemorisees: Promise<IssueDesLectures | undefined> | undefined
  // `moment` : celui du PREMIER appel, le seul qui interroge le petit modèle (promesse mémorisée).
  const deuxLecturesDuTour = (moment: MomentDeLaLecture): Promise<IssueDesLectures | undefined> => {
    const demande = latestUserMessage?.trim() ? latestUserMessage : undefined
    const demander = demanderDeuxLectures
    if (!lectureDuTourArmee || !demande || !demander) return Promise.resolve(undefined)
    // Ce que font les commandes citées (`/scout`, `/arena`) : sans elles, le petit modèle a lu
    // conv-767 comme nette — rejeu sur le vrai modèle du 2026-10-22, 0 question sur 3 cas visés.
    const descriptions = descriptionsDesCommandes(commandesNommees(demande))
    lecturesMemorisees ??= demander(
      CONSIGNE_DEUX_LECTURES,
      // Les messages que des tours coupés ont laissés sans réponse font partie de la demande
      // (kaizen conv-1558 : « améliore tout » lu « tout sur le kimono », le dernier sujet seul).
      // Ceux qu'écrit l'app ou un agent n'en sont pas : aucun humain ne les a tapés.
      chargeDeuxLectures(
        demande,
        dernierMessageAgent(history),
        descriptions,
        demandesResteesSansReponse(history).filter(
          (texte) =>
            !estUneRepriseAutomatique(texte) &&
            !estUnMessageDuPlan(texte) &&
            !estUnPromptDOrdre(texte)
        )
      ),
      // Le coût de l'appel appartient au fil, et sa trace dit ce que le contrôle a DÉCIDÉ, pas la
      // réponse brute coupée à 160 caractères (conv-1431 : 527 lignes sur 696 inclassables).
      {
        ...(conversationId ? { conversationId } : {}),
        issue: (texte) => issueDesLecturesPourLaTrace(texte, demande, { questionPermise, moment })
      }
    )
      .then((reponse) => {
        const issue = lireLesLectures(reponse, demande)
        // Une relance, ou la réponse à la question d'avant : la ligne, jamais une question.
        return issue && !questionPermise ? lectureAAnnoncer(issue) : issue
      })
      // Un contrôle en panne ne bloque jamais le travail : il part comme avant.
      .catch(() => undefined)
    return lecturesMemorisees
  }
  const poserLaQuestionDesLectures = async (
    actionId: string,
    lectures: [string, string]
  ): Promise<void> => {
    const args = questionDesDeuxLectures(lectures, latestUserMessage ?? '')
    emit({ kind: 'command', actionId, name: 'ask', args })
    const reponse = await execCommand('ask', args)
    emit({
      kind: 'result',
      actionId,
      name: 'ask',
      ok: commandResultSucceeded(reponse),
      data: reponse.ok ? reponse.data : reponse.error
    })
  }
  const fermerSurLaQuestionDesLectures = async (
    actionId: string,
    lectures: [string, string]
  ): Promise<void> => {
    await poserLaQuestionDesLectures(actionId, lectures)
    emit({
      kind: 'done',
      text: AVIS_DEUX_LECTURES,
      usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 }
    })
  }
  /*
   * UNE LECTURE DOMINE → ELLE PART, ANNONCÉE EN UNE LIGNE (conv-1123). Émise en vrai `delta`, pas
   * seulement dans le `done` : le renderer jette le texte du `done` quand le tour a déjà parlé, et
   * l'utilisateur doit voir la lecture AVANT la fin du travail pour pouvoir corriger. Une seule
   * fois par tour : les trois points de passage partagent la même décision mémorisée.
   */
  let lectureRetenue: Extract<IssueDesLectures, { kind: 'retenue' }> | undefined
  const annoncerLaLectureRetenue = (
    issue: Extract<IssueDesLectures, { kind: 'retenue' }>
  ): void => {
    if (lectureRetenue) return
    lectureRetenue = issue
    emit({
      kind: 'delta',
      streamId: FLUX_LECTURE_RETENUE,
      text: `${annonceDeLaLectureRetenue(issue.retenue)}\n\n`,
      iteration: 0
    })
  }
  const lancerAvantLeModele = (): Promise<IssueDesLectures | undefined> | undefined => {
    // Lancée AVANT la recherche Brain et attendue après : son délai se cache derrière elle.
    const lecturesAvantRendu = demandeDeChangementDeRendu(latestUserMessage)
      ? deuxLecturesDuTour('avant-d-agir')
      : undefined
    /*
     * TOUS LES AUTRES TOURS (conv-1240) : la lecture court EN PARALLÈLE du modèle, sans l'attendre.
     * Mesure sur turn-timing.jsonl du 2026-10-28 : le petit modèle répond en ~4 s, le premier jeton du
     * modèle du chat arrive en 24 s (médiane) et en moins de 5 s pour 5 % des tours seulement.
     * L'attendre aurait rallongé CHAQUE réponse ; la ligne arrive presque toujours avant le texte, et
     * le fil la range de toute façon en tête du message (`chat-view-model.ts`). Si le modèle demande
     * ensuite un run, la même lecture mémorisée le garde (question à quasi-égalité, tâche précisée).
     */
    if (!lecturesAvantRendu)
      void deuxLecturesDuTour('en-parallele').then((issue) => {
        if (issue && !tourEstClos()) annoncerLaLectureRetenue(lectureAAnnoncer(issue))
      })
    return lecturesAvantRendu
  }
  return {
    deuxLecturesDuTour,
    poserLaQuestionDesLectures,
    fermerSurLaQuestionDesLectures,
    annoncerLaLectureRetenue,
    lancerAvantLeModele,
    lectureRetenue: () => lectureRetenue
  }
}
