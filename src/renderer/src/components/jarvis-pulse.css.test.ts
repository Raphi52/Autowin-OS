import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * La pastille d'ecoute BOUGE, et elle ne bouge que quand le micro est ouvert.
 *
 * Un widget qui ecoute en permanence doit se voir de loin : c'est la seule chose qui distingue « mon
 * micro est ouvert » de « il est coupe ». Une capture fixe ne peut pas le prouver ; ce test verifie
 * le lien CSS lui-meme.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST si la correction est fausse : deplacer l'`animation` de
 * `.jarvis[data-ecoute='true'] .jarvis__bascule` vers `.jarvis__bascule` tout court (le bouton
 * pulserait micro COUPE — mensonge visuel), ou supprimer les `@keyframes jarvis-pulse`.
 */
describe('HomeView.css — la pastille d’écoute de Jarvis pulse, et seulement à l’écoute', () => {
  const css = readFileSync(new URL('./HomeView.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )

  it('déclare les keyframes du pouls', () => {
    expect(css).toMatch(/@keyframes\s+jarvis-pulse\s*\{/)
  })

  it('n’anime le bouton QUE sous l’état d’écoute', () => {
    const regleActive = css.match(
      /\.jarvis\[data-ecoute='true'\]\s+\.jarvis__bascule\s*\{([^}]*)\}/
    )
    expect(regleActive, 'la règle liée à l’état d’écoute doit exister').not.toBeNull()
    expect(regleActive?.[1]).toMatch(/animation\s*:\s*jarvis-pulse/)

    const regleNeutre = css.match(/(?<!\])\s\.jarvis__bascule\s*\{([^}]*)\}/)
    expect(regleNeutre?.[1] ?? '').not.toMatch(/animation/)
  })

  /**
   * MOUVEMENT REDUIT — repeche de la remise de cote 646a83eb. Le pouls est de l'ambiance : quand le
   * systeme demande moins d'animation, il s'arrete. La distinction micro ouvert / micro coupe ne
   * repose alors plus sur le mouvement mais sur la COULEUR, que la meme regle pose deja
   * (`border-color` et `color` en or) — sans elle, immobiliser le pouls rendrait l'etat illisible.
   */
  const FIN_DE_BLOC = String.fromCharCode(10) + '}'

  it('immobilise le pouls quand le systeme demande moins d animation', () => {
    const blocs = css
      .split('@media (prefers-reduced-motion: reduce)')
      .slice(1)
      .map((morceau) => morceau.slice(0, morceau.indexOf(FIN_DE_BLOC)))
    const couvre = blocs.some(
      (bloc) =>
        bloc.includes(".jarvis[data-ecoute='true'] .jarvis__bascule") &&
        /animation\s*:\s*none/.test(bloc)
    )
    expect(couvre, 'le pouls du micro doit etre coupe sous prefers-reduced-motion').toBe(true)

    const regleActive = css.match(/\.jarvis\[data-ecoute='true'\]\s+\.jarvis__bascule\s*\{([^}]*)\}/)
    expect(regleActive?.[1], 'la couleur doit rester le signal de secours').toMatch(/color\s*:/)
  })
})
