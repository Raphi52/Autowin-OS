// @vitest-environment happy-dom
import { createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (texte: string): string | null => {
    const m = texte.match(/👉\s*Recommandé\s*\n([^\n]+)/u)
    return m ? m[1] : null
  }
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

const fil = (suite: string): unknown[] => [
  { role: 'user', content: 'salut' },
  {
    role: 'assistant',
    content: `✅ Fait\nla correction\n\n👉 Recommandé\npasser en terrain\n\nAUTOWIN_PROMPT_V1: ${suite}`
  }
]

/**
 * STOP = « J'ARRÊTE TOUT » (choix de l'utilisateur, 2026-09-03).
 *
 * DÉFAUT VÉCU : « le bouton stop n'arrête pas la réflexion ». Mesuré sur les journaux de tours de
 * conv-24 : trois tours successifs sans AUCUN évènement de fin, un nouveau tour repartant ~40 s
 * après l'arrêt du précédent. Le Stop coupait bien le tour, mais la boucle du mode auto se
 * déclenche justement sur la transition « plus occupé » — donc elle renvoyait la suite aussitôt, et
 * la conversation semblait ne jamais s'arrêter.
 *
 * Le garde d'arrêt volontaire existait déjà (`stoppedQueueDrainRef`), mais SEUL le vidage de la
 * file de messages le consultait. Ce test garde l'autre moitié : après un Stop, l'interrupteur est
 * éteint et plus aucun tour ne part tout seul.
 */
describe('ChatView — Stop éteint le mode auto', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('un clic sur Stop coupe le tour ET désarme la relance automatique', async () => {
    const messages = fil('lance le terrain sur X')
    // Un tour qui ne finit JAMAIS de lui-même : c'est l'état dans lequel le bouton Stop existe.
    const pilotChat = vi.fn(() => new Promise<never>(() => {}))
    const cancelPilotChat = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        pilotChat,
        cancelPilotChat,
        conversations: vi.fn().mockResolvedValue([conversation('A', messages)]),
        conversation: vi.fn(async (id: string) => conversation(id, messages))
      })
    )
    await h.click('.conv-item .conv-pick')
    await h.click('[data-testid="conv-auto-toggle"]')
    // L'allumage envoie la suite affichée : le tour est parti et ne rendra pas la main.
    expect(pilotChat).toHaveBeenCalled()
    expect(
      h.container.querySelector('[data-testid="conv-auto-toggle"]')?.getAttribute('aria-pressed')
    ).toBe('true')

    await h.click('[data-testid="composer-stop"]')

    expect(cancelPilotChat).toHaveBeenCalledWith('A')
    expect(
      h.container.querySelector('[data-testid="conv-auto-toggle"]')?.getAttribute('aria-pressed')
    ).toBe('false')
  })
})
