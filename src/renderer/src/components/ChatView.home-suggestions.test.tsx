// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'
import { STATIC_SUGGESTIONS } from './chat-home-suggestions'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const blockedRun = (subject: string) => ({
  subject,
  session: 'attaché',
  path: `runs/${subject}/RUN.md`,
  mtime: 1,
  // `open` : un statut que `parseRun` produit vraiment (`bloqué` n'en est pas un, il deviendrait `unknown`).
  summary: { status: 'open', dodTotal: 0, dodChecked: 0, journalEvents: 0, defauts: 0 }
})

describe('ChatView — la home propose l’état réel, plus quatre phrases figées', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  // La phrase est écrite lettre à lettre (conv-1401) : son texte complet se lit sur `aria-label`.
  const phraseDuMoment = (conteneur: Element): string | null | undefined =>
    conteneur.querySelector('.aa-phrase')?.getAttribute('aria-label')

  it('écrit d’abord le run bloqué, avec la mention @run prête à l’emploi', async () => {
    h = await mountChat(
      chatApi({
        conversationRuns: vi.fn().mockResolvedValue([blockedRun('workflow-bench-regression')])
      })
    )
    await h.click('.conv-pick')
    expect(phraseDuMoment(h.container)).toBe('Débloque @run:workflow-bench-regression')
  })

  it('retombe sur le jeu statique quand aucun run n’est bloqué', async () => {
    h = await mountChat(chatApi())
    await h.click('.conv-pick')
    expect(phraseDuMoment(h.container)).toBe(STATIC_SUGGESTIONS[0])
  })

  it('un clic sur la phrase REMPLIT la saisie, n’envoie rien, et la mascotte se met à lire', async () => {
    const mockApi = chatApi()
    h = await mountChat(mockApi)
    await h.click('.conv-pick')
    await h.click('.aa-phrase')
    const champ = h.container.querySelector('textarea') as HTMLTextAreaElement
    expect(champ.value).toBe(STATIC_SUGGESTIONS[0])
    expect(mockApi.pilotChat).not.toHaveBeenCalled()
    // Le texte vit désormais dans la saisie : le répéter au-dessus le doublerait à l'écran.
    expect(h.container.querySelector('.aa-phrase')).toBeNull()
    expect(h.container.querySelector('.accueil-anim.est-lecture')).not.toBeNull()
  })
})
