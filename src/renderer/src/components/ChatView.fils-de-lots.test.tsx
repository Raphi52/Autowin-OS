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
 * Lot 5 du plan « Rendre la super conversation parfaite » (conv-1151, plan-ba5b7d4a, 2026-10-26) :
 * chaque lot d'un plan ouvre un fil « Lot N/M — … » qui se mêlait aux autres fils de la liste. Avec
 * plusieurs plans, on ne savait plus quel fil appartenait à quel chef.
 *
 * La liste range les fils d'un plan juste après leur fil chef, un cran plus à droite, avec un repère
 * « lot N/M ». Un fil hors plan ne bouge pas. Depuis conv-1158, elle lit TOUS les plans en un seul
 * appel `plansDeLots('tous')` — plus de repérage par le titre : un fil de lot renommé reste rangé,
 * et 1 000 fils coûtent un appel.
 */

const DOSSIER = 'D:/Projet'

type Lot = { rang: number; fil?: string }
type Plan = { id: string; chef: string; lots: Lot[] }

/** Un fil du dossier, plus récent quand `recence` est grand. */
const fil = (id: string, title: string, recence: number): Record<string, unknown> => ({
  ...conversation(id),
  title,
  projectPath: DOSSIER,
  updatedAt: recence,
  lastUserMessageAt: recence
})

/**
 * Le canal `os:plansDeLots` : « tous » passe par la VRAIE réduction de l'app (`plansPourLaListe`),
 * appliquée à des plans complets. « voir » ne sert qu'au tableau du fil ouvert (`TableauDesLots`).
 */
function apiDesPlans(plans: Plan[]): ReturnType<typeof vi.fn> {
  const complets = plans.map(
    (p) =>
      ({
        id: p.id,
        chef: p.chef,
        titre: p.id,
        statut: 'termine',
        lots: p.lots.map((l) => ({
          ...l,
          titre: `lot ${l.rang}`,
          etat: l.fil ? 'fait' : 'a-faire',
          demande: '',
          fichiers: []
        }))
      }) as unknown as PlanDeLots
  )
  return vi.fn(async (geste: string) => {
    if (geste === 'tous') return { ok: true, plans: plansPourLaListe(complets) }
    if (geste === 'voir') return { ok: true, vue: null }
    return { ok: false, erreur: 'geste inattendu dans ce test' }
  })
}

/** Laisse filer la lecture des plans et le rendu qui suit. */
async function laisserFiler(): Promise<void> {
  for (let i = 0; i < 5; i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
}

describe('ChatView — fils d’un plan de lots rangés sous leur fil chef', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  /** Les lignes du groupe du dossier (le dernier groupe : « Récent » le précède). */
  const lignesDuDossier = (): HTMLElement[] => {
    const groupes = [...h!.container.querySelectorAll<HTMLElement>('.conv-list .conv-group')]
    const lignes: HTMLElement[] = []
    let el = groupes[groupes.length - 1]?.nextElementSibling as HTMLElement | null
    while (el && el.classList.contains('conv-item')) {
      lignes.push(el)
      el = el.nextElementSibling as HTMLElement | null
    }
    return lignes
  }
  const ids = (lignes: HTMLElement[]): string[] =>
    lignes.map((l) => l.getAttribute('data-conversation-id') ?? '?')
  /** Les lectures groupées « tous » : celles de la LISTE. */
  const lecturesGroupees = (espion: ReturnType<typeof vi.fn>): number =>
    espion.mock.calls.filter((appel) => appel[0] === 'tous').length
  /**
   * Les « voir » qui ne viennent pas du tableau du fil OUVERT (`TableauDesLots`, un appel quelle
   * que soit la longueur de la liste) : la liste n'en fait plus aucun.
   */
  const voirDeLaListe = (espion: ReturnType<typeof vi.fn>): string[] => {
    const ouvert = h!.container
      .querySelector('.conv-list .conv-item.active')
      ?.getAttribute('data-conversation-id')
    return espion.mock.calls
      .filter((appel) => appel[0] === 'voir')
      .map((appel) => String(appel[1]))
      .filter((f) => f !== ouvert)
  }

  it('range les lots juste après leur chef, indentés et marqués « lot N/M » ; le reste ne bouge pas', async () => {
    // Ordre par récence : X1, L2, X2, C1, L1, X3. Les lots L1 et L2 sont séparés de leur chef.
    const convs = [
      fil('X1', 'Ordinaire 1', 90),
      fil('L2', 'Lot 2/3 — Deuxième', 80),
      fil('X2', 'Ordinaire 2', 70),
      fil('C1', 'Le fil chef', 60),
      fil('L1', 'Lot 1/3 — Premier', 50),
      fil('X3', 'Ordinaire 3', 40)
    ]
    const plansDeLots = apiDesPlans([
      {
        id: 'plan-a',
        chef: 'C1',
        // Le lot 3 n'est pas encore ouvert : il compte dans le total, sans fil à ranger.
        lots: [{ rang: 1, fil: 'L1' }, { rang: 2, fil: 'L2' }, { rang: 3 }]
      }
    ])
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(convs),
        conversation: vi.fn(async (id: string) => convs.find((c) => c.id === id)),
        plansDeLots
      })
    )
    await laisserFiler()

    const lignes = lignesDuDossier()
    expect(ids(lignes)).toEqual(['X1', 'X2', 'C1', 'L1', 'L2', 'X3'])
    const parId = new Map(lignes.map((l) => [l.getAttribute('data-conversation-id'), l]))
    // Indentés d'un cran (14 px) sous le chef ; le chef et les fils hors plan restent au bord.
    expect(parId.get('L1')!.style.marginLeft).toBe('14px')
    expect(parId.get('L2')!.style.marginLeft).toBe('14px')
    for (const id of ['X1', 'X2', 'C1', 'X3']) expect(parId.get(id)!.style.marginLeft).toBe('0px')
    // Le repère vient du plan (rang et total, lot 3 non ouvert compris), pas du titre.
    expect(parId.get('L1')!.getAttribute('data-lot')).toBe('lot 1/3')
    expect(parId.get('L2')!.querySelector('.conv-lot')?.textContent).toBe('lot 2/3')
    expect(parId.get('C1')!.getAttribute('data-lot')).toBeNull()
    expect(parId.get('X1')!.querySelector('.conv-lot')).toBeNull()
    expect(lecturesGroupees(plansDeLots)).toBe(1)
    expect(voirDeLaListe(plansDeLots)).toEqual([])
  })

  it('un fil de lot RENOMMÉ reste rangé sous son chef ; un faux « Lot » hors plan ne bouge pas', async () => {
    const convs = [
      fil('X1', 'Ordinaire 1', 90),
      fil('F1', 'Lot 1/1 — Un titre choisi à la main', 80),
      fil('R1', 'Titre changé par l’utilisateur', 70),
      fil('C1', 'Le fil chef', 60)
    ]
    const plansDeLots = apiDesPlans([{ id: 'plan-a', chef: 'C1', lots: [{ rang: 1, fil: 'R1' }] }])
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(convs),
        conversation: vi.fn(async (id: string) => convs.find((c) => c.id === id)),
        plansDeLots
      })
    )
    await laisserFiler()

    const lignes = lignesDuDossier()
    expect(ids(lignes)).toEqual(['X1', 'F1', 'C1', 'R1'])
    const parId = new Map(lignes.map((l) => [l.getAttribute('data-conversation-id'), l]))
    expect(parId.get('R1')!.getAttribute('data-lot')).toBe('lot 1/1')
    expect(parId.get('R1')!.style.marginLeft).toBe('14px')
    expect(parId.get('F1')!.hasAttribute('data-lot')).toBe(false)
    expect(parId.get('F1')!.style.marginLeft).toBe('0px')
    expect(lecturesGroupees(plansDeLots)).toBe(1)
  })

  it('mesure : 1 000 fils et deux plans → UN appel « tous » ; un événement de plan → un de plus', async () => {
    const convs: Array<Record<string, unknown>> = []
    for (let i = 0; i < 994; i++) convs.push(fil(`N${i}`, `Ordinaire ${i}`, 10_000 - i))
    for (let rang = 1; rang <= 3; rang++) {
      convs.push(fil(`A${rang}`, `Lot ${rang}/3 — Plan A`, 5_000 - rang))
      convs.push(fil(`B${rang}`, `Lot ${rang}/3 — Plan B`, 4_000 - rang))
    }
    expect(convs).toHaveLength(1_000)
    const plansDeLots = apiDesPlans([
      { id: 'plan-a', chef: 'N10', lots: [1, 2, 3].map((rang) => ({ rang, fil: `A${rang}` })) },
      { id: 'plan-b', chef: 'N20', lots: [1, 2, 3].map((rang) => ({ rang, fil: `B${rang}` })) }
    ])
    const abonnes: Array<(e: Record<string, unknown>) => void> = []
    h = await mountChat(
      chatApi({
        conversations: vi.fn(async () => convs.map((c) => ({ ...c }))),
        conversation: vi.fn(async (id: string) => convs.find((c) => c.id === id)),
        plansDeLots,
        onAppEvent: vi.fn((rappel: (e: Record<string, unknown>) => void) => {
          abonnes.push(rappel)
          return vi.fn()
        })
      })
    )
    await laisserFiler()

    expect(lecturesGroupees(plansDeLots)).toBe(1)
    expect(voirDeLaListe(plansDeLots)).toEqual([])
    // Un rafraîchissement de la LISTE ne relit pas les plans.
    await act(async () => {
      for (const rappel of abonnes) rappel({ type: 'refresh', scope: 'conversations' })
    })
    await laisserFiler()
    expect(lecturesGroupees(plansDeLots)).toBe(1)
    // Un changement de PLAN les relit, en un seul appel.
    await act(async () => {
      for (const rappel of abonnes) rappel({ type: 'refresh', scope: 'plans-de-lots' })
    })
    await laisserFiler()
    expect(lecturesGroupees(plansDeLots)).toBe(2)
    expect(voirDeLaListe(plansDeLots)).toEqual([])
    const ordre = ids(lignesDuDossier())
    const apres = (chef: string): string[] =>
      ordre.slice(ordre.indexOf(chef) + 1, ordre.indexOf(chef) + 4)
    expect(apres('N10')).toEqual(['A1', 'A2', 'A3'])
    expect(apres('N20')).toEqual(['B1', 'B2', 'B3'])
  }, 60_000)
})
