import { describe, expect, it, vi } from 'vitest'
import { ModelQuestionHub, parseModelQuestion } from './model-questions'

describe('model questions', () => {
  it('parse une question structurée et borne les options', () => {
    const question = parseModelQuestion(
      '<question>{"text":"Quel serveur ?","options":["A","B"]}</question>'
    )
    expect(question).toEqual({ text: 'Quel serveur ?', options: ['A', 'B'] })
  })

  it('ignore le texte conversationnel et le JSON invalide', () => {
    expect(parseModelQuestion('Tu veux continuer ?')).toBeNull()
    expect(parseModelQuestion('<question>non</question>')).toBeNull()
  })

  it('route la réponse vers la bonne question', async () => {
    const hub = new ModelQuestionHub()
    const notify = vi.fn()
    const answer = hub.ask('loop', { text: 'Choix ?', options: ['A'] }, notify, 'tour-1')
    const id = notify.mock.calls[0][0].id as string
    hub.resolve(id, 'A')
    await expect(answer).resolves.toBe('A')
  })
  it('rejects a pending question when its signal is aborted', async () => {
    const hub = new ModelQuestionHub()
    const controller = new AbortController()
    const answer = hub.ask(
      'chat',
      { text: 'Choix ?', options: ['A'] },
      vi.fn(),
      'tour-1',
      controller.signal
    )
    controller.abort('conversation-deleted')
    await expect(answer).rejects.toThrow('conversation-deleted')
  })
})
