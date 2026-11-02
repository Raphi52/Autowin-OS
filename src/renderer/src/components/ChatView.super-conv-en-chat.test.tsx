// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { anciensPlansDuChef, plansPourLaListe, type PlanDeLots } from '../../../shared/plan-de-lots'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/*
 * conv-1315 (« quand je suis sur une conv chef ça doit l'afficher comme la vue mosaïque dans la vue
 * chat ») : en vue chat, un fil chef montre ce que montre sa case de mosaïque — un onglet par fil,
 * frise pleine sous l'onglet du chef, seule piste du lot sous l'onglet d'un lot. Le fil et la saisie
 * restent ceux du panneau de chat : c'est là, et là seulement, que vivent l'autorisation de
 * production, Ctrl+F, Reprendre et le dépôt de fichiers. Montage réel de ChatView.
 */
const MIN = 60_000
const T0 = Date.UTC(2026, 9, 30, 13, 0)

function planLance(surcharge: Partial<PlanDeLots> = {}): PlanDeLots {
  return {
    id: 'plan-1',
    chef: 'C',
    cle: 'k',
    titre: 'Super conv de test',
    parallele: 3,
    plafondTours: 6,
    toursLances: 3,
    statut: 'en-cours',
    avertissements: [],
    creeLe: T0,
    lots: [
      {
        rang: 1,
        titre: 'Lecture groupée',
        demande: 'x',
        fichiers: [],
        etat: 'fait',
        fil: 'L1',
        debut: T0,
        fin: T0 + 4 * MIN
      },
      {
        rang: 2,
        titre: 'Bouton Relancer',
        demande: 'x',
        fichiers: [],
        etat: 'en-cours',
        fil: 'L2',
        debut: T0
      },
      { rang: 3, titre: 'Rangement', demande: 'x', fichiers: [], etat: 'a-faire', apres: [2] }
    ],
    ...surcharge
  }
}

/** Le canal `os:plansDeLots` : mêmes règles que `planDuFil` et `plansPourLaListe` côté app. */
function apiDesPlans(plans: PlanDeLots[]): ReturnType<typeof vi.fn> {
  return vi.fn(async (geste: string, fil?: string) => {
    if (geste === 'tous') return { ok: true, plans: plansPourLaListe(plans) }
    if (geste === 'anciens') return { ok: true, anciens: anciensPlansDuChef(plans, fil ?? '') }
    if (geste !== 'voir') return { ok: true, detail: 'ok' }
    const mene = [...plans].reverse().find((p) => p.chef === fil)
    if (mene) return { ok: true, vue: { plan: mene, role: 'chef' } }
    for (const plan of [...plans].reverse()) {
      const lot = plan.lots.find((l) => l.fil === fil)
      if (lot) return { ok: true, vue: { plan, role: 'enfant', rang: lot.rang } }
    }
    return { ok: true, vue: null }
  })
}

const message = (texte: string): unknown[] => [{ role: 'user', content: texte, ts: 1 }]

const CONVS: Array<Record<string, unknown>> = [
  { ...conversation('C', message('message du chef')), title: 'Le fil chef' },
  { ...conversation('L1', message('message du lot un')), title: 'Lot 1/3 — Lecture' },
  { ...conversation('L2', message('message du lot deux')), title: 'Lot 2/3 — Bouton' },
  { ...conversation('X', message('message ordinaire')), title: 'Fil ordinaire' }
]

async function laisserFiler(): Promise<void> {
  for (let i = 0; i < 6; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

describe('ChatView — une conv chef en vue chat s’affiche comme dans la mosaïque', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  async function monter(plans: PlanDeLots[], fil: string): Promise<void> {
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(CONVS),
        conversation: vi.fn(async (id: string) => CONVS.find((c) => c.id === id)),
        plansDeLots: apiDesPlans(plans)
      })
    )
    await laisserFiler()
    await h.click(`.conv-item[data-conversation-id="${fil}"] .conv-pick`)
    await laisserFiler()
  }

  const trouver = (selecteur: string): HTMLElement | null =>
    h!.container.querySelector<HTMLElement>(selecteur)
  const filOuvert = (): string | null | undefined =>
    trouver('[data-testid="chat-runtime-conv"]')?.textContent

  it('le chef montre la frise pleine, sans aucun onglet, dans le vrai panneau de chat', async () => {
    await monter([planLance()], 'C')

    // conv-1387 : le bloc mène aux conv de lot, plus rien en haut de la fenêtre.
    expect(trouver('.scm-chat [role="tablist"]')).toBeNull()
    expect(trouver('.scm-chat [role="tab"]')).toBeNull()
    // Le chef est le point de départ : il n'a nulle part où revenir.
    expect(trouver('[data-testid="scm-retour"]')).toBeNull()
    expect(trouver('[data-testid="scm-frise"]')).not.toBeNull()
    expect(h!.container.querySelectorAll('.scm-piste')).toHaveLength(3)
    expect(trouver('[data-testid="scm-chiffre-faits"]')?.textContent).toContain('1/3')
    // Le panneau reste celui du chat : ni fenêtre de mosaïque, ni saisie de mosaïque.
    expect(trouver('.chat-mosaic-window')).toBeNull()
    expect(trouver('section.chat [data-testid="chat-runtime-identity"]')).not.toBeNull()
    expect(trouver('.chat-scroll')?.textContent).toContain('message du chef')
  })

  it('la frise remplace la liste des lots ; Arrêter reste à portée de clic', async () => {
    await monter([planLance()], 'C')

    const tableau = trouver('[data-testid="tableau-des-lots"]')
    expect(tableau).not.toBeNull()
    expect(tableau?.querySelector('.tdl-lots')).toBeNull()
    expect(tableau?.textContent).toContain('Arrêter')
  })

  it('la ligne d’un lot ouvre SA conv, avec sa seule piste ; Retour ramène au chef', async () => {
    await monter([planLance()], 'C')

    await h!.click('[data-testid="scm-piste-1"] .scm-nom')
    await laisserFiler()
    expect(filOuvert()).toBe('L1')
    expect(trouver('[data-testid="scm-frise"]')).toBeNull()
    expect(trouver('[data-testid="scm-piste-reduite"]')?.textContent).toContain('Lecture groupée')
    expect(trouver('.chat-scroll')?.textContent).toContain('message du lot un')
    // La piste dit déjà quel lot on regarde : pas de ligne « Lot 1/3 du plan ».
    expect(trouver('[data-testid="tableau-des-lots"]')).toBeNull()

    await h!.click('[data-testid="scm-retour"]')
    await laisserFiler()
    expect(filOuvert()).toBe('C')
    expect(trouver('[data-testid="scm-retour"]')).toBeNull()
    expect(trouver('[data-testid="scm-frise"]')).not.toBeNull()
  })

  it('un lot ouvert par un lien porte Retour, et la liste surligne son chef', async () => {
    await monter([planLance()], 'X')
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('autowin:open-conversation', { detail: { conversationId: 'L2' } })
      )
    })
    await laisserFiler()

    expect(filOuvert()).toBe('L2')
    expect(trouver('[data-testid="scm-retour"]')).not.toBeNull()
    expect(trouver('[data-testid="scm-piste-reduite"]')?.textContent).toContain('Bouton Relancer')
    // Le lot n'a pas de ligne (conv-1381) : c'est son chef qui dit où l'on est. Dédoublonné : un
    // fil récent a aussi sa ligne dans « Récent ».
    const surlignes = [...h!.container.querySelectorAll('.conv-list .conv-item.active')].map((l) =>
      l.getAttribute('data-conversation-id')
    )
    expect([...new Set(surlignes)]).toEqual(['C'])
  })

  it('un lot qui pose une question le montre sur sa ligne (conv-1381)', async () => {
    // Une question ouverte a l'assistant en dernier : une réponse de l'utilisateur la refermerait.
    const avecQuestion = CONVS.map((c) =>
      c.id === 'L1' ? { ...c, lastMessageRole: 'assistant', lastAssistantAsksUser: true } : c
    )
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(avecQuestion),
        conversation: vi.fn(async (id: string) => avecQuestion.find((c) => c.id === id)),
        plansDeLots: apiDesPlans([planLance()])
      })
    )
    await laisserFiler()
    await h.click('.conv-item[data-conversation-id="C"] .conv-pick')
    await laisserFiler()

    expect(trouver('[data-testid="scm-piste-1"] .conversation-state.is-asking')).not.toBeNull()
    expect(trouver('[data-testid="scm-piste-2"] .conversation-state.is-asking')).toBeNull()
  })

  it('un fil hors plan garde le chat ordinaire', async () => {
    await monter([planLance()], 'X')

    expect(trouver('.scm-chat')).toBeNull()
    expect(trouver('[data-testid="scm-frise"]')).toBeNull()
  })

  it('un chef dont aucun lot n’est parti garde son tableau complet, sans frise', async () => {
    const pasLance = planLance({
      statut: 'attente-accord',
      toursLances: 0,
      lots: planLance().lots.map((l) => ({
        rang: l.rang,
        titre: l.titre,
        demande: l.demande,
        fichiers: [],
        etat: 'a-faire'
      }))
    })
    await monter([pasLance], 'C')

    expect(trouver('.scm-chat')).toBeNull()
    expect(h!.container.querySelectorAll('.tdl-lot')).toHaveLength(3)
    expect(trouver('[data-testid="tableau-des-lots"]')?.textContent).toContain('Lancer le plan')
  })

  it('un lot d’un ANCIEN plan n’a plus de ligne : le bloc du chef l’ouvre, sans le bloc du plan récent (conv-1394)', async () => {
    const ancien = planLance({
      id: 'plan-ancien',
      statut: 'termine',
      lots: [{ ...planLance().lots[0], fil: 'X' }]
    })
    await monter([ancien, planLance()], 'C')

    expect(trouver('.conv-list [data-conversation-id="X"]')).toBeNull()
    await h!.click('[data-testid="scm-ancien-plan-ancien-1"] button')
    await laisserFiler()
    expect(filOuvert()).toBe('X')
    expect(trouver('.scm-chat')).toBeNull()
    expect(trouver('.tdl--enfant .tdl-fil')?.textContent).toBe('C')
  })

  it('Réduire replie la frise sans toucher au fil', async () => {
    await monter([planLance()], 'C')

    await h!.click('[data-testid="scm-reduire"]')
    expect(h!.container.querySelectorAll('.scm-piste')).toHaveLength(0)
    expect(trouver('.chat-scroll')?.textContent).toContain('message du chef')
  })

  it('Arrêter vise le plan affiché, depuis le panneau de chat', async () => {
    const plansDeLots = apiDesPlans([planLance()])
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(CONVS),
        conversation: vi.fn(async (id: string) => CONVS.find((c) => c.id === id)),
        plansDeLots
      })
    )
    await laisserFiler()
    await h.click('.conv-item[data-conversation-id="C"] .conv-pick')
    await laisserFiler()

    await h.click('[data-testid="tableau-des-lots"] .tdl-actions .tdl-bouton')
    expect(plansDeLots).toHaveBeenCalledWith('arreter', 'C', 'plan-1')
  })
})
