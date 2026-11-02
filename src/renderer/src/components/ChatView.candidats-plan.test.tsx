// @vitest-environment happy-dom
/**
 * LE WORKFLOW INTELLIGENT EN SUPER CONVERSATION, CÂBLÉ DANS LE FIL (conv-1333, 2026-10-30).
 *
 * Depuis le 22/10 : 4 sélections, 12 lots prévus, 4 partis, jamais un lot 2 — la file du fil vit dans
 * la vue. Puis, conv-1332 : « tu aurais dû tout paralléliser avec une super conv ». Le clic et la
 * saisie (« 1 et 2 ») déposent donc un plan. Entrées qui font tomber ce test : le lot part quand même
 * dans le fil, la saisie reste un message au modèle, ou un refus disparaît sans un mot.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

const TEXTE_SCOUT = [
  '| Score | Type | Quoi | Ancrage | Preuve |',
  '| ---: | --- | --- | --- | --- |',
  '| 92 | fix | Compteur jamais remis | src/a.ts:1 | reste à 3 |',
  '| 84 | new | Vue des couts | src/b.ts:2 | relus a la main |'
].join('\n')

const fil = (): unknown[] => [
  { role: 'user', content: 'scout' },
  { role: 'assistant', done: true, parts: [{ kind: 'text', text: TEXTE_SCOUT }] }
]

let h: Harness | null = null
beforeAll(installRafShim)
afterEach(async () => {
  await h?.unmount()
  h = null
  window.localStorage.clear()
  vi.restoreAllMocks()
})

type Pilote = ReturnType<typeof vi.fn>

const monter = async (plansDeLots: unknown): Promise<Pilote> => {
  const pilotChat: Pilote = vi.fn(async () => ({ ok: true }))
  h = await mountChat(
    chatApi({
      pilotChat,
      plansDeLots,
      conversations: vi.fn().mockResolvedValue([conversation('A', fil())]),
      conversation: vi.fn(async (id: string) => conversation(id, fil()))
    })
  )
  await h.click('.conv-item .conv-pick')
  return pilotChat
}

const laisserPasser = async (): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
}

const taper = async (texte: string): Promise<void> => {
  await h!.type(texte)
  await act(async () => {
    h!
      .textarea()
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      )
  })
  await laisserPasser()
}

const gestesDeLancement = (plans: Pilote): unknown[][] =>
  plans.mock.calls.filter((appel) => appel[0] === 'lancer-selection')

describe('ChatView — la sélection part en super conversation', () => {
  it('le clic dépose le plan des deux lots : aucun message ne part dans le fil', async () => {
    const plans: Pilote = vi.fn(async () => ({ ok: true }))
    const pilotChat = await monter(plans)
    await h!.click('[data-testid="cpick-lancer"]')
    await laisserPasser()
    const [appel] = gestesDeLancement(plans)
    expect(appel?.[1], 'le fil affiché est le chef').toBe('A')
    const selection = appel?.[4] as { lots: { fichiers: string[] }[] }
    expect(selection.lots.map((lot) => lot.fichiers)).toEqual([['src/a.ts'], ['src/b.ts']])
    expect(pilotChat).not.toHaveBeenCalled()
    expect(h!.container.textContent).toContain('Plan lancé (2 lots)')
  })

  it('« 1 et 2 » tapé sous le panneau vaut le clic, et la saisie se vide', async () => {
    const plans: Pilote = vi.fn(async () => ({ ok: true }))
    const pilotChat = await monter(plans)
    await taper('1 et 2')
    expect(gestesDeLancement(plans)).toHaveLength(1)
    expect(pilotChat).not.toHaveBeenCalled()
    expect(h!.textarea().value).toBe('')
  })

  it('« 1 » tapé part en un seul message /build, comme le bouton sur une ligne', async () => {
    const plans: Pilote = vi.fn(async () => ({ ok: true }))
    const pilotChat = await monter(plans)
    await taper('1')
    expect(gestesDeLancement(plans)).toHaveLength(0)
    const messages = pilotChat.mock.calls[0]?.[0] as { role: string; content: string }[]
    expect(
      messages
        .filter((m) => m.role === 'user')
        .at(-1)
        ?.content.split('\n')[0]
    ).toBe('/build')
  })

  it('une vraie phrase reste un message au modèle, même sous un panneau', async () => {
    const plans: Pilote = vi.fn(async () => ({ ok: true }))
    const pilotChat = await monter(plans)
    await taper('pourquoi la 2 passe après la 1 ?')
    expect(gestesDeLancement(plans)).toHaveLength(0)
    expect(pilotChat).toHaveBeenCalledOnce()
  })

  it('un plan refusé garde le texte tapé et dit pourquoi', async () => {
    const plans: Pilote = vi.fn(async () => ({
      ok: false,
      erreur: 'plan suspendu par la limite'
    }))
    const pilotChat = await monter(plans)
    await taper('1 et 2')
    expect(pilotChat).not.toHaveBeenCalled()
    expect(h!.textarea().value).toBe('1 et 2')
    expect(h!.container.textContent).toContain('plan suspendu par la limite')
  })

  it('dans le fil d’un lot, les lots s’enchaînent ici, le plus court d’abord', async () => {
    const plans: Pilote = vi.fn(async () => ({
      ok: false,
      erreur: 'un lot ne lance pas de plan',
      repli: true
    }))
    const pilotChat = await monter(plans)
    await h!.click('[data-testid="cpick-lancer"]')
    await laisserPasser()
    // Le faux modèle répond aussitôt : le lot 2 part dès la fin du lot 1, jamais avant.
    const envoyes = pilotChat.mock.calls.map((appel) => {
      const messages = appel[0] as { role: string; content: string }[]
      return messages.filter((m) => m.role === 'user').at(-1)?.content ?? ''
    })
    expect(envoyes).toHaveLength(2)
    expect(envoyes[0]!.split('\n')[0]).toBe('/build')
    expect(envoyes[1]).toContain('Lot 2 sur 2 de la sélection')
  })
})
