// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * LE SYMPTOME EXACT rapporte le 20/08 : « affiche 1 action en cours mais quand je vais dans
 * sous-agents il n'y a plus rien en cours ». Le badge lit les parts du tour, le panneau lit les runs
 * vivants — vide a `orchestrate-end` — et rien ne les reconciliait.
 */
describe('ChatView — la fin du run décolle le badge « action en cours »', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  async function monter(): Promise<{
    pilote: (event: Record<string, unknown>) => void
    app: (event: Record<string, unknown>) => void
  }> {
    let pilote!: (event: Record<string, unknown>) => void
    let app!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
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
    return { pilote, app }
  }

  const libelleDuGroupe = (): string =>
    harness?.container.querySelector('[data-testid="activity-group"]')?.textContent ?? ''

  it('« en cours » tant que le run tourne, puis plus rien quand il finit vert', async () => {
    const { pilote, app } = await monter()
    await act(async () =>
      pilote({ conversationId: 'A', kind: 'command', name: 'orchestrate', args: {} })
    )
    expect(libelleDuGroupe()).toContain('en cours')

    await act(async () => app({ type: 'orchestrate-end', convId: 'A', status: 'green' }))
    // Le run est fini : plus rien n'est « en cours », et l'action est comptée comme terminée.
    expect(libelleDuGroupe()).not.toContain('en cours')
  })

  it('un run rouge ferme aussi l’action — il ne la laisse pas ouverte', async () => {
    const { pilote, app } = await monter()
    await act(async () =>
      pilote({ conversationId: 'A', kind: 'command', name: 'orchestrate', args: {} })
    )
    await act(async () => app({ type: 'orchestrate-end', convId: 'A', status: 'red' }))
    const libelle = libelleDuGroupe()
    expect(libelle).not.toContain('en cours')
    expect(libelle).toContain('erreur')
  })

  it('la fin d’un run d’une AUTRE conversation ne touche pas ce tour', async () => {
    const { pilote, app } = await monter()
    await act(async () =>
      pilote({ conversationId: 'A', kind: 'command', name: 'orchestrate', args: {} })
    )
    await act(async () =>
      app({ type: 'orchestrate-end', convId: 'conv-etrangere', status: 'green' })
    )
    expect(libelleDuGroupe()).toContain('en cours')
  })
})
