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
})
