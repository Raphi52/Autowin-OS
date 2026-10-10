import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { THEMES, baseDuTheme } from '../theme-mode'

/**
 * Theme « Nebuleuse de verre » (conv-124, 2026-10-09). Deux fichiers : les regles ecrites a la main
 * (theme-nebuleuse-verre.css) et la couche generee des couleurs en dur
 * (theme-nebuleuse-verre.genere.css, scripts/theme-nebuleuse-verre.mjs).
 *
 * Le risque qui compte : une regle NON confinee au theme repeindrait l'application de TOUS les
 * utilisateurs, quel que soit le theme choisi -- 500 regles generees, une seule suffit.
 */
const lire = (fichier: string): string => readFileSync(new URL(fichier, import.meta.url), 'utf8')
const PREFIXE = ":root[data-theme='nebuleuse-verre']"

function selecteursHorsTheme(css: string): string[] {
  const fautifs: string[] = []
  postcss.parse(css).walkRules((regle) => {
    if (
      regle.parent?.type === 'atrule' &&
      /keyframes/i.test((regle.parent as postcss.AtRule).name)
    ) {
      return
    }
    for (const selecteur of regle.selectors) {
      if (!selecteur.trim().startsWith(PREFIXE)) fautifs.push(selecteur)
    }
  })
  return fautifs
}

describe('theme Nebuleuse de verre', () => {
  it('est propose dans la liste des themes, en base sombre', () => {
    expect(THEMES.map((t) => t.id)).toContain('nebuleuse-verre')
    expect(THEMES.find((t) => t.id === 'nebuleuse-verre')?.libelle).toBe('Nébuleuse de verre')
    expect(baseDuTheme('nebuleuse-verre')).toBe('sombre')
  })

  it('charge la couche generee AVANT les regles ecrites a la main', () => {
    const app = lire('../App.tsx')
    const genere = app.indexOf("import './assets/theme-nebuleuse-verre.genere.css'")
    const main = app.indexOf("import './assets/theme-nebuleuse-verre.css'")
    expect(genere).toBeGreaterThan(-1)
    expect(main).toBeGreaterThan(genere)
  })

  it('ne peint rien hors du theme : chaque selecteur porte le prefixe du theme', () => {
    expect(selecteursHorsTheme(lire('./theme-nebuleuse-verre.css'))).toEqual([])
    expect(selecteursHorsTheme(lire('./theme-nebuleuse-verre.genere.css'))).toEqual([])
  })

  it('garde les couleurs d etat : aucun jaune d alerte ni vert de reussite transpose', () => {
    const genere = lire('./theme-nebuleuse-verre.genere.css')
    // Les teintes d'ETAT ne sont jamais des sorties du generateur : il n'ecrit que des roses,
    // des violets et l'encre. Un vert ou un jaune ici voudrait dire qu'il a touche a un etat.
    expect(genere).not.toMatch(/rgba?\(\s*(53, 208, 127|250, 204, 21|240, 160, 32)\b/)
  })

  /**
   * REGLE DE L'UTILISATEUR (2026-10-09, conv-124) : « jamais de bouton a triple degrade ».
   * Un bouton -- envoi, onglet, element de menu actif, pastille, choix -- porte au plus DEUX
   * teintes. Les jetons de degrade du theme sont resolus avant de compter : un rose -> violet
   * -> or cache derriere une variable compte comme trois teintes.
   */
  it('ne donne a aucun bouton un degrade de plus de deux teintes', () => {
    const BOUTON =
      /btn|send|-tab\b|-tab[.:[\s]|tabs? |nav-item|toggle|tests-run|tests-add|askd-item|rail-toggle|panel-close/
    const fautifs: string[] = []
    const normaliser = (selecteur: string): string => selecteur.replace(/\s+/g, ' ').trim()
    const main = postcss.parse(lire('./theme-nebuleuse-verre.css'))
    const jetons = new Map<string, string>()
    main.walkDecls(/^--nv-/, (decl) => {
      jetons.set(decl.prop, decl.value)
    })
    // Le fichier ecrit a la main est importe APRES la couche generee : une regle generee dont
    // il reprend le MEME selecteur avec son propre fond ne s'affiche jamais. Seul le gagnant compte.
    const surcharges = new Set<string>()
    main.walkDecls(/^background/, (decl) => {
      const regle = decl.parent as postcss.Rule
      for (const selecteur of regle.selectors ?? []) surcharges.add(normaliser(selecteur))
    })
    for (const [fichier, racine] of [
      ['main', main],
      ['genere', postcss.parse(lire('./theme-nebuleuse-verre.genere.css'))]
    ] as const) {
      racine.walkRules((regle) => {
        if (!BOUTON.test(regle.selector)) return
        if (fichier === 'genere' && regle.selectors.every((s) => surcharges.has(normaliser(s)))) {
          return
        }
        regle.walkDecls(/^background/, (decl) => {
          const valeur = decl.value.replace(
            /var\((--nv-[\w-]+)\)/g,
            (m, nom) => jetons.get(nom) ?? m
          )
          for (const degrade of valeur.match(/linear-gradient\((?:[^()]|\([^()]*\))*\)/g) ?? []) {
            const teintes = degrade.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? []
            if (teintes.length > 2) fautifs.push(`${regle.selector} -> ${degrade}`)
          }
        })
      })
    }
    expect(fautifs).toEqual([])
  })

  /**
   * AUCUN FLOU DE FOND (2026-10-10, conv-124). Un parent porteur d'un `backdrop-filter` devient le
   * repere des enfants `position: fixed` : la fenetre des quotas (ModelQuotaIndicator.tsx), ancree
   * sur la fenetre de l'app, se calculait depuis le bloc de saisie et disparaissait. Le theme
   * sombre d'origine met deja `--container-blur` a 0 pour la meme raison (ui-system.css).
   */
  it('ne pose aucun flou de fond qui decalerait les fenetres ancrees sur la fenetre', () => {
    const fautifs: string[] = []
    for (const fichier of ['./theme-nebuleuse-verre.css', './theme-nebuleuse-verre.genere.css']) {
      postcss.parse(lire(fichier)).walkDecls((decl) => {
        if (/backdrop-filter$/.test(decl.prop) && decl.value.trim() !== 'none') {
          fautifs.push(`${fichier} : ${decl.prop}: ${decl.value}`)
        }
        if (decl.prop === '--container-blur' && !/^0(px)?$/.test(decl.value.trim())) {
          fautifs.push(`${fichier} : --container-blur: ${decl.value}`)
        }
      })
    }
    expect(fautifs).toEqual([])
  })
})
