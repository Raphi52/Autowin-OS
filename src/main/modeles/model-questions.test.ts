import { describe, expect, it, vi } from 'vitest'
import { ModelQuestionHub, parseModelQuestion } from './model-questions'
import { buildChatPilotagePrompt } from '../consignes/chat-pilotage-prompt'
import { CATALOG } from '../commands/commands'
import { CONSTITUTION } from '../consignes/constitution'

describe('model questions', () => {
  // conv-1577 : la consigne « Avance de façon autonome » doublait la constitution (et l'avait
  // contredite en conv-1142). L'autonomie et la limite destructive ne vivent plus que là ; la seule
  // phrase propre (ne pas réclamer un secret dans le chat) y a été reportée.
  it("l'autonomie n'est dite qu'une fois : par la constitution, plus par une 2e consigne du chat", () => {
    expect(buildChatPilotagePrompt(CATALOG)).not.toMatch(/Avance de façon autonome/u)
    expect(CONSTITUTION).toMatch(/réversible ne se re-confirme pas/u)
    expect(CONSTITUTION).toMatch(/Irréversible = arrêt/u)
    expect(CONSTITUTION).toMatch(/jamais sa valeur, et ne la réclame pas dans le chat/u)
  })

  it('désactive le canal de question tant qu’aucune preuve applicative sécurisée ne l’autorise', () => {
    expect(
      parseModelQuestion(
        '<question>{"text":"Quel token d’accès manque ?","options":[],"reason":"secret-or-personal-data"}</question>'
      )
    ).toBeNull()
    expect(
      parseModelQuestion(
        '<question>{"text":"Le token sk-test-123 est-il correct ?","options":[],"reason":"secret-or-personal-data"}</question>'
      )
    ).toBeNull()
  })

  it('ignore le texte conversationnel, le JSON invalide et les questions sans blocage admis', () => {
    expect(parseModelQuestion('Tu veux continuer ?')).toBeNull()
    expect(parseModelQuestion('<question>non</question>')).toBeNull()
    expect(
      parseModelQuestion('<question>{"text":"Quel nom donner ?","options":["A","B"]}</question>')
    ).toBeNull()
    expect(
      parseModelQuestion(
        '<question>{"text":"Quel nom donner ?","options":["A","B"],"reason":"preference"}</question>'
      )
    ).toBeNull()
    expect(
      parseModelQuestion(
        '<question>{"text":"Quel nom donner ?","options":["A","B"],"reason":"material-ambiguity"}</question>'
      )
    ).toBeNull()
    expect(
      parseModelQuestion(
        '<question>{"text":"Quel token CSS utiliser ?","options":[],"reason":"secret-or-personal-data"}</question>'
      )
    ).toBeNull()
  })

  it('route la réponse vers la bonne question', async () => {
    const hub = new ModelQuestionHub()
    const notify = vi.fn()
    const answer = hub.ask(
      'loop',
      { text: 'Choix ?', options: ['A'], reason: 'material-ambiguity' },
      notify,
      'tour-1'
    )
    const id = notify.mock.calls[0][0].id as string
    hub.resolve(id, 'A')
    await expect(answer).resolves.toBe('A')
  })
  it('rejects a pending question when its signal is aborted', async () => {
    const hub = new ModelQuestionHub()
    const controller = new AbortController()
    const answer = hub.ask(
      'chat',
      { text: 'Choix ?', options: ['A'], reason: 'external-effect' },
      vi.fn(),
      'tour-1',
      controller.signal
    )
    controller.abort('conversation-deleted')
    await expect(answer).rejects.toThrow('conversation-deleted')
  })
})
