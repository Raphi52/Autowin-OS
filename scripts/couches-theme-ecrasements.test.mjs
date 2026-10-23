import { describe, expect, it } from 'vitest'
import { analyser, THEMES_CLAUDE, variantesEcrasees } from './couches-theme-ecrasements.mjs'

/**
 * LE PIEGE DES COUCHES DE CLAUDE (conv-1105, 2026-10-23) : une couche generee qui recopie une regle
 * GENERALE avec le prefixe du theme bat les variantes plus precises que la transposition n'a pas
 * recopiees. Mesure sur le disque avant correction : 105 variantes sous Ninja (`.control-status.is-on`
 * perd son vert, `.sc-diff-action.is-armed` son rouge, scout/build/judge du deroule leur couleur),
 * 8 sous Vanilla (le bouton « galaxie » de GraphView.css perd son etat allume).
 */

const feuille = (fichier, css, origine, rang = 0) => ({ fichier, css, origine, rang })

describe('analyse des variantes ecrasees par une couche de theme', () => {
  it('voit la variante battue par la copie de sa regle generale (cas du deroule sous Ninja)', () => {
    const cas = analyser('ninja-claude', [
      feuille(
        'composant.css',
        `.ligne { --c: #8c96a8 } .ligne[data-phase='scout'] { --c: #5b8cf0 }`,
        'source'
      ),
      feuille(
        'couche.css',
        `:root[data-theme='ninja-claude'] .ligne { --c: rgb(160, 158, 148) }`,
        'couche',
        100
      )
    ])
    expect(cas.map((c) => [c.selecteur, c.valeurPerdue])).toEqual([
      [".ligne[data-phase='scout']", '#5b8cf0']
    ])
  })

  it('ne voit plus rien quand la variante a sa propre copie, ni pour la transposition voulue', () => {
    const cas = analyser('ninja-claude', [
      feuille(
        'composant.css',
        `.ligne { --c: #8c96a8 } .ligne[data-phase='scout'] { --c: #5b8cf0 }`,
        'source'
      ),
      feuille(
        'couche.css',
        `:root[data-theme='ninja-claude'] .ligne { --c: rgb(160, 158, 148) }
         :root[data-theme='ninja-claude'] .ligne[data-phase='scout'] { --c: #5b8cf0 }`,
        'couche',
        100
      )
    ])
    expect(cas).toEqual([])
  })

  it('voit la variante d un parent (`.panneau .x.is-on`) et ignore les regles des autres themes', () => {
    const cas = analyser('ninja-claude', [
      feuille(
        'composant.css',
        `.x { color: #47617e } .panneau .x.is-on { color: #2fae74 }`,
        'source'
      ),
      feuille(
        'autre.css',
        `:root[data-theme='vanilla-claude'] .panneau .x.is-on { color: red }`,
        'source',
        50
      ),
      feuille(
        'couche.css',
        `:root[data-theme='ninja-claude'] .x { color: rgb(110, 108, 100) }`,
        'couche',
        100
      )
    ])
    expect(cas.map((c) => c.selecteur)).toEqual(['.panneau .x.is-on'])
  })

  it('suit l ordre d import : a egalite, une feuille importee apres le composant gagne deja sans la couche', () => {
    // theme-modes.css est importe par App.tsx APRES les composants : sa regle claire bat deja la
    // variante du composant, la couche Vanilla n'y change rien.
    const cas = analyser('vanilla-claude', [
      feuille('composant.css', `.a.on .piste { color: #ff5dde }`, 'source', 0),
      feuille('modes.css', `:root[data-base='clair'] .piste { color: #47617e }`, 'source', 59),
      feuille(
        'couche.css',
        `:root[data-theme='vanilla-claude'][data-base='clair'] .piste { color: rgb(110, 108, 100) }`,
        'couche',
        75
      )
    ])
    expect(cas).toEqual([])
  })

  for (const theme of Object.keys(THEMES_CLAUDE)) {
    /** ENTREE QUI DOIT FAIRE ECHOUER CE CAS : une couche regeneree sans recopier les variantes battues. */
    it(`aucune variante ne perd sa couleur a cause de la couche ${theme} sur le disque`, () => {
      const cas = variantesEcrasees(theme).map(
        (c) =>
          `${c.variante} ${c.selecteur} { ${c.prop}: ${c.valeurPerdue} } battue par ${c.battueePar}`
      )
      expect(cas).toEqual([])
    })
  }
})
