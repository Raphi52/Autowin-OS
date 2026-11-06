import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('./SuperConvMosaique.css', import.meta.url), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

/** Corps réunis des règles dont un sélecteur vaut exactement `cible` (commentaires retirés). */
const regles = (cible: string): string =>
  [...styles.matchAll(/([^{}]+){([^}]*)}/g)]
    .filter((m) => m[1].split(',').some((s) => s.trim() === cible))
    .map((m) => m[2])
    .join('\n')

/**
 * LA FRISE D'UN PLAN DE LOTS SUIT LE THÈME (2026-10-31 : « adapte ça aux thèmes, c'est
 * super moche »). Elle écrivait sa chasse fixe en dur et tirait sur 800 px des couleurs d'état
 * réglées pour de petits voyants : le #00ff55 d'Holographique criait. Une valeur de secours en dur
 * a aussi un coût caché : la couche générée de chaque thème recopie la règle avec une priorité plus
 * forte, et plus aucun changement de la règle ne s'y voit. Le rendu de chaque thème se regarde en
 * capture ; ici, on garde seulement ce qui ferait revenir le défaut. Happy-dom ne calcule aucun
 * style : la règle est vérifiée dans la feuille.
 */
describe('frise des lots — le style vient du thème', () => {
  it('n’écrit aucune police en dur : le texte hérite de celle du thème', () => {
    expect(styles).not.toMatch(/ui-monospace/)
  })

  it('ne tire pas une couleur d’état pleine sur un bloc', () => {
    expect(regles('.scm-bloc')).toMatch(/background:\s*rgba\(var\(--voile-rgb\)/)
    expect(regles('.scm-bloc.scm-etat--echec')).toMatch(/background:\s*color-mix\(/)
    expect(regles('.scm-bloc.scm-etat--attend-chef')).toMatch(/background:\s*color-mix\(/)
    expect(regles('.scm-bloc.scm-etat--interrompu')).toMatch(/background:\s*color-mix\(/)
  })

  it('prend la jauge du thème pour un lot en cours, et ne lit jamais l’accent adouci', () => {
    expect(regles('.scm-bandeau')).toMatch(/var\(\s*--run-jauge/)
    expect(regles('.scm-bloc.scm-etat--en-cours')).toMatch(/var\(--scm-jauge\)/)
    // --accent-dim est très pâle dans Vanilla et NieR : le texte du bloc y disparaîtrait.
    expect(styles).not.toMatch(/--accent-dim/)
  })

  it('écrit sur la jauge avec le texte prévu pour elle, noir sur un accent très clair', () => {
    expect(regles('.scm-bandeau')).toMatch(/--scm-sur-jauge:\s*var\(--on-accent\)/)
    expect(regles('.scm-bloc.scm-etat--en-cours')).toMatch(/color:\s*var\(--scm-sur-jauge\)/)
    expect(regles('.scm-relancer')).toMatch(/color:\s*var\(--scm-sur-jauge\)/)
    const modes = readFileSync(new URL('../assets/theme-modes.css', import.meta.url), 'utf8')
    for (const theme of ['machine-a-ecrire', 'malvoyant-sombre'])
      expect(modes).toMatch(
        new RegExp(
          `data-theme='${theme}'\\] \\.scm-bandeau \\{\\s*--scm-sur-jauge: var\\(--bg-0\\)`
        )
      )
  })

  it('pose la frise du chat sur la plaque du thème, avec ses arrondis', () => {
    const plaque = regles('.scm-chat .scm-bandeau')
    expect(plaque).toMatch(/background:\s*var\(--surface-panel\)/)
    expect(plaque).toMatch(/border-radius:\s*var\(--r2\)/)
  })

  it('n’arrondit rien en dur : NieR, à angles droits, passe à 0 partout', () => {
    for (const cible of ['.scm-bloc', '.scm-reduire', '.scm-relancer', '.scm-pastille'])
      expect(regles(cible)).toMatch(/border-radius:\s*var\(--r[123]\)/)
  })

  // Le rail de la voie est parti avec la barre de temps de la vue d'un lot.
  it('laisse les chiffres lisibles sur un thème clair comme sombre', () => {
    expect(regles('.scm-chiffre b')).toMatch(/color:\s*var\(--text\)/)
  })
})
