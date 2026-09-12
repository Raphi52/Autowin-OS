import { describe, expect, it } from 'vitest'
import {
  MARGE_APRES_RESET_MS,
  deciderRepriseProgrammee,
  libelleRepriseProgrammee,
  type EtatRepriseProgrammee
} from './reprise-quota-planifiee'
import type { ModelQuota, ModelQuotaWindow } from '../../../shared/model-quotas'

/*
 * PIÈCE 3 — la reprise s'arme TOUTE SEULE à l'heure du retour de quota.
 *
 * Ce qui doit être prouvé n'est pas « ça se déclenche », c'est « ça NE se déclenche PAS » dans les
 * cas où un déclenchement coûterait : refus de l'utilisateur, reprise déjà en cours, échéance déjà
 * jouée. Une reprise automatique qui repart en boucle brûle le quota qui vient de revenir.
 */

const MAINTENANT = new Date('2026-09-11T18:00:00.000Z')
const RESET = '2026-09-11T19:10:00.000Z'

function quotas(...resets: string[]): { models: ModelQuota[] } {
  const windows: ModelQuotaWindow[] = resets.map((resetsAt, index) => ({
    id: `w${index}`,
    label: '5 h',
    usedPercent: 100,
    remainingPercent: 0,
    resetsAt
  }))
  return {
    models: [
      {
        modelId: 'claude',
        model: 'claude-opus',
        label: 'Opus',
        provider: 'claude',
        shared: false,
        status: 'available',
        source: 'test',
        windows
      }
    ]
  }
}

const BASE: EtatRepriseProgrammee = {
  coupees: 2,
  quotas: quotas(RESET),
  refusee: false,
  enCours: false,
  maintenant: MAINTENANT
}

describe('reprise programmée au retour du quota', () => {
  it('programme la reprise à l’heure du reset, avec une marge d’une minute', () => {
    const decision = deciderRepriseProgrammee(BASE)
    expect(decision).toEqual({
      type: 'programmer',
      resetsAt: RESET,
      dansMs: 70 * 60_000 + MARGE_APRES_RESET_MS
    })
  })

  it('« ne pas reprendre » VERROUILLE : le refus prime sur l’échéance', () => {
    expect(deciderRepriseProgrammee({ ...BASE, refusee: true })).toEqual({ type: 'aucune' })
  })

  it('CAS LIMITE — aucune conversation coupée : rien à programmer', () => {
    expect(deciderRepriseProgrammee({ ...BASE, coupees: 0 })).toEqual({ type: 'aucune' })
  })

  it('CAS LIMITE — une reprise tourne déjà : pas de doublon', () => {
    expect(deciderRepriseProgrammee({ ...BASE, enCours: true })).toEqual({ type: 'aucune' })
  })

  it('CAS LIMITE — l’échéance déjà jouée ne se rejoue PAS (pas de boucle sur un mur qui tient)', () => {
    expect(deciderRepriseProgrammee({ ...BASE, dejaTentee: RESET })).toEqual({ type: 'aucune' })
  })

  it('une NOUVELLE échéance après une tentative ratée, elle, se programme', () => {
    const etat = { ...BASE, quotas: quotas('2026-09-11T23:00:00.000Z'), dejaTentee: RESET }
    expect(deciderRepriseProgrammee(etat)).toMatchObject({
      type: 'programmer',
      resetsAt: '2026-09-11T23:00:00.000Z'
    })
  })

  it('CAS LIMITE — quotas pas encore lus, ou reset déjà passé : rien', () => {
    expect(deciderRepriseProgrammee({ ...BASE, quotas: null })).toEqual({ type: 'aucune' })
    expect(
      deciderRepriseProgrammee({ ...BASE, quotas: quotas('2026-09-11T10:00:00.000Z') })
    ).toEqual({ type: 'aucune' })
  })

  it('entre deux échéances futures, la PLUS PROCHE est retenue', () => {
    const etat = { ...BASE, quotas: quotas('2026-09-12T06:00:00.000Z', RESET) }
    expect(deciderRepriseProgrammee(etat)).toMatchObject({ resetsAt: RESET })
  })

  it('le libellé dit l’heure locale et le nombre de fils concernés', () => {
    const heure = new Date(RESET).toLocaleTimeString('fr-FR', {
      hour: '2-digit',
      minute: '2-digit'
    })
    expect(libelleRepriseProgrammee(RESET, 3)).toBe(
      `3 conversations reprises automatiquement à ${heure}`
    )
    expect(libelleRepriseProgrammee(RESET, 1)).toBe(`reprise automatiquement à ${heure}`)
  })
})
