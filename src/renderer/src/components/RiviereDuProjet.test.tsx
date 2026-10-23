// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte,
  StatutDemande
} from '../../../shared/carte-des-besoins'
import { RiviereDuProjet } from './RiviereDuProjet'
import { CLE_ETATS_MANUELS_CARTE } from './etats-manuels-carte'

/**
 * LA RIVIÈRE DE LA CARTE DU PROJET (/draft conv-1113, « implémente 1+2 »). ENTRÉES QUI DOIVENT
 * FAIRE ÉCHOUER : une colonne la plus large qui ne suit pas la molette (proposition 2), une souris
 * qui déplace encore la loupe (proposition 1 retirée : « laisse que la roulette »), une molette qui
 * bloque le défilement de la page en butée, une loupe qui bouge quand la fiche est ouverte, un
 * post-it glissé qui ne change pas d'étage ou dont l'état n'est pas gardé. Remonter le temps
 * (conv-1131, « enlève le filtre 2 semaines, on doit pouvoir remonter à l'infini ») : un bouton de
 * période qui reste, une molette qui bute avant le plus vieux fil, une frise qui s'allonge au lieu
 * de glisser, une loupe qui sort du tableau, un retour au présent absent ou qui laisse la fiche figer
 * la molette.
 * Seule dans sa vue, et « tout doit rentrer dans l'écran en hauteur » : un tableau plus haut que la
 * place offerte, un post-it sous son bas, une molette qui ferait défiler quoi que ce soit.
 * Puis : un jour chargé sous la loupe qui reste à 3 de front.
 * Enfin (conv-1130, « quand je click sur une colonne du board ca doit me scroll dessus ») : un clic
 * sur une colonne qui n'y amène pas la loupe, ou un clic sur un post-it qui la déplace. Puis
 * (conv-1135) : une colonne cliquée laissée au bord au lieu d'être posée au milieu de la frise.
 */

const MAINTENANT = new Date(2026, 9, 23, 15, 0).getTime()
const HEURE = 3_600_000
const JOUR = 24 * HEURE

const demande = (
  conversationId: string,
  rang: number,
  statut: StatutDemande,
  debut: number
): DemandeDeLaCarte => ({
  conversationId,
  conversationTitre: `Fil ${conversationId}`,
  rang,
  titre: `demande ${conversationId}-${rang}`,
  statut,
  constat: 'npm test → exit 0',
  debut,
  demandeur: { cle: 'raph@x', nom: 'Raph', origine: 'journal' }
})

function carte(enPlus: DemandeDeLaCarte[] = []): CarteDesBesoins {
  const demandes = [
    ...enPlus,
    demande('conv-1', 1, 'sans-preuve', MAINTENANT - 2 * HEURE),
    demande('conv-2', 1, 'prouve', MAINTENANT - 4 * JOUR),
    demande('conv-3', 1, 'refuse', MAINTENANT - 9 * JOUR),
    {
      ...demande('conv-4', 1, 'en-cours', MAINTENANT - HEURE),
      demandeur: { cle: 'lea@x', nom: 'Léa', origine: 'journal' as const }
    },
    // Hors des 14 derniers jours : ils n'entrent qu'en remontant le temps (20 et 60 jours).
    demande('conv-5', 1, 'prouve', MAINTENANT - 20 * JOUR),
    demande('conv-6', 1, 'sans-preuve', MAINTENANT - 60 * JOUR)
  ]
  const projet = {
    cle: 'P',
    libelle: 'AutoWinOS',
    nature: 'dossier',
    conversations: 4,
    demandes,
    runsBloques: [],
    comptes: { prouve: 1, refuse: 1, 'en-cours': 1, 'sans-preuve': 1 }
  } as ProjetDeLaCarte
  return {
    projets: [projet],
    comptes: projet.comptes,
    demandes: demandes.length,
    runsBloques: 0,
    conversationsLues: 4,
    demandeurs: [
      { cle: 'raph@x', nom: 'Raph', demandes: 3 },
      { cle: 'lea@x', nom: 'Léa', demandes: 1 }
    ],
    demandesJournalisees: 4,
    calculeeA: MAINTENANT,
    dureeMs: 1
  }
}

describe('RiviereDuProjet', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  beforeEach(() => {
    window.localStorage.removeItem(CLE_ETATS_MANUELS_CARTE)
  })
  const montes: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
  afterEach(async () => {
    for (const m of montes.splice(0)) {
      await act(async () => m.root.unmount())
      m.el.remove()
    }
  })

  async function monter(
    ouvrir = vi.fn(),
    donnees = carte()
  ): Promise<{ el: HTMLDivElement; ouvrir: typeof ouvrir }> {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    await act(async () => root.render(createElement(RiviereDuProjet, { carte: donnees, ouvrir })))
    return { el, ouvrir }
  }

  const tableau = (el: HTMLElement): HTMLElement =>
    el.querySelector('[data-testid="riviere-tableau"]') as HTMLElement
  const largeurs = (el: HTMLElement): number[] =>
    [...el.querySelectorAll<HTMLElement>('[data-testid="riviere-jour"]')].map((j) =>
      parseFloat(j.style.width)
    )
  const plusLarge = (el: HTMLElement): number => {
    const l = largeurs(el)
    return l.indexOf(Math.max(...l))
  }
  const postit = (el: HTMLElement, id: string): HTMLElement =>
    el.querySelector(`[data-conversation="${id}"]`) as HTMLElement
  const pointeur = (cible: Element, type: string, x: number, y = 60): void => {
    cible.dispatchEvent(
      new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1 })
    )
  }
  /** Le milieu de la colonne du jour `j` TELLE QU'AFFICHÉE : c'est elle que la souris survole. */
  const milieu = (el: HTMLElement, j: number): number => {
    const col = el.querySelectorAll<HTMLElement>('[data-testid="riviere-jour"]')[j]
    return parseFloat(col.style.left) + parseFloat(col.style.width) / 2
  }

  it('pose un post-it par fil, à l’étage de son état, et élargit aujourd’hui par défaut', async () => {
    const { el } = await monter()
    expect(el.querySelectorAll('[data-testid="riviere-postit"]')).toHaveLength(4)
    expect(postit(el, 'conv-3').dataset.etage).toBe('refuse')
    expect(postit(el, 'conv-4').dataset.etage).toBe('en-cours')
    expect(plusLarge(el)).toBe(13)
    const noms = [...el.querySelectorAll('[data-testid="riviere-etage"]')].map((e) => e.textContent)
    expect(noms).toEqual([
      'À faire · 0',
      'En cours · 1',
      'Bloqué · 1',
      'À vérifier · 1',
      'Fait · 1'
    ])
  })

  it('cliquer une colonne la pose au milieu : sur le tableau comme dans la bande des jours, jamais depuis un post-it', async () => {
    const { el } = await monter()
    const clic = (cible: Element, x: number): void => {
      cible.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: 60 }))
    }
    // Le fond d'un étage couvre les colonnes : c'est lui que la souris touche sur le tableau.
    const etage = el.querySelector('[data-testid="riviere-etage"]') as HTMLElement
    // conv-3 vit au jour 4 (9 jours avant) : un clic sur sa colonne la pose au MILIEU de la frise
    // (conv-1135), la frise reculant de 3 jours — pas au bord, où elle restait avant.
    expect(postit(el, 'conv-3').dataset.jour).toBe('4')
    await act(async () => clic(etage, milieu(el, 4)))
    expect(Number(tableau(el).dataset.recul)).toBe(3)
    expect(plusLarge(el)).toBe(7)
    expect(postit(el, 'conv-3').dataset.jour).toBe('7')
    // La colonne de gauche, dans la bande des jours : les jours d'avant apparaissent sans molette
    // (« si je click sur celle tout à gauche je dois scroller pour faire apparaître celles d'avant »).
    expect(postit(el, 'conv-5')).toBeNull()
    const enTete = el.querySelectorAll<HTMLElement>('[data-testid="riviere-tete-jour"]')[0]
    await act(async () => clic(enTete, 0))
    expect(Number(tableau(el).dataset.recul)).toBe(10)
    expect(plusLarge(el)).toBe(7)
    expect(postit(el, 'conv-5').dataset.jour).toBe('3')
    // conv-5 : son clic ouvre sa fiche, la loupe et la frise restent où elles étaient.
    await act(async () => postit(el, 'conv-5').click())
    expect(el.querySelector('[data-testid="riviere-fiche"]')).not.toBeNull()
    expect(plusLarge(el)).toBe(7)
    expect(Number(tableau(el).dataset.recul)).toBe(10)
    // Fiche ouverte : un clic sur le tableau la ferme SEULEMENT (détail dans
    // RiviereDuProjet.fiche-ouverte.test.tsx).
    await act(async () => {
      pointeur(etage, 'pointerdown', milieu(el, 11))
      clic(etage, milieu(el, 11))
    })
    expect(el.querySelector('[data-testid="riviere-fiche"]')).toBeNull()
    expect(plusLarge(el)).toBe(7)
    expect(Number(tableau(el).dataset.recul)).toBe(10)
  })

  it('survoler le tableau ne déplace pas la loupe : ni sur un jour, ni en sortant du tableau', async () => {
    const { el } = await monter()
    await act(async () => pointeur(tableau(el), 'pointermove', milieu(el, 3)))
    expect(plusLarge(el)).toBe(13)
    await act(async () => {
      tableau(el).dispatchEvent(
        new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
      )
    })
    expect(Number(tableau(el).dataset.foyer)).toBe(13)
    // React tire onPointerLeave de pointerout (vers un élément hors du tableau), pas de pointerleave.
    await act(async () =>
      tableau(el).dispatchEvent(
        new PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body })
      )
    )
    expect(Number(tableau(el).dataset.foyer)).toBe(13)
  })

  it('2 · chaque cran de molette recule la loupe d’une demi-journée ; en butée, elle ne fait rien défiler', async () => {
    const { el } = await monter()
    const molette = (deltaY: number): WheelEvent => {
      const e = new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
      tableau(el).dispatchEvent(e)
      return e
    }
    // Déjà sur aujourd'hui : vers le bas, la loupe ne peut plus avancer, et le tableau ne défile
    // pas non plus — vers le bas il aurait défilé, vers le haut la même molette bouge la loupe.
    let e!: WheelEvent
    await act(async () => {
      for (let i = 0; i < 3; i += 1) e = molette(100)
    })
    expect(e.defaultPrevented).toBe(true)
    expect(plusLarge(el)).toBe(13)
    await act(async () => {
      for (let i = 0; i < 4; i += 1) e = molette(-100)
    })
    expect(e.defaultPrevented).toBe(true)
    expect(plusLarge(el)).toBe(11)
  })

  it('ouvre la fiche au clic, fige la loupe pendant qu’elle est ouverte, et ouvre le fil', async () => {
    const { el, ouvrir } = await monter()
    const p = postit(el, 'conv-1')
    await act(async () => {
      pointeur(p, 'pointerdown', 10)
      pointeur(p, 'pointerup', 10)
      p.click()
    })
    const fiche = el.querySelector('[data-testid="riviere-fiche"]') as HTMLElement
    expect(fiche.textContent).toContain('Fil conv-1')
    expect(fiche.textContent).toContain('Raph')
    await act(async () => {
      for (let i = 0; i < 4; i += 1)
        tableau(el).dispatchEvent(
          new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
        )
    })
    expect(plusLarge(el)).toBe(13)
    await act(async () =>
      (el.querySelector('[data-testid="riviere-fiche-ouvrir"]') as HTMLElement).click()
    )
    expect(ouvrir).toHaveBeenCalledWith('conv-1')
  })

  it('glisser un post-it vers un autre étage change son état, le garde, et la fiche permet de revenir', async () => {
    const { el } = await monter()
    const etageFait = [...el.querySelectorAll<HTMLElement>('[data-testid="riviere-etage"]')].find(
      (e) => e.dataset.etage === 'prouve'
    )!
    const yFait = parseFloat(etageFait.style.top) + parseFloat(etageFait.style.height) / 2
    const p = postit(el, 'conv-1')
    await act(async () => {
      pointeur(p, 'pointerdown', 800, 100)
      pointeur(p, 'pointermove', 805, 140)
      pointeur(p, 'pointermove', 805, yFait)
      pointeur(p, 'pointerup', 805, yFait)
      p.click()
    })
    expect(postit(el, 'conv-1').dataset.etage).toBe('prouve')
    expect(postit(el, 'conv-1').dataset.manuel).toBe('1')
    expect(el.querySelector('[data-testid="riviere-fiche"]')).toBeNull()
    expect(
      JSON.parse(window.localStorage.getItem(CLE_ETATS_MANUELS_CARTE) ?? '{}')['conv-1'].etage
    ).toBe('prouve')

    await act(async () => postit(el, 'conv-1').click())
    const manuel = el.querySelector('[data-testid="riviere-fiche-manuel"]') as HTMLElement
    expect(manuel.textContent).toContain('sans preuve')
    await act(async () => (manuel.querySelector('button') as HTMLElement).click())
    expect(postit(el, 'conv-1').dataset.etage).toBe('sans-preuve')
    expect(postit(el, 'conv-1').dataset.manuel).toBeUndefined()
  })

  it('estompe les post-it des autres personnes quand on en choisit une', async () => {
    const { el } = await monter()
    const lea = [...el.querySelectorAll<HTMLElement>('[data-testid="riviere-personne"]')].find(
      (b) => b.textContent === 'Léa'
    )!
    await act(async () => lea.click())
    expect(postit(el, 'conv-4').dataset.estompe).toBeUndefined()
    expect(postit(el, 'conv-1').dataset.estompe).toBe('true')
  })

  const molette = async (el: HTMLElement, crans: number, deltaY = -100): Promise<void> =>
    act(async () => {
      for (let i = 0; i < crans; i += 1)
        tableau(el).dispatchEvent(
          new WheelEvent('wheel', { deltaY, bubbles: true, cancelable: true })
        )
    })
  const pied = (el: HTMLElement): string =>
    el.querySelector('[data-testid="riviere-pied"]')?.textContent ?? ''
  const auJourdhui = (el: HTMLElement): HTMLElement | null =>
    el.querySelector('[data-testid="riviere-aujourdhui"]')

  it('la molette remonte le temps sans butée jusqu’au plus vieux fil : la frise garde 14 jours et glisse', async () => {
    const { el } = await monter()
    // Plus aucun choix de période.
    expect(el.querySelector('[data-testid="riviere-periode"]')).toBeNull()
    expect(largeurs(el)).toHaveLength(14)
    expect(postit(el, 'conv-5')).toBeNull()
    expect(pied(el)).toContain('sur les 14 derniers jours · 2 plus anciens')
    expect(auJourdhui(el)).toBeNull()

    // 40 crans d'une demi-journée : 20 jours en arrière, le jour de conv-5.
    await molette(el, 40)
    expect(largeurs(el)).toHaveLength(14)
    expect(Number(tableau(el).dataset.recul)).toBe(10)
    // La loupe reste à 3 jours du bord : c'est la frise qui a glissé, pas la loupe qui en sort.
    expect(plusLarge(el)).toBe(3)
    expect(postit(el, 'conv-5').dataset.jour).toBe('3')
    expect(el.querySelectorAll('[data-testid="riviere-postit"]')).toHaveLength(1)
    // Dans le passé, la frise dit ses dates et compte ce qui est plus récent qu'elle.
    expect(pied(el)).toContain(
      'fils du mer 30 sept. au mar 13 oct. · 1 plus anciens · 4 plus récents'
    )
    expect(auJourdhui(el)).not.toBeNull()

    // Jusqu'au plus vieux fil (60 jours), puis plus rien : au-delà, la frise serait vide.
    await molette(el, 200)
    expect(Number(tableau(el).dataset.recul)).toBe(47)
    expect(plusLarge(el)).toBe(0)
    expect(postit(el, 'conv-6').dataset.etage).toBe('sans-preuve')
    expect(postit(el, 'conv-5')).toBeNull()
    expect(pied(el)).not.toContain('plus anciens')
    expect(largeurs(el)).toHaveLength(14)

    // Et vers aujourd'hui, la frise revient d'elle-même jusqu'au présent.
    await molette(el, 300, 100)
    expect(Number(tableau(el).dataset.recul)).toBe(0)
    expect(plusLarge(el)).toBe(13)
    expect(auJourdhui(el)).toBeNull()
  })

  it('« revenir à aujourd’hui » ramène la frise d’un clic et ferme la fiche, sans quoi la molette resterait figée', async () => {
    const { el } = await monter()
    await molette(el, 40)
    await act(async () => postit(el, 'conv-5').click())
    expect(el.querySelector('[data-testid="riviere-fiche"]')).not.toBeNull()
    await act(async () => auJourdhui(el)!.click())
    expect(el.querySelector('[data-testid="riviere-fiche"]')).toBeNull()
    expect(Number(tableau(el).dataset.recul)).toBe(0)
    expect(plusLarge(el)).toBe(13)
    expect(postit(el, 'conv-5')).toBeNull()
    expect(auJourdhui(el)).toBeNull()
    await molette(el, 1)
    expect(plusLarge(el)).toBe(12)
  })

  it('tout tient dans la hauteur offerte : rien ne défile, aucun post-it sous le bas du tableau', async () => {
    for (const H of [420, 220]) {
      // happy-dom ne mesure rien : la place offerte est donnée par un faux observateur de taille.
      vi.stubGlobal(
        'ResizeObserver',
        class {
          constructor(private rappel: ResizeObserverCallback) {}
          observe(): void {
            this.rappel(
              [{ contentRect: { width: 960, height: H } } as ResizeObserverEntry],
              this as unknown as ResizeObserver
            )
          }
          unobserve = vi.fn()
          disconnect = vi.fn()
        }
      )
      const { el } = await monter()
      expect(el.querySelector('[data-testid="riviere-defilement"]')).toBeNull()
      expect(parseFloat(tableau(el).style.height)).toBe(H)
      const etages = [...el.querySelectorAll<HTMLElement>('[data-testid="riviere-etage"]')]
      const dernier = etages[etages.length - 1]
      expect(parseFloat(dernier.style.top) + parseFloat(dernier.style.height)).toBeLessThanOrEqual(
        H
      )
      for (const p of el.querySelectorAll<HTMLElement>('[data-testid="riviere-postit"]')) {
        const m = /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([\d.e-]+), ([\d.e-]+)\)/u.exec(
          p.style.transform
        )!
        expect(Number(m[2]) + 54 * Number(m[4])).toBeLessThanOrEqual(H + 1e-6)
      }
      // La molette n'a qu'un rôle, la loupe : rien d'autre à faire défiler.
      const e = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true })
      await act(async () => tableau(el).dispatchEvent(e))
      expect(e.defaultPrevented).toBe(true)
      expect(plusLarge(el)).toBe(12)
      vi.unstubAllGlobals()
    }
  })

  /** La place offerte au tableau : happy-dom ne mesure rien, un faux observateur de taille la donne. */
  const offrir = (largeur: number, hauteur: number): void => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private rappel: ResizeObserverCallback) {}
        observe(): void {
          this.rappel(
            [{ contentRect: { width: largeur, height: hauteur } } as ResizeObserverEntry],
            this as unknown as ResizeObserver
          )
        }
        unobserve = vi.fn()
        disconnect = vi.fn()
      }
    )
  }

  it('range un jour très chargé sous la loupe sur 4 ou 5 de front, sans rien faire déborder', async () => {
    offrir(960, 300)
    const chargees = Array.from({ length: 30 }, (_, i) =>
      demande(`charge-${i}`, 1, 'sans-preuve', MAINTENANT - (i + 1) * 12 * 60_000)
    )
    const { el } = await monter(vi.fn(), carte(chargees))
    const etage = el.querySelector<HTMLElement>(
      '[data-testid="riviere-etage"][data-etage="sans-preuve"]'
    )!
    const colonnes = Number(etage.dataset.colonnesLoupe)
    expect(colonnes).toBeGreaterThanOrEqual(4)
    // Autant de positions distinctes que de colonnes, pour les post-it d'aujourd'hui de cet étage.
    const xs = new Set(
      [...el.querySelectorAll<HTMLElement>('[data-etage="sans-preuve"][data-jour="13"]')]
        .filter((p) => p.dataset.testid === 'riviere-postit')
        .map((p) => p.style.transform.split(/[^0-9.-]+/u).filter(Boolean)[0])
    )
    expect(xs.size).toBe(colonnes)
    // Tout tient encore : aucun post-it sous le bas du tableau.
    for (const p of el.querySelectorAll<HTMLElement>('[data-testid="riviere-postit"]')) {
      const [, y, , k] = p.style.transform
        .split(/[^0-9.-]+/u)
        .filter(Boolean)
        .map(Number)
      expect(y + 54 * k).toBeLessThanOrEqual(300 + 1e-6)
    }
    // Un étage peu chargé, lui, reste à 3.
    expect(
      el.querySelector<HTMLElement>('[data-testid="riviere-etage"][data-etage="en-cours"]')!.dataset
        .colonnesLoupe
    ).toBe('3')
    vi.unstubAllGlobals()
  })
})
