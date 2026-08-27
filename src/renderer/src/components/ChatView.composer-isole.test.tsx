// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

/**
 * COMPTEUR HORS-MODÈLE des rendus de ChatView. `ChatQueuePanel` est rendu par le CORPS de
 * ChatView : chaque exécution du corps le re-rend. S'il compte une frappe, c'est que la vue
 * entière (3800 lignes de JSX, listes, panneaux) se recalcule à chaque caractère — le freeze
 * mesuré en conv-1466. Le composer isolé doit absorber la frappe SEUL.
 */
const compteur = { rendus: 0 }
vi.mock('./ChatQueuePanel', async (importOriginal) => {
  const reel = await importOriginal<typeof import('./ChatQueuePanel')>()
  return {
    ...reel,
    ChatQueuePanel: (props: Parameters<typeof reel.ChatQueuePanel>[0]) => {
      compteur.rendus += 1
      return reel.ChatQueuePanel(props)
    }
  }
})

const { chatApi, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

const RUN = {
  subject: 'workflow-bench-regression',
  session: 'attaché',
  path: 'runs/workflow-bench-regression/RUN.md',
  mtime: 1,
  summary: { status: 'bloqué', dodTotal: 0, dodChecked: 0, journalEvents: 0, defauts: 0 }
}

describe('ChatView — le composer est isolé : taper ne re-rend pas la vue', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('ne re-rend PAS ChatView à chaque caractère tapé', async () => {
    h = await mountChat(chatApi())
    await h.click('.conv-pick')
    // Le PREMIER caractère a le droit de re-rendre la vue UNE fois : le composer lui signale la
    // bascule « il y a un brouillon » (la home s'y accroche). Les suivants doivent coûter zéro.
    await h.type('b')
    compteur.rendus = 0
    for (const valeur of ['bo', 'bon', 'bonj', 'bonjo', 'bonjou', 'bonjour']) await h.type(valeur)
    expect(h.textarea().value).toBe('bonjour')
    expect(compteur.rendus).toBe(0)
  })

  /**
   * FALSIFIEURS. Un composer isolé mais DÉBRANCHÉ ferait passer le test ci-dessus tout en
   * cassant le produit. Entrées qui doivent alors échouer :
   */
  it('FALSIFIEUR — le texte tapé part bien à l’envoi', async () => {
    const api = chatApi()
    h = await mountChat(api)
    await h.click('.conv-pick')
    await h.type('un message tout neuf')
    await h.click('.composer-send')
    const payload = (api.pilotChat as ReturnType<typeof vi.fn>).mock.calls[0][0] as Array<{
      content: string
    }>
    expect(payload[payload.length - 1].content).toBe('un message tout neuf')
    expect(h.textarea().value).toBe('')
  })

  it('FALSIFIEUR — le brouillon reste attaché à SA conversation', async () => {
    h = await mountChat(chatApi())
    await h.click('.conv-pick')
    await h.type('brouillon de A')
    await h.click('.conv-new-row') // nouvelle conversation → composer vierge
    expect(h.textarea().value).toBe('')
    await h.click('.conv-pick') // retour sur A → le brouillon revient
    expect(h.textarea().value).toBe('brouillon de A')
  })

  it('FALSIFIEUR — les palettes slash et mention répondent encore à la frappe', async () => {
    h = await mountChat(chatApi({ conversationRuns: vi.fn().mockResolvedValue([RUN]) }))
    await h.click('.conv-pick')
    await h.type('/')
    expect(h.container.querySelectorAll('.slash-palette .slash-item').length).toBeGreaterThan(0)
    await h.type('débloque @work')
    const items = h.container.querySelectorAll('[data-testid="mention-item"]')
    expect(items).toHaveLength(1)
    await act(async () => {
      items[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(h.textarea().value).toBe('débloque @run:workflow-bench-regression ')
  })
})
