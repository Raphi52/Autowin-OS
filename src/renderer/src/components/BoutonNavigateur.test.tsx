// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EtatNavigateur, OngletNavigateur } from '../../../shared/navigateur'
import {
  BoutonDetails,
  BoutonNavigateur,
  type PropsBoutonDetails,
  type PropsBoutonNavigateur
} from './BoutonNavigateur'
import { siteDeLAdresse } from './navigateur-integre-outils'

/**
 * LA MINI-ADRESSE (/draft de conv-1317, proposition 6) : le bouton de l'en-tête du fil montre le site
 * de l'onglet actif, panneau fermé.
 *
 * Entrées qui doivent faire échouer ce fichier : le site d'un AUTRE fil affiché dans celui-ci (l'état
 * arrive « tous fils confondus »), un site resté à l'écran après la fermeture du dernier onglet, le
 * globe redessiné ou retiré, un bouton qui ne bascule plus le panneau.
 */

function onglet(id: string, url: string, conversationId = 'A'): OngletNavigateur {
  return {
    id,
    conversationId,
    url,
    titre: 'Page',
    chargement: false,
    peutReculer: false,
    peutAvancer: false
  }
}

function etatDe(conversationId: string, partiel: Partial<EtatNavigateur> = {}): EtatNavigateur {
  return {
    conversationId,
    onglets: [],
    ongletActif: null,
    agentPilote: false,
    mode: null,
    nombreAnnotations: 0,
    gestes: [],
    pilotage: 'libre',
    ...partiel
  }
}

function simulerApi(etats: Record<string, EtatNavigateur> = {}) {
  const abonnes = new Set<(etat: EtatNavigateur) => void>()
  const api = {
    etat: vi.fn(async (id: string) => etats[id] ?? etatDe(id)),
    surEtat: vi.fn((rappel: (etat: EtatNavigateur) => void) => {
      abonnes.add(rappel)
      return () => {
        abonnes.delete(rappel)
      }
    })
  }
  return {
    api,
    abonnes,
    async pousser(etat: EtatNavigateur): Promise<void> {
      await act(async () => {
        for (const rappel of [...abonnes]) rappel(etat)
      })
    }
  }
}

describe('siteDeLAdresse', () => {
  it('garde le site et son port, sans protocole ni chemin', () => {
    expect(siteDeLAdresse('http://localhost:5173/app?x=1#y')).toBe('localhost:5173')
    expect(siteDeLAdresse('https://www.exemple.fr/page')).toBe('www.exemple.fr')
  })

  it('lit le vrai site quand une adresse se déguise', () => {
    expect(siteDeLAdresse('https://banque.fr@pirate.net/')).toBe('pirate.net')
  })

  it('ne rend rien pour ce qui n’est pas une page web', () => {
    for (const adresse of [
      'about:blank',
      'data:text/html,<p>',
      'file:///C:/a.html',
      '',
      'pas une url'
    ]) {
      expect(siteDeLAdresse(adresse)).toBeNull()
    }
  })
})

describe('BoutonNavigateur', () => {
  let conteneur: HTMLDivElement
  let racine: Root | null = null

  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  beforeEach(() => {
    conteneur = document.createElement('div')
    document.body.appendChild(conteneur)
  })

  afterEach(async () => {
    await act(async () => racine?.unmount())
    racine = null
    conteneur.remove()
    Reflect.deleteProperty(window, 'api')
  })

  function poserApi(api: unknown): void {
    ;(window as unknown as { api: unknown }).api = { navigateur: api }
  }

  async function monter(props: Partial<PropsBoutonNavigateur> = {}): Promise<void> {
    const complet: PropsBoutonNavigateur = {
      conversationId: 'A',
      ouvert: false,
      onBasculer: () => undefined,
      ...props
    }
    await act(async () => {
      racine ??= createRoot(conteneur)
      racine.render(createElement(BoutonNavigateur, complet))
    })
  }

  const bouton = (): HTMLButtonElement =>
    conteneur.querySelector('[data-testid="chat-navigateur-toggle"]') as HTMLButtonElement
  const site = (): string | null =>
    conteneur.querySelector('[data-testid="chat-navigateur-site"]')?.textContent ?? null

  it('sans onglet : le globe seul', async () => {
    poserApi(simulerApi().api)
    await monter()
    expect(site()).toBeNull()
    expect(bouton().querySelector('svg')).toBeTruthy()
  })

  it('garde le tracé exact du globe (« l’icône est bonne », conv-1317)', async () => {
    poserApi(simulerApi().api)
    await monter()
    expect(bouton().querySelector('svg circle')?.getAttribute('r')).toBe('8.5')
    expect(bouton().querySelector('svg path')?.getAttribute('d')).toBe(
      'M3.5 12h17M12 3.5c2.4 2.4 3.6 5.2 3.6 8.5s-1.2 6.1-3.6 8.5c-2.4-2.4-3.6-5.2-3.6-8.5S9.6 5.9 12 3.5Z'
    )
  })

  it('montre le site de l’onglet ACTIF dès l’ouverture du fil', async () => {
    const { api } = simulerApi({
      A: etatDe('A', {
        onglets: [onglet('o1', 'https://exemple.fr/'), onglet('o2', 'http://localhost:5173/app')],
        ongletActif: 'o2'
      })
    })
    poserApi(api)
    await monter()
    expect(site()).toBe('localhost:5173')
    expect(bouton().title).toContain('http://localhost:5173/app')
    expect(bouton().getAttribute('aria-label')).toContain('localhost:5173')
  })

  it('suit l’état poussé : autre site, puis retour au globe au dernier onglet fermé', async () => {
    const nav = simulerApi()
    poserApi(nav.api)
    await monter()
    await nav.pousser(
      etatDe('A', { onglets: [onglet('o1', 'https://exemple.fr/')], ongletActif: 'o1' })
    )
    expect(site()).toBe('exemple.fr')
    await nav.pousser(etatDe('A'))
    expect(site()).toBeNull()
  })

  it('une page sans site (about:blank) reste au globe', async () => {
    const nav = simulerApi()
    poserApi(nav.api)
    await monter()
    await nav.pousser(etatDe('A', { onglets: [onglet('o1', 'about:blank')], ongletActif: 'o1' }))
    expect(site()).toBeNull()
  })

  it('ignore l’état poussé par un AUTRE fil', async () => {
    const nav = simulerApi()
    poserApi(nav.api)
    await monter()
    await nav.pousser(
      etatDe('B', { onglets: [onglet('o9', 'https://autre.fr/', 'B')], ongletActif: 'o9' })
    )
    expect(site()).toBeNull()
  })

  it('en changeant de fil, le site de l’ancien ne reste pas affiché', async () => {
    const { api } = simulerApi({
      A: etatDe('A', { onglets: [onglet('o1', 'https://exemple.fr/')], ongletActif: 'o1' })
    })
    poserApi(api)
    await monter()
    expect(site()).toBe('exemple.fr')
    await monter({ conversationId: 'B' })
    expect(site()).toBeNull()
  })

  it('se désabonne au démontage', async () => {
    const nav = simulerApi()
    poserApi(nav.api)
    await monter()
    expect(nav.abonnes.size).toBe(1)
    await act(async () => racine?.unmount())
    racine = null
    expect(nav.abonnes.size).toBe(0)
  })

  it('le clic bascule le panneau et l’état ouvert se lit sur le bouton', async () => {
    poserApi(simulerApi().api)
    const onBasculer = vi.fn()
    await monter({ onBasculer })
    expect(bouton().getAttribute('aria-pressed')).toBe('false')
    await act(async () => bouton().click())
    expect(onBasculer).toHaveBeenCalledOnce()
    await monter({ ouvert: true, onBasculer })
    expect(bouton().getAttribute('aria-pressed')).toBe('true')
  })

  it('sans fil ouvert : désactivé, et aucune lecture du navigateur', async () => {
    const nav = simulerApi()
    poserApi(nav.api)
    await monter({ conversationId: null })
    expect(bouton().disabled).toBe(true)
    expect(nav.api.etat).not.toHaveBeenCalled()
    expect(site()).toBeNull()
  })

  it('tient sans l’API du navigateur (vues de test qui ne la simulent pas)', async () => {
    await monter()
    expect(bouton()).toBeTruthy()
    expect(site()).toBeNull()
  })

  // Mesuré dans l'app (conv-1317) : panneau ouvert, le site faisait déborder l'en-tête de 37 px à
  // 1280 px de large et poussait le bouton sous le panneau à 1180 px.
  describe('quand l’en-tête manque de place', () => {
    let observateurs: { cible: Element | null; deconnecte: boolean }[]
    let rappels: ((entrees: { contentRect: { width: number } }[]) => void)[]

    beforeEach(() => {
      observateurs = []
      rappels = []
      vi.stubGlobal(
        'ResizeObserver',
        class {
          private trace = { cible: null as Element | null, deconnecte: false }
          constructor(rappel: (entrees: { contentRect: { width: number } }[]) => void) {
            rappels.push(rappel)
            observateurs.push(this.trace)
          }
          observe(cible: Element): void {
            this.trace.cible = cible
          }
          disconnect(): void {
            this.trace.deconnecte = true
          }
        }
      )
      // Le bouton vit dans l'en-tête du fil : c'est cette largeur-là qui décide.
      const entete = document.createElement('div')
      entete.className = 'chat-head'
      document.body.appendChild(entete)
      entete.appendChild(conteneur)
    })

    afterEach(() => {
      conteneur.parentElement?.remove()
      vi.unstubAllGlobals()
    })

    const mesurer = (width: number): Promise<void> =>
      act(async () => rappels.forEach((rappel) => rappel([{ contentRect: { width } }])))

    async function monterAvecSite(): Promise<void> {
      poserApi(
        simulerApi({
          A: etatDe('A', {
            onglets: [onglet('o1', 'https://exemple.fr/page')],
            ongletActif: 'o1'
          })
        }).api
      )
      await monter()
    }

    it('observe la largeur de l’en-tête du fil', async () => {
      await monterAvecSite()
      expect(observateurs[0].cible).toBe(conteneur.parentElement)
    })

    it('trop étroit : retour au globe, l’adresse reste dans l’infobulle et pour le lecteur d’écran', async () => {
      await monterAvecSite()
      await mesurer(439)
      expect(site()).toBeNull()
      expect(bouton().title).toContain('https://exemple.fr/page')
      expect(bouton().getAttribute('aria-label')).toContain('exemple.fr')
    })

    it('le site revient dès que la place revient, seuil compris', async () => {
      await monterAvecSite()
      await mesurer(300)
      await mesurer(440)
      expect(site()).toBe('exemple.fr')
    })

    it('se débranche au démontage', async () => {
      await monterAvecSite()
      await act(async () => racine?.unmount())
      racine = null
      expect(observateurs[0].deconnecte).toBe(true)
    })

    describe('Détails', () => {
      async function monterDetails(props: Partial<PropsBoutonDetails> = {}): Promise<void> {
        const complet: PropsBoutonDetails = {
          ouvert: false,
          libelle: 'Détails',
          titre: 'Panneau de détails',
          runsOuverts: 0,
          onBasculer: () => undefined,
          ...props
        }
        await act(async () => {
          racine ??= createRoot(conteneur)
          racine.render(createElement(BoutonDetails, complet))
        })
      }
      const details = (): HTMLButtonElement =>
        conteneur.querySelector('.workflow-toggle') as HTMLButtonElement
      const libelle = (): string | null =>
        details().querySelector('.bouton-creux-texte')?.textContent ?? null

      it('porte la classe de la Mini-adresse et dit s’il est ouvert', async () => {
        await monterDetails({ ouvert: true })
        expect(details().classList.contains('bouton-creux')).toBe(true)
        expect(details().getAttribute('aria-pressed')).toBe('true')
        expect(libelle()).toBe('Détails')
      })

      it('le clic bascule le panneau', async () => {
        const onBasculer = vi.fn()
        await monterDetails({ onBasculer })
        await act(async () => details().click())
        expect(onBasculer).toHaveBeenCalledOnce()
      })

      // Mesuré dans l'app (conv-1317) : de 92 à 103 px en passant au creux, l'en-tête débordait de
      // nouveau à 1180 px de large, panneau ouvert.
      it('cède son libellé quand l’en-tête est trop étroit, et le reprend avec la place', async () => {
        await monterDetails({ runsOuverts: 2 })
        await mesurer(169)
        expect(libelle()).toBeNull()
        expect(details().getAttribute('aria-label')).toBe('Détails, 2 open')
        expect(details().textContent).toContain('2 open')
        await mesurer(170)
        expect(libelle()).toBe('Détails')
      })

      it('sans run ouvert, aucun compteur', async () => {
        await monterDetails()
        expect(details().textContent).toBe('Détails')
      })
    })
  })
})
