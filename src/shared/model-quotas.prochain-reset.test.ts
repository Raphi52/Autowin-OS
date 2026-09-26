import { describe, expect, it } from 'vitest'
import { prochainResetUtile } from './model-quotas'
import type { ModelQuota, ModelQuotaWindow } from './model-quotas'

/*
 * PIÈCE 2 de la reprise automatique au retour du quota.
 *
 * `resetsAt` existe depuis longtemps mais n'était qu'AFFICHÉ. Pour armer un minuteur, il faut
 * répondre à une question précise : « dans combien de temps ça redevient possible ? » — et une
 * réponse fausse coûte cher dans les deux sens (un minuteur qui part tout de suite relance dans le
 * mur ; un minuteur jamais armé laisse l'utilisateur attendre à la main).
 */

const MAINTENANT = new Date('2026-09-11T18:00:00.000Z')

function fenetre(resetsAt?: string): ModelQuotaWindow {
  return {
    id: 'five-hour',
    label: '5 h',
    usedPercent: 100,
    remainingPercent: 0,
    ...(resetsAt ? { resetsAt } : {})
  }
}

function modele(...windows: ModelQuotaWindow[]): ModelQuota {
  return {
    modelId: 'claude',
    model: 'claude-opus',
    label: 'Opus',
    provider: 'claude',
    shared: false,
    status: 'available',
    source: 'test',
    windows
  }
}

describe('prochainResetUtile', () => {
  it('rend l’échéance future la plus PROCHE — c’est elle qui rend la main en premier', () => {
    const snapshot = {
      models: [
        modele(fenetre('2026-09-12T06:00:00.000Z')),
        modele(fenetre('2026-09-11T19:10:00.000Z'), fenetre('2026-09-18T00:00:00.000Z'))
      ]
    }
    expect(prochainResetUtile(snapshot, MAINTENANT)).toBe('2026-09-11T19:10:00.000Z')
  })

  it('IGNORE un reset déjà passé — sinon le minuteur partirait immédiatement, dans le mur', () => {
    const snapshot = {
      models: [modele(fenetre('2026-09-11T17:00:00.000Z'), fenetre('2026-09-11T20:00:00.000Z'))]
    }
    expect(prochainResetUtile(snapshot, MAINTENANT)).toBe('2026-09-11T20:00:00.000Z')
  })

  it('CAS LIMITE — un reset qui tombe PILE maintenant est déjà consommé', () => {
    const snapshot = { models: [modele(fenetre('2026-09-11T18:00:00.000Z'))] }
    expect(prochainResetUtile(snapshot, MAINTENANT)).toBeUndefined()
  })

  it('CAS LIMITE — une fenêtre sans resetsAt est ignorée, jamais devinée', () => {
    const snapshot = { models: [modele(fenetre(), fenetre('2026-09-11T19:10:00.000Z'))] }
    expect(prochainResetUtile(snapshot, MAINTENANT)).toBe('2026-09-11T19:10:00.000Z')
  })

  it('CAS LIMITE — une date illisible n’arme rien (elle vaudrait un minuteur au hasard)', () => {
    const snapshot = { models: [modele(fenetre('bientôt'))] }
    expect(prochainResetUtile(snapshot, MAINTENANT)).toBeUndefined()
  })

  it('CAS LIMITE — aucune échéance future du tout : rien à planifier', () => {
    const snapshot = { models: [modele(fenetre('2026-09-10T18:00:00.000Z'))] }
    expect(prochainResetUtile(snapshot, MAINTENANT)).toBeUndefined()
  })

  it('CAS LIMITE — snapshot absent, vide, ou modèle sans fenêtre : aucune exception', () => {
    expect(prochainResetUtile(undefined, MAINTENANT)).toBeUndefined()
    expect(prochainResetUtile(null, MAINTENANT)).toBeUndefined()
    expect(prochainResetUtile({ models: [] }, MAINTENANT)).toBeUndefined()
    expect(prochainResetUtile({ models: [modele()] }, MAINTENANT)).toBeUndefined()
  })

  it('l’heure de référence par défaut est l’instant courant — appel sans second argument', () => {
    const futur = new Date(Date.now() + 3_600_000).toISOString()
    const passe = new Date(Date.now() - 3_600_000).toISOString()
    expect(prochainResetUtile({ models: [modele(fenetre(passe), fenetre(futur))] })).toBe(futur)
  })
})
