// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * LE SIGNE DE VIE D'UNE ACTION LONGUE, de l'évènement pilote jusqu'au DOM.
 *
 * SYMPTÔME EXACT rapporté le 2026-08-25 : « ça me met une action en cours mais je le vois rien
 * faire ». `verify` rejouait la suite unitaire pendant dix minutes ; le fil affichait « 1 action en
 * cours » et RIEN d'autre jusqu'au plafond. Impossible de distinguer, à l'œil, une suite qui
 * travaille d'une suite bloquée — ou d'une app plantée.
 *
 * Ce test refuse le Potemkine : il ne vérifie pas que le réducteur sait stocker un texte, il
 * vérifie que le texte émis par le main ARRIVE À L'ÉCRAN, et qu'il DISPARAÎT au verdict.
 */
describe('ChatView — signe de vie d’une action en cours', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  async function monter(): Promise<(event: Record<string, unknown>) => void> {
    let pilote!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
        conversation: vi.fn().mockResolvedValue({ id: 'A', messages: [] }),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    return pilote
  }

  const groupe = (): string =>
    harness?.container.querySelector('.activity-group')?.textContent ?? ''

  it('affiche le battement pendant l’action, puis l’efface au verdict', async () => {
    const pilote = await monter()

    await act(async () => {
      pilote({ conversationId: 'A', kind: 'command', actionId: '0:0', name: 'verify', args: {} })
    })
    expect(groupe()).toContain('en cours')

    await act(async () => {
      pilote({
        conversationId: 'A',
        kind: 'action-progress',
        actionId: '0:0',
        text: '3 min 20 s · ✓ src/b.test.ts (8)'
      })
    })
    // C'est CELA que l'utilisateur n'avait pas : la preuve visible que ça avance.
    expect(groupe()).toContain('3 min 20 s')
    expect(groupe()).toContain('src/b.test.ts')

    await act(async () => {
      pilote({
        conversationId: 'A',
        kind: 'result',
        actionId: '0:0',
        name: 'verify',
        ok: true,
        data: {}
      })
    })
    // Le verdict remplace le signe de vie : pas de compteur mort sous un résultat rendu.
    expect(groupe()).not.toContain('3 min 20 s')
  })
})
