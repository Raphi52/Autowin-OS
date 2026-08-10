import { describe, expect, it, vi } from 'vitest'
import {
  MODEL_QUESTION_INSTRUCTION,
  ModelQuestionHub,
  parseModelQuestion
} from './model-questions'

describe('model questions', () => {
  it('reserves questions for genuine blockers after autonomous inspection and defaults', () => {
    expect(MODEL_QUESTION_INSTRUCTION).toMatch(/inspecte|vérifie/i)
    expect(MODEL_QUESTION_INSTRUCTION).toMatch(/défaut|hypothèse raisonnable/i)
    expect(MODEL_QUESTION_INSTRUCTION).toMatch(/destruct|irréversible/i)
    expect(MODEL_QUESTION_INSTRUCTION).toMatch(/indispensable|impossible/i)
    expect(MODEL_QUESTION_INSTRUCTION).toMatch(/directement.*sans demande d.approbation/i)
    expect(MODEL_QUESTION_INSTRUCTION).not.toMatch(/sas|confirmation/i)
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
