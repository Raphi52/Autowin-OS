// @vitest-environment happy-dom
/**
 * UN RE-RENDU PAR FRAME, PAS PAR TOKEN.
 *
 * Le handler `onPilotEvent` appelait `patchLast` → `setMessages` à CHAQUE delta : sur un tour de
 * 300 tokens, 300 recopies du fil et 300 rendus. Le batcher (`createLiveRunDeltaBatcher`) existait
 * déjà mais n'était branché que sur `orchestrate-delta`.
 *
 * Entrées qui doivent faire échouer ces tests si la correction est fausse :
 *  (a) 300 deltas émis dans la même frame → le fil ne doit être rendu qu'une fois (au flush rAF), et
 *      le texte complet doit être là : un batcher qui PERD des deltas casse la 2e assertion ;
 *  (b) `done` juste après un delta, SANS laisser passer de frame → la clôture ne doit pas être
 *      retardée (le tour doit s'afficher terminé tout de suite) ;
 *  (c) `error` idem — un chemin terminal ne dort jamais dans le tampon.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

const rendus = { markdown: 0 }
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => {
    rendus.markdown += 1
    return createElement('span', { 'data-testid': 'md' }, text)
  },
  extractRecommendation: (): string | null => null
}))

let harnais: ChatHarness | undefined
beforeAll(() => installRafShim())
afterEach(async () => {
  await harnais?.unmount()
  harnais = undefined
  vi.useRealTimers()
})

type Emit = (event: Record<string, unknown>) => void

async function monter(): Promise<{ emettre: Emit }> {
  let handler: ((event: unknown) => void) | undefined
  const api = chatApi({
    onPilotEvent: vi.fn((cb: (event: unknown) => void) => {
      handler = cb
      return vi.fn()
    }),
    conversation: vi.fn().mockResolvedValue({ id: 'A', title: 'A', messages: [], updatedAt: 1 })
  })
  harnais = await mountChat(api)
  if (!handler) throw new Error('onPilotEvent non abonné')
  const abonne = handler
  return { emettre: (event) => abonne(event) }
}

const texteAffiche = (): string =>
  [...(harnais?.container.querySelectorAll('[data-testid="md"]') ?? [])]
    .map((n) => n.textContent ?? '')
    .join('')

describe('deltas pilote — batchés par frame', () => {
  it('300 deltas dans une frame = 1 seule vague de rendus, texte complet préservé', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { emettre } = await monter()
    await act(async () => {
      emettre({ conversationId: 'A', kind: 'delta', text: 'x', streamId: 's' })
      await vi.advanceTimersByTimeAsync(1)
    })
    rendus.markdown = 0

    // Chaque événement IPC arrive dans sa PROPRE tâche : les émettre dans un seul `act` laisserait
    // le batching automatique de React masquer le défaut mesuré. On simule donc 300 tâches.
    for (let i = 0; i < 300; i += 1)
      // eslint-disable-next-line no-await-in-loop -- une tâche par événement, c'est le point du test
      await act(async () => {
        emettre({ conversationId: 'A', kind: 'delta', text: 'y', streamId: 's' })
      })
    const avantFlush = rendus.markdown
    expect(avantFlush, '300 deltas ne doivent pas rendre 300 fois').toBeLessThan(10)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20)
    })
    expect(texteAffiche(), 'aucun delta ne doit être perdu par le batch').toContain(
      `x${'y'.repeat(300)}`
    )
    expect(rendus.markdown, 'le flush ne doit rendre qu’une poignée de fois').toBeLessThan(20)
  })

  it('`done` n’attend PAS une frame : le tour s’affiche terminé immédiatement', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { emettre } = await monter()
    await act(async () => {
      emettre({ conversationId: 'A', kind: 'delta', text: 'fin', streamId: 's' })
      emettre({ conversationId: 'A', kind: 'done' })
    })
    // AUCUN temps avancé : si la clôture dormait dans le tampon, ce texte serait absent.
    expect(texteAffiche()).toContain('fin')
    expect(
      harnais?.container.querySelector('[data-testid="chat-stop"]'),
      'un tour clos ne doit plus afficher le bouton d’arrêt'
    ).toBeNull()
  })

  it('`error` vide aussi le tampon sans attendre', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { emettre } = await monter()
    await act(async () => {
      emettre({ conversationId: 'A', kind: 'delta', text: 'avant-erreur', streamId: 's' })
      emettre({ conversationId: 'A', kind: 'error', text: 'boom' })
    })
    expect(texteAffiche()).toContain('avant-erreur')
  })
})
