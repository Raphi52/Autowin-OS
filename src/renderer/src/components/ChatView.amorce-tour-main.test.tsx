// @vitest-environment happy-dom
/**
 * TRONCATURE À LA RÉOUVERTURE (conv-1376, « quand je suis retourné dans ma conversation »).
 *
 * Un tour initié CÔTÉ MAIN (scout de veille, tâche planifiée) sur une conversation NON ouverte amorce
 * un fil live pour que les patchs aient une cible. Cette amorce était écrite sur un cache VIDE : le
 * cache live devenait `[assistant streaming]`, alors qu'il fait AUTORITÉ à la réouverture
 * (`liveMessagesRef.current.get(id) ?? store`). Résultat : tout l'historique persisté disparaissait
 * de l'écran.
 *
 * Entrée qui doit faire échouer ce test si la correction est fausse : une conversation B qui possède
 * DÉJÀ un échange complet dans le store, jamais ouverte pendant la session, et qui reçoit un
 * événement pilote avant son premier clic. Si l'amorce n'est pas précédée d'une amorce du cache
 * depuis le store, « vieux message » et « vieille réponse » sont absents après le clic.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const stubs = [
  { id: 'A', title: 'Conversation A', category: 'codex', provider: 'codex', updatedAt: 3 },
  { id: 'B', title: 'Conversation B', category: 'codex', provider: 'codex', updatedAt: 2 }
]

const detail = (id: string): Record<string, unknown> =>
  id === 'B'
    ? {
        ...stubs[1],
        messages: [
          { role: 'user', content: 'vieux message', messageId: 'b1' },
          { role: 'assistant', content: 'vieille réponse', messageId: 'b2', done: true }
        ]
      }
    : { ...stubs[0], messages: [] }

describe('ChatView — tour initié côté main sur une conversation fermée', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null

  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('la réouverture garde l’historique du store (pas de fil tronqué à l’amorce)', async () => {
    let pilote!: (event: Record<string, unknown>) => void
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(stubs),
        conversation: vi.fn(async (id: string) => detail(id)),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )

    // B n'a jamais été ouverte : le main y démarre un tour.
    await act(async () =>
      pilote({ conversationId: 'B', kind: 'delta', text: 'je travaille', streamId: 's1' })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    // L'utilisateur revient dans B.
    const picks = h.container.querySelectorAll('.conv-pick')
    await act(async () => (picks[1] as HTMLElement).click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(h.container.textContent).toContain('vieux message')
    expect(h.container.textContent).toContain('vieille réponse')
    // Le tour en cours reste visible : l'amorce n'est pas perdue par la correction.
    expect(h.container.textContent).toContain('je travaille')
  })

  /*
   * LE TOUR EN VOL PERSISTÉ EST LA BULLE ADOPTÉE, PAS UNE AMORCE VIDE (conv-1146, 2026-10-25 :
   * « la conv m'affiche uniquement le bloc raisonnement vide, aucun suivi dans le chat », pendant un
   * run de 8 h). L'écran perd son état (fenêtre rechargée) pendant que le tour attend son
   * orchestration ; le premier battement reçu ensuite fait adopter le tour. L'adoption posait une
   * bulle VIDE et jetait du store le tour persisté NON CLOS — celui qui porte la réponse écrite et
   * l'action `orchestrate`. Les battements suivants visaient cette action, absente de la bulle vide :
   * plus rien ne s'affichait que le bloc Raisonnement vide, pendant tout le run.
   */
  it('adopte le tour persisté non clos : sa réponse et son action restent visibles', async () => {
    const turnId = 'ea65c2a0-857a-4d9d-a759-95031b9908f8'
    const enVol = {
      ...stubs[1],
      messages: [
        { role: 'user', content: 'full anglais', messageId: 'c1' },
        {
          role: 'assistant',
          content: '',
          messageId: 'c2',
          turnId,
          status: 'streaming',
          parts: [
            { kind: 'text', text: 'Aucune bascule de langue n’existe aujourd’hui.' },
            { kind: 'action', actionId: '0:0', name: 'orchestrate', args: { task: 'traduire' } }
          ]
        }
      ]
    }
    let pilote!: (event: Record<string, unknown>) => void
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(stubs),
        conversation: vi.fn(async (id: string) => (id === 'B' ? enVol : detail(id))),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )

    // Écran rechargé : le premier signe du tour est un battement de l'orchestration en cours.
    await act(async () =>
      pilote({
        conversationId: 'B',
        turnId,
        kind: 'action-progress',
        actionId: '0:0',
        text: '577 min 27 s · build · réfléchit…'
      })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    const picks = h.container.querySelectorAll('.conv-pick')
    await act(async () => (picks[1] as HTMLElement).click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(h.container.textContent).toContain('full anglais')
    expect(h.container.textContent).toContain('Aucune bascule de langue')
    // Une seule bulle de réponse : l'amorce vide ne s'ajoute pas sous le tour adopté.
    expect(h.container.querySelectorAll('.msg.assistant')).toHaveLength(1)
  })

  /*
   * MÊME DÉFAUT, AUTRE CHEMIN : UN BROUILLON RETIENT L'ÉCRAN AILLEURS (conv-1149, 2026-10-25,
   * reproduit dans une instance cachée). Au rechargement, la reprise vise le tour en vol, mais un
   * brouillon garde l'écran sur un autre fil ; le texte du tour est alors REJOUÉ depuis son journal
   * en une bulle « terminée », sans la demande ni l'action, et sans lire l'enregistrement qui les
   * porte. Le battement suivant ajoutait dessous une bulle vide : « Raisonnement 7 s », rien d'autre.
   */
  it('un brouillon ailleurs : le rejeu ne remplace pas le tour enregistré en vol', async () => {
    const turnId = 'tour-en-vol'
    localStorage.setItem('autowin.chat.derniereConversation', 'A')
    localStorage.setItem('autowin.chat.brouillons', JSON.stringify({ A: 'brouillon en cours' }))
    const enVol = {
      ...stubs[1],
      messages: [
        { role: 'user', content: 'full anglais', messageId: 'c1' },
        {
          role: 'assistant',
          content: '',
          messageId: 'c2',
          turnId,
          status: 'streaming',
          parts: [
            { kind: 'text', text: 'Je lance la vérification du typage.' },
            { kind: 'action', actionId: 'natif:0:0', name: 'verify', args: { type: 'typecheck' } }
          ]
        }
      ]
    }
    let pilote!: (event: Record<string, unknown>) => void
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(stubs),
        conversation: vi.fn(async (id: string) => (id === 'B' ? enVol : detail(id))),
        unfinishedTurns: vi
          .fn()
          .mockResolvedValue([{ conversationId: 'B', turnId, events: 4, updatedAt: Date.now() }]),
        turnJournal: vi.fn(async () => [
          { kind: 'delta', streamId: '0:0', text: 'Je lance la vérification du typage.' }
        ]),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    await act(async () =>
      pilote({
        conversationId: 'B',
        turnId,
        kind: 'action-progress',
        actionId: 'natif:0:0',
        text: '7 s · tsc --noEmit'
      })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const picks = h.container.querySelectorAll('.conv-pick')
    await act(async () => (picks[1] as HTMLElement).click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(h.container.textContent).toContain('full anglais')
    expect(h.container.textContent).toContain('Je lance la vérification du typage.')
    expect(h.container.querySelectorAll('.msg.assistant')).toHaveLength(1)
  })
})
