// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { plansPourLaListe, type PlanDeLots } from '../../../shared/plan-de-lots'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * (/draft « un signe distinctif pour les super convs dans la liste de gauche »,
 * proposition retenue « 6 · Raccourci ») : la ligne d'un fil chef porte une pile, une jauge (un
 * segment par lot), le compte des lots finis et un raccourci « N ? » vers le lot qui attend ta
 * réponse. Un fil seul n'a rien de tout cela.
 */

const DOSSIER = 'D:/Projet'
const fil = (
  id: string,
  recence: number,
  etat: Record<string, unknown> = {}
): Record<string, unknown> => ({
  ...conversation(id),
  title: id,
  projectPath: DOSSIER,
  updatedAt: recence,
  lastUserMessageAt: recence,
  messageCount: 2,
  lastMessageRole: 'assistant',
  lastAssistantStatus: 'completed',
  ...etat
})

async function laisserFiler(): Promise<void> {
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

describe('ChatView — signe distinctif d’une super conv dans la liste', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  async function monter(): Promise<void> {
    // Un AUTRE fil ouvert au départ : sinon le chef, le plus récent, l'est déjà.
    window.localStorage.setItem('autowin.chat.derniereConversation', 'conv-seul')
    const convs = [
      fil('conv-chef', 50),
      fil('conv-seul', 40),
      fil('conv-l1', 30),
      fil('conv-l2', 20, { lastAssistantAsksUser: true })
    ]
    const plan = {
      id: 'plan-1',
      chef: 'conv-chef',
      titre: 'plan',
      statut: 'en-cours',
      lots: [
        { rang: 1, fil: 'conv-l1', etat: 'fait' },
        { rang: 2, fil: 'conv-l2', etat: 'en-cours' },
        { rang: 3, etat: 'a-faire' }
      ].map((l) => ({ ...l, titre: `lot ${l.rang}`, demande: '', fichiers: [] }))
    } as unknown as PlanDeLots
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(convs),
        conversation: vi.fn(async (id: string) => convs.find((c) => c.id === id)),
        plansDeLots: vi.fn(async (geste: string) =>
          geste === 'tous' ? { ok: true, plans: plansPourLaListe([plan]) } : { ok: true, vue: null }
        )
      })
    )
    await laisserFiler()
  }
  const ligne = (id: string): HTMLElement | null =>
    h!.container.querySelector<HTMLElement>(`.conv-list .conv-item[data-conversation-id="${id}"]`)

  it('le chef porte pile, jauge par lot, compte des finis et raccourci vers la question', async () => {
    await monter()
    const chef = ligne('conv-chef')
    expect(chef?.classList.contains('conv-item--super')).toBe(true)
    expect(chef?.querySelector('.conv-sc-pile')).not.toBeNull()
    const segments = [...(chef?.querySelectorAll('.conv-sc-seg') ?? [])].map((s) =>
      s.className.replace('conv-sc-seg ', '')
    )
    expect(segments).toEqual(['is-fini', 'is-question', 'is-afaire'])
    expect(chef?.querySelector('.conv-sc-compte')?.textContent).toBe('1/3')
    // Structure de la maquette choisie (« ça ressemble pas du tout ») : titre, « N ? »
    // puis « M/T » sur la ligne du titre, la jauge dessous.
    const raccourci = chef?.querySelector<HTMLElement>('.conv-sc-tete > .conv-sc-question')
    expect(raccourci?.textContent).toBe('2 ?')
    const compte = chef?.querySelector('.conv-sc-tete > .conv-sc-compte')
    expect(chef?.querySelector('.conv-sc-tete + .conv-sc-jauge')).not.toBeNull()
    expect(
      raccourci && compte
        ? raccourci.compareDocumentPosition(compte) & Node.DOCUMENT_POSITION_FOLLOWING
        : 0
    ).toBeTruthy()

    const ouvertures: unknown[] = []
    const ecouter = (e: Event): void => {
      ouvertures.push((e as CustomEvent).detail)
    }
    // Toute ouverture d'un fil passe par `loadConv`, qui le retient comme dernier fil ouvert.
    const ecritures = vi.spyOn(window.localStorage, 'setItem')
    const chefOuvert = (): number =>
      ecritures.mock.calls.filter(
        ([cle, valeur]) => cle === 'autowin.chat.derniereConversation' && valeur === 'conv-chef'
      ).length
    window.addEventListener('autowin:open-conversation', ecouter)
    await act(async () => raccourci?.click())
    window.removeEventListener('autowin:open-conversation', ecouter)
    expect(ouvertures).toEqual(['conv-l2'])
    // Le raccourci est DANS la ligne du chef : son clic ne doit pas ouvrir le chef en plus.
    await laisserFiler()
    expect(chefOuvert()).toBe(0)
  })

  it('un fil hors plan n’a ni pile, ni jauge, ni compte', async () => {
    await monter()
    const seul = ligne('conv-seul')
    expect(seul).not.toBeNull()
    expect(seul?.classList.contains('conv-item--super')).toBe(false)
    expect(
      seul?.querySelector('.conv-sc-pile, .conv-sc-jauge, .conv-sc-compte, .conv-sc-question')
    ).toBeNull()
  })
})
