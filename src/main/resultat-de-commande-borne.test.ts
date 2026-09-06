import { describe, expect, it } from 'vitest'
import {
  CARACTERES_MAX_RESULTAT_COMMANDE,
  bornerResultatDeCommande
} from './resultat-de-commande-borne'

describe('resultat de commande — plafond a l injection', () => {
  it('laisse un resultat ordinaire intact', () => {
    const rendu = 'retrospective → {"ok":true}'
    expect(bornerResultatDeCommande('retrospective', rendu)).toBe(rendu)
  })

  it('coupe le resultat geant qui a tue conv-312, et le DIT', () => {
    // 2 860 957 caracteres rendus par `retrospective` : le prompt passait a ~890 k tokens.
    const geant = 'x'.repeat(2_860_957)
    const borne = bornerResultatDeCommande('retrospective', geant)
    expect(borne.length).toBeLessThan(CARACTERES_MAX_RESULTAT_COMMANDE + 600)
    expect(borne).toContain('RESULTAT TRONQUE')
    expect(borne).toContain('retrospective')
    expect(borne).toContain(String(2_860_957 - CARACTERES_MAX_RESULTAT_COMMANDE))
  })

  it('ne coupe jamais en silence : la coupe nomme ce qui manque', () => {
    const borne = bornerResultatDeCommande('read_file', 'y'.repeat(200), 100)
    expect(borne.startsWith('y'.repeat(100))).toBe(true)
    expect(borne).toContain('100 caractere(s)')
  })
})
