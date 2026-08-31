import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * DEUX REGRESSIONS VUES PAR L'UTILISATEUR LE MEME JOUR (2026-08-31), toutes deux nees d'un fond.
 *
 * 1. « quand je suis dans accueil je ne vois plus le menu de gauche » — `.decor-de-fond` etait
 *    `position: fixed; z-index: 0`, et `.rail` n'est ni positionne ni indexe. L'ordre de peinture
 *    CSS place les blocs statiques (etape 4) AVANT les positionnes a z-index 0 (etape 8) : le fond
 *    recouvrait donc le menu, quelle que soit sa place dans le DOM.
 * 2. « j'ai perdu mon ancien fond d'ecran 2d sur les vues » — le 2D avait ete retire du `body` quand
 *    le decor 3D couvrait toutes les vues ; le 3D a ensuite ete restreint a l'Accueil, laissant les
 *    autres vues sans aucun fond.
 *
 * Ces regles sont VERIFIEES SUR LE CSS, pas sur un rendu : un test de rendu jsdom ne calcule aucun
 * ordre de peinture, il aurait passe au vert dans les deux cas.
 */
const css = (name: string): string =>
  readFileSync(new URL(`../assets/${name}`, import.meta.url), 'utf8')

/**
 * Extrait le corps d'une regle. ANCRE EN DEBUT DE LIGNE (`^` multiligne) : sans cet ancrage, le
 * selecteur `body` etait d'abord trouve DANS un commentaire qui le mentionne, et le test lisait un
 * corps qui n'etait pas le bon -- il echouait sur un CSS pourtant juste.
 */
const regle = (feuille: string, selecteur: string): string => {
  const echappe = selecteur.replace(/[.]/g, '[.]')
  return feuille.match(new RegExp('^' + echappe + '[ ]*[{]([^}]*)[}]', 'ms'))?.[1] ?? ''
}

describe('empilement du decor de fond', () => {
  it('le decor passe DERRIERE la coque, jamais devant (menu de gauche visible)', () => {
    const corps = regle(css('theme.css'), '.decor-de-fond')
    expect(corps).toMatch(/z-index:\s*-1\s*;/)
    // Le piege exact a re-interdire : un z-index nul ou positif recouvrirait `.rail`, statique.
    expect(corps).not.toMatch(/z-index:\s*[0-9]/)
  })

  it('le menu de gauche n’a besoin d’aucun z-index pour rester visible', () => {
    // Si un jour `.rail` doit se defendre par un z-index, c'est que le fond est repasse devant :
    // la regle ci-dessus a saute. On verrouille l'invariant, pas un contournement.
    const rail = regle(css('app-shell.css'), '.rail')
    expect(rail).not.toMatch(/z-index/)
  })

  it('le fond 2D reste le defaut, pour les vues sans decor 3D', () => {
    const corps = regle(css('theme.css'), 'body')
    expect(corps).toContain('autowin-galaxy-bg-hq.png')
    // Un aplat de repli DOIT subsister sous l'image (chargement, image absente).
    expect(corps).toMatch(/#05060c/)
  })

  it('le decor 3D n’est monte QUE sur l’Accueil', () => {
    const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
    expect(app).toMatch(/tab === 'accueil' && <DecorDeFond \/>/)
  })
})
