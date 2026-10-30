// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PlanDeLots } from '../../../shared/plan-de-lots'
import { SuperConvDuChat } from './SuperConvMosaique'

/*
 * conv-1315 : ChatView se redessine à chaque mot d'un flux. Les onglets et la frise du panneau de
 * chat ne doivent pas suivre, sinon chaque image redemande toutes les phrases des pistes (le gel
 * mesuré sur la mosaïque, conv-1581).
 */
const T0 = Date.UTC(2026, 9, 30, 13, 0)
const PLAN: PlanDeLots = {
  id: 'plan-1',
  chef: 'conv-c',
  cle: 'k',
  titre: 'Super conv',
  parallele: 3,
  plafondTours: 6,
  toursLances: 1,
  statut: 'en-cours',
  avertissements: [],
  creeLe: T0,
  lots: [{ rang: 1, titre: 'Lot', demande: 'x', fichiers: [], etat: 'fait', fil: 'conv-l1' }]
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  ;(window as unknown as { api?: unknown }).api = undefined
})

describe('SuperConvDuChat', () => {
  it('un rendu de la vue aux mêmes valeurs ne redemande pas les phrases', async () => {
    const plansDeLots = vi.fn(async () => ({ ok: true as const, phrases: { 1: 'Livré.' } }))
    ;(window as unknown as { api: unknown }).api = { plansDeLots }
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const racine = createRoot(hote)
    const rendre = (): Promise<void> =>
      act(async () => {
        racine.render(<SuperConvDuChat plan={PLAN} onglet="chef" />)
      })
    await rendre()
    const lectures = plansDeLots.mock.calls.length
    expect(lectures).toBeGreaterThan(0)
    expect(hote.querySelector('[data-testid="scm-piste-1"]')?.textContent).toContain('Livré.')
    await rendre()
    await rendre()
    expect(plansDeLots.mock.calls.length).toBe(lectures)
    await act(async () => racine.unmount())
  })

  it('la frise du chat ne double pas Arrêter et Reprendre : ils restent au bas du fil', async () => {
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const racine = createRoot(hote)
    await act(async () => {
      racine.render(<SuperConvDuChat plan={PLAN} onglet="chef" />)
    })
    expect(hote.querySelector('[data-testid="scm-arreter"]')).toBeNull()
    expect(hote.querySelector('[data-testid="scm-reprendre"]')).toBeNull()
    await act(async () => racine.unmount())
  })

  it('l’onglet suit le titre de la conv, renommée ou non', async () => {
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const racine = createRoot(hote)
    const rendre = (titres: ReadonlyMap<string, string>): Promise<void> =>
      act(async () => {
        racine.render(<SuperConvDuChat plan={PLAN} onglet="chef" titres={titres} />)
      })
    const textes = (): (string | null)[] =>
      [...hote.querySelectorAll('.scm-onglet')].map((o) => o.textContent)
    await rendre(
      new Map([
        ['conv-c', 'Le chef'],
        ['conv-l1', 'Lot 1/1 — Lot']
      ])
    )
    expect(textes()).toEqual(['Le chef', 'Lot 1/1 — Lot'])
    await rendre(
      new Map([
        ['conv-c', 'Le chef'],
        ['conv-l1', 'Renommé par moi']
      ])
    )
    expect(textes()).toEqual(['Le chef', 'Renommé par moi'])
    await rendre(new Map())
    expect(textes()).toEqual(['Chef', 'Lot 1/1 — Lot'])
    await act(async () => racine.unmount())
  })

  it('l’onglet ouvert reste visible et la molette parcourt les onglets qui débordent', async () => {
    const plan: PlanDeLots = {
      ...PLAN,
      lots: [1, 2, 3].map((rang) => ({ ...PLAN.lots[0], rang, fil: `conv-l${rang}` }))
    }
    // Une bande de 300 px, et un onglet de 200 px à chaque rang : le 3e commence à 600 px.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const rang = Number(this.dataset.testid?.replace('scm-onglet-', ''))
      const left = Number.isNaN(rang) ? 0 : rang * 200
      const width = this.classList.contains('scm-onglets') ? 300 : 200
      return { left, right: left + width, width } as DOMRect
    })
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const racine = createRoot(hote)
    await act(async () => {
      racine.render(<SuperConvDuChat plan={plan} onglet={3} />)
    })
    const bande = hote.querySelector<HTMLElement>('.scm-onglets')!
    expect(bande.scrollLeft).toBe(500)
    await act(async () => {
      bande.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true }))
    })
    expect(bande.scrollLeft).toBe(380)
    await act(async () => racine.unmount())
  })

  it('un onglet ouvre le fil du lot par le canal d’ouverture du chat', async () => {
    const ouverts: unknown[] = []
    const ecouter = (e: Event): void => {
      ouverts.push((e as CustomEvent).detail)
    }
    window.addEventListener('autowin:open-conversation', ecouter)
    const hote = document.createElement('div')
    document.body.appendChild(hote)
    const racine = createRoot(hote)
    await act(async () => {
      racine.render(<SuperConvDuChat plan={PLAN} onglet="chef" />)
    })
    await act(async () => {
      hote.querySelector<HTMLElement>('[data-testid="scm-onglet-1"]')?.click()
    })
    expect(ouverts).toEqual(['conv-l1'])
    window.removeEventListener('autowin:open-conversation', ecouter)
    await act(async () => racine.unmount())
  })
})
