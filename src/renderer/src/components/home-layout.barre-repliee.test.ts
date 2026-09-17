/**
 * REGRESSION — repli de la barre laterale (defaut rapporte le 2026-09-17).
 *
 * Reproduit par pilotage du rendu hors ecran : l'agencement etait deduit de la FENETRE au premier
 * rendu (1584 x 935) alors que l'Accueil n'occupe que la surface restante (1320 x 887 barre
 * deployee). Persiste tel quel, il ne tenait pas barre deployee -- donc invisible -- mais « tenait »
 * des que le repli rendait 156 px : les tuiles s'affichaient alors calibrees pour une surface qui
 * n'existe pas (445 px de large au lieu de 419, rangee du bas trop basse).
 */
import { describe, expect, it } from 'vitest'
import {
  defaultHomeLayout,
  estDispositionDOrigine,
  moveWidgetBox,
  reconcileLayout,
  replaceWidget
} from './home-layout'

const FENETRE = { width: 1584, height: 935, top: 142 }
const SURFACE_REPLIEE = { width: 1498, height: 887, top: 93 }
const SURFACE_DEPLOYEE = { width: 1320, height: 887, top: 93 }

describe('disposition d origine', () => {
  it('reconnait une disposition que personne n a touchee, sur les trois arrangements', () => {
    for (const surface of [
      SURFACE_REPLIEE,
      { width: 900, height: 800, top: 120 },
      { width: 460, height: 800, top: 120 }
    ]) {
      expect(estDispositionDOrigine(defaultHomeLayout(surface))).toBe(true)
    }
  })

  it('ne reconnait plus rien des qu une seule tuile a ete posee a la main', () => {
    const origine = defaultHomeLayout(SURFACE_REPLIEE)
    const deplacee = replaceWidget(
      origine,
      moveWidgetBox(origine.find((b) => b.id === 'jarvis')!, 40, 25, SURFACE_REPLIEE)
    )
    expect(estDispositionDOrigine(deplacee)).toBe(false)
  })
})

describe('agencement deduit de la fenetre', () => {
  it('est reconnu comme deduit, donc re-derivable pour la vraie surface', () => {
    expect(estDispositionDOrigine(defaultHomeLayout(FENETRE))).toBe(true)
  })

  it('ne s affiche pas barre deployee, mais PASSE barre repliee — c est le defaut', () => {
    const deduitDeLaFenetre = defaultHomeLayout(FENETRE)
    // Barre deployee : il ne tient pas, la vue retombe sur la disposition d origine et rien ne se voit.
    expect(reconcileLayout(deduitDeLaFenetre, SURFACE_DEPLOYEE)).toEqual(
      defaultHomeLayout(SURFACE_DEPLOYEE)
    )
    // Barre repliee : il « tient » et s affiche TEL QUEL, avec des tuiles plus larges que la surface
    // ne le permet — la difference exacte que voyait l utilisateur.
    const affiche = reconcileLayout(deduitDeLaFenetre, SURFACE_REPLIEE)
    expect(affiche).not.toEqual(defaultHomeLayout(SURFACE_REPLIEE))
    expect(affiche[0].w).toBeGreaterThan(defaultHomeLayout(SURFACE_REPLIEE)[0].w)
  })

  it('une fois re-derive pour la surface reelle, tout tient dans le cadre', () => {
    for (const box of defaultHomeLayout(SURFACE_REPLIEE)) {
      expect(box.x + box.w).toBeLessThanOrEqual(SURFACE_REPLIEE.width)
      expect(box.y + box.h).toBeLessThanOrEqual(SURFACE_REPLIEE.height)
    }
  })
})
