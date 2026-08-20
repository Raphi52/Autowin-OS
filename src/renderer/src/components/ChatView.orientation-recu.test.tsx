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

  it('un RUN en cours ⇒ « lira à la phase suivante », pas « Orienté »', async () => {
    const { pilote, app, injecte } = await monter()
    await act(async () =>
      app({ type: 'orchestrate-start', convId: 'A', task: '/frame les icônes' })
    )
    await orienter(pilote)
    expect(injecte).toHaveBeenCalled()
    expect(recu()).toContain('à la phase suivante')
    expect(recu()).not.toContain('Orienté')
  })

  it('sans run, un tour de chat ordinaire annonce bien « Orienté »', async () => {
    const { pilote, injecte } = await monter()
    await orienter(pilote)
    expect(injecte).toHaveBeenCalled()
    expect(recu()).toContain('Orienté')
  })

  it('un run TERMINÉ ne rend plus le reçu trompeur', async () => {
    const { pilote, app } = await monter()
    await act(async () => app({ type: 'orchestrate-start', convId: 'A', task: '/frame' }))
    await act(async () => app({ type: 'orchestrate-end', convId: 'A', status: 'green' }))
    await orienter(pilote)
    expect(recu()).toContain('Orienté')
  })
})
