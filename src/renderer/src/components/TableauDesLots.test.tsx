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
let lecturesDeCout: string[] = []

/** Lignes de coût rendues par `costBreakdown` pour un fil ; 'erreur' = canal qui rejette. */
type CoutsDeTest = Record<string, unknown[] | 'erreur'>

function ligneDeCout(costUsd: number, calls = 2): Record<string, unknown> {
  return {
    key: 'build',
    calls,
    costUsd,
    inputTokens: 1_000,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheHitRatio: 0,
    unpricedCalls: 0
  }
}

function poserApi(parFil: Record<string, VuePlanDeLots | null>, couts?: CoutsDeTest): void {
  appels = []
  lecturesDeCout = []
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.api = {
    plansDeLots: (geste: string, fil: string, planId?: string): Promise<ReponsePlansDeLots> => {
      appels.push([geste, fil, planId])
      return Promise.resolve(
        geste === 'voir' ? { ok: true, vue: parFil[fil] ?? null } : { ok: true, detail: 'ok' }
      )
    },
    // Absent quand le test ne donne aucun coût : un shell plus ancien n'expose pas ce canal.
    ...(couts
      ? {
          costBreakdown: (dimension: string, fil: string): Promise<unknown[]> => {
            lecturesDeCout.push(`${dimension}:${fil}`)
            const rendu = couts[fil]
            return rendu === 'erreur'
              ? Promise.reject(new Error('journal illisible'))
              : Promise.resolve(rendu ?? [])
          }
        }
      : {}),
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

  /*
   * Constat d'origine (conv-1146) : plus de 20 $ dans un seul fil sans que rien ne le montre. Chaque
   * lot dit donc sa durée et son coût, et le bilan le coût des lots — lu par `costBreakdown` et
   * résumé par le MÊME calcul que la pastille de coût du fil. Un coût inconnu se lit « — », jamais 0.
   */
  describe('durée et coût des lots', () => {
    function planMesure(): PlanDeLots {
      let p: PlanDeLots = { ...plan(), statut: 'en-cours' }
      p = marquerLance(p, 1, 'conv-100', 1_000)
      p = marquerLance(p, 2, 'conv-101', 2_000)
      // Lot 1 : 3 min 12 s entre son lancement et la fin de son tour.
      p = noterFinDeTour(p, 'conv-100', { ok: true }, 1_000 + 192_000).plan
      return p
    }

    const mesure = (hote: HTMLElement, rang: number, quoi: 'duree' | 'cout'): string =>
      hote.querySelector(`[data-testid="tdl-lot-${rang}-${quoi}"]`)?.textContent ?? ''

    it('chaque lot porte sa durée et son coût ; inconnu = « — » ; le bilan somme les lots mesurés', async () => {
      poserApi(
        { 'conv-1': { plan: planMesure(), role: 'chef' } },
        // conv-101 tourne encore : son journal n'a aucun appel → coût inconnu, pas 0.
        { 'conv-100': [ligneDeCout(1.5)], 'conv-101': [] }
      )
      const { hote, fin } = await monter('conv-1')
      expect(lecturesDeCout.sort()).toEqual(['actor:conv-100', 'actor:conv-101'])
      expect(mesure(hote, 1, 'duree')).toBe('3 min 12 s')
      expect(mesure(hote, 1, 'cout')).toBe('1,50 $')
      expect(mesure(hote, 2, 'duree')).toMatch(/^depuis \d{2}:\d{2}$/)
      expect(mesure(hote, 2, 'cout')).toBe('—')
      expect(mesure(hote, 3, 'duree')).toBe('—')
      expect(mesure(hote, 3, 'cout')).toBe('—')
      const total = hote.querySelector('[data-testid="tdl-cout-total"]')?.textContent
      expect(total).toBe('coût des lots 1,50 $ · 1 lot sans mesure')
      expect(hote.textContent).not.toMatch(/(^|[^\d,])0 \$|0,00 \$/)
      fin()
    })

    it('le total additionne les lots par le même calcul que la pastille de coût', async () => {
      poserApi(
        { 'conv-1': { plan: planMesure(), role: 'chef' } },
        { 'conv-100': [ligneDeCout(1.5)], 'conv-101': [ligneDeCout(2), ligneDeCout(0.25, 1)] }
      )
      const { hote, fin } = await monter('conv-1')
      expect(mesure(hote, 2, 'cout')).toBe('2,25 $')
      expect(hote.querySelector('[data-testid="tdl-cout-total"]')?.textContent).toBe(
        'coût des lots 3,75 $'
      )
      fin()
    })

    it('aucun coût lisible (canal absent ou en erreur) : « — » partout, jamais 0', async () => {
      poserApi({ 'conv-1': { plan: planMesure(), role: 'chef' } })
      const sansCanal = await monter('conv-1')
      expect(mesure(sansCanal.hote, 1, 'cout')).toBe('—')
      expect(sansCanal.hote.querySelector('[data-testid="tdl-cout-total"]')?.textContent).toBe(
        'coût des lots —'
      )
      sansCanal.fin()

      poserApi(
        { 'conv-1': { plan: planMesure(), role: 'chef' } },
        { 'conv-100': 'erreur', 'conv-101': 'erreur' }
      )
      const enErreur = await monter('conv-1')
      expect(mesure(enErreur.hote, 1, 'cout')).toBe('—')
      expect(mesure(enErreur.hote, 2, 'cout')).toBe('—')
      expect(enErreur.hote.querySelector('[data-testid="tdl-cout-total"]')?.textContent).toBe(
        'coût des lots —'
      )
      expect(enErreur.hote.textContent).not.toMatch(/0,00 \$/)
      enErreur.fin()
    })

    it('un plan sans lot lancé ne lit aucun coût', async () => {
      poserApi({ 'conv-1': { plan: plan(), role: 'chef' } }, {})
      const { hote, fin } = await monter('conv-1')
      expect(lecturesDeCout).toEqual([])
      expect(hote.querySelector('[data-testid="tdl-cout-total"]')?.textContent).toBe(
        'coût des lots —'
      )
      fin()
    })
  })

  it('dans un fil enfant : une ligne nomme le lot et le chef', async () => {
    poserApi({ 'conv-100': { plan: plan(), role: 'enfant', rang: 2 } })
    const { hote, fin } = await monter('conv-100')
    expect(hote.textContent).toContain('Lot 2/3')
    expect(hote.textContent).toContain('mené par conv-1')
    fin()
  })
})
