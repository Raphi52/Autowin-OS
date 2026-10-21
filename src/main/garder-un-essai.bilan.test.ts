import { describe, expect, it } from 'vitest'
import { bilanDeLaFacon } from './garder-un-essai'
import { demandePourLaFacon } from '../renderer/src/components/trois-facons'

/**
 * LA CARTE DE COMPARAISON, CÔTÉ TOUR (conv-1038, 2026-10-21 — idée 6) : où en est chaque façon, et
 * ce que ses vérifications (`verify`) ont RENDU — un code de sortie, pas ce que l'agent en dit.
 *
 * Les entrées qui feraient échouer une version fausse :
 *  - une vérification du fil d'ORIGINE, copiée dans la branche par le fork : ce n'est pas le
 *    travail de la façon, elle ne compte pas ;
 *  - une vérification interrompue : ni verte, ni passée sous silence ;
 *  - une branche dont la demande n'est pas encore enregistrée : « pas encore partie ».
 */

const user = (content: string): Record<string, unknown> => ({ role: 'user', content, ts: 1 })
const verify = (ok?: boolean, interrupted?: boolean): Record<string, unknown> => ({
  kind: 'action',
  name: 'verify',
  args: { type: 'test' },
  ...(ok === undefined ? {} : { ok }),
  ...(interrupted ? { interrupted } : {})
})
const asst = (
  status: string,
  parts: Array<Record<string, unknown>> = []
): Record<string, unknown> => ({
  role: 'assistant',
  content: '',
  ts: 2,
  status,
  parts
})

const ORIGINE = [user('la demande d’origine'), asst('completed', [verify(true), verify(false)])]

describe('bilanDeLaFacon', () => {
  it('compte les vérifications de la façon seulement, pas celles copiées du fil d’origine', () => {
    const bilan = bilanDeLaFacon([
      ...ORIGINE,
      user(demandePourLaFacon('fais X', 1, 3)),
      asst('completed', [verify(true), verify(true), verify(false), verify(undefined, true)])
    ])
    expect(bilan).toEqual({ etat: 'fini', vertes: 2, rouges: 2 })
  })

  it('l’état suit la dernière réponse de la façon', () => {
    const demande = user(demandePourLaFacon('fais X', 0, 3))
    expect(bilanDeLaFacon([...ORIGINE, demande, asst('streaming')]).etat).toBe('en-cours')
    expect(bilanDeLaFacon([...ORIGINE, demande, asst('failed')]).etat).toBe('echec')
    expect(bilanDeLaFacon([...ORIGINE, demande, asst('cancelled')]).etat).toBe('arrete')
    expect(bilanDeLaFacon([...ORIGINE, demande]).etat).toBe('pas-parti')
  })

  it('sans demande d’essai dans la branche : pas encore partie, rien de compté', () => {
    expect(bilanDeLaFacon(ORIGINE)).toEqual({ etat: 'pas-parti', vertes: 0, rouges: 0 })
  })
})
