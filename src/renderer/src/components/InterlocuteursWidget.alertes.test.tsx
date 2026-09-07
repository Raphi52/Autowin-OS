// @vitest-environment happy-dom
/**
 * Le SWITCH d'alerte par interlocuteur, dans la tuile (demande du 2026-09-07).
 *
 * Ce que ce fichier protège, et qui casserait sans bruit :
 *  - basculer le switch ne doit PAS ouvrir le fil de la personne (le switch vit à côté du bouton) ;
 *  - le premier instantané ne SONNE PAS : sinon ouvrir l'accueil déclencherait une rafale de popups
 *    pour des non-lus parfois vieux de plusieurs jours ;
 *  - un message qui ARRIVE ensuite, lui, alerte — une seule fois.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InterlocuteursWidget } from './InterlocuteursWidget'
import { CLE_ALERTES_INTERLOCUTEURS } from './outlook-alertes'
import type { Interlocuteur, MessageInterlocuteur } from './outlook-model'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 8, 7, 12, 0, 0).getTime()
const popups: string[] = []

function message(part: Partial<MessageInterlocuteur> & { id: string }): MessageInterlocuteur {
  return {
    sujet: 'Devis',
    corps: 'corps',
    recuLe: NOW - 3_600_000,
    nonLu: false,
    deMoi: false,
    auteur: 'Zoé Martin',
    fil: 'devis',
    ...part
  }
}

function contact(messages: MessageInterlocuteur[]): Interlocuteur {
  return {
    echange: true,
    cle: 'zoe@ex.fr',
    nom: 'Zoé Martin',
    adresse: 'zoe@ex.fr',
    dernierNomRecu: NOW,
    nonLus: messages.filter((m) => m.nonLu).length,
    dernierEchange: NOW,
    messages
  }
}

const monte: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

function rendre(fils: Interlocuteur[]): {
  container: HTMLDivElement
  rerendre: (suivant: Interlocuteur[]) => void
} {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  monte.push({ root, container })
  const props = (f: Interlocuteur[]) => ({
    fils: f,
    now: NOW,
    onOuvrir: async () => undefined,
    ouvertureEnCours: null,
    onRepondre: async () => ({ ok: true }),
    onMarquerLu: async () => ({ ok: true })
  })
  act(() => root.render(createElement(InterlocuteursWidget, props(fils))))
  return {
    container,
    rerendre: (suivant) =>
      act(() => root.render(createElement(InterlocuteursWidget, props(suivant))))
  }
}

beforeEach(() => {
  popups.length = 0
  window.localStorage.clear()
  class NotifStub {
    static permission = 'granted'
    static requestPermission = async (): Promise<string> => 'granted'
    constructor(titre: string) {
      popups.push(titre)
    }
  }
  vi.stubGlobal('Notification', NotifStub)
  // Pas de contexte audio dans happy-dom : `jouerSon` doit rendre `false` sans casser l'alerte.
  vi.stubGlobal('AudioContext', undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const { root, container } of monte.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('switch d’alerte par interlocuteur', () => {
  it('s’active sans ouvrir le fil, et se réactive au rendu suivant', () => {
    const { container, rerendre } = rendre([contact([message({ id: 'm1' })])])
    const bascule = container.querySelector<HTMLInputElement>(
      '[data-testid="home-contact-alerte-zoe@ex.fr"]'
    )
    expect(bascule).not.toBeNull()
    act(() => bascule!.click())
    // Toujours sur la liste des contacts : le switch n'a pas déclenché l'ouverture.
    expect(container.querySelector('[data-testid="home-contact-zoe@ex.fr"]')).not.toBeNull()
    expect(window.localStorage.getItem(CLE_ALERTES_INTERLOCUTEURS)).toContain('zoe@ex.fr')
    rerendre([contact([message({ id: 'm1' })])])
    expect(
      container.querySelector<HTMLInputElement>('[data-testid="home-contact-alerte-zoe@ex.fr"]')!
        .checked
    ).toBe(true)
  })

  it('ne sonne pas pour l’existant, alerte une seule fois pour l’arrivant', () => {
    window.localStorage.setItem(CLE_ALERTES_INTERLOCUTEURS, JSON.stringify(['zoe@ex.fr']))
    const ancien = message({ id: 'vieux', nonLu: true })
    const { rerendre } = rendre([contact([ancien])])
    expect(popups).toEqual([])
    const nouveau = message({ id: 'neuf', sujet: 'Relance', nonLu: true, recuLe: NOW })
    rerendre([contact([ancien, nouveau])])
    expect(popups).toEqual(['Zoé Martin — Relance'])
    rerendre([contact([ancien, nouveau])])
    expect(popups).toEqual(['Zoé Martin — Relance'])
  })
})
