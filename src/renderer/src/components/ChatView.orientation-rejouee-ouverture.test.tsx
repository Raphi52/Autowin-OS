// @vitest-environment happy-dom
/**
 * UNE CONSIGNE DONNÉE PENDANT UN TOUR REVIENT À L'OUVERTURE DU FIL, sous la réponse de SON tour.
 *
 * L'effet de ChatView qui la relit (`orientationsDeConversation`) prend le fil tel qu'il est à
 * l'ouverture, par sa ref : avec `messages` en dépendance, il se relancerait à chaque delta du flux.
 * Le calcul (`rejouerOrientations`) a son propre test ; celui-ci garde le BRANCHEMENT, c'est-à-dire
 * le fil que l'effet lui passe.
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER le premier cas : un effet qui passe un fil vide ou périmé — la
 * consigne est alors écartée, faute d'y trouver le tour `tour-1`.
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER le troisième : la correction naïve de la règle des dépendances,
 * `[activeId, messages]` — le journal serait relu à chaque message, puis à chaque delta du flux.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const fil = [
  { role: 'user', content: 'refais la page', messageId: 'm1' },
  {
    role: 'assistant',
    content: 'Page refaite.',
    messageId: 'm2',
    turnId: 'tour-1',
    status: 'done',
    parts: [{ kind: 'text', text: 'Page refaite.' }]
  }
]

async function ouvrirLeFilAvec(
  orientations: Array<{ ts: number; texte: string; turnId?: string }>
): Promise<{ h: ChatHarness; lecture: ReturnType<typeof vi.fn> }> {
  const lecture = vi.fn().mockResolvedValue(orientations)
  const h = await mountChat(
    chatApi({
      conversations: vi.fn().mockResolvedValue([conversation('A', fil)]),
      conversation: vi.fn(async () => ({ id: 'A', title: 'A', messages: fil })),
      orientationsDeConversation: lecture
    })
  )
  await h.click('.conv-pick')
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10))
  })
  return { h, lecture }
}

describe('ChatView — consigne rejouée à l’ouverture du fil', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('pose la consigne relue du journal sous la réponse de son tour', async () => {
    const ouvert = await ouvrirLeFilAvec([{ ts: 7, texte: 'garde le titre', turnId: 'tour-1' }])
    h = ouvert.h
    expect(ouvert.lecture).toHaveBeenCalledWith('A')
    const recus = h.container.querySelectorAll('.directive-receipt')
    expect(recus).toHaveLength(1)
    expect(recus[0].querySelector('.msg-body')?.textContent).toBe('garde le titre')
  })

  it('écarte une consigne dont le tour n’est pas dans le fil, plutôt que de la poser au hasard', async () => {
    const ouvert = await ouvrirLeFilAvec([
      { ts: 8, texte: 'consigne orpheline', turnId: 'tour-absent' }
    ])
    h = ouvert.h
    expect(ouvert.lecture).toHaveBeenCalledWith('A')
    expect(h.container.querySelectorAll('.directive-receipt')).toHaveLength(0)
  })

  it('ne relit pas le journal quand le fil bouge après l’ouverture', async () => {
    const ouvert = await ouvrirLeFilAvec([{ ts: 7, texte: 'garde le titre', turnId: 'tour-1' }])
    h = ouvert.h
    expect(ouvert.lecture).toHaveBeenCalledTimes(1)
    const messagesAvant = h.container.querySelectorAll('.msg').length
    await h.type('et ajoute un pied de page')
    await h.click('[data-testid="composer-send"]')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    // Le fil a bien bougé (sinon ce cas ne prouverait rien) ; la relecture, elle, n'a pas eu lieu.
    expect(window.api.pilotChat).toHaveBeenCalledTimes(1)
    expect(h.container.querySelectorAll('.msg').length).toBeGreaterThan(messagesAvant)
    expect(ouvert.lecture).toHaveBeenCalledTimes(1)
  })
})
