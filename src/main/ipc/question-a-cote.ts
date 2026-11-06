/**
 * QUESTION À CÔTÉ — les canaux IPC entre l'interface et le moteur (conv-1362, lot 1/3, 2026-10-31).
 *
 * Le moteur (`../question-a-cote.ts`) porte toutes les règles ; ce module vérifie chaque appel à la
 * frontière : expéditeur de confiance d'abord, puis la forme de chaque argument.
 *
 * Pourquoi les noms de canaux sont écrits EN TOUTES LETTRES dans `ipcMain.handle(` : le contrôle de
 * sécurité (`security-critical-fixes.test.ts`) ne voit que les canaux littéraux. La dérive avec le
 * contrat est fermée par `question-a-cote.test.ts`.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from './ipc-senders'
import { guardString } from './ipc-guards'
import { QuestionsACote, type DependancesQuestionACote } from '../chat/question-a-cote'
import { QUESTION_A_COTE_MAX, type IssueQuestionACote } from '../../shared/question-a-cote'

/** Le nom donné au contrôle d'expéditeur : c'est lui qu'un refus affiche. */
const PORTEE = 'Question à côté'
/** Un identifiant de fil : court, jamais vide. */
const MAX_IDENTIFIANT = 200

function guardConversation(valeur: unknown): string {
  const id = guardString(valeur, 'conversationId').trim()
  if (!id || id.length > MAX_IDENTIFIANT)
    throw new Error('IPC conversationId: identifiant invalide')
  return id
}

function guardQuestion(valeur: unknown): string {
  const question = guardString(valeur, 'question').trim()
  if (!question) throw new Error('IPC question: question vide')
  if (question.length > QUESTION_A_COTE_MAX) throw new Error('IPC question: question trop longue')
  return question
}

export function registerQuestionACoteIpc(deps: DependancesQuestionACote): void {
  const questions = new QuestionsACote(deps)

  ipcMain.handle(
    'question-a-cote:poser',
    (event, conversationId: unknown, question: unknown): Promise<IssueQuestionACote> => {
      assertTrustedRendererSender(event, PORTEE)
      return questions.poser(guardConversation(conversationId), guardQuestion(question))
    }
  )

  ipcMain.handle('question-a-cote:annuler', (event, conversationId: unknown): void => {
    assertTrustedRendererSender(event, PORTEE)
    questions.annuler(guardConversation(conversationId))
  })
}
