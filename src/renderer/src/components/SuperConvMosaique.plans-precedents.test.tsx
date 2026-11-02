// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { PlanDeLots, ReponsePlansDeLots } from '../../../shared/plan-de-lots'
import { BandeauSuperConv } from './SuperConvMosaique'

/*
 * conv-1394 (2026-10-31) : « masque aussi les lots des anciens plans d'un même chef dans la liste de
 * gauche, et rends-les accessibles depuis le bloc de la conv chef ». La liste ne leur donne plus de
 * ligne : le bloc du chef, nourri par le geste « anciens » du canal os:plansDeLots, est leur seul
 * chemin.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION EST FAUSSE : un bloc qui n'affiche que le
 * plan montré, ou un clic sur un ancien lot qui n'ouvre pas son fil.
 */
const T0 = Date.UTC(2026, 9, 30, 12, 0)

const plan = (id: string, titre: string, lots: PlanDeLots['lots']): PlanDeLots => ({
  id,
  chef: 'conv-c',
  cle: id,
  titre,
  parallele: 1,
  plafondTours: 6,
  toursLances: 2,
  statut: 'termine',
  avertissements: [],
  creeLe: T0,
  lots
})

const MONTRE = plan('plan-neuf', 'Plan montré', [
  { rang: 1, titre: 'Neuf', demande: 'x', fichiers: [], etat: 'fait', fil: 'conv-n1', debut: T0 }
])
const ANCIEN = plan('plan-ancien', 'Navigateur intégré', [
  { rang: 1, titre: 'Moteur', demande: 'x', fichiers: [], etat: 'fait', fil: 'conv-a1' },
  { rang: 2, titre: 'Panneau', demande: 'x', fichiers: [], etat: 'echec', fil: 'conv-a2' },
  { rang: 3, titre: 'Jamais parti', demande: 'x', fichiers: [], etat: 'a-faire' }
])

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  delete (window as { api?: unknown }).api
})

/** Le canal des plans : « anciens » rend `anciens`, le reste répond vide. */
function brancherCanal(anciens: PlanDeLots[] | 'geste-inconnu'): ReturnType<typeof vi.fn> {
  const plansDeLots = vi.fn(async (geste: string): Promise<ReponsePlansDeLots> => {
    if (geste === 'anciens')
      return anciens === 'geste-inconnu'
        ? { ok: false, erreur: 'geste « anciens » inconnu.' }
        : { ok: true, anciens }
    return { ok: true, phrases: {} }
  })
  ;(window as { api?: unknown }).api = { plansDeLots, onAppEvent: () => () => {} }
  return plansDeLots
}

async function monter(questions?: ReadonlySet<string>): Promise<HTMLElement> {
  const hote = document.createElement('div')
  document.body.appendChild(hote)
  await act(async () => {
    createRoot(hote).render(
      <BandeauSuperConv
        plan={MONTRE}
        onglet="chef"
        questions={questions}
        onOuvrirLot={() => {}}
        onRetour={() => {}}
      />
    )
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return hote
}

describe('le bloc du chef mène aux lots de ses anciens plans (conv-1394)', () => {
  it('liste chaque ancien plan et ses lots ouverts, avec leur état', async () => {
    const canal = brancherCanal([ANCIEN])
    const hote = await monter()

    expect(canal).toHaveBeenCalledWith('anciens', 'conv-c')
    const rangee = hote.querySelector('[data-testid="scm-ancien-plan-ancien"]')
    expect(rangee?.textContent).toContain('Plan précédent · Navigateur intégré')
    expect(hote.querySelector('[data-testid="scm-ancien-plan-ancien-1"]')?.textContent).toContain(
      '1 · Moteur'
    )
    expect(
      hote
        .querySelector('[data-testid="scm-ancien-plan-ancien-2"]')
        ?.classList.contains('scm-etat--echec')
    ).toBe(true)
    // Un lot jamais parti n'a pas de fil : rien à ouvrir, pas de bouton.
    expect(hote.querySelector('[data-testid="scm-ancien-plan-ancien-3"]')).toBeNull()
  })

  it('un clic sur un ancien lot ouvre SON fil', async () => {
    brancherCanal([ANCIEN])
    const ouverts: string[] = []
    const ecouter = (e: Event): void => {
      ouverts.push(String((e as CustomEvent).detail))
    }
    window.addEventListener('autowin:open-conversation', ecouter)
    const hote = await monter()

    await act(async () => {
      hote
        .querySelector<HTMLButtonElement>('[data-testid="scm-ancien-plan-ancien-2"] button')!
        .click()
    })
    window.removeEventListener('autowin:open-conversation', ecouter)
    expect(ouverts).toEqual(['conv-a2'])
  })

  it('un ancien lot qui attend ta réponse porte l’animation de question', async () => {
    brancherCanal([ANCIEN])
    const hote = await monter(new Set(['conv-a1']))
    expect(
      hote.querySelector('[data-testid="scm-ancien-plan-ancien-1"] .conversation-state.is-asking')
    ).not.toBeNull()
    expect(hote.querySelector('[data-testid="scm-ancien-plan-ancien-2"] .is-asking')).toBeNull()
  })

  it('rien de plus sans ancien plan, ni quand l’app ne connaît pas encore le geste', async () => {
    brancherCanal([])
    expect((await monter()).querySelector('[data-testid^="scm-ancien-"]')).toBeNull()
    brancherCanal('geste-inconnu')
    expect((await monter()).querySelector('[data-testid^="scm-ancien-"]')).toBeNull()
  })
})
