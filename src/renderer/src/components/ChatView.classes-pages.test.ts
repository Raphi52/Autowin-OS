import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { CLASSES_PAGES_HTML } from '../../../shared/classes-pages-html'

/**
 * LES CLASSES `aw-*` DES PAGES HTML SUIVENT LE THEME CHOISI (conv-1074, 2026-10-22).
 *
 * Avant : le prompt dictait au modele des couleurs EN DUR (texte `#dde3ee`, or `#d4a94f`-`#e3ba55`).
 * En theme clair, l'app les ecrasait toutes en `!important` (`theme-modes.css`), accents compris :
 * l'or devenait du texte sombre. Les classes fournies par l'app lisent les jetons du theme
 * (`--gold-doux`, `--text-dim`, `--ok`…), qui ont deja une valeur lisible dans chaque theme.
 *
 * ENTREE QUI FERAIT ECHOUER UNE MAUVAISE CORRECTION : une regle claire ecrite
 * `:root[data-base='clair'] .md-html .aw-chiffre` — meme force (0,4,0) que l'ecrasement GENERE des
 * themes Vanilla Claude et NieR, charges APRES : elle perdrait, et l'or redeviendrait du texte.
 */
const ici = (chemin: string): string => readFileSync(join(__dirname, chemin), 'utf8')
const CHAT_CSS = ici('./ChatView.css')
const MODES_CSS = ici('../assets/theme-modes.css')
const GENERES = ['theme-vanilla-claude.genere.css', 'theme-nier-automata.genere.css'].map((f) =>
  ici(`../assets/${f}`)
)

type Regle = {
  selecteurs: string[]
  declarations: { prop: string; value: string; important: boolean }[]
}
function regles(css: string): Regle[] {
  const sortie: Regle[] = []
  postcss.parse(css).walkRules((regle) => {
    const declarations: Regle['declarations'] = []
    regle.walkDecls((d) => {
      declarations.push({ prop: d.prop, value: d.value, important: d.important })
    })
    sortie.push({
      selecteurs: regle.selectors.map((s) => s.replace(/\s+/g, ' ').trim()),
      declarations
    })
  })
  return sortie
}

/** Specificite (b, c) d'un selecteur simple — ni id ni :is() ici. */
function specificite(selecteur: string): [number, number] {
  const sansAttributs = selecteur.replace(/\[[^\]]*\]/g, ' ')
  const attributs = (selecteur.match(/\[[^\]]*\]/g) ?? []).length
  const classes = (sansAttributs.match(/\.[\w-]+/g) ?? []).length
  const pseudos = (sansAttributs.match(/:(?!:)[\w-]+/g) ?? []).length
  const types = (
    sansAttributs.replace(/[.:][\w-]+/g, ' ').match(/(?:^|[\s>+~])[a-z][\w-]*/gi) ?? []
  ).length
  return [attributs + classes + pseudos, types]
}
const plusFort = (a: [number, number], b: [number, number]): boolean =>
  a[0] !== b[0] ? a[0] > b[0] : a[1] > b[1]

const COULEUR_EN_DUR = /#[0-9a-f]{3,8}\b|rgba?\(\s*\d/i

describe('classes aw-* des pages html-render', () => {
  it('prémisse : la liste nomme au moins les accents, le discret, les statuts et la grille', () => {
    const noms = CLASSES_PAGES_HTML.map((c) => c.classe)
    for (const nom of [
      'aw-kicker',
      'aw-chiffre',
      'aw-discret',
      'aw-chip',
      'aw-ok',
      'aw-ko',
      'aw-grille'
    ])
      expect(noms).toContain(nom)
  })

  it('chaque classe est définie dans ChatView.css, sous .md-html, sans couleur en dur', () => {
    const toutes = regles(CHAT_CSS)
    for (const { classe } of CLASSES_PAGES_HTML) {
      const trouvees = toutes.filter((r) => r.selecteurs.includes(`.md-html .${classe}`))
      expect(trouvees, classe).not.toHaveLength(0)
      for (const r of trouvees)
        for (const d of r.declarations)
          expect(d.value, `${classe} ${d.prop}`).not.toMatch(COULEUR_EN_DUR)
    }
  })

  it('en thème clair, chaque classe colorée bat l’écrasement de la base ET celui des thèmes générés', () => {
    const ecrasements = [MODES_CSS, ...GENERES]
      .flatMap(regles)
      .flatMap((r) => r.selecteurs)
      .filter((s) => /\[data-base='clair'\].* \.md-html \*$/.test(s))
    // Prémisse : la base claire et les deux thèmes générés écrasent bien tout le contenu des pages.
    expect(ecrasements.length).toBeGreaterThanOrEqual(3)
    const claires = regles(MODES_CSS)
    for (const { classe, couleur } of CLASSES_PAGES_HTML) {
      if (!couleur) continue
      const regle = claires.find((r) =>
        r.selecteurs.some(
          (s) => s.startsWith(":root[data-base='clair']") && s.endsWith(` .${classe}`)
        )
      )
      expect(regle, classe).toBeDefined()
      const selecteur = regle!.selecteurs.find((s) => s.endsWith(` .${classe}`))!
      for (const ecrasement of ecrasements)
        expect(
          plusFort(specificite(selecteur), specificite(ecrasement)),
          `${selecteur} vs ${ecrasement}`
        ).toBe(true)
      expect(
        regle!.declarations.every((d) => d.important),
        classe
      ).toBe(true)
      for (const d of regle!.declarations) expect(d.value, classe).not.toMatch(COULEUR_EN_DUR)
    }
  })

  it('jumeau : la classe sans couleur (grille) n’a pas de règle claire à elle', () => {
    const claires = regles(MODES_CSS).flatMap((r) => r.selecteurs)
    expect(claires.some((s) => s.endsWith(' .aw-grille'))).toBe(false)
  })
})
