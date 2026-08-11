// @vitest-environment happy-dom
/**
 * Une erreur d'envoi était injectée comme part TEXTE `⚠️ …` : indistinguable d'un contenu produit
 * par le modèle, sans `role="alert"`, sans cause, sans action. Elle devient une part STRUCTURÉE
 * rendue par un bloc dédié — l'ancien texte `⚠️ …` des conversations DÉJÀ persistées continue,
 * lui, de s'afficher tel quel (pas de rupture d'hydratation).
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

describe('ChatView — erreur d’envoi structurée', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  async function sendWith(pilotChat: ReturnType<typeof vi.fn>): Promise<void> {
    h = await mountChat(chatApi({ pilotChat }))
    await h.click('.conv-pick')
    await h.type('ma tâche')
    await h.click('.composer-send')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25))
    })
  }

  it('rend un bloc d’alerte accessible (cause + message) quand le tour échoue', async () => {
    await sendWith(vi.fn().mockResolvedValue({ ok: false, error: 'quota dépassé' }))
    const alerte = h!.container.querySelector('.msg-error')
    expect(alerte).not.toBeNull()
    expect(alerte!.getAttribute('role')).toBe('alert')
    expect(alerte!.textContent).toContain('quota dépassé')
    expect(alerte!.querySelector('.msg-error-cause')?.textContent).toContain('Le tour a échoué')
    // Plus aucune part texte déguisée en réponse du modèle.
    expect(h!.container.querySelector('.msg-body')?.textContent ?? '').not.toContain('⚠️')
    // Une SEULE barre d'actions : le bloc d'alerte la porte, le bloc terminal ne la duplique pas.
    expect(h!.container.querySelector('.msg-terminal')).toBeNull()
    expect(h!.container.querySelectorAll('.msg-error-action')).toHaveLength(2)
  })

  it('rend aussi l’exception levée par l’IPC', async () => {
    await sendWith(vi.fn().mockRejectedValue(new Error('IPC coupée')))
    const alerte = h!.container.querySelector('.msg-error')
    expect(alerte).not.toBeNull()
    expect(alerte!.textContent).toContain('IPC coupée')
    expect(alerte!.querySelector('.msg-error-cause')?.textContent).toContain('Envoi impossible')
  })

  it('n’altère pas les anciens messages persistés en part texte « ⚠️ … »', async () => {
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([
          conversation('A', [
            { role: 'user', content: 'salut' },
            {
              role: 'assistant',
              content: '⚠️ ancienne erreur',
              parts: [{ kind: 'text', text: '⚠️ ancienne erreur' }],
              status: 'failed'
            }
          ])
        ])
      })
    )
    await h.click('.conv-pick')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(h.container.textContent).toContain('⚠️ ancienne erreur')
  })
})
