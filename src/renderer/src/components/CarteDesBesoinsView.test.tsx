// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CarteDesBesoinsView, PAQUET } from './CarteDesBesoinsView'
import { reclamerOuvertureConversation } from './pending-conversation-open'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte,
  StatutDemande
} from '../../../shared/carte-des-besoins'

/**
 * VUE « BESOINS » (conv-1089, 2026-10-22). ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : tous les projets
 * dépliés d'office (4 065 lignes rendues d'un bloc), un projet qui rend toutes ses demandes sans
 * paquet, un filtre qui laisse passer les autres états, un clic sur un fil qui n'ouvre rien quand le
 * chat n'est pas encore monté, une panne du calcul rendue comme une carte vide.
 */

const demande = (
  conversationId: string,
  rang: number,
  statut: StatutDemande,
  titre = `demande ${conversationId}-${rang}`
): DemandeDeLaCarte => ({
  conversationId,
  conversationTitre: `Fil ${conversationId}`,
  rang,
  titre,
  statut,
  constat: statut === 'prouve' ? 'npm test → exit 0' : 'fini sans vérification',
  debut: 1_790_000_000_000 - rang
})

function comptes(demandes: DemandeDeLaCarte[]): Record<StatutDemande, number> {
  const c = { prouve: 0, refuse: 0, 'en-cours': 0, 'sans-preuve': 0 }
  for (const d of demandes) c[d.statut] += 1
  return c
}

const projet = (cle: string, demandes: DemandeDeLaCarte[], extra: Partial<ProjetDeLaCarte> = {}) =>
  ({
    cle,
    libelle: cle,
    nature: 'dossier',
    conversations: new Set(demandes.map((d) => d.conversationId)).size,
    demandes,
    runsBloques: [],
    comptes: comptes(demandes),
    derniereActivite: 1_790_000_000_000,
    ...extra
  }) as ProjetDeLaCarte

function carte(projets: ProjetDeLaCarte[], extra: Partial<CarteDesBesoins> = {}): CarteDesBesoins {
  const toutes = projets.flatMap((p) => p.demandes)
  return {
    projets,
    comptes: comptes(toutes),
    demandes: toutes.length,
    runsBloques: projets.reduce((n, p) => n + p.runsBloques.length, 0),
    conversationsLues: 12,
    demandeurs: [],
    demandesJournalisees: 0,
    calculeeA: 1_790_000_000_000,
    dureeMs: 7,
    ...extra
  }
}

describe('CarteDesBesoinsView', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  const montes: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
  afterEach(async () => {
    for (const m of montes.splice(0)) {
      await act(async () => m.root.unmount())
      m.el.remove()
    }
    reclamerOuvertureConversation()
  })

  async function monter(
    source: () => Promise<CarteDesBesoins>,
    onOpenConversation = vi.fn()
  ): Promise<{ el: HTMLDivElement; onOpenConversation: typeof onOpenConversation }> {
    ;(window as unknown as { api: unknown }).api = { carteDesBesoins: vi.fn(source) }
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    await act(async () =>
      root.render(createElement(CarteDesBesoinsView, { active: true, onOpenConversation }))
    )
    return { el, onOpenConversation }
  }

  const lignes = (el: HTMLElement, cle: string): HTMLElement[] => [
    ...el.querySelectorAll<HTMLElement>(`[data-cle="${cle}"] [data-testid="besoins-demande"]`)
  ]

  it('seul le projet le plus récent est déplié, et il rend ses demandes par paquets', async () => {
    const beaucoup = Array.from({ length: PAQUET + 5 }, (_, i) =>
      demande('a', i, i % 2 ? 'prouve' : 'sans-preuve')
    )
    const { el } = await monter(async () =>
      carte([projet('AutoWinOS', beaucoup), projet('Contoso', [demande('b', 0, 'refuse')])])
    )
    const blocs = [...el.querySelectorAll<HTMLDetailsElement>('[data-testid="besoins-projet"]')]
    expect(blocs.map((b) => [b.dataset.cle, b.open])).toEqual([
      ['AutoWinOS', true],
      ['Contoso', false]
    ])
    expect(lignes(el, 'AutoWinOS')).toHaveLength(PAQUET)
    expect(lignes(el, 'Contoso')).toHaveLength(0)
    const plus = el.querySelector<HTMLButtonElement>('[data-testid="besoins-plus"]')!
    expect(plus.textContent).toBe('Afficher 5 de plus · 5 restantes')
    await act(async () => plus.click())
    expect(lignes(el, 'AutoWinOS')).toHaveLength(PAQUET + 5)
    expect(el.querySelector('[data-testid="besoins-plus"]')).toBeNull()
    expect(el.querySelector('[data-testid="besoins-stats"]')?.textContent).toContain(
      `${PAQUET + 6} demandes`
    )
  })

  it('le filtre ne garde que l’état choisi, et masque les projets qui n’en ont aucun', async () => {
    const { el } = await monter(async () =>
      carte([
        projet('P1', [demande('a', 0, 'prouve'), demande('a', 1, 'refuse', 'le bouton casse')]),
        projet('P2', [demande('b', 0, 'prouve')])
      ])
    )
    await act(async () =>
      el.querySelector<HTMLButtonElement>('[data-testid="besoins-filtre-refuse"]')!.click()
    )
    const blocs = [...el.querySelectorAll<HTMLElement>('[data-testid="besoins-projet"]')]
    expect(blocs.map((b) => b.dataset.cle)).toEqual(['P1'])
    expect(
      lignes(el, 'P1').map((l) => [l.dataset.statut, l.querySelector('b')?.textContent])
    ).toEqual([['refuse', 'le bouton casse']])
  })

  it('un clic sur le fil l’ouvre, même si le chat n’est pas encore monté', async () => {
    const { el, onOpenConversation } = await monter(async () =>
      carte([projet('P1', [demande('conv-7', 0, 'prouve')])])
    )
    const fil = el.querySelector<HTMLButtonElement>('[data-testid="besoins-demande"] .besoins-fil')!
    expect(fil.textContent).toBe('Fil conv-7')
    await act(async () => fil.click())
    expect(onOpenConversation).toHaveBeenCalledWith({ conversationId: 'conv-7' })
    expect(reclamerOuvertureConversation()).toBe('conv-7')
  })

  it('montre les runs bloqués du projet et dit quand leur liste est partielle', async () => {
    const { el } = await monter(async () =>
      carte(
        [
          projet('P1', [demande('a', 0, 'refuse')], {
            runsBloques: [
              {
                sujet: 'traite-ensemble-8-candidats',
                statut: 'red',
                chemin: 'C:/runs/x/RUN.md',
                mtime: 1_790_000_000_000,
                conversationId: 'a',
                conversationTitre: 'Fil a'
              }
            ]
          })
        ],
        { runsNonExamines: 1122 }
      )
    )
    expect(el.querySelector('[data-testid="besoins-projet-runs"]')?.textContent).toBe(
      '1 run bloqué'
    )
    expect(el.querySelector('[data-testid="besoins-run"]')?.textContent).toContain(
      'traite-ensemble-8-candidats'
    )
    expect(el.querySelector('[data-testid="besoins-pied"]')?.textContent).toContain(
      '1122 RUN.md non examinés'
    )
  })

  it('accorde chaque compte : « 1 prouvée », « 2 refusées », « 1 run bloqué »', async () => {
    const { el } = await monter(async () =>
      carte([
        projet(
          'P1',
          [demande('a', 0, 'prouve'), demande('a', 1, 'refuse'), demande('a', 2, 'refuse')],
          {
            runsBloques: [
              {
                sujet: 'x',
                statut: 'red',
                chemin: 'C:/runs/x/RUN.md',
                mtime: 1,
                conversationId: 'a'
              }
            ]
          }
        )
      ])
    )
    const resume = el.querySelector('[data-testid="besoins-projet"] summary')?.textContent ?? ''
    expect(resume).toContain('3 demandes')
    expect(resume).toContain('1 prouvée')
    expect(resume).not.toContain('1 prouvées')
    expect(resume).toContain('2 refusées')
    const stats = el.querySelector('[data-testid="besoins-stats"]')?.textContent ?? ''
    expect(stats).toContain('1 prouvée')
    expect(stats).toContain('1 run bloqué')
    expect(stats).not.toContain('1 runs')
  })

  it('un groupe fait seulement de runs bloqués ne montre pas de comptes à zéro', async () => {
    const { el } = await monter(async () =>
      carte([
        projet('divers', [], {
          conversations: 0,
          runsBloques: [{ sujet: 'orphelin', statut: 'red', chemin: 'C:/runs/o/RUN.md', mtime: 1 }]
        })
      ])
    )
    const resume = el.querySelector('[data-testid="besoins-projet"] summary')?.textContent ?? ''
    expect(resume).toContain('aucune demande')
    expect(resume).toContain('1 run bloqué')
    for (const zero of ['0 demande', '0 prouvée', '0 fil']) expect(resume).not.toContain(zero)
    expect(el.querySelector('[data-testid="besoins-run"]')?.textContent).toContain('sans fil connu')
  })

  it('une panne du calcul est dite, pas rendue comme une carte vide', async () => {
    const { el } = await monter(async () => {
      throw new Error('store illisible')
    })
    expect(el.querySelector('[data-testid="besoins-erreur"]')?.textContent).toBe(
      'Carte impossible à calculer : store illisible'
    )
    expect(el.querySelector('[data-testid="besoins-stats"]')).toBeNull()
  })
  it('lot 2 — montre qui a prompté (relevé ou déduit), ce que l’agent a déclaré, et filtre par personne', async () => {
    const releve: DemandeDeLaCarte = {
      ...demande('conv-1', 1, 'prouve', 'Ajoute le filtre'),
      demandeur: {
        cle: 'a@exemple.test',
        nom: 'Personne A',
        email: 'a@exemple.test',
        origine: 'journal'
      },
      besoin: { nature: 'suite', de: 'conv-9' }
    }
    const deduit: DemandeDeLaCarte = {
      ...demande('conv-2', 2, 'sans-preuve', 'Vieille demande'),
      demandeur: { cle: 'b@exemple.test', nom: 'Personne B', origine: 'git-du-dossier' }
    }
    const inconnu = demande('conv-3', 3, 'sans-preuve', 'Sans identité')
    const { el, onOpenConversation } = await monter(async () =>
      carte([projet('D:/depot', [releve, deduit, inconnu])], {
        demandeurs: [
          { cle: 'a@exemple.test', nom: 'Personne A', email: 'a@exemple.test', demandes: 1 },
          { cle: 'b@exemple.test', nom: 'Personne B', demandes: 1 }
        ],
        demandesJournalisees: 1
      })
    )
    const demandeurs = [...el.querySelectorAll('[data-testid="besoins-demandeur"]')]
    expect(demandeurs.map((d) => d.textContent)).toEqual([
      'Personne A',
      'Personne B · déduit',
      'demandeur inconnu'
    ])
    expect(demandeurs[0].getAttribute('title')).toContain('relevée au moment du prompt')
    expect(demandeurs[1].getAttribute('title')).toContain('déduit')
    // La suite d'un autre fil se clique et ouvre ce fil-là.
    const besoin = el.querySelector<HTMLButtonElement>('[data-testid="besoins-besoin"]')!
    expect(besoin.textContent).toBe('suite de conv-9')
    await act(async () => besoin.click())
    expect(onOpenConversation).toHaveBeenLastCalledWith({ conversationId: 'conv-9' })
    expect(el.querySelector('[data-testid="besoins-pied-demandeurs"]')?.textContent).toContain(
      '1 demande relevée dans git'
    )
    // Filtre par personne : seules ses demandes restent.
    const filtreB = [
      ...el.querySelectorAll<HTMLButtonElement>('[data-testid="besoins-filtre-demandeur"]')
    ].find((b) => b.textContent?.startsWith('Personne B'))!
    await act(async () => filtreB.click())
    expect(
      [...el.querySelectorAll('[data-testid="besoins-demande"] .besoins-titre')].map(
        (t) => t.textContent
      )
    ).toEqual(['Vieille demande'])
  })
})
