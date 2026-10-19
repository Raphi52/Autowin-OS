import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { positionNuage } from './home-decor-scene'

/**
 * LE DÉFAUT (conv-1476, « le nuage est statique ») : sur la machine de l'utilisateur,
 * `prefers-reduced-motion: reduce` est ACTIF, et le décor recevait alors un temps
 * CONSTANT (`reduceMotion ? 12 : time / 1000`). Le shader du nuage et `positionNuage` sont tous
 * deux fonctions du temps : temps figé = nuage figé. La matière n'était pas en cause.
 *
 * PUIS (conv-1018, 2026-10-19) : le temps n'était plus figé mais RALENTI d'un facteur 0,25 sous la
 * même préférence — « le fond d'écran 3d de l'accueil défile super lentement ». Décision de
 * l'utilisateur : le décor suit l'horloge réelle, quel que soit ce réglage. La vitesse elle-même est
 * prouvée par `DecorDeFond.vitesse.test.tsx`.
 */
describe('le décor vit, à vitesse réelle', () => {
  it('le nuage se DÉPLACE réellement entre deux instants', () => {
    const cadre = { halfWidth: 10, halfHeight: 6 }
    const a = positionNuage(0, cadre)
    const b = positionNuage(10, cadre)
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeGreaterThan(0.05)
  })

  /*
   * LA CIBLE A SUIVI LE CODE : le decor a quitte `HomeView` pour `DecorDeFond`, devenu le fond de
   * TOUTE l'application. Laisser ce test lire `HomeView.tsx` le rendrait vert en ne verifiant plus
   * rien — le fichier n'y contient plus une seule ligne de rendu. La garantie se verifie ou elle vit.
   */
  it('le decor recoit l horloge, ni une constante ni un temps ralenti', () => {
    const source = readFileSync(join(__dirname, 'DecorDeFond.tsx'), 'utf8')
    expect(source).not.toMatch(/reduceMotion\s*\?\s*\d+\s*:/)
    expect(source).toMatch(/scene\.render\(\s*time\s*\/\s*1000\s*,\s*look\s*\)/)
  })
})
