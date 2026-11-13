import { describe, expect, it } from 'vitest'
import { demandeDeSignalement } from './signaler-fils'

describe('demandeDeSignalement', () => {
  it('prépare /kaizen sur le fil, et laisse le curseur après un espace', () => {
    expect(demandeDeSignalement(['conv-1789'])).toBe('/kaizen conv-1789 ')
  })

  it('range plusieurs fils du plus ancien au plus récent, sans doublon', () => {
    expect(demandeDeSignalement(['conv-1906', 'conv-205', 'conv-1906', ' conv-1789 '])).toBe(
      '/kaizen conv-205 conv-1789 conv-1906 '
    )
  })

  it('garde un identifiant d’une autre forme, après les numéros', () => {
    expect(demandeDeSignalement(['fil-test', 'conv-3'])).toBe('/kaizen conv-3 fil-test ')
  })
})
