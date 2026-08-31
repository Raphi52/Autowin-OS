import { describe, expect, it } from 'vitest'
import { NUAGE_FRAGMENT_SHADER } from './home-decor-scene'

/**
 * LE DÉFAUT (conv-1586, « gigalag ») : `fbm` recalcule DEUX `cos` et DEUX `sin` à CHAQUE
 * octave (7 octaves), et `main()` appelle `fbm` neuf fois par fragment. Soit 9 × 7 × 4 = 252
 * transcendantes par PIXEL d'un plan plein écran — le commit qui a introduit la rotation
 * par octave affirmait « le coût est nul », ce qui est faux et mesurable ici.
 *
 * Le contrat : la rotation par octave se PROPAGE par un produit de matrices constant
 * (mathématiquement identique), aucune transcendante dans la boucle de `fbm`.
 */
const corpsFbm = (): string => {
  const src = NUAGE_FRAGMENT_SHADER
  const debut = src.indexOf('float fbm(vec2 p) {')
  expect(debut).toBeGreaterThan(-1)
  const fin = src.indexOf('\n}', debut)
  return src.slice(debut, fin)
}

describe('coût par fragment du nuage', () => {
  it('la boucle de fbm ne contient AUCUN cos/sin par octave', () => {
    const corps = corpsFbm()
    // L'entrée qui ferait échouer une fausse correction : déplacer le cos/sin sous un autre nom
    // ou dans une fonction appelée depuis la boucle laisserait un `rotation(` ici.
    expect(corps).not.toMatch(/\b(cos|sin)\s*\(/)
    expect(corps).toMatch(/mat2/)
  })

  it('fbm garde ses 7 octaves (la correction ne doit pas payer en qualité)', () => {
    expect(corpsFbm()).toMatch(/octave\s*<\s*7/)
  })

  it('le shader garde ses appels fbm de rendu (pas de suppression de matière)', () => {
    const appels = NUAGE_FRAGMENT_SHADER.match(/fbm\(/g) ?? []
    // 9 appels dans main() + 1 définition + 0 ailleurs
    expect(appels.length).toBeGreaterThanOrEqual(9)
  })
})
