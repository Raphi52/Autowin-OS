/**
 * QUESTION À CÔTÉ — le CONTRAT partagé entre le processus principal, le pont (preload) et l'interface
 * (conv-1362, lot 1/3, 2026-10-31), sur le modèle de `shared/navigateur.ts`.
 *
 * Une question posée depuis un fil, qui s'appuie sur tout ce fil, et dont rien n'est gardé : ni message,
 * ni journal de tour, ni Board, ni fichier. C'est `/btw` de Claude Code (section « Side questions » de
 * https://code.claude.com/docs/en/interactive-mode.md). Le `/btw` d'Autowin, lui, oriente le tour en
 * cours : ce n'est pas la même chose, et ce contrat n'y touche pas.
 *
 * Ce fichier ne dépend de rien (ni Electron, ni Node, ni React) : il est importé des deux côtés.
 */

/** Pourquoi aucune réponse n'est rendue. L'interface en tire son message, le moteur n'écrit rien. */
export type MotifSansReponse =
  /** Le fil n'a pas encore de session : aucun tour n'a été lancé. */
  | 'sans-session'
  /** Le fil tourne sur un autre modèle IA que Claude : il n'a pas de session à reprendre. */
  | 'autre-modele'
  /** Le compte qui a ouvert la session a été retiré : la session vit dans son dossier. */
  | 'compte-absent'
  /** Le CLI ne connaît pas (ou plus) cette session. */
  | 'session-introuvable'
  /** La réponse demandait un outil jusqu'au bout : rien n'a été lancé. */
  | 'outil-requis'
  /** Le panneau a été fermé, ou une nouvelle question a remplacé celle-ci. */
  | 'annulee'
  /** Délai dépassé : le processus de la question a été arrêté. */
  | 'delai'
  /** Tout le reste : le CLI a échoué, `detail` dit comment. */
  | 'echec'

export type IssueQuestionACote =
  | {
      ok: true
      reponse: string
      /** Le modèle a tenté un outil et il a été refusé : la réponse se fonde sur le contexte seul. */
      outilRefuse: boolean
    }
  | { ok: false; motif: MotifSansReponse; detail?: string }

/** Longueur maximale d'une question : assez pour une vraie question, pas pour un collage de fichier. */
export const QUESTION_A_COTE_MAX = 4_000

/**
 * Noms des canaux IPC. `ipc/question-a-cote.ts` les écrit en toutes lettres (le contrôle de sécurité ne
 * voit que les canaux littéraux) ; son test exige qu'ils soient exactement ceux-ci.
 */
export const CANAUX_QUESTION_A_COTE = {
  poser: 'question-a-cote:poser',
  annuler: 'question-a-cote:annuler'
} as const

/** L'API exposée par le preload à l'interface (`window.api.questionACote`). */
export interface ApiQuestionACote {
  poser(conversationId: string, question: string): Promise<IssueQuestionACote>
  /** Arrête la question en cours de CE fil, et elle seule. Sans effet s'il n'y en a pas. */
  annuler(conversationId: string): Promise<void>
}
