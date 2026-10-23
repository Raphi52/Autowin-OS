// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { CarteDesBesoinsView } from './CarteDesBesoinsView'
import { reclamerOuvertureConversation } from './pending-conversation-open'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte,
  StatutDemande
} from '../../../shared/carte-des-besoins'

/**
 * VUE « CARTE DU PROJET » (conv-1089, 2026-10-22 ; réduite à la rivière le 23/10, conv-1113 : « il
 * doit y avoir que ce board dans la view, supprime tout ce qui est en dessous »). ENTRÉES QUI
 * DOIVENT FAIRE ÉCHOUER : la fiche d'un dépôt, la liste des demandes, ses filtres ou son pied encore
 * rendus sous la rivière ; un fil qui ne s'ouvre pas quand le chat n'est pas encore monté ; un
 * compte mal accordé ; une panne du calcul rendue comme une carte vide.
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

  it('ne montre que la rivière : ni fiche du dépôt, ni liste des demandes, ni filtres, ni pied', async () => {
    const { el } = await monter(async () =>
      carte([projet('P1', [demande('a', 0, 'prouve'), demande('b', 0, 'refuse')])])
    )
    const vue = el.querySelector('[data-testid="besoins-view"]')!
    expect(vue.querySelector('[data-testid="riviere"]')).not.toBeNull()
    expect(el.querySelectorAll('[data-testid="riviere-postit"]')).toHaveLength(2)
    for (const parti of [
      'besoins-projet',
      'besoins-demande',
      'besoins-filtre-refuse',
      'besoins-filtre-demandeur',
      'besoins-pied',
      'besoins-dessin',
      'besoins-menu-depot'
    ])
      expect(el.querySelector(`[data-testid="${parti}"]`)).toBeNull()
    expect(vue.textContent).not.toContain('Toutes les demandes')
    // Sous la rivière, plus rien : elle est le dernier enfant de la vue.
    expect(vue.lastElementChild?.getAttribute('data-testid')).toBe('riviere')
  })

  it('ouvre le fil depuis la fiche de la rivière, même si le chat n’est pas encore monté', async () => {
    const { el, onOpenConversation } = await monter(async () =>
      carte([projet('P1', [demande('conv-7', 0, 'prouve')])])
    )
    await act(async () => el.querySelector<HTMLElement>('[data-conversation="conv-7"]')!.click())
    await act(async () =>
      el.querySelector<HTMLElement>('[data-testid="riviere-fiche-ouvrir"]')!.click()
    )
    expect(onOpenConversation).toHaveBeenCalledWith({ conversationId: 'conv-7' })
    expect(reclamerOuvertureConversation()).toBe('conv-7')
  })

  it('accorde chaque compte de l’en-tête : « 1 prouvée », « 2 refusées », « 1 run bloqué »', async () => {
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
    const stats = el.querySelector('[data-testid="besoins-stats"]')?.textContent ?? ''
    expect(stats).toContain('3 demandes')
    expect(stats).toContain('1 prouvée')
    expect(stats).not.toContain('1 prouvées')
    expect(stats).toContain('2 refusées')
    expect(stats).toContain('1 run bloqué')
    expect(stats).not.toContain('1 runs')
  })

  it('une panne du calcul est dite, pas rendue comme une carte vide', async () => {
    const { el } = await monter(async () => {
      throw new Error('store illisible')
    })
    expect(el.querySelector('[data-testid="besoins-erreur"]')?.textContent).toBe(
      'Carte impossible à calculer : store illisible'
    )
    expect(el.querySelector('[data-testid="besoins-stats"]')).toBeNull()
    expect(el.querySelector('[data-testid="riviere"]')).toBeNull()
  })
})
