import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./ChatComposerExtras.css', import.meta.url), 'utf8')

/**
 * UNE LONGUE SUGGESTION NE DOIT PAS ÉLARGIR LA ZONE DE SAISIE (conv-1103, 2026-10-22).
 *
 * Défaut vu dans une fenêtre de 900 px : la suggestion la plus longue ne passe pas à la ligne
 * (`white-space: nowrap`, prévu pour se couper avec « … »), donc le bloc des suggestions annonçait
 * sa longueur entière comme largeur minimale. Un parent de la zone de saisie s'élargissait pour la
 * contenir, et le bouton d'envoi sortait de l'écran. Mesuré par capture : en ajoutant seulement
 * `contain: inline-size` au bloc, les suggestions se coupent et le bouton revient à l'écran.
 *
 * Happy-dom ne calcule aucune mise en page : la règle est donc vérifiée dans la feuille, et la
 * preuve visuelle reste la capture à 900 px (scripts/ui-capture.mjs --largeur 900).
 */
describe('bloc des suggestions — ne dicte jamais la largeur du champ', () => {
  const bloc = /^\.composer-suites\s*{([^}]*)}/m.exec(styles)?.[1] ?? ''
  const texte = /^\.composer-suite-texte\s*{([^}]*)}/m.exec(styles)?.[1] ?? ''

  it('le bloc ignore la largeur de son contenu pour se dimensionner', () => {
    expect(bloc).not.toBe('')
    expect(bloc).toMatch(/contain:\s*inline-size/)
  })

  it('le texte d’une suggestion se coupe avec « … » au lieu de passer à la ligne', () => {
    expect(texte).toMatch(/text-overflow:\s*ellipsis/)
    expect(texte).toMatch(/white-space:\s*nowrap/)
    expect(texte).toMatch(/overflow:\s*hidden/)
  })
})
