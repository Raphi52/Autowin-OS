// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * LE RECU NE DOIT PAS MENTIR. Rapporte le 20/08 : « j'ai oriente et rien ne se passe ».
 *
 * `injectDirective` repond `ok` des que la directive est empilee — mais un RUN ne peut pas la lire :
 * le pilote ne draine les directives qu'entre deux de ses iterations, et pendant une orchestration
 * il est bloque dans l'appel `orchestrate`. Annoncer « Oriente » confondait « acceptee » et « lue ».
 */
describe('ChatView — le reçu d’orientation dit la vérité', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  async function monter(): Promise<{
    pilote: (event: Record<string, unknown>) => void
    app: (event: Record<string, unknown>) => void
    injecte: ReturnType<typeof vi.fn>
  }> {
    let pilote!: (event: Record<string, unknown>) => void
    let app!: (event: Record<string, unknown>) => void
    const injecte = vi.fn().mockResolvedValue({ ok: true })
    harness = await mountChat(
      chatApi({
        injectDirective: injecte,
        conversation: vi.fn().mockResolvedValue({ id: 'A', messages: [] }),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        }),
        onAppEvent: vi.fn((listener) => {
          app = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    return { pilote, app, injecte }
  }

  const recu = (): string =>
    harness?.container.querySelector('.directive-receipt-status')?.textContent ?? ''

  async function orienter(pilote: (e: Record<string, unknown>) => void): Promise<void> {
    // Un tour doit tourner pour que `/btw` injecte au lieu d'envoyer normalement.
    await act(async () => pilote({ conversationId: 'A', kind: 'delta', delta: 'je travaille' }))
    await harness!.type('/btw décale les icônes de 4 px')
    await act(async () => {
      harness!
        .textarea()
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await act(async () => {})
  }

  it('un RUN en cours ⇒ « lira à la phase suivante », pas « puis y répond »', async () => {
    const { pilote, app, injecte } = await monter()
    await act(async () =>
      app({ type: 'orchestrate-start', convId: 'A', task: '/frame les icônes' })
    )
    await orienter(pilote)
    expect(injecte).toHaveBeenCalled()
    expect(recu()).toContain('à la phase suivante')
    expect(recu()).not.toContain('puis y répond')
  })

  it('sans run, le reçu annonce QUAND la réponse viendra', async () => {
    const { pilote, injecte } = await monter()
    await orienter(pilote)
    expect(injecte).toHaveBeenCalled()
    // « Orienté » disait seulement « transmis » : l'utilisateur croyait que rien ne se passait
    // pendant les minutes du tour (conv-61, 2026-09-01). Le reçu dit maintenant QUAND il aura
    // sa réponse.
    // « dans sa prochaine réponse » était FAUX (conv-253, tour cdbc9802-bbd2-4144-924d-a9f4cdb90ac3,
    // saisie ts 1791720124446) : le texte suivant de l'agent finissait son étape en cours et ne
    // répondait pas ; la réponse est venue 93 s plus tard. L'utilisateur a conclu « pas pris en compte ».
    expect(recu()).toBe('✓ Reçue — l’agent finit ce qu’il fait, puis y répond')
  })

  it('un run TERMINÉ ne rend plus le reçu trompeur', async () => {
    const { pilote, app } = await monter()
    await act(async () => app({ type: 'orchestrate-start', convId: 'A', task: '/frame' }))
    await act(async () => app({ type: 'orchestrate-end', convId: 'A', status: 'green' }))
    await orienter(pilote)
    expect(recu()).toContain('puis y répond')
  })
})
