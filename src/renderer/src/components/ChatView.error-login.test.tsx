// @vitest-environment happy-dom
/**
 * Tour coupe par une SESSION EXPIREE (« 401 OAuth access token has expired. Re-authenticate »).
 * Renvoyer ou reprendre le meme prompt echouerait a l'identique tant que personne ne s'est
 * reconnecte : le bloc d'erreur n'offre donc QUE le login. Demande du 2026-09-10.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'
import { estErreurAuthExpiree } from './erreur-auth'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const AUTH =
  'Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.'

describe('ChatView — session expirée', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('reconnaît le message d’auth expirée, pas un défaut ordinaire', () => {
    expect(estErreurAuthExpiree(AUTH)).toBe(true)
    expect(estErreurAuthExpiree('401 tests en 38 s')).toBe(false)
    expect(estErreurAuthExpiree('Budget durée dépassé')).toBe(false)
  })

  it('offre « Se reconnecter » SEUL et appelle le login du provider', async () => {
    const providerLogin = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        providerLogin,
        pilotChat: vi.fn().mockResolvedValue({ ok: false, error: AUTH })
      })
    )
    await h.click('.conv-pick')
    await h.type('ma tâche')
    await h.click('.composer-send')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25))
    })
    const actions = h.container.querySelectorAll('.msg-error-action')
    expect(actions).toHaveLength(1)
    expect(actions[0].textContent).toContain('Se reconnecter')
    await h.click('[data-testid="error-login"]')
    expect(providerLogin).toHaveBeenCalledWith('claude')
  })
})
