// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * Demande du 2026-09-22 : « importe toutes mes conversations active et inactive que j'ai dans
 * claude.exe et reproduit le systeme de conv active/inactive (le systeme de filtre par statut) » —
 * puis directive : « le bouton pour filtrer doit etre a coté des boutons mosaique et Densité
 * et passe les 3 boutons en dessous des conv tout en bas ».
 *
 * Ici : le filtre tourne tous → actives → inactives, survit au redemarrage, et les trois boutons
 * vivent dans un pied de panneau SOUS la liste — plus dans l'en-tete.
 */
describe('ChatView — filtre actif/inactif des conversations (systeme claude.exe)', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  const fils = [
    conversation('A'), // nee dans Autowin : comptee ACTIVE
    { ...conversation('B'), claudeExe: { sessionId: 's-b', statut: 'inactive' } },
    { ...conversation('C'), claudeExe: { sessionId: 's-c', statut: 'active' } }
  ]
  const api = (extra: Record<string, unknown> = {}): Record<string, unknown> =>
    chatApi({
      conversations: vi.fn().mockResolvedValue(fils),
      conversation: vi.fn(async (id: string) => conversation(id)),
      ...extra
    })

  const panneau = (): HTMLElement => h!.container.querySelector('.conv-pane') as HTMLElement
  const titresVisibles = (): string => panneau().textContent ?? ''

  it('pose les 3 boutons dans un pied SOUS la liste, et plus dans l’en-tête', async () => {
    h = await mountChat(api())
    const pied = panneau().querySelector('.conv-footer') as HTMLElement
    expect(pied).not.toBeNull()
    // Le pied vient APRES la liste : c'est « en dessous des conv tout en bas ».
    expect(pied.previousElementSibling?.classList.contains('conv-list')).toBe(true)
    for (const bouton of ['conv-status-filter', 'conv-density-toggle', 'conv-view-toggle']) {
      expect(pied.querySelector(`[data-testid="${bouton}"]`)).not.toBeNull()
    }
    expect(panneau().querySelector('.conv-head [data-testid="conv-density-toggle"]')).toBeNull()
    expect(panneau().querySelector('.conv-head [data-testid="conv-view-toggle"]')).toBeNull()
  })

  it('tourne tous → actives → inactives, filtre la liste et memorise le cran', async () => {
    h = await mountChat(api())
    expect(titresVisibles()).toContain('Conversation B')
    expect(titresVisibles()).toContain('Conversation C')

    await h.click('[data-testid="conv-status-filter"]')
    // Actives : le fil natif A et le fil claude.exe ouvert C — l'inactif B disparait.
    expect(titresVisibles()).toContain('Conversation A')
    expect(titresVisibles()).toContain('Conversation C')
    expect(titresVisibles()).not.toContain('Conversation B')
    expect(window.localStorage.getItem('autowin.chat.conversationsStatusFilter')).toBe('actives')

    await h.click('[data-testid="conv-status-filter"]')
    // Inactives : seul B reste.
    expect(titresVisibles()).toContain('Conversation B')
    expect(titresVisibles()).not.toContain('Conversation C')
    expect(titresVisibles()).not.toContain('Conversation A')

    await h.click('[data-testid="conv-status-filter"]')
    expect(titresVisibles()).toContain('Conversation A')
    expect(window.localStorage.getItem('autowin.chat.conversationsStatusFilter')).toBe('tous')
  })

  it('reprend le cran memorise, et ignore une valeur inconnue', async () => {
    window.localStorage.setItem('autowin.chat.conversationsStatusFilter', 'inactives')
    h = await mountChat(api())
    expect(titresVisibles()).toContain('Conversation B')
    expect(titresVisibles()).not.toContain('Conversation C')
    await h.unmount()
    h = null

    window.localStorage.setItem('autowin.chat.conversationsStatusFilter', 'zzz')
    h = await mountChat(api())
    expect(
      h.container.querySelector('[data-testid="conv-status-filter"]')!.getAttribute('data-filtre')
    ).toBe('tous')
  })

  it('declenche l’import claude.exe au montage quand le canal existe', async () => {
    const importer = vi.fn().mockResolvedValue({ creees: 0, statutsMisAJour: 0, sessions: 0 })
    h = await mountChat(api({ conversationsImportClaudeExe: importer }))
    expect(importer).toHaveBeenCalledTimes(1)
  })
})
