// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * Preuve que le bloc est ALIMENTE, pas seulement atteignable : l'evenement du run le fait
 * apparaitre, et le clic pre-remplit reellement le composer. Un composant qu'aucun evenement
 * n'atteint est du theatre, quel que soit le nombre de ses tests unitaires.
 */
describe('ChatView — les suppositions du cadrage arrivent dans le fil', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  async function monter(): Promise<(event: Record<string, unknown>) => void> {
    let emit!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
        capabilityControls: vi.fn().mockResolvedValue([]),
        onAppEvent: vi.fn((listener) => {
          emit = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    return emit
  }

  const evenement = (convId: string): Record<string, unknown> => ({
    type: 'orchestrate-hypotheses',
    convId,
    hypotheses: [
      { affirmation: 'le sanitizeur refuse les contrôles', source: 'confiance' },
      { affirmation: 'le store est vide au premier lancement', source: 'besoin' }
    ]
  })

  it('affiche le bloc pour la conversation ACTIVE, et pas pour une autre', async () => {
    const emit = await monter()
    // Le harnais monte une seule conversation, « A », qui est donc l'active.
    await act(async () => emit(evenement('conv-etrangere')))
    expect(harness!.container.querySelector('[data-testid="cadrage-hypotheses"]')).toBeNull()

    await act(async () => emit(evenement('A')))
    const bloc = harness!.container.querySelector('[data-testid="cadrage-hypotheses"]')
    expect(bloc?.textContent).toContain('le sanitizeur refuse les contrôles')
    expect(harness!.container.querySelectorAll('[data-testid="cadrage-hypothese"]')).toHaveLength(2)
  })

  it('un clic sur une supposition PRE-REMPLIT le composer, sans envoyer', async () => {
    const emit = await monter()
    await act(async () => emit(evenement('A')))
    const ligne = harness!.container.querySelectorAll<HTMLButtonElement>('.askd-choix')[0]
    await act(async () => ligne.click())
    const composer = harness!.textarea()
    expect(composer.value).toContain('le sanitizeur refuse les contrôles')
    expect(composer.value).toMatch(/En réalité\s*:\s*$/u)
  })

  it('un evenement sans supposition ne fait apparaitre aucun bloc', async () => {
    const emit = await monter()
    await act(async () => emit({ type: 'orchestrate-hypotheses', convId: 'A', hypotheses: [] }))
    expect(harness!.container.querySelector('[data-testid="cadrage-hypotheses"]')).toBeNull()
  })
})
