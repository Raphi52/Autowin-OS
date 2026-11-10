import { describe, expect, it } from 'vitest'
import { cibleNommeeTouchee, ciblesNommees } from './root-execution-contract'
import type { ExecutionEvidence } from '../providers/types'

/**
 * UNE CIBLE CITÉE PAR SON CHEMIN COMPLET SE COMPARE DANS LA COPIE DU RUN.
 *
 * Mesuré sur le run build-quand-menage-retire-copie-fi… (08/11/2026) : la demande citait
 * `D:/AutoWinOS/src/main/store/conversations.ts:NN`. La cible retenue était
 * `autowinos/src/main/store/conversations.ts`, alors que le run écrit dans une copie du dépôt
 * (`…/copies-de-taches/run-…/src/main/store/conversations.ts`) : aucun chemin modifié ne pouvait
 * finir par `autowinos/src/…`. Refus garanti, trois fois de suite, puis arrêt.
 */
const SEP = String.fromCharCode(92)
const DEMANDE =
  'Quand le ménage retire la copie, corrige D:/AutoWinOS/src/main/store/conversations.ts:120 pour garder la session.'
const DANS_LA_COPIE = [
  'D:',
  'AutoWinOS',
  '.autowin-data',
  'autowin-os',
  'copies-de-taches',
  'run-1'
]
const depotConnu = (chemin: string): boolean =>
  chemin.replace(/\\/g, '/').toLowerCase() === 'd:/autowinos/.git'

function mutation(...segments: string[]): ExecutionEvidence {
  return {
    kind: 'mutation',
    status: 'completed',
    ok: true,
    summary: 'edit',
    paths: [[...DANS_LA_COPIE, ...segments].join(SEP)]
  } as ExecutionEvidence
}

describe('cible nommée par un chemin complet', () => {
  it('la cible est ramenée au chemin dans le dépôt', () => {
    expect(ciblesNommees(DEMANDE, depotConnu)).toEqual(['src/main/store/conversations.ts'])
  })

  it('le même fichier modifié dans la copie du run touche la cible', () => {
    const preuve = [mutation('src', 'main', 'store', 'conversations.ts')]
    expect(cibleNommeeTouchee(DEMANDE, preuve, depotConnu)).toBe('touchee')
  })

  it('contrôle négatif : un autre fichier de la copie ne touche pas la cible', () => {
    const preuve = [mutation('src', 'main', 'store', 'autre.ts')]
    expect(cibleNommeeTouchee(DEMANDE, preuve, depotConnu)).toBe('manquee')
  })

  it('contrôle négatif : sans dépôt reconnu, le chemin cité reste tel quel', () => {
    expect(ciblesNommees(DEMANDE, () => false)).toEqual([
      'autowinos/src/main/store/conversations.ts'
    ])
  })
})
