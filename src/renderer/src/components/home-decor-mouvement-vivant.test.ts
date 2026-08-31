import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tempsDecor, MOUVEMENT_REDUIT, positionNuage } from './home-decor-scene'

/**
 * LE DÉFAUT (conv-1476, « le nuage est statique ») : sur la machine de l'utilisateur,
 * `prefers-reduced-motion: reduce` est ACTIF, et le décor recevait alors un temps
 * CONSTANT (`reduceMotion ? 12 : time / 1000`). Le shader du nuage et `positionNuage` sont tous
 * deux fonctions du temps : temps figé = nuage figé. La matière n'était pas en cause.
 *
 * Le contrat : mouvement réduit RALENTIT le temps, il ne l'ARRÊTE pas.
 */
describe('le décor vit même en mouvement réduit', () => {
  it('le temps AVANCE en mouvement réduit (ralenti, jamais figé)', () => {
    const t1 = tempsDecor(10, true)
    const t2 = tempsDecor(20, true)
    expect(t2).toBeGreaterThan(t1)
    // L'entrée qui ferait échouer une fausse correction : un `return 12` constant, ou un facteur 0.
    expect(MOUVEMENT_REDUIT.facteur).toBeGreaterThan(0)
    expect(MOUVEMENT_REDUIT.facteur).toBeLessThan(1)
    expect(t2 - t1).toBeCloseTo(10 * MOUVEMENT_REDUIT.facteur, 6)
  })

  it('hors mouvement réduit, le temps est INTACT', () => {
    expect(tempsDecor(37.5, false)).toBe(37.5)
  })

  it('le nuage se DÉPLACE réellement entre deux instants de mouvement réduit', () => {
    const cadre = { halfWidth: 10, halfHeight: 6 }
    const a = positionNuage(tempsDecor(0, true), cadre)
    const b = positionNuage(tempsDecor(40, true), cadre)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.05)
  })

  /*
   * LA CIBLE A SUIVI LE CODE : le decor a quitte `HomeView` pour `DecorDeFond`, devenu le fond de
   * TOUTE l'application. Laisser ce test lire `HomeView.tsx` le rendrait vert en ne verifiant plus
   * rien — le fichier n'y contient plus une seule ligne de rendu. La garantie se verifie ou elle vit.
   */
  it('le decor passe le temps par tempsDecor, plus par une constante', () => {
    const source = readFileSync(join(__dirname, 'DecorDeFond.tsx'), 'utf8')
    expect(source).not.toMatch(/reduceMotion\s*\?\s*\d+\s*:/)
    expect(source).toMatch(/tempsDecor\(\s*time\s*\/\s*1000\s*,\s*reduceMotion\s*\)/)
  })
})
