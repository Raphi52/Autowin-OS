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

/**
 * GEL `renderer:vue-chat-liste` (diagnostic /gel conv-1115, 2026-10-23) : chaque évènement
 * « conversations changées » rechargeait la liste par IPC, donc en objets NEUFS, et `refreshConvs`
 * la posait telle quelle. `LigneConversation` est mémorisée sur l'objet `c` : les ~1 000 lignes se
 * redessinaient toutes alors qu'un seul fil avait bougé (57 à 87 ms par rafraîchissement mesurés
 * sur la vraie liste, `scripts/cdp-profil-liste-chat.mjs`).
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION SAUTE : un rafraîchissement où le main
 * renvoie des copies neuves de 50 fils, dont un seul a changé. Chaque ligne redessinée calcule son
 * état par `deriveConversationState` : le compteur dit combien de lignes ont été redessinées.
 */
const appels = { n: 0 }
vi.mock('./chat-view-model', async (original) => {
  const reel = await original<typeof import('./chat-view-model')>()
  return {
    ...reel,
    deriveConversationState: (...args: Parameters<typeof reel.deriveConversationState>) => {
      appels.n++
      return reel.deriveConversationState(...args)
    }
  }
})

async function laisserPasser(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20))
  })
}

describe('ChatView — un rafraîchissement de la liste ne redessine que les fils modifiés', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  /** Le « store » côté main : chaque appel IPC en rend une COPIE neuve, comme la vraie IPC. */
  function monter(store: Array<Record<string, unknown>>): Promise<{
    rafraichir: () => Promise<void>
  }> {
    let emettre!: (event: Record<string, unknown>) => void
    return mountChat(
      chatApi({
        conversations: vi.fn(async () => structuredClone(store)),
        onAppEvent: vi.fn((listener) => {
          emettre = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    ).then(async (monte) => {
      harness = monte
      await laisserPasser()
      return {
        rafraichir: async () => {
          await act(async () => emettre({ type: 'refresh', scope: 'conversations' }))
          await laisserPasser()
        }
      }
    })
  }

  const fils = (): Array<Record<string, unknown>> =>
    Array.from({ length: 50 }, (_, i) => ({
      ...conversation(`c${i}`),
      messageCount: 1,
      lastMessageRole: 'assistant',
      lastAssistantStatus: 'completed',
      modeleChoisi: { provider: 'claude', model: 'opus' },
      updatedAt: 1_000 + i
    }))

  it('un seul fil modifié sur 50 ⇒ seule sa ligne se redessine', async () => {
    const store = fils()
    const { rafraichir } = await monter(store)
    const lignes = harness!.container.querySelectorAll('.conv-item').length
    expect(lignes).toBeGreaterThanOrEqual(50)

    store[7] = { ...store[7], title: 'Titre changé', messageCount: 2 }
    appels.n = 0
    await rafraichir()

    // Le changement est bien AFFICHÉ : stabiliser ne doit pas figer un fil qui a bougé.
    expect(harness!.container.textContent).toContain('Titre changé')
    expect(harness!.container.querySelectorAll('.conv-item')).toHaveLength(lignes)
    // Au plus deux rendus : le groupe « Récent » peut montrer la même ligne une seconde fois.
    expect(appels.n).toBeGreaterThan(0)
    expect(appels.n).toBeLessThanOrEqual(2)
  })

  it('rien de modifié ⇒ aucune ligne ne se redessine', async () => {
    const { rafraichir } = await monter(fils())
    expect(harness!.container.querySelectorAll('.conv-item').length).toBeGreaterThanOrEqual(50)

    appels.n = 0
    await rafraichir()
    await rafraichir()

    expect(appels.n).toBe(0)
  })

  it('un champ imbriqué modifié (modèle choisi) ⇒ la ligne reçoit le nouvel objet', async () => {
    const store = fils()
    const { rafraichir } = await monter(store)

    store[3] = { ...store[3], modeleChoisi: { provider: 'claude', model: 'sonnet' } }
    store[4] = { ...store[4], title: 'Autre titre' }
    appels.n = 0
    await rafraichir()

    expect(harness!.container.textContent).toContain('Autre titre')
    // Deux fils modifiés : au plus deux rendus chacun (groupe « Récent »).
    expect(appels.n).toBeGreaterThanOrEqual(2)
    expect(appels.n).toBeLessThanOrEqual(4)
  })
})
