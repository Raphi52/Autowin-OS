import { describe, expect, it } from 'vitest'
import { departPourModifier } from './modifier-relancer'

/**
 * « MODIFIER ET RELANCER » (conv-1038, 2026-10-21) : reprendre un de ses messages, le corriger, et
 * repartir de LÀ. `fork()` (store/conversations.ts) copie jusqu'au message choisi INCLUS : pour
 * repartir AVANT le message à modifier, la copie s'ancre sur le message qui le précède.
 */
const FIL = [
  { messageId: 'm-1' },
  { messageId: 'm-2' },
  {}, // message ancien sans identifiant : jamais une ancre (fork le refuse)
  { messageId: 'm-4' }
]

describe('departPourModifier', () => {
  it('message au milieu du fil : copie ancrée sur le message JUSTE AVANT, pas sur lui', () => {
    expect(departPourModifier(FIL, 'm-2')).toEqual({ kind: 'copie', ancre: 'm-1' })
  })

  it('le message précédent n’a pas d’identifiant : l’ancre remonte au dernier qui en a un', () => {
    expect(departPourModifier(FIL, 'm-4')).toEqual({ kind: 'copie', ancre: 'm-2' })
  })

  // L'entrée qui casse une implémentation naïve : rien AVANT le premier message, donc aucune copie
  // possible — copier « jusqu'à lui » le garderait, et la version modifiée s'ajouterait à côté.
  it('premier message du fil : un fil NEUF, aucune copie', () => {
    expect(departPourModifier(FIL, 'm-1')).toEqual({ kind: 'fil-neuf' })
  })

  it('message inconnu du fil : rien', () => {
    expect(departPourModifier(FIL, 'absent')).toBeNull()
  })
})
