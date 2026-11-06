// @vitest-environment happy-dom
/**
 * LE PANNEAU DES BUREAUX CACHÉS DANS LE CHAT (2026-10-31) : « ça devient un icône à côté de
 * celui du navigateur et ça ouvre un right panel comme le navigateur ».
 *
 * Entrées qui doivent faire échouer ce fichier : un bouton absent de l'en-tête, les deux panneaux
 * ouverts ensemble (ils ne tiennent pas à 1280 px : le fil tomberait à zéro), une demande d'ouverture
 * perdue parce que le chat n'était pas encore monté, un bureau lancé par le fil sans panneau ouvert,
 * le retour de l'ancien bloc dans le fil, un panneau refermé qui se rouvre seul sur le même bureau.
 */
import { act, createElement, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BureauTv } from '../../../main/bureau/hdesk-tv'
import type { BureauGere } from '../../../shared/hdesk-gestion'
import { ChatView } from './ChatView'
import { chatApi, conversation, installRafShim } from './ChatView.harness'

const panneauBureaux = (c: Element): Element | null => c.querySelector('[data-testid="hdesk-view"]')
const panneauNavigateur = (c: Element): Element | null =>
  c.querySelector('[data-testid="navigateur-panneau"]')

function navigateurFactice(): Record<string, unknown> {
  const etat = {
    conversationId: 'A',
    onglets: [],
    ongletActif: null,
    agentPilote: false,
    mode: null,
    nombreElementsChoisis: 0,
    gestes: [],
    pilotage: 'libre'
  }
  return {
    etat: vi.fn(async () => etat),
    surEtat: vi.fn(() => () => undefined),
    afficherFil: vi.fn(async () => undefined),
    poserCadre: vi.fn(async () => undefined),
    prendreElementsChoisis: vi.fn(async () => []),
    reglages: {
      lire: vi.fn(async () => ({ ouvrirLiensDuChatIci: false })),
      ecrire: vi.fn()
    }
  }
}

describe('ChatView — panneau des Bureaux cachés', () => {
  beforeAll(installRafShim)
  let hote: HTMLElement | null = null
  let demanderDepuisLApp: (() => void) | null = null
  let quitterPuisRevenir: (() => Promise<void>) | null = null
  let demonter: (() => Promise<void>) | null = null
  /** Ce que le guet du fil lit. */
  let lances: BureauTv[] = []
  const lectures = vi.fn(async (_fil?: string) => lances)

  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear() // La mosaïque est retenue là : elle passerait d'un test au suivant.
    lances = []
    lectures.mockClear()
  })

  afterEach(async () => {
    await demonter?.()
    demonter = null
    hote?.remove()
    hote = null
    demanderDepuisLApp = null
    vi.restoreAllMocks()
  })

  /** Monte le chat comme App : `demandeBureaux` part d'une valeur donnée (demande d'avant le montage). */
  async function monter(depart = 0, bureaux: BureauGere[] = []): Promise<HTMLElement> {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        navigateur: navigateurFactice(),
        hdeskGestionBureaux: vi.fn(async () => ({ ok: true as const, bureaux })),
        hdeskTvBureaux: lectures,
        hdeskGestionFermer: vi.fn(),
        hdeskGestionCreer: vi.fn()
      })
    })
    hote = document.createElement('div')
    document.body.appendChild(hote)
    const racine = createRoot(hote)
    function App(): React.JSX.Element {
      const [demandeBureaux, setDemande] = useState(depart)
      const [actif, setActif] = useState(true)
      demanderDepuisLApp = () => setDemande((n) => n + 1)
      // Le guet relit dès le retour à l'écran : pas besoin d'attendre ses 5 s.
      quitterPuisRevenir = async () => {
        await act(async () => setActif(false))
        await act(async () => setActif(true))
        await act(async () => {
          await new Promise((r) => setTimeout(r, 0))
        })
      }
      return createElement(ChatView, { isActive: actif, demandeBureaux })
    }
    await act(async () => racine.render(createElement(App)))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    demonter = async () => act(async () => racine.unmount())
    await cliquer('.conv-pick')
    // Le fil s'ouvre en plusieurs temps : le guet ne le lit qu'une fois le fil posé.
    await vi.waitFor(() => expect(lectures).toHaveBeenCalledWith('A'))
    return hote
  }

  async function cliquer(selecteur: string): Promise<void> {
    await act(async () => {
      hote!.querySelector<HTMLElement>(selecteur)?.click()
      await new Promise((r) => setTimeout(r, 0))
    })
  }

  it('le bouton est juste après le globe, avant Détails, et ouvre puis ferme le panneau', async () => {
    const c = await monter()
    const boutons = [...c.querySelectorAll('.chat-head-actions button')]
    const rang = boutons.findIndex(
      (b) => b.getAttribute('data-testid') === 'chat-navigateur-toggle'
    )
    expect(boutons[rang + 1]?.getAttribute('data-testid')).toBe('chat-bureaux-toggle')
    expect(panneauBureaux(c)).toBeNull()
    await cliquer('[data-testid="chat-bureaux-toggle"]')
    expect(panneauBureaux(c)).not.toBeNull()
    await cliquer('[data-testid="chat-bureaux-toggle"]')
    expect(panneauBureaux(c)).toBeNull()
  })

  it('un seul des deux panneaux à la fois : ouvrir l’un ferme l’autre', async () => {
    const c = await monter()
    await cliquer('[data-testid="chat-navigateur-toggle"]')
    expect(panneauNavigateur(c)).not.toBeNull()
    await cliquer('[data-testid="chat-bureaux-toggle"]')
    expect(panneauBureaux(c)).not.toBeNull()
    expect(panneauNavigateur(c)).toBeNull()
    await cliquer('[data-testid="chat-navigateur-toggle"]')
    expect(panneauNavigateur(c)).not.toBeNull()
    expect(panneauBureaux(c)).toBeNull()
  })

  it('une demande de l’app (« va sur les bureaux cachés ») ouvre le panneau, même refermé', async () => {
    const c = await monter()
    await act(async () => demanderDepuisLApp?.())
    expect(panneauBureaux(c)).not.toBeNull()
    await cliquer('[data-testid="hdesk-panneau-fermer"]')
    expect(panneauBureaux(c)).toBeNull()
    await act(async () => demanderDepuisLApp?.())
    expect(panneauBureaux(c)).not.toBeNull()
  })

  it('une demande arrivée avant le montage du chat n’est pas perdue', async () => {
    const c = await monter(1)
    expect(panneauBureaux(c)).not.toBeNull()
  })

  it('en mosaïque, sans icône dans l’en-tête, une demande de l’app reste visible', async () => {
    const c = await monter()
    await cliquer('[data-testid="conv-view-toggle"]')
    expect(c.querySelector('[data-testid="chat-bureaux-toggle"]')).toBeNull()
    await act(async () => demanderDepuisLApp?.())
    expect(panneauBureaux(c)).not.toBeNull()
  })

  it('le fil d’un bureau demande l’ouverture de cette conversation', async () => {
    const ouvertures: unknown[] = []
    const ecoute = (e: Event): void => void ouvertures.push((e as CustomEvent).detail)
    window.addEventListener('autowin:open-conversation', ecoute)
    try {
      const c = await monter(1, [
        { id: 'zox', travail: 'ZOX', relie: true, conversationId: 'conv-951' }
      ])
      await cliquer('[data-testid="hdesk-tous"]')
      await cliquer('[data-testid="hdesk-fil-zox"]')
      expect(ouvertures).toEqual([{ conversationId: 'conv-951' }])
      expect(panneauBureaux(c)).not.toBeNull()
    } finally {
      window.removeEventListener('autowin:open-conversation', ecoute)
    }
  })

  const lancement = (): BureauTv => ({
    id: 'chat-A',
    travail: 'Essai',
    conversationId: 'A',
    lanceLe: new Date(Date.now() + 1000).toISOString()
  })

  it('le fil lance un bureau : le panneau s’ouvre, et rien ne s’affiche dans le fil', async () => {
    const c = await monter()
    expect(panneauBureaux(c)).toBeNull()
    lances = [lancement()]
    await quitterPuisRevenir?.()
    expect(panneauBureaux(c)).not.toBeNull()
    expect(c.querySelector('.chat-scroll [data-testid="hdesk-view"]')).toBeNull()
    expect(c.querySelector('[data-testid="hdesk-tv"]')).toBeNull()
  })

  it('refermé, il ne revient pas pour le même bureau, mais pour un nouveau lancement', async () => {
    const c = await monter()
    const premier = lancement()
    lances = [premier]
    await quitterPuisRevenir?.()
    await cliquer('[data-testid="hdesk-panneau-fermer"]')
    await quitterPuisRevenir?.()
    expect(panneauBureaux(c)).toBeNull()
    lances = [{ ...premier, lanceLe: new Date(Date.now() + 2000).toISOString() }]
    await quitterPuisRevenir?.()
    expect(panneauBureaux(c)).not.toBeNull()
  })

  it('un lancement prend la place du navigateur, comme une page prend celle du panneau', async () => {
    const c = await monter()
    await cliquer('[data-testid="chat-navigateur-toggle"]')
    expect(panneauNavigateur(c)).not.toBeNull()
    lances = [lancement()]
    await quitterPuisRevenir?.()
    expect(panneauBureaux(c)).not.toBeNull()
    expect(panneauNavigateur(c)).toBeNull()
  })

  it('en mosaïque, rien ne s’ouvre seul', async () => {
    const c = await monter()
    await cliquer('[data-testid="conv-view-toggle"]')
    expect(c.querySelector('[data-testid="chat-bureaux-toggle"]')).toBeNull()
    lances = [lancement()]
    lectures.mockClear()
    await quitterPuisRevenir?.()
    expect(c.querySelector('[data-testid="chat-bureaux-toggle"]')).toBeNull()
    expect(lectures).not.toHaveBeenCalled()
    expect(panneauBureaux(c)).toBeNull()
  })

  it('le panneau ne montre que le bureau du fil, plus la liste de tous', async () => {
    const c = await monter(1, [
      { id: 'chat-A', travail: 'Essai', relie: true, conversationId: 'A' },
      { id: 'zox', travail: 'ZOX', relie: true, conversationId: 'conv-951' }
    ])
    const ecrans = [...c.querySelectorAll('[data-testid="hdesk-antenne"]')]
    expect(ecrans.map((e) => e.getAttribute('data-bureau'))).toEqual(['chat-A'])
  })
})
