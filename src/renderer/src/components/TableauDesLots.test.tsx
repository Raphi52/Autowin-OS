// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { TableauDesLots } from './TableauDesLots'
import {
  creerPlan,
  lirePlanDeLots,
  marquerLance,
  noterFinDeTour,
  type PlanDeLots,
  type ReponsePlansDeLots,
  type VuePlanDeLots
} from '../../../shared/plan-de-lots'

/*
 * conv-1150 : le fil chef montre l'avancement de ses lots, et c'est là — et seulement là — que
 * l'utilisateur lance le plan d'un clic.
 */
let ecouteur: ((e: { type: string; scope?: string }) => void) | undefined
let appels: Array<[string, string, string | undefined]> = []

function poserApi(parFil: Record<string, VuePlanDeLots | null>): void {
  appels = []
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.api = {
    plansDeLots: (geste: string, fil: string, planId?: string): Promise<ReponsePlansDeLots> => {
      appels.push([geste, fil, planId])
      return Promise.resolve(
        geste === 'voir' ? { ok: true, vue: parFil[fil] ?? null } : { ok: true, detail: 'ok' }
      )
    },
    onAppEvent: (cb: typeof ecouteur) => {
      ecouteur = cb
      return () => {
        ecouteur = undefined
      }
    }
  }
}

async function monter(conversationId: string): Promise<{ hote: HTMLElement; fin: () => void }> {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  const racine = createRoot(hote)
  await act(async () => {
    racine.render(<TableauDesLots conversationId={conversationId} />)
  })
  return { hote, fin: () => act(() => racine.unmount()) }
}

function plan(): PlanDeLots {
  const lu = lirePlanDeLots({
    titre: 'Traduction anglaise',
    parallele: 2,
    lots: [1, 2, 3].map((n) => ({ titre: `Écrans ${n}`, demande: `/build groupe ${n}` }))
  })
  if (!lu.ok) throw new Error(lu.erreur)
  return creerPlan(lu.plan, { id: 'plan-a', chef: 'conv-1', maintenant: 1 })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('TableauDesLots', () => {
  it('plan en attente : les lots, et UN bouton qui annonce lots, parallélisme et plafond', async () => {
    poserApi({ 'conv-1': { plan: plan(), role: 'chef' } })
    const { hote, fin } = await monter('conv-1')
    expect(hote.querySelectorAll('.tdl-lot')).toHaveLength(3)
    const bouton = hote.querySelector('.tdl-bouton--principal') as HTMLButtonElement
    expect(bouton.textContent).toBe('Lancer le plan — 3 lots, 2 en parallèle, plafond 6 tours')
    await act(async () => bouton.click())
    expect(appels.at(-1)).toEqual(['accepter', 'conv-1', 'plan-a'])
    fin()
  })

  it('plan en cours : état de chaque lot et fil qui le traite, sans bouton de lancement', async () => {
    let p: PlanDeLots = { ...plan(), statut: 'en-cours' }
    p = marquerLance(p, 1, 'conv-100', 2)
    p = marquerLance(p, 2, 'conv-101', 2)
    p = noterFinDeTour(p, 'conv-100', { ok: false, erreur: 'tests rouges' }, 3).plan
    poserApi({ 'conv-1': { plan: p, role: 'chef' } })
    const { hote, fin } = await monter('conv-1')
    const etats = [...hote.querySelectorAll('[data-lot-etat]')].map((l) =>
      l.getAttribute('data-lot-etat')
    )
    expect(etats).toEqual(['echec', 'en-cours', 'a-faire'])
    expect(hote.textContent).toContain('tests rouges')
    expect(hote.textContent).toContain('conv-101')
    expect(hote.textContent).toContain('0 fait, 1 en échec, 1 en cours, 1 à faire sur 3')
    expect(hote.textContent).not.toContain('Lancer le plan')
    expect(hote.textContent).toContain('Arrêter (aucun nouveau lot)')
    fin()
  })

  it('se relit au signal « plans-de-lots » ; un fil sans plan n’affiche rien', async () => {
    poserApi({ 'conv-1': null })
    const { hote, fin } = await monter('conv-1')
    expect(hote.querySelector('[data-testid="tableau-des-lots"]')).toBeNull()
    poserApi({ 'conv-1': { plan: plan(), role: 'chef' } })
    await act(async () => ecouteur?.({ type: 'refresh', scope: 'plans-de-lots' }))
    expect(hote.querySelector('[data-testid="tableau-des-lots"]')).not.toBeNull()
    fin()
  })

  it('dans un fil enfant : une ligne nomme le lot et le chef', async () => {
    poserApi({ 'conv-100': { plan: plan(), role: 'enfant', rang: 2 } })
    const { hote, fin } = await monter('conv-100')
    expect(hote.textContent).toContain('Lot 2/3')
    expect(hote.textContent).toContain('mené par conv-1')
    fin()
  })
})
