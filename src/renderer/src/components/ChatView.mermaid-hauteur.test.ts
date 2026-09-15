import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * GARDE DE LA TAILLE DES SCHEMAS DANS LE FIL.
 *
 * Mesure du 2026-09-14 : un `flowchart` avec deux `subgraph` rendu dans le chat obligeait a
 * derouler plusieurs ecrans pour le voir en entier. La largeur etait deja ramenee a 100% (rule
 * `.md-mermaid svg`), mais AUCUNE borne ne tenait la HAUTEUR : un SVG a ratio intrinseque,
 * contraint seulement en largeur, s'etire autant que son viewBox le demande.
 *
 * La borne vit ici et pas dans `ArtifactPreview.css` : dans le panneau d'artefacts, le diagramme
 * occupe une vue dediee et doit pouvoir etre grand. Dans le FIL, il est un element de lecture
 * parmi d'autres et doit tenir sous les yeux.
 */
describe('hauteur des schemas mermaid dans le fil', () => {
  const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')

  it('plafonne la hauteur du SVG et le laisse retrecir en largeur', () => {
    const bloc = css.slice(css.indexOf('.md-mermaid svg'))
    const regle = bloc.slice(0, bloc.indexOf('}'))
    expect(regle).toMatch(/max-height:\s*min\(60vh,\s*420px\)/)
    expect(regle).toMatch(/width:\s*auto/)
  })

  it('neutralise la hauteur plancher heritee du panneau d artefacts', () => {
    const bloc = css.slice(css.indexOf('.md-mermaid'))
    expect(bloc.slice(0, 900)).toMatch(/min-height:\s*0/)
  })
})
