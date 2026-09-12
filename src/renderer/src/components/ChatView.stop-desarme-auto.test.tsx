// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// 2026-09-12 : mock PARTIEL obligatoire. Remplacer tout le module faisait disparaitre
// `splitFinalSummary`, que `cloture-en-dernier.ts` importe d'ici -- les 2 tests de ce
// fichier tombaient sur une erreur de mock, sans rapport avec le Stop qu'ils verifient.
vi.mock('./Markdown', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (texte: string): string | null => {
    const m = texte.match(/👉\s*Recommandé\s*\n([^\n]+)/u)
    return m ? m[1] : null
  }
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/** Un tour TERMINE qui propose explicitement une suite : c'est ce que la chaine auto enchaine. */
const filAvecSuite = (suite: string): unknown[] => [
  { role: 'user', content: 'salut' },
  {
    role: 'assistant',
    content: `✅ Fait\nla correction\n\n👉 Recommandé\npasser en terrain\n\nAUTOWIN_PROMPT_V1: ${suite}`
  }
]

/**
 * DEFAUT VECU (2026-09-03) : quatre fils portent mot pour mot « kaizen je click sur stop et ca fait
 * que de relancer la task » (conv-210, conv-214, conv-215, conv-221). Stop ne posait qu'un gel sur
 * la FILE des messages en attente ; l'interrupteur auto restait arme, le tour coupe arrivait comme
 * un tour termine, et la boucle renvoyait la suite proposee — la tache que l'utilisateur venait
 * d'arreter repartait toute seule.
 */
describe('ChatView — Stop desarme la chaine auto du fil', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  /**
   * GARDE COMPAGNON — elle observe qu'aucun envoi de plus ne part. Le harnais ne rejoue pas le
   * fil apres l'annulation, donc elle passait deja AVANT le correctif : la preuve rouge -> vert
   * du desarmement est le test suivant (l'interrupteur qui retombe). Celle-ci reste pour
   * attraper une regression qui, elle, ferait partir un tour.
   */
  it('apres un Stop, aucune suite ne repart toute seule', async () => {
    // Le fil GRANDIT quand le tour coupe retombe : c'est ce nouveau tour « termine » que la
    // boucle auto voyait comme une suite a enchainer.
    let fil = filAvecSuite('enchaine sur la suite')
    const pilotChat = vi.fn().mockResolvedValue({ ok: true, messages: [] })
    h = await mountChat(
      chatApi({
        pilotChat,
        pilotChatActive: vi.fn().mockResolvedValue({ active: true }),
        cancelPilotChat: vi.fn().mockResolvedValue({ ok: true }),
        conversations: vi.fn().mockResolvedValue([conversation('A', fil)]),
        conversation: vi.fn(async (id: string) => conversation(id, fil))
      })
    )
    await h.click('.conv-item .conv-pick')
    // Allumer le mode auto envoie la suite deja affichee : c'est le tour que Stop va couper.
    await h.click('[data-testid="composer-auto-toggle"]')
    const apresAllumage = pilotChat.mock.calls.length
    expect(apresAllumage).toBeGreaterThan(0)

    fil = [...fil, ...filAvecSuite('et encore une suite')]
    await h.click('[data-testid="composer-stop"]')
    // On laisse la boucle auto respirer : sans le desarmement, c'est ici qu'elle repartait.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80))
    })
    expect(pilotChat).toHaveBeenCalledTimes(apresAllumage)
  }, 20_000)

  it("le bouton auto retombe eteint : l'utilisateur VOIT que la chaine est coupee", async () => {
    const messages = filAvecSuite('enchaine sur la suite')
    h = await mountChat(
      chatApi({
        pilotChat: vi.fn().mockResolvedValue({ ok: true, messages: [] }),
        pilotChatActive: vi.fn().mockResolvedValue({ active: true }),
        cancelPilotChat: vi.fn().mockResolvedValue({ ok: true }),
        conversations: vi.fn().mockResolvedValue([conversation('A', messages)]),
        conversation: vi.fn(async (id: string) => conversation(id, messages))
      })
    )
    await h.click('.conv-item .conv-pick')
    await h.click('[data-testid="composer-auto-toggle"]')
    const bouton = (): Element | null =>
      h!.container.querySelector('[data-testid="composer-auto-toggle"]')
    const allume = bouton()?.className ?? ''
    await h.click('[data-testid="composer-stop"]')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80))
    })
    expect(bouton()?.className ?? '').not.toBe(allume)
  }, 20_000)
})
