// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'
import { oublierRendusRecents } from './rendu-long'

/**
 * GEL `renderer:vue-chat-liste` QUI NOMME SA CAUSE (conv-1115, 2026-10-23). 18 gels réels pour 73 s
 * depuis le 20/10 (pire 12,9 s) disaient seulement « la liste a mis N ms » : ni combien de lignes
 * elle avait redessinées, ni quelle donnée avait changé. Le diagnostic /gel n'a donc pas pu trancher.
 * Chaque gel de la liste porte désormais `liste` : lignes redessinées, rendus, et déclencheurs.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LE DÉTAIL SAUTE : un rafraîchissement où un seul fil sur
 * 50 a changé. Le seuil est abaissé à 0 pour que CHAQUE rendu de la liste soit signalé : sans
 * détail, le signal de la liste part sans champ `liste`.
 */
vi.mock('../../../shared/gel-detector', async (original) => ({
  ...(await original<typeof import('../../../shared/gel-detector')>()),
  SEUIL_GEL_MS: 0
}))

type Liste = { lignes: number; rendus: number; passages: number; declencheurs: string[] }
type Signal = [number, string | undefined, { liste?: Liste } | undefined]

async function laisserPasser(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

describe('ChatView — le gel de la liste nomme les lignes redessinées et leur déclencheur', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    oublierRendusRecents()
  })

  async function monter(store: Array<Record<string, unknown>>): Promise<{
    signaux: Signal[]
    rafraichir: () => Promise<void>
  }> {
    const signaux: Signal[] = []
    let emettre!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
        conversations: vi.fn(async () => structuredClone(store)),
        conversation: vi.fn(async (id: string) => store.find((c) => c.id === id)),
        onAppEvent: vi.fn((listener) => {
          emettre = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        }),
        signalerGelRenderer: vi.fn((...a: unknown[]) => signaux.push(a as Signal))
      })
    )
    await laisserPasser()
    return {
      signaux,
      rafraichir: async () => {
        await act(async () => emettre({ type: 'refresh', scope: 'conversations' }))
        await laisserPasser()
      }
    }
  }

  const fils = (): Array<Record<string, unknown>> =>
    Array.from({ length: 50 }, (_, i) => ({
      ...conversation(`c${i}`),
      messageCount: 1,
      updatedAt: 1_000 + i
    }))
  const signauxListe = (signaux: Signal[]): Signal[] =>
    signaux.filter(([, etiquette]) => etiquette === 'vue-chat-liste')

  it('un fil modifié au rafraîchissement ⇒ 1 ligne redessinée, déclenchée par les conversations', async () => {
    const store = fils()
    const { signaux, rafraichir } = await monter(store)
    expect(harness!.container.querySelectorAll('.conv-item').length).toBeGreaterThanOrEqual(50)

    store[7] = { ...store[7], title: 'Titre changé' }
    signaux.length = 0
    await rafraichir()

    const liste = signauxListe(signaux)
    expect(liste.length).toBeGreaterThan(0)
    // Chaque signal de la liste porte son détail, même quand il n'y a rien à accuser.
    for (const [, , detail] of liste) expect(detail?.liste).toBeDefined()
    const redessines = liste.filter(([, , d]) => (d?.liste?.lignes ?? 0) > 0)
    expect(redessines).toHaveLength(1)
    const detail = redessines[0]![2]!.liste!
    expect(detail.lignes).toBe(1)
    expect(detail.rendus).toBeGreaterThanOrEqual(1)
    expect(detail.rendus).toBeLessThanOrEqual(2)
    expect(detail.passages).toBe(1)
    expect(detail.declencheurs).toContain('conversations')
  })

  it('ouvrir un fil ⇒ le déclencheur nommé est le fil ouvert', async () => {
    const { signaux } = await monter(fils())
    signaux.length = 0
    await act(async () =>
      harness!.container.querySelectorAll<HTMLButtonElement>('.conv-pick')[3]!.click()
    )
    await laisserPasser()

    const avecFilOuvert = signauxListe(signaux).filter(([, , d]) =>
      d?.liste?.declencheurs.includes('fil-ouvert')
    )
    expect(avecFilOuvert.length).toBeGreaterThan(0)
    const lignes = avecFilOuvert.reduce((n, [, , d]) => n + (d?.liste?.lignes ?? 0), 0)
    expect(lignes).toBeGreaterThanOrEqual(1)
    expect(lignes).toBeLessThanOrEqual(4)
  })
})
