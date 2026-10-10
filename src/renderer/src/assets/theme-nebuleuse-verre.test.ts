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
   * REGLE DE L'UTILISATEUR (2026-10-10, conv-155) : le coin bas-droit pince « faisait sens pour la
   * bulle de chat mais pas pour les boutons et les highlights ». Seule la bulle de SES messages a
   * le droit d'avoir des coins inegaux ; un bouton ou un element selectionne a des coins reguliers.
   */
  it('reserve le coin pince aux bulles de message de l utilisateur', () => {
    const coinsInegaux: string[] = []
    for (const fichier of ['./theme-nebuleuse-verre.css', './theme-nebuleuse-verre.genere.css']) {
      postcss.parse(lire(fichier)).walkDecls(/^(border-radius|--nv-forme-toi)$/, (decl) => {
        // Une valeur calculee (`calc(var(--nv-rond) - 1px)`) est UN rayon, pas quatre coins.
        const coins = decl.value.includes('(') ? [decl.value] : decl.value.split('/')[0].trim().split(/\s+/)
        if (new Set(coins).size < 2) return
        const regle = decl.parent as postcss.Rule
        if (regle.selectors.every((s) => /\.msg\.user \.msg-body$/.test(s.trim()))) return
        coinsInegaux.push(`${regle.selector} -> ${decl.value}`)
      })
    }
    expect(coinsInegaux).toEqual([])
  })

  /**
   * LA SAISIE SANS ROSE (2026-10-10, conv-155, variante « B · S'allume, rond » choisie sur
   * maquette) : bloc noir profond uni a bord or, bouton d'envoi ROND qui s'allume en or plein
   * quand le message peut partir, contour or eteint quand le champ est vide, aucune lueur.
   */
  it('donne a la saisie le noir a bord or et le bouton rond qui s allume en or', () => {
    const decls = (selecteur: string): Record<string, string> => {
      const valeurs: Record<string, string> = {}
      postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((regle) => {
        if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
        regle.walkDecls((d) => {
          valeurs[d.prop] = d.value
        })
      })
      return valeurs
    }
    const saisie = decls(`${PREFIXE} .cosmic-outline .composer`)
    expect(saisie['--nv-saisie-degrade']).toBe('linear-gradient(#09090a, #09090a)')
    expect(decls(`${PREFIXE} .cosmic-outline .chat > .composer`)['--nv-saisie-bord']).toBe(
      'rgba(212, 169, 79, 0.5)'
    )
    const envoi = decls(`${PREFIXE} .cosmic-outline .composer-send`)
    expect(envoi['border-radius']).toBe('50%')
    expect([envoi.width, envoi.height]).toEqual(['38px', '38px'])
    expect(envoi['--nv-envoi-fond']).toBe('#d9ae52')
    expect(envoi['--nv-envoi-vide-fond']).toBe('transparent')
    expect(envoi['--nv-envoi-lueur']).toBe('none')
    // Plus aucun rose dans les regles de la saisie ecrites a la main.
    const saisieEtEnvoi = JSON.stringify([saisie, envoi])
    expect(saisieEtEnvoi).not.toMatch(/230, 60, 160|nv-degrade\b|nv-lueur-toi/)
  })

  it('allume le mode auto de la saisie en or, pas en rose', () => {
    let actif = ''
    postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((regle) => {
      if (regle.selector.trim() === `${PREFIXE} .composer-auto.actif`) actif = regle.toString()
    })
    expect(actif).toContain('rgba(212, 169, 79, 0.75)')
    expect(actif).not.toMatch(/251, 91, 171/)
  })

  /**
   * DEMANDE DE L'UTILISATEUR (2026-10-10, conv-157) : « met des borders degrade [...] sur les
   * elements du chat qui ont un cadre comme ca » (capture de la carte de fichier du fil), precise :
   * « ca doit etre les memes couleurs que mes messages dans le chat ». Le bord rose plein de la
   * couche generee laisse place a un calque au degrade EXACT des bulles de l'utilisateur, qui
   * garde les coins arrondis.
   */
  it('borde les cartes de fichier du fil du degrade des bulles de l utilisateur', () => {
    const decls = (selecteur: string): Record<string, string> => {
      const valeurs: Record<string, string> = {}
      postcss.parse(lire('./theme-nebuleuse-verre.css')).walkRules((regle) => {
        if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
        regle.walkDecls((d) => {
          valeurs[d.prop] = d.value
        })
      })
      return valeurs
    }
    const carte = decls(`${PREFIXE} .artifact-preview`)
    expect(carte.border).toBe('0')
    expect(carte.position).toBe('relative')
    const bord = decls(`${PREFIXE} .artifact-preview::before`)
    const bulle = decls(`${PREFIXE} .msg.user .msg-body`)
    expect(bulle.background).toBe('linear-gradient(135deg, #e63ca0, #3c6eeb)')
    expect(bord.background).toBe(bulle.background)
    expect(bord['border-radius']).toBe('inherit')
    expect(bord['mask-composite']).toBe('exclude')
    expect(bord['pointer-events']).toBe('none')
  })
})
