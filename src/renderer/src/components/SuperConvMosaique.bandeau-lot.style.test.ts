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
 * LE BANDEAU D'UN LOT NE DÉFILE PAS (conv-1348, 2026-10-30 : « c dégueu que ça soit scrollable comme
 * ça »). Un pixel de la ligne « maintenant », au bout de l'axe, créait une barre horizontale de 15 px
 * qui mangeait la deuxième ligne. Depuis conv-1396, la vue d'un lot n'a plus d'axe, seulement la
 * ligne du lot ; son bloc ne cède toujours pas. Happy-dom ne calcule aucune mise en page : la règle
 * est vérifiée dans la feuille.
 */
describe('bandeau d’un lot de la super conv — sans ascenseur', () => {
  it('n’a plus de barre de temps : ni voie, ni ligne « maintenant »', () => {
    expect(styles).not.toMatch(/\.scm-voie|\.scm-barre|\.scm-maintenant-ligne/)
  })

  it('ne fait défiler ni la ligne du lot ni son bloc, qui ne cèdent jamais', () => {
    const bandeau = regles('.scm-bandeau.scm-bandeau--lot')
    expect(bandeau).toMatch(/flex:\s*none/)
    expect(bandeau).toMatch(/overflow:\s*visible/)
    expect(bandeau).toMatch(/max-height:\s*none/)
    expect(regles('.scm-chat:has(> .scm-bandeau--lot)')).toMatch(/flex:\s*none/)
  })
})

/**
 * PLUS DE LOTS SANS DÉFILER (conv-1396, 2026-10-31 : « agrandis le bloc du plan de lots dans le chat
 * pour voir plus de lots sans faire défiler, sans écraser le fil »). Mesuré sur le plan de conv-1335 :
 * la borne de 30vh montrait 9 lots sur 19 (fenêtre de 1000 px), 13 depuis (1040 px). Le bloc monte
 * jusqu'à 50vh, les lignes sont serrées, et le fil garde 30 % de la colonne : c'est ce minimum qui
 * le protège.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : la borne de 30vh revenue, ou un fil sans minimum relatif.
 */
describe('bloc du plan dans le chat — plus haut, sans écraser le fil', () => {
  it('laisse le bloc monter jusqu’à la moitié de la fenêtre', () => {
    expect(regles('.scm-chat .scm-bandeau')).toMatch(/max-height:\s*50vh/)
  })

  it('garde au fil 30 % de la colonne, et 120 px dans une fenêtre très basse', () => {
    expect(regles('.chat:has(> .scm-chat) > .chat-scroll')).toMatch(
      /min-height:\s*max\(120px,\s*30%\)/
    )
  })
})

/** Le corps d'un bloc `@container` de la liste, de son ouverture à l'accolade en début de ligne. */
const blocConteneur = (seuil: number): string =>
  styles.match(
    new RegExp(`@container scm-lignes \\(max-width: ${seuil}px\\) \\{([\\s\\S]*?)\\n\\}`)
  )?.[1] ?? ''

/**
 * TITRE ENTIER, HUIT LOTS SANS ASCENSEUR (conv-1387, 2026-10-31 : « écris le titre en entier, et
 * garde un bloc de plan sans défilement : réduis la hauteur des lignes pour que 8 lots tiennent »).
 * Mesuré dans l'app sur le plan de conv-1370 (8 lots) : à 1400 × 860, le bloc laisse 170 px à la liste,
 * et 8 lignes de 21,8 px en demandaient 188 ; dans une liste de moins de 620 px, chaque lot prenait
 * trois lignes (57 px), un seul lot restait visible. Happy-dom ne calcule aucune mise en page :
 * la preuve à l'écran est faite dans l'app, ici on garde les règles et le budget de hauteur.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : un titre coupé par des points de suspension, une colonne de
 * titre qui recède devant la phrase, des lignes trop hautes pour 8 lots, ou une liste étroite où un
 * lot reprend plusieurs lignes.
 */
describe('bloc du plan — titre entier, huit lots sans ascenseur', () => {
  /** La place laissée à la liste par le bloc, à 1400 × 860 (mesure conv-1387). */
  const PLACE_DE_LA_LISTE = 170

  it('donne au titre sa largeur d’abord : c’est la phrase qui cède', () => {
    for (const liste of ['.scm-lignes', '.scm-lignes--relance'])
      expect(regles(liste)).toMatch(/grid-template-columns:\s*minmax\(0, max-content\)/)
  })

  it('passe un titre trop long à la ligne au lieu de le couper', () => {
    const titre = regles('.scm-bloc .scm-nom')
    expect(titre).toMatch(/white-space:\s*normal/)
    expect(titre).toMatch(/overflow:\s*visible/)
  })

  it('tient 8 lots dans la place du bloc, et la pastille ne hausse pas la ligne', () => {
    const liste = regles('.scm-lignes')
    const interligne = Number(liste.match(/line-height:\s*([\d.]+)/)?.[1])
    const ecart = Number(liste.match(/row-gap:\s*([\d.]+)px/)?.[1])
    const marge = Number(regles('.scm-bloc').match(/padding:\s*([\d.]+)px 8px/)?.[1])
    const hauteurDeLigne = 12 * interligne + 2 * marge
    expect(8 * hauteurDeLigne + 7 * ecart).toBeLessThanOrEqual(PLACE_DE_LA_LISTE)

    const pastille = regles('.scm-pastille')
    const hauteurDePastille =
      Number(pastille.match(/font-size:\s*([\d.]+)px/)?.[1]) *
        Number(pastille.match(/line-height:\s*([\d.]+)/)?.[1]) +
      2 // sa bordure, haut et bas
    expect(hauteurDePastille).toBeLessThanOrEqual(12 * interligne)
    // Une marge verticale sur « Relancer » hausserait sa ligne de 3 px (mesuré, conv-1387).
    expect(regles('.scm-relancer')).toMatch(/padding:\s*0 10px/)
  })

  it('garde une seule ligne par lot chez le chef quand la liste est étroite', () => {
    const etroite = blocConteneur(720)
    expect(etroite).toMatch(
      /\.scm-bandeau--chef \.scm-bloc > :is\(\.scm-heures, \.scm-cout, \.scm-phrase\)\s*{\s*display:\s*none/
    )
    expect(blocConteneur(480)).toMatch(
      /\.scm-bandeau--chef \.scm-enchainement\s*{\s*display:\s*none/
    )
    expect(etroite).not.toMatch(/flex-wrap/)
  })

  it('ne cache rien dans la vue d’un lot : elle a la place, sa ligne peut passer sur deux', () => {
    const lot = blocConteneur(620)
    expect(lot).toMatch(/\.scm-bandeau--lot \.scm-bloc\s*{[^}]*flex-wrap:\s*wrap/)
    expect(lot).not.toMatch(/\.scm-bandeau--chef/)
    // Seules ses cellules vides disparaissent (`:empty`) : aucune information.
    expect(`${lot}${blocConteneur(720)}${blocConteneur(480)}`).not.toMatch(
      /\.scm-bandeau--lot[^{]*\.scm-(heures|cout|phrase|enchainement|duree)[^{]*{[^}]*display:\s*none/
    )
  })
})
