import { describe, expect, it, vi } from 'vitest'
import { protegerRappel } from './observabilite-non-bloquante'

describe('protegerRappel — un gel ne casse pas le tour', () => {
  it('absorbe le jet du verrou de trace au lieu de le propager au run', () => {
    const erreurs: string[] = []
    const protege = protegerRappel(
      'onStep',
      () => {
        throw new Error('allocation de sequence verrouillee trop longtemps')
      },
      (nom) => erreurs.push(nom)
    )
    expect(() => protege?.()).not.toThrow()
    expect(erreurs).toEqual(['onStep'])
  })

  it('laisse passer les appels normaux avec leurs arguments', () => {
    const vu = vi.fn()
    protegerRappel('onPhase', vu)?.({ step: 'gate' })
    expect(vu).toHaveBeenCalledWith({ step: 'gate' })
  })

  it('rend undefined quand il n y a rien a proteger', () => {
    expect(protegerRappel('onDelta', undefined)).toBeUndefined()
  })

  it('ne casse pas le tour meme si le signalement d erreur echoue', () => {
    const protege = protegerRappel(
      'onStep',
      () => {
        throw new Error('boum')
      },
      () => {
        throw new Error('le journal aussi est casse')
      }
    )
    expect(() => protege?.()).not.toThrow()
  })
})
