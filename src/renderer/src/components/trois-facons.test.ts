import { describe, expect, it } from 'vitest'
import { FACONS, demandePourLaFacon, titreDeLaFacon } from './trois-facons'

/**
 * « ESSAIE 3 FAÇONS » (conv-1038, 2026-10-21) : la même demande part dans trois branches du fil,
 * chacune dans sa copie séparée, avec une façon IMPOSÉE. Sans façon imposée, trois tours du même
 * modèle sur le même texte donnent trois fois à peu près la même réponse : on paierait trois fois
 * pour un seul avis.
 *
 * L'entrée qui ferait échouer une version fausse : deux rangs différents qui recevraient le MÊME
 * texte.
 */
describe('demandePourLaFacon', () => {
  it('chaque rang porte la demande ET une façon différente des deux autres', () => {
    const textes = [0, 1, 2].map((rang) => demandePourLaFacon('refais le carnet', rang, 3))
    expect(new Set(textes).size).toBe(3)
    for (const [rang, texte] of textes.entries()) {
      expect(texte.startsWith('refais le carnet\n\n')).toBe(true)
      expect(texte).toContain(`Essai ${rang + 1}/3`)
      expect(texte).toContain(FACONS[rang])
    }
  })

  it('dit à chaque branche de ne rien publier ni fusionner, et de rendre de quoi comparer', () => {
    const texte = demandePourLaFacon('x', 0, 3)
    expect(texte).toMatch(/ne publie rien/i)
    expect(texte).toMatch(/ne fusionne rien/i)
    expect(texte).toMatch(/preuve/i)
  })
})

describe('titreDeLaFacon', () => {
  it('le titre de la branche dit sa façon', () => {
    expect(titreDeLaFacon('Refonte du chat', 1, 3)).toBe('Refonte du chat — façon 2/3')
  })
  it('un titre déjà marqué n’empile pas les marques', () => {
    expect(titreDeLaFacon('Refonte du chat — façon 1/3', 2, 3)).toBe('Refonte du chat — façon 3/3')
  })
})
