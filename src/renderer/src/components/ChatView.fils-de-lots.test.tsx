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
 * Lot 5 du plan « Rendre la super conversation parfaite » (plan-ba5b7d4a, 2026-10-26) :
 * chaque lot d'un plan ouvre un fil « Lot N/M — … » qui se mêlait aux autres fils de la liste. Avec
 * plusieurs plans, on ne savait plus quel fil appartenait à quel chef.
 *
 * La liste range les fils d'un plan juste après leur fil chef, un cran plus à droite, avec un repère
 * « lot N/M ». Un fil hors plan ne bouge pas. Elle lit TOUS les plans en un seul
 * appel `plansDeLots('tous')` — plus de repérage par le titre : un fil de lot renommé reste rangé,
 * et 1 000 fils coûtent un appel.
 *
 * (« les conv de lot ne les affiche pas dans cette liste, on y accède que par les
 * onglets »), un lot qui a son onglet n'a plus de ligne. (« masque aussi les lots
 * des anciens plans d'un même chef, et rends-les accessibles depuis le bloc de la conv chef »), un
 * lot d'un ancien plan non plus : le bloc du chef les liste. Seul un lot dont le chef a disparu garde
 * sa ligne. Le rangement sous le chef ne sert plus qu'aux résultats de recherche. Le spinner du chef
 * répond de ses lots masqués.
 */

const DOSSIER = 'D:/Projet'

type Lot = { rang: number; fil?: string }
type Plan = { id: string; chef: string; lots: Lot[]; statut?: string }

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
        statut: p.statut ?? 'termine',
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

  /** Monte la liste sur ces fils et ces plans, plans lus. */
  async function monter(
    convs: Array<Record<string, unknown>>,
    plans: Plan[]
  ): Promise<ReturnType<typeof vi.fn>> {
    const plansDeLots = apiDesPlans(plans)
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue(convs),
        conversation: vi.fn(async (id: string) => convs.find((c) => c.id === id)),
        plansDeLots
      })
    )
    await laisserFiler()
    return plansDeLots
  }
  const etatDe = (id: string): string | null | undefined =>
    h!.container
      .querySelector(`.conv-item[data-conversation-id="${id}"] [data-conversation-state]`)
      ?.getAttribute('data-conversation-state')

  it('un lot qui a son onglet n’a plus de ligne ; le reste ne bouge pas (conv-1381)', async () => {
    // Ordre par récence : X1, L2, X2, C1, L1, X3. Le lot 3 n'est pas ouvert : rien à masquer.
    const plansDeLots = await monter(
      [
        fil('X1', 'Ordinaire 1', 90),
        fil('L2', 'Lot 2/3 — Deuxième', 80),
        fil('X2', 'Ordinaire 2', 70),
        fil('C1', 'Le fil chef', 60),
        fil('L1', 'Lot 1/3 — Premier', 50),
        fil('X3', 'Ordinaire 3', 40)
      ],
      [
        {
          id: 'plan-a',
          chef: 'C1',
          lots: [{ rang: 1, fil: 'L1' }, { rang: 2, fil: 'L2' }, { rang: 3 }]
        }
      ]
    )

    const lignes = lignesDuDossier()
    expect(ids(lignes)).toEqual(['X1', 'X2', 'C1', 'X3'])
    for (const ligne of lignes) expect(ligne.style.marginLeft).toBe('0px')
    expect(h!.container.querySelector('.conv-lot')).toBeNull()
    // Ni dans « Récent », ni dans le compteur du dossier : 4 lignes, 4 annoncées.
    expect(h!.container.querySelector('.conv-list [data-conversation-id="L1"]')).toBeNull()
    expect(h!.container.querySelector('.conv-list [data-conversation-id="L2"]')).toBeNull()
    const compteurs = [...h!.container.querySelectorAll('.conv-list .conv-group-count')]
    expect(compteurs[compteurs.length - 1]?.textContent).toBe('4')
    expect(lecturesGroupees(plansDeLots)).toBe(1)
    expect(voirDeLaListe(plansDeLots)).toEqual([])
  })

  it('un fil de lot RENOMMÉ reste masqué ; un faux « Lot » hors plan garde sa ligne', async () => {
    await monter(
      [
        fil('X1', 'Ordinaire 1', 90),
        fil('F1', 'Lot 1/1 — Un titre choisi à la main', 80),
        fil('R1', 'Titre changé par l’utilisateur', 70),
        fil('C1', 'Le fil chef', 60)
      ],
      [{ id: 'plan-a', chef: 'C1', lots: [{ rang: 1, fil: 'R1' }] }]
    )

    const lignes = lignesDuDossier()
    expect(ids(lignes)).toEqual(['X1', 'F1', 'C1'])
    expect(lignes[1].hasAttribute('data-lot')).toBe(false)
  })

  it('un lot d’un ANCIEN plan n’a plus de ligne non plus : le bloc du chef y mène (conv-1394)', async () => {
    await monter(
      [
        fil('C1', 'Le fil chef', 90),
        fil('N1', 'Lot 1/1 — Plan récent', 80),
        fil('A1', 'Lot 1/2 — Ancien plan', 70),
        fil('X1', 'Ordinaire', 60),
        fil('A2', 'Lot 2/2 — Ancien plan', 50)
      ],
      [
        {
          id: 'plan-ancien',
          chef: 'C1',
          lots: [
            { rang: 1, fil: 'A1' },
            { rang: 2, fil: 'A2' }
          ]
        },
        { id: 'plan-recent', chef: 'C1', lots: [{ rang: 1, fil: 'N1' }] }
      ]
    )

    expect(ids(lignesDuDossier())).toEqual(['C1', 'X1'])
    const compteurs = [...h!.container.querySelectorAll('.conv-list .conv-group-count')]
    expect(compteurs[compteurs.length - 1]?.textContent).toBe('2')
  })

  it('un lot masqué aussi quand son chef montre un plan neuf, encore sans fil ouvert', async () => {
    await monter(
      [fil('C1', 'Le fil chef', 90), fil('A1', 'Lot 1/1 — Plan précédent', 80)],
      [
        { id: 'plan-avant', chef: 'C1', lots: [{ rang: 1, fil: 'A1' }] },
        { id: 'plan-neuf', chef: 'C1', statut: 'attente-accord', lots: [{ rang: 1 }] }
      ]
    )

    expect(ids(lignesDuDossier())).toEqual(['C1'])
  })

  it('un lot dont le chef a disparu garde sa ligne : aucun onglet ne mènerait à lui', async () => {
    await monter(
      [fil('X1', 'Ordinaire', 90), fil('L1', 'Lot 1/1 — Orphelin', 80)],
      [{ id: 'plan-a', chef: 'supprime', lots: [{ rang: 1, fil: 'L1' }] }]
    )

    expect(ids(lignesDuDossier())).toEqual(['X1', 'L1'])
  })

  it('une recherche retrouve un lot : chercher, c’est vouloir voir', async () => {
    await monter(
      [fil('C1', 'Le fil chef', 90), fil('L1', 'Lot 1/1 — Bouton Relancer', 80)],
      [{ id: 'plan-a', chef: 'C1', lots: [{ rang: 1, fil: 'L1' }] }]
    )
    expect(ids(lignesDuDossier())).toEqual(['C1'])

    const champ = h!.container.querySelector('.conv-search input') as HTMLInputElement
    const poserValeur = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      poserValeur?.call(champ, 'Relancer')
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await laisserFiler()

    expect(
      h!.container.querySelector('.conv-list [data-conversation-id="L1"]')?.getAttribute('data-lot')
    ).toBe('lot 1/1')
  })

  it('le chef garde son spinner tant qu’un de ses lots masqués tourne', async () => {
    const repos = { messages: [{ role: 'assistant', content: 'fini', ts: 1 }] }
    await monter(
      [
        { ...fil('C1', 'Chef au repos, lot actif', 90), ...repos },
        { ...fil('C2', 'Chef au repos, lots au repos', 80), ...repos },
        { ...fil('L1', 'Lot 1/2', 70), ...repos },
        { ...fil('L2', 'Lot 2/2', 60), ...repos, hasStreamingTurn: true },
        { ...fil('M1', 'Lot 1/1', 50), ...repos }
      ],
      [
        {
          id: 'plan-a',
          chef: 'C1',
          lots: [
            { rang: 1, fil: 'L1' },
            { rang: 2, fil: 'L2' }
          ]
        },
        { id: 'plan-b', chef: 'C2', lots: [{ rang: 1, fil: 'M1' }] }
      ]
    )

    expect(etatDe('C1')).toBe('running')
    expect(etatDe('C2')).not.toBe('running')
  })

  it('une question de lot met l’animation de question sur le chef, devant le spinner', async () => {
    const repos = { messages: [{ role: 'assistant', content: 'fini', ts: 1 }] }
    await monter(
      [
        { ...fil('C1', 'Chef au repos', 90), ...repos },
        { ...fil('L1', 'Lot 1/2', 80), ...repos, lastAssistantAsksUser: true },
        { ...fil('L2', 'Lot 2/2', 70), ...repos, hasStreamingTurn: true }
      ],
      [
        {
          id: 'plan-a',
          chef: 'C1',
          lots: [
            { rang: 1, fil: 'L1' },
            { rang: 2, fil: 'L2' }
          ]
        }
      ]
    )

    expect(etatDe('C1')).toBe('asking')
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
    expect(ordre).toHaveLength(994)
    expect(ordre).toContain('N10')
    expect(ordre).not.toContain('A1')
    expect(ordre).not.toContain('B3')
  }, 60_000)

  /** Laisse filer les lectures et le rendu, sans avancer les minuteurs de la liste. */
  async function attendreSansMinuteur(): Promise<void> {
    for (let i = 0; i < 5; i++)
      await act(async () => {
        await new Promise((fin) => setImmediate(fin))
      })
  }

  /**
   * Joue les tranches : la liste n'avance que par minuteur, un à 0 ms par tranche. Sans ce pas, elle
   * reste à sa première fenêtre.
   */
  async function jouerLesTranches(): Promise<void> {
    for (let tour = 0; tour < 10; tour += 1) {
      await act(async () => {
        vi.advanceTimersByTime(0)
      })
      await attendreSansMinuteur()
    }
  }

  /** Tape `texte` dans la recherche de la liste, comme le ferait l'utilisateur. */
  async function chercher(texte: string): Promise<void> {
    const champ = h!.container.querySelector('.conv-search input') as HTMLInputElement
    const poserValeur = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    await act(async () => {
      poserValeur?.call(champ, texte)
      champ.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  /** La ligne d'un fil dans la liste, ou null tant qu'elle n'est pas posée. */
  const ligneDe = (id: string): HTMLElement | null =>
    h!.container.querySelector<HTMLElement>(`.conv-list .conv-item[data-conversation-id="${id}"]`)

  /**
   * Hors recherche, un lot dont le chef existe a son onglet et n'a pas de ligne : c'est la recherche
   * qui montre le rangement sous le chef, lots compris. Jumeau de la fenêtre : ici tout tient dans le
   * premier passage, sans aucune tranche.
   */
  it('une recherche range le chef et ses lots sous lui, dans la première fenêtre', async () => {
    await monter(
      [
        fil('X0', 'Projet ordinaire', 90),
        fil('C1', 'Projet — le fil chef', 80),
        fil('X1', 'Projet ordinaire suivant', 70),
        fil('L1', 'Lot 1/2 — Projet premier', 60),
        fil('L2', 'Lot 2/2 — Projet second', 50)
      ],
      [
        {
          id: 'plan-a',
          chef: 'C1',
          lots: [
            { rang: 1, fil: 'L1' },
            { rang: 2, fil: 'L2' }
          ]
        }
      ]
    )
    expect(ids(lignesDuDossier())).toEqual(['X0', 'C1', 'X1'])

    await chercher('Projet')
    await laisserFiler()

    expect(ids(lignesDuDossier())).toEqual(['X0', 'C1', 'L1', 'L2', 'X1'])
    expect(ligneDe('L1')?.getAttribute('data-lot')).toBe('lot 1/2')
    expect(ligneDe('L2')?.getAttribute('data-lot')).toBe('lot 2/2')
    expect(parseFloat(ligneDe('L1')!.style.marginLeft)).toBeGreaterThan(
      parseFloat(ligneDe('C1')!.style.marginLeft)
    )
  })

  /**
   * LE RANGEMENT TIENT AU-DELÀ DE LA PREMIÈRE FENÊTRE. Une recherche sur 64 fils : le chef et ses deux
   * lots sont passés la 40e ligne, donc absents du premier passage ; la tranche suivante les pose,
   * rangés sous leur chef. ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : un rangement qui ne met plus les
   * lots sous leur chef, ou une liste qui ne dessine jamais un lot au-delà de la fenêtre.
   */
  it('une recherche sur 64 fils : chef et lots, passés la 40e ligne, se rangent sous lui après la tranche', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      const convs = [
        ...Array.from({ length: 60 }, (_, i) => fil(`P${i}`, `Projet ordinaire ${i}`, 1_000 - i)),
        fil('C1', 'Projet — le fil chef', 100),
        fil('X1', 'Projet ordinaire après le chef', 99),
        fil('L1', 'Lot 1/2 — Projet premier', 98),
        fil('L2', 'Lot 2/2 — Projet second', 97)
      ]
      const plansDeLots = apiDesPlans([
        {
          id: 'plan-a',
          chef: 'C1',
          lots: [
            { rang: 1, fil: 'L1' },
            { rang: 2, fil: 'L2' }
          ]
        }
      ])
      h = await mountChat(
        chatApi({
          conversations: vi.fn().mockResolvedValue(convs),
          conversation: vi.fn(async (id: string) => convs.find((c) => c.id === id)),
          plansDeLots
        })
      )
      await attendreSansMinuteur()
      await chercher('Projet')
      await attendreSansMinuteur()

      // Premier passage : la fenêtre ne pose que ses premières lignes, ni le chef ni ses lots.
      expect(ligneDe('C1')).toBeNull()
      expect(ligneDe('L1')).toBeNull()

      await jouerLesTranches()
      expect(ids(lignesDuDossier()).slice(-4)).toEqual(['C1', 'L1', 'L2', 'X1'])
      expect(ligneDe('L1')?.getAttribute('data-lot')).toBe('lot 1/2')
      expect(ligneDe('L2')?.getAttribute('data-lot')).toBe('lot 2/2')
      expect(parseFloat(ligneDe('L1')!.style.marginLeft)).toBeGreaterThan(
        parseFloat(ligneDe('C1')!.style.marginLeft)
      )
    } finally {
      vi.useRealTimers()
    }
  }, 60_000)
})
