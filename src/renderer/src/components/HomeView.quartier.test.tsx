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
