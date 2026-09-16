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
 *
 * OU VIT LA BORNE — corrige le 2026-09-16. La premiere version bornait le SVG lui-meme, qui etait
 * donc RETRECI : un flowchart de 15 etapes tombait a 27 px de large, libelles illisibles (capture
 * de la sonde cdp-chat-mermaid). La borne a ete deplacee sur le CADRE `.md-mermaid`, qui fait
 * DEFILER un schema trop haut au lieu de l'ecraser. L'exigence testee est la meme — un schema du
 * fil tient sous les yeux — seul l'endroit qui la porte a change ; ce test citait l'ancien.
 */
describe('hauteur des schemas mermaid dans le fil', () => {
  const css = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')

  /*
   * TROISIEME ETAPE, 2026-09-16 (conv-590) : le CADRE borne a 300 px faisait apparaitre une barre
   * de defilement pour quelques dizaines de pixels manquants — un schema qui depasse a peine se
   * lisait en deux temps. La borne de hauteur a donc ete RETIREE du cadre ; c'est la regle du
   * dessin (`.md-mermaid svg`) qui tient la taille. Ce test gardait l'etape precedente et refusait
   * toute edition de la feuille de style ; il garde desormais la decision REELLE.
   */
  it('ne fait JAMAIS defiler le cadre verticalement', () => {
    const bloc = css.slice(css.indexOf('.md-mermaid {'))
    const regle = bloc.slice(0, bloc.indexOf('}'))
    expect(regle).toMatch(/overflow-y:\s*visible/)
    expect(regle).not.toMatch(/max-height/)
  })

  it('laisse le SVG suivre la largeur du fil sans etre ecrase en hauteur', () => {
    const bloc = css.slice(css.indexOf('.md-mermaid svg'))
    const regle = bloc.slice(0, bloc.indexOf('}'))
    expect(regle).toMatch(/width:\s*100%/)
    expect(regle).toMatch(/height:\s*auto/)
  })

  it('neutralise la hauteur plancher heritee du panneau d artefacts', () => {
    const bloc = css.slice(css.indexOf('.md-mermaid'))
    expect(bloc.slice(0, 900)).toMatch(/min-height:\s*0/)
  })
})
