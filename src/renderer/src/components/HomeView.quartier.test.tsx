// @vitest-environment happy-dom
/**
 * L'ACCUEIL SUR LE QUARTIER (conv-1421) : les widgets dans leurs tours, les gestes sur le fond.
 *
 * La scène elle-même a besoin d'une vraie toile : ici, un pilote simulé joue son rôle, et c'est tout ce
 * que l'Accueil en connaît (`quartier-pont.ts`). Le rendu réel se prouve par capture de l'app.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { autowinStorageKey } from '../storage-keys'
import {
  brancherQuartier,
  debrancherQuartier,
  type CibleQuartier,
  type PiloteQuartier
} from '../quartier/quartier-pont'
import { CLE_TUILES_SORTIES, oublierTuilesSorties } from '../quartier/quartier-tuiles'
import {
  agentsDesCollegues,
  CLE_MODE_VILLAGE,
  idCollegue,
  lireAgentsCollegues,
  oublierAgentsCollegues,
  poserAgentsCollegues
} from '../quartier/agents-collegues'
import { HomeView } from './HomeView'

const rect = { x: 100, y: 100, w: 40, h: 120 }
let sous: CibleQuartier | null = null
let pilote: PiloteQuartier
let racine: Root | null = null
let hote: HTMLElement | null = null

async function monter(onNavigate = vi.fn()): Promise<{ vue: HTMLElement; onNavigate: typeof onNavigate }> {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => racine?.render(createElement(HomeView, { active: true, onNavigate })))
  return { vue: hote.querySelector('[data-testid="home-view"]') as HTMLElement, onNavigate }
}

const cliquerFond = async (vue: HTMLElement): Promise<void> => {
  await act(async () => {
    vue.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 120, clientY: 150 }))
  })
}

beforeEach(() => {
  window.localStorage.clear()
  oublierTuilesSorties()
  oublierAgentsCollegues()
  sous = null
  pilote = {
    cibleSous: () => sous,
    survoler: vi.fn(),
    zoomerSur: vi.fn(() => Promise.resolve()),
    frapperGong: vi.fn(),
    rectDeLaTour: () => rect,
    poserCadre: vi.fn()
  }
  brancherQuartier(pilote)
})

afterEach(async () => {
  debrancherQuartier(pilote)
  await act(async () => racine?.unmount())
  racine = null
  hote?.remove()
  hote = null
})

describe('les widgets vivent dans leurs tours', () => {
  it('n’affiche aucune tuile tant qu’aucune tour n’a été cliquée', async () => {
    const { vue } = await monter()
    expect(vue.querySelectorAll('.home-tile')).toHaveLength(0)
  })

  it('fait sortir le widget de la tour cliquée, et lui seul', async () => {
    const { vue } = await monter()
    sous = { type: 'tour', cle: 't_horloge', widget: 'agenda', rect }
    await cliquerFond(vue)
    expect(vue.querySelector('[data-testid="home-widget-agenda"]')).not.toBeNull()
    expect(vue.querySelectorAll('.home-tile')).toHaveLength(1)
  })

  it('retient le widget sorti d’une ouverture à l’autre', async () => {
    window.localStorage.setItem(CLE_TUILES_SORTIES, JSON.stringify(['mails']))
    oublierTuilesSorties()
    const { vue } = await monter()
    expect(vue.querySelector('[data-testid="home-widget-mails"]')).not.toBeNull()
  })

  it('le fait rentrer par la tour ou par son bouton', async () => {
    const { vue } = await monter()
    sous = { type: 'tour', cle: 't_horloge', widget: 'agenda', rect }
    await cliquerFond(vue)
    await cliquerFond(vue)
    expect(vue.querySelectorAll('.home-tile')).toHaveLength(0)
    await cliquerFond(vue)
    await act(async () => {
      vue.querySelector<HTMLElement>('[data-testid="home-rentrer-agenda"]')?.click()
    })
    expect(vue.querySelectorAll('.home-tile')).toHaveLength(0)
  })

  it('laisse les tuiles de toujours sous un autre fond', async () => {
    window.localStorage.setItem(autowinStorageKey('home.decor.v4'), 'avenue')
    const { vue } = await monter()
    expect(vue.querySelectorAll('.home-tile').length).toBeGreaterThan(3)
    expect(vue.querySelector('[data-testid="quartier-etiquette"]')).toBeNull()
  })
})

describe('les gestes sur le décor', () => {
  it('zoome sur l’objet, puis ouvre sa vraie vue', async () => {
    const { vue, onNavigate } = await monter()
    const cible: CibleQuartier = { type: 'vue', cle: 'worktree', destination: 'worktree', rect }
    sous = cible
    await cliquerFond(vue)
    expect(pilote.zoomerSur).toHaveBeenCalledWith(cible)
    expect(onNavigate).toHaveBeenCalledWith('worktree')
  })

  it('fait sonner le gong, et lui seul', async () => {
    const { vue } = await monter()
    sous = { type: 'vue', cle: 'chat', destination: 'chat', rect }
    await cliquerFond(vue)
    expect(pilote.frapperGong).not.toHaveBeenCalled()
    sous = { type: 'vue', cle: 'task', destination: 'task-manager', rect }
    await cliquerFond(vue)
    expect(pilote.frapperGong).toHaveBeenCalledWith(true)
  })

  it('ouvre le fil du tanuki cliqué (D-3)', async () => {
    const { vue, onNavigate } = await monter()
    const ouvert = vi.fn()
    window.addEventListener('autowin:open-conversation', ouvert)
    sous = { type: 'agent', id: 'conv-7', titre: 'Un fil', rect }
    await cliquerFond(vue)
    window.removeEventListener('autowin:open-conversation', ouvert)
    expect((ouvert.mock.calls[0][0] as CustomEvent).detail).toBe('conv-7')
    expect(onNavigate).toHaveBeenCalledWith('chat')
  })

  it('ne vole jamais le clic d’une tuile posée sur la scène', async () => {
    window.localStorage.setItem(CLE_TUILES_SORTIES, JSON.stringify(['agenda']))
    oublierTuilesSorties()
    const { vue } = await monter()
    sous = { type: 'vue', cle: 'chat', destination: 'chat', rect }
    await act(async () => {
      vue.querySelector('[data-testid="home-widget-agenda"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(pilote.zoomerSur).not.toHaveBeenCalled()
  })

  it('nomme ce que survole la souris et rend le curseur cliquable', async () => {
    const { vue } = await monter()
    sous = { type: 'vue', cle: 'chat', destination: 'chat', rect }
    await act(async () => {
      vue.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 120, clientY: 150 }))
    })
    expect(vue.getAttribute('data-sur-cible')).toBe('true')
    expect(vue.querySelector('[data-testid="quartier-etiquette"]')?.textContent).toContain('Maison de thé')
  })
})

/*
 * LES AGENTS DES COLLÈGUES (plan « Village commun », conv-1429, D8 à D10) : prénom au survol, carte au
 * clic sans jamais ouvrir de fil, bouton « Mes agents / Toute l'équipe ». Le registre est posé à la main :
 * la relecture du partage passe par le processus principal, absent ici.
 */
const ID_CLAIRE = idCollegue('claire.d', 'conv-3')

function poserClaire(titre: string | undefined, phase: 'travail' | 'attente' = 'travail'): void {
  poserAgentsCollegues(
    agentsDesCollegues(
      {
        collegues: [
          {
            poste: 'claire.d',
            nom: 'Claire Dupont',
            prenom: 'Claire',
            agents: [
              {
                id: 'conv-3',
                ...(titre === undefined ? {} : { titre }),
                phase,
                metier: 'lire',
                depuis: new Date(Date.now() - 120_000).toISOString()
              }
            ]
          }
        ]
      },
      Date.now()
    )
  )
}

const survoler = async (vue: HTMLElement): Promise<void> => {
  await act(async () => {
    vue.dispatchEvent(
      new PointerEvent('pointermove', { bubbles: true, clientX: 120, clientY: 150 })
    )
  })
}

describe('les agents des collègues', () => {
  it('nomme au survol le prénom, le titre publié et l’activité', async () => {
    poserClaire('Revue du budget')
    const { vue } = await monter()
    sous = { type: 'agent', id: ID_CLAIRE, titre: 'Revue du budget', rect }
    await survoler(vue)
    const etiquette = vue.querySelector('[data-testid="quartier-etiquette"]')?.textContent ?? ''
    expect(etiquette).toContain('Claire')
    expect(etiquette).toContain('Revue du budget')
    expect(etiquette).toContain('Lit un fichier')
  })

  it('ne dit jamais « T’attend » d’un agent qui attend son humain', async () => {
    poserClaire('Revue du budget', 'attente')
    const { vue } = await monter()
    sous = { type: 'agent', id: ID_CLAIRE, titre: 'Revue du budget', rect }
    await survoler(vue)
    const etiquette = vue.querySelector('[data-testid="quartier-etiquette"]')?.textContent ?? ''
    expect(etiquette).toContain('Attend une réponse de Claire')
    expect(etiquette).not.toContain('T’attend')
  })

  it('montre sa carte au clic, sans zoom ni fil ouvert (D10)', async () => {
    poserClaire('Revue du budget')
    const { vue, onNavigate } = await monter()
    const ouvert = vi.fn()
    window.addEventListener('autowin:open-conversation', ouvert)
    sous = { type: 'agent', id: ID_CLAIRE, titre: 'Revue du budget', rect }
    await cliquerFond(vue)
    window.removeEventListener('autowin:open-conversation', ouvert)
    const carte = vue.querySelector('[data-testid="quartier-carte"]')
    expect(carte?.textContent).toContain('Claire')
    expect(carte?.textContent).toContain('Revue du budget')
    expect(carte?.textContent).toContain('Lit un fichier')
    expect(carte?.textContent).toContain('Depuis')
    expect(ouvert).not.toHaveBeenCalled()
    expect(onNavigate).not.toHaveBeenCalled()
    expect(pilote.zoomerSur).not.toHaveBeenCalled()
  })

  it('dit « Fil privé » quand le titre n’est pas publié', async () => {
    poserClaire(undefined)
    const { vue } = await monter()
    sous = { type: 'agent', id: ID_CLAIRE, titre: '', rect }
    await cliquerFond(vue)
    expect(vue.querySelector('[data-testid="quartier-carte"]')?.textContent).toContain('Fil privé')
  })

  it('écrit le titre d’un collègue comme du texte, jamais comme du HTML', async () => {
    const piege = '<img src=x onerror="window.__pirate=1">'
    poserClaire(piege)
    const { vue } = await monter()
    sous = { type: 'agent', id: ID_CLAIRE, titre: piege, rect }
    await survoler(vue)
    await cliquerFond(vue)
    expect(vue.querySelector('img')).toBeNull()
    expect(vue.querySelector('[data-testid="quartier-carte"]')?.textContent).toContain('<img src=x')
  })

  it('referme la carte par son bouton, par Échap ou par un clic sur le décor', async () => {
    poserClaire('Revue du budget')
    const { vue } = await monter()
    const carte = (): Element | null => vue.querySelector('[data-testid="quartier-carte"]')
    sous = { type: 'agent', id: ID_CLAIRE, titre: 'Revue du budget', rect }
    await cliquerFond(vue)
    await act(async () => {
      vue.querySelector<HTMLElement>('[data-testid="quartier-carte-fermer"]')?.click()
    })
    expect(carte()).toBeNull()
    await cliquerFond(vue)
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(carte()).toBeNull()
    await cliquerFond(vue)
    sous = null
    await cliquerFond(vue)
    expect(carte()).toBeNull()
  })

  it('ouvre toujours le fil de MON tanuki au clic', async () => {
    poserClaire('Revue du budget')
    const { vue, onNavigate } = await monter()
    sous = { type: 'agent', id: 'conv-3', titre: 'Mon fil', rect }
    await cliquerFond(vue)
    expect(onNavigate).toHaveBeenCalledWith('chat')
    expect(vue.querySelector('[data-testid="quartier-carte"]')).toBeNull()
  })
})

describe('le bouton « Mes agents / Toute l’équipe » (D8)', () => {
  it('vaut « Toute l’équipe » par défaut', async () => {
    const { vue } = await monter()
    const presse = (mode: string): string | null | undefined =>
      vue.querySelector(`[data-testid="home-village-${mode}"]`)?.getAttribute('aria-pressed')
    expect(presse('equipe')).toBe('true')
    expect(presse('moi')).toBe('false')
  })

  it('masque les agents des collègues, et retient le choix', async () => {
    poserClaire('Revue du budget')
    const { vue } = await monter()
    expect(lireAgentsCollegues()).toHaveLength(1)
    await act(async () => {
      vue.querySelector<HTMLElement>('[data-testid="home-village-moi"]')?.click()
    })
    expect(window.localStorage.getItem(CLE_MODE_VILLAGE)).toBe('moi')
    expect(lireAgentsCollegues()).toHaveLength(0)
    expect(
      vue.querySelector('[data-testid="home-village-moi"]')?.getAttribute('aria-pressed')
    ).toBe('true')
    await act(async () => {
      vue.querySelector<HTMLElement>('[data-testid="home-village-equipe"]')?.click()
    })
    expect(lireAgentsCollegues()).toHaveLength(1)
  })

  it('n’apparaît pas sous un autre fond', async () => {
    window.localStorage.setItem(autowinStorageKey('home.decor.v4'), 'avenue')
    const { vue } = await monter()
    expect(vue.querySelector('[data-testid="home-village"]')).toBeNull()
  })
})
