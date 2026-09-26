// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * GEL VECU (heal gels vue chat, 2026-09-18) : chaque morceau de texte recu pendant un tour
 * re-rendait ChatView, qui recreait TOUTES les lignes de la liste des conversations (~600 chez
 * l'utilisateur) alors que rien de ce qu'elles affichent n'avait change. Profil mesure : 5,9 s pour
 * 30 morceaux avant, 0,2 a 0,6 s apres memorisation du bloc.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION SAUTE : des morceaux de texte recus sur la
 * conversation ouverte. Chaque ligne calcule son etat via `deriveConversationState` : si la liste
 * est recreee, le compteur monte d'une ligne par conversation et par morceau.
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

describe('ChatView — la liste des conversations ne se recree pas a chaque morceau de texte', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('10 morceaux sur la conversation ouverte ⇒ aucune ligne de la liste recalculee', async () => {
    const convs = Array.from({ length: 50 }, (_, i) =>
      conversation(i === 0 ? 'A' : `c${i}`, [{ role: 'user', content: `fil ${i}` }] as never)
    )
    let pilote!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(convs),
        conversation: vi.fn().mockResolvedValue(convs[0]),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await harness.click('.conv-pick')
    // Le premier morceau fait passer A « en cours » : la pastille change, la liste se recalcule UNE fois.
    await act(async () => pilote({ conversationId: 'A', kind: 'delta', delta: 'debut ' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const lignesAvant = harness.container.querySelectorAll('.conv-item').length
    expect(lignesAvant).toBeGreaterThanOrEqual(50)

    appels.n = 0
    for (let i = 0; i < 10; i++) {
      await act(async () => pilote({ conversationId: 'A', kind: 'delta', delta: `morceau ${i} ` }))
      await act(async () => {
        await new Promise((r) => setTimeout(r, 20))
      })
    }
    expect(appels.n).toBe(0)
    // La liste reste la liste : memoriser ne doit rien faire disparaitre.
    expect(harness.container.querySelectorAll('.conv-item')).toHaveLength(lignesAvant)
  })

  /**
   * Meme defaut, a la BASCULE : changer de conversation recreait les ~600 lignes (~430 ms par
   * bascule, mesure dans l'app en serveur de dev) pour ne changer que deux classes « active ».
   * Seules l'ancienne et la nouvelle ligne active doivent se recalculer — au plus deux fois chacune,
   * car le groupe « Récent » duplique une ligne deja rangee ailleurs.
   */
  it('changer de conversation ⇒ seules les lignes concernées se recalculent', async () => {
    const convs = Array.from({ length: 50 }, (_, i) =>
      conversation(`c${i}`, [{ role: 'user', content: `fil ${i}` }] as never)
    )
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(convs),
        conversation: vi.fn(async (id: string) => convs.find((c) => c.id === id))
      })
    )
    const picks = (): HTMLButtonElement[] =>
      Array.from(harness!.container.querySelectorAll<HTMLButtonElement>('.conv-pick'))
    await act(async () => picks()[0].click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(picks().length).toBeGreaterThanOrEqual(50)

    appels.n = 0
    await act(async () => picks()[picks().length - 1].click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(harness.container.querySelector('.conv-item.active')).not.toBeNull()
    expect(appels.n).toBeLessThanOrEqual(4)
  })
})
