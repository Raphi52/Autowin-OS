import { describe, expect, it } from 'vitest'
import {
  PANNEAU_BUREAUX,
  basculerBureaux,
  basculerNavigateurDans,
  sontBureauxOuverts,
  navigateurDuFil,
  navigateurOuvertDans
} from './panneau-outil'

describe('panneau d’outil du chat', () => {
  it('le navigateur ne s’affiche que dans le fil qui l’a ouvert', () => {
    const panneau = navigateurDuFil('A')
    expect(navigateurOuvertDans(panneau, 'A')).toBe(true)
    expect(navigateurOuvertDans(panneau, 'B')).toBe(false)
    // Fil neuf, pas encore créé : rien à montrer.
    expect(navigateurOuvertDans(panneau, null)).toBe(false)
  })

  it('le globe ouvre dans le fil courant, même si le navigateur était ouvert pour un autre', () => {
    expect(basculerNavigateurDans(null, 'A')).toEqual(navigateurDuFil('A'))
    expect(basculerNavigateurDans(navigateurDuFil('A'), 'A')).toBeNull()
    expect(basculerNavigateurDans(navigateurDuFil('A'), 'B')).toEqual(navigateurDuFil('B'))
    expect(basculerNavigateurDans(PANNEAU_BUREAUX, 'A')).toEqual(navigateurDuFil('A'))
  })

  it('sans fil ouvert, le globe ne change rien', () => {
    expect(basculerNavigateurDans(null, null)).toBeNull()
    expect(basculerNavigateurDans(PANNEAU_BUREAUX, null)).toBe(PANNEAU_BUREAUX)
  })

  it('les Bureaux cachés restent d’un fil à l’autre et prennent la place du navigateur', () => {
    expect(sontBureauxOuverts(PANNEAU_BUREAUX)).toBe(true)
    expect(basculerBureaux(navigateurDuFil('A'))).toBe(PANNEAU_BUREAUX)
    expect(basculerBureaux(PANNEAU_BUREAUX)).toBeNull()
    expect(navigateurOuvertDans(PANNEAU_BUREAUX, 'A')).toBe(false)
  })
})
