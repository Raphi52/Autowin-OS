import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const lire = (...chemin: string[]): string => readFileSync(join(__dirname, ...chemin), 'utf8')
const extras = lire('ChatComposerExtras.css')

/**
 * BARRE DE PROMPT COMPACTE (2026-10-31). Demandes : « compacte la barre de prompt en
 * hauteur », « le bouton question à côté a un border et pas les autres et met-le en première position
 * et le micro en 2ème ». La mise en page se joue dans `order` et `flex` : le DOM reste celui d'avant,
 * donc seule la feuille de style porte la garantie.
 */
describe('barre de prompt compacte', () => {
  // 2026-10-31 : « je veux qu'elle fasse toute la largeur comme avant », puis « mets-la
  // en dessous des icônes ». Puis : « la barre de quota on peut la mettre au niveau du bord
  // du container, on gagnerait grave de la place en hauteur ». Elle reste de bord à bord sous les
  // icônes, mais SORTIE du flux, posée au pied de la rangée : plus de ligne à elle.
  it('la jauge longe le bas du cadre, de bord à bord, sans ligne à elle', () => {
    const bloc = extras.match(/\.composer-input-row > \.model-quota \{[^}]*\}/)?.[0] ?? ''
    expect(bloc, 'règle de la jauge introuvable').not.toBe('')
    expect(bloc).toMatch(/position:\s*absolute/)
    expect(bloc).toMatch(/bottom:\s*0/)
    expect(bloc).toMatch(/left:\s*0/)
    expect(bloc).toMatch(/right:\s*0/)
    expect(bloc).not.toMatch(/flex:\s*1 0 100%/)
    // « le chiffre du quota il est trop haut, il est plus centré sur la barre », puis
    // « t'as remonté la barre au lieu de baisser le chiffre ». Le trait reste au pied de la rangée et
    // le rond descend sur son milieu (trait de 3 px) : il dépasse donc du cadre.
    const jauge =
      extras.match(/\.composer-input-row > \.model-quota \.model-quota-trigger \{[^}]*\}/)?.[0] ?? ''
    expect(jauge).toMatch(/align-items:\s*flex-end/)
    const rond =
      extras.match(/\.composer-input-row > \.model-quota \.model-quota-bar-value \{[^}]*\}/)?.[0] ?? ''
    expect(rond).toMatch(/top:\s*calc\(100% - 1\.5px\)/)
    // Sans cette marge, `.chat` et `.chat-layout` coupent le bas du rond (mesuré : 5,5 px).
    const marge =
      extras.match(/:root \.cosmic-outline \.chat-layout,\s*:root \.cosmic-outline \.chat \{[^}]*\}/)?.[0] ??
      ''
    expect(marge).toMatch(/overflow:\s*clip/)
    expect(marge).toMatch(/overflow-clip-margin:\s*8px/)
    // La rangée garde sous ses icônes la place du rond, et descend jusqu'au bord du cadre.
    expect(extras).toMatch(/\.composer-input-row:has\(> \.model-quota\) \{\s*padding-bottom:\s*14px;/)
    expect(extras).toMatch(
      /div\.composer\[data-origine='saisie'\]:has\(\.composer-input-row > \.model-quota\) \{\s*padding-bottom:\s*0;/
    )
  })

  // 2026-10-31 : « ya bcp d'espace vide en haut et en bas de cette barre de prompt,
  // réduis tous les padding ». Les marges des thèmes (`:root[data-theme=…] .cosmic-outline
  // .composer-field`, 4 niveaux) battaient celles du compactage (2 niveaux) : la règle doit les
  // dépasser, et ne fixer que le vertical pour garder les marges latérales de chaque thème.
  it('les marges du haut et du bas battent celles des thèmes', () => {
    const cadre =
      extras.match(/:root \.cosmic-outline div\.composer\[data-origine='saisie'\] \{[^}]*\}/)?.[0] ?? ''
    const champ =
      extras.match(
        /:root \.cosmic-outline \.composer\[data-origine='saisie'\] > \.composer-field \{[^}]*\}/
      )?.[0] ?? ''
    for (const bloc of [cadre, champ]) {
      expect(bloc, 'règle de marge introuvable').not.toBe('')
      expect(bloc).toMatch(/padding-top:\s*\d+px/)
      expect(bloc).toMatch(/padding-bottom:\s*\d+px/)
      expect(bloc).not.toMatch(/padding:/)
    }
    const jauge =
      extras.match(/\.composer-input-row > \.model-quota \.model-quota-trigger \{[^}]*\}/)?.[0] ?? ''
    expect(jauge).toMatch(/padding:\s*0/)
  })

  it('le texte garde sa ligne entière, moins l’envoi', () => {
    const bloc = extras.match(/\.composer-input-row > textarea \{[^}]*\}/)?.[0] ?? ''
    expect(bloc).toMatch(/flex:\s*1 1 calc\(100% - 40px\)/)
  })

  it('∞, le trombone et ×3 passent après la question à côté et le micro', () => {
    const bloc =
      extras.match(/\.composer-input-row > \.composer-auto,[^{]*\{[^}]*\}/)?.[0] ?? ''
    expect(bloc).toContain('.attachment-button')
    expect(bloc).toContain('.composer-trois-facons')
    expect(bloc).toMatch(/order:\s*1/)
    expect(bloc).not.toContain('composer-question-a-cote')
    expect(bloc).not.toContain('composer-dictee')
  })

  it.each(['theme-nebuleuse-verre.css', 'theme-holographique-clair.css'])(
    '%s retire le rond de la question à côté comme celui de ses voisins',
    (theme) => {
      const css = lire('..', 'assets', theme)
      // Les deux listes « icônes nues » (repos, puis survol) nomment chaque bouton : un bouton oublié
      // garde son rond blanc, c'est le défaut constaté.
      const listes = css.match(/> :is\(\s*\.composer-auto:not\(\.actif\),[^)]*\)[^)]*\)[^)]*\)[^)]*\)/g)
      expect(listes?.length).toBe(2)
      for (const liste of listes ?? [])
        expect(liste).toContain('.composer-question-a-cote:not(.actif)')
      // Le survol nacré lit ses couleurs sur ces variables, posées bouton par bouton.
      expect(css).toMatch(
        /:is\(\.composer-auto, \.attachment-button, \.composer-trois-facons, \.composer-question-a-cote, \.composer-dictee\)/
      )
    }
  )

  it('la question à côté a la même opacité que ses voisins au repos', () => {
    const css = lire('QuestionACote.css')
    const bloc =
      css.match(/\.composer-input-row > \.composer-question-a-cote\.btn:not\(:disabled\) \{[^}]*\}/)?.[0] ??
      ''
    expect(bloc).toMatch(/opacity:\s*1/)
  })
})
