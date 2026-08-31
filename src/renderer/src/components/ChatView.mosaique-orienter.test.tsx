// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * DEFAUT VECU (2026-08-31) : en mosaique, une fenetre OCCUPEE affichait « 🧭 Orienter » mais le
 * clic ne faisait RIEN — `onQueue` etait un no-op et `submitBtw` ne savait viser que la
 * conversation ACTIVE. Stop, lui, passait par `interruptAndFlushQueue` (relance la file) au lieu
 * de `stopPilotTurn`. Les deux gestes doivent viser LA fenetre cliquee.
 */
describe('ChatView — mosaique : Orienter et Stop visent leur fenetre', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  async function mosaiqueOccupee(): Promise<{
    injectDirective: ReturnType<typeof vi.fn>
    cancelPilotChat: ReturnType<typeof vi.fn>
  }> {
    window.localStorage.setItem('autowin.chat.conversationsViewMode', 'mosaic')
    window.localStorage.setItem('autowin.chat.mosaicOpenIds', '["A"]')
    const injectDirective = vi.fn().mockResolvedValue({ ok: true })
    const cancelPilotChat = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
        conversation: vi.fn(async (id: string) => conversation(id)),
        // Tour qui ne finit jamais : la fenetre reste occupee.
        pilotChat: vi.fn(() => new Promise(() => {})),
        injectDirective,
        cancelPilotChat
      })
    )
    await taper('premier message')
    await cliquer('[data-conv-id="A"] [data-testid="composer-send"]')
    return { injectDirective, cancelPilotChat }
  }

  async function taper(valeur: string): Promise<void> {
    const el = h!.container.querySelector('[data-conv-id="A"] textarea') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(el, valeur)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function cliquer(selector: string): Promise<void> {
    const el = h!.container.querySelector(selector) as HTMLElement
    if (!el) throw new Error(`sélecteur introuvable : ${selector}`)
    await act(async () => el.click())
  }

  it('« Orienter » injecte la directive dans LA conversation de la fenetre', async () => {
    const { injectDirective } = await mosaiqueOccupee()
    const bouton = h!.container.querySelector(
      '[data-conv-id="A"] [data-testid="composer-send"]'
    ) as HTMLButtonElement
    expect(bouton.textContent).toContain('Orienter')

    await taper('vise plutot le fichier X')
    await cliquer('[data-conv-id="A"] [data-testid="composer-send"]')

    expect(injectDirective).toHaveBeenCalledWith('A', 'vise plutot le fichier X')
  })

  it('« Stop » annule le tour de CETTE fenetre', async () => {
    const { cancelPilotChat } = await mosaiqueOccupee()
    await cliquer('[data-conv-id="A"] [data-testid="composer-stop"]')
    expect(cancelPilotChat).toHaveBeenCalledWith('A')
  })
})
