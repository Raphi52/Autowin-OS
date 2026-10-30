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
  const ongletActif = (): string | null | undefined =>
    trouver('.scm-onglet[aria-selected="true"]')?.textContent

  it('le chef montre onglets et frise pleine, dans le vrai panneau de chat', async () => {
    await monter([planLance()], 'C')

    // Comme un onglet de navigateur : le titre de la conv, pas un numéro (conv-1286). Le lot 3 n'a
    // pas encore de fil : son onglet annonce le titre que le fil recevra.
    expect([...h!.container.querySelectorAll('.scm-onglet')].map((o) => o.textContent)).toEqual([
      'Le fil chef',
      'Lot 1/3 — Lecture',
      'Lot 2/3 — Bouton',
      'Lot 3/3 — Rangement'
    ])
    expect(ongletActif()).toBe('Le fil chef')
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

  it('l’onglet d’un lot ouvre SON fil, avec sa seule piste ; Chef ramène d’un clic', async () => {
    await monter([planLance()], 'C')

    await h!.click('[data-testid="scm-onglet-1"]')
    await laisserFiler()
    expect(filOuvert()).toBe('L1')
    expect(ongletActif()).toBe('Lot 1/3 — Lecture')
    expect(trouver('[data-testid="scm-frise"]')).toBeNull()
    expect(trouver('[data-testid="scm-piste-reduite"]')?.textContent).toContain('Lecture groupée')
    expect(trouver('.chat-scroll')?.textContent).toContain('message du lot un')
    // L'onglet et la piste disent déjà quel lot on regarde : pas de ligne « Lot 1/3 du plan ».
    expect(trouver('[data-testid="tableau-des-lots"]')).toBeNull()

    await h!.click('[data-testid="scm-onglet-chef"]')
    await laisserFiler()
    expect(filOuvert()).toBe('C')
    expect(ongletActif()).toBe('Le fil chef')
    expect(trouver('[data-testid="scm-frise"]')).not.toBeNull()
  })

  it('cliquer le nom d’une piste ouvre l’onglet du lot, comme dans la mosaïque', async () => {
    await monter([planLance()], 'C')

    await h!.click('[data-testid="scm-piste-2"] .scm-nom')
    await laisserFiler()
    expect(filOuvert()).toBe('L2')
    expect(ongletActif()).toBe('Lot 2/3 — Bouton')
  })

  it('un lot ouvert depuis la liste porte les mêmes onglets', async () => {
    await monter([planLance()], 'L2')

    expect(ongletActif()).toBe('Lot 2/3 — Bouton')
    expect(trouver('[data-testid="scm-piste-reduite"]')?.textContent).toContain('Bouton Relancer')
  })

  it('un fil hors plan garde le chat ordinaire', async () => {
    await monter([planLance()], 'X')

    expect(trouver('.scm-onglets')).toBeNull()
    expect(trouver('[data-testid="scm-frise"]')).toBeNull()
  })

  it('un chef dont aucun lot n’est parti garde son tableau complet, sans onglets', async () => {
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

    expect(trouver('.scm-onglets')).toBeNull()
    expect(h!.container.querySelectorAll('.tdl-lot')).toHaveLength(3)
    expect(trouver('[data-testid="tableau-des-lots"]')?.textContent).toContain('Lancer le plan')
  })

  it('un lot d’un ANCIEN plan du chef garde sa ligne, sans les onglets du plan récent', async () => {
    const ancien = planLance({
      id: 'plan-ancien',
      statut: 'termine',
      lots: [{ ...planLance().lots[0], fil: 'X' }]
    })
    await monter([ancien, planLance()], 'X')

    expect(trouver('.scm-onglets')).toBeNull()
    expect(trouver('.tdl--enfant .tdl-fil')?.textContent).toBe('C')
  })

  it('Réduire replie la frise sans toucher au fil ni aux onglets', async () => {
    await monter([planLance()], 'C')

    await h!.click('[data-testid="scm-reduire"]')
    expect(h!.container.querySelectorAll('.scm-piste')).toHaveLength(0)
    expect(trouver('.scm-onglets')).not.toBeNull()
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
