import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

// fix-ok: vu rouge d abord (feuille et import absents), puis mis en forme par prettier ; aucune assertion desserree.
/**
 * Theme « Ninja Claude » (conv-269, 2026-10-16) : l'apparence de Claude en sombre. Deux fichiers :
 * la couche generee des couleurs en dur (theme-ninja-claude.genere.css, produite par
 * `node scripts/theme-nebuleuse-verre.mjs ninja-claude`) et la feuille ecrite a la main
 * (theme-ninja-claude.css : jetons, polices, chat, decor retire).
 *
 * Le risque qui compte : une regle NON confinee au theme repeindrait l'application de TOUS les
 * utilisateurs, quel que soit le theme choisi.
 */
const lire = (fichier: string): string => readFileSync(new URL(fichier, import.meta.url), 'utf8')
const PREFIXE = ":root[data-theme='ninja-claude']"

function selecteursHorsTheme(css: string): string[] {
  const fautifs: string[] = []
  postcss.parse(css).walkRules((regle) => {
    if (regle.parent?.type === 'atrule' && /keyframes/i.test((regle.parent as postcss.AtRule).name))
      return
    for (const selecteur of regle.selectors) {
      if (!selecteur.trim().startsWith(PREFIXE)) fautifs.push(selecteur)
    }
  })
  return fautifs
}

/** Toutes les couleurs d'un fichier, en `r,g,b`. */
function couleurs(css: string): string[] {
  const sortie: string[] = []
  for (const m of css.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g))
    sortie.push(`${m[1]},${m[2]},${m[3]}`)
  return sortie
}

describe('theme Ninja Claude', () => {
  /** ENTREE QUI DOIT FAIRE ECHOUER CE CAS : une regle generee ou ecrite sans le prefixe du theme. */
  it('ne peint rien hors du theme : chaque selecteur porte le prefixe', () => {
    const genere = lire('./theme-ninja-claude.genere.css')
    expect(postcss.parse(genere).nodes.length).toBeGreaterThan(100)
    expect(selecteursHorsTheme(genere)).toEqual([])
    expect(selecteursHorsTheme(lire('./theme-ninja-claude.css'))).toEqual([])
  })

  /** ENTREE QUI DOIT FAIRE ECHOUER CE CAS : oublier l'import, ou charger la main AVANT la couche. */
  it('est charge par l application, la couche generee AVANT la feuille ecrite a la main', () => {
    const app = lire('../App.tsx')
    const genere = app.indexOf("import './assets/theme-ninja-claude.genere.css'")
    const main = app.indexOf("import './assets/theme-ninja-claude.css'")
    expect(genere).toBeGreaterThan(-1)
    expect(main).toBeGreaterThan(genere)
  })

  /**
   * La couche sur disque est EXACTEMENT ce que produit le generateur : un fichier retouche a la main
   * ou une source modifiee sans regenerer fait echouer ce cas.
   */
  it('la couche sur disque est a jour avec son generateur', async () => {
    const { genererNinjaClaude } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    expect(genererNinjaClaude().css).toBe(lire('./theme-ninja-claude.genere.css'))
  })

  /**
   * Plus d'or ni de cyan d'Autowin, mais les jaunes d'ETAT gardent leur sens.
   * ENTREE QUI DOIT FAIRE ECHOUER CE CAS : transposer par plage de teinte au lieu de la liste des ors
   * (le jaune « question » #facc15 deviendrait terracotta), ou oublier une famille.
   */
  it('transpose l or et le cyan d Autowin, garde les jaunes d etat', async () => {
    const genere = lire('./theme-ninja-claude.genere.css')
    const sortie = couleurs(genere)
    // Or de la marque (#e9bd4e) et cyan HUD (#49cfff) : absents de la couche produite.
    expect(sortie).not.toContain('233,189,78')
    expect(sortie).not.toContain('73,207,255')
    // La regle qui portait l'or des titres du fil existe bien, et devient terracotta (teinte 10-25 deg).
    expect(genere).toMatch(/--gold: rgb\(\d+, \d+, \d+\)/)
    const [, r, g, b] = genere.match(/--gold: rgb\((\d+), (\d+), (\d+)\)/) ?? []
    expect(Number(r)).toBeGreaterThan(Number(g))
    expect(Number(g)).toBeGreaterThan(Number(b))
    // Les jaunes d'etat ne sont jamais reecrits : aucune regle generee pour le jeton de la question.
    expect(genere).not.toMatch(/--chat-etat-question:/)
    expect(genere).not.toMatch(/--chat-etat-non-lu:/)
  })

  /**
   * Claude ecrit ses titres en casse normale, sans capitales espacees ni filet, et son menu est
   * monochrome. Autowin pose `text-transform: uppercase` dans 127 regles de 34 feuilles : seul un
   * reglage global du theme les neutralise toutes, vue par vue on en oublierait.
   * ENTREE QUI DOIT FAIRE ECHOUER CE CAS : retirer la neutralisation globale, le gris du menu, le
   * logo remplace ou l'effacement du filet des tuiles.
   */
  it('casse normale, menu monochrome, logo terracotta, sans filet de titre', () => {
    const regles = new Map<string, postcss.Rule>()
    postcss.parse(lire('./theme-ninja-claude.css')).walkRules((r) => {
      for (const s of r.selectors) regles.set(s.trim(), r)
    })
    const decl = (sel: string, prop: string): string | undefined => {
      let v: string | undefined
      regles.get(`${PREFIXE} ${sel}`)?.walkDecls(prop, (d) => {
        v = d.value + (d.important ? ' !important' : '')
      })
      return v
    }
    expect(decl('*', 'text-transform')).toBe('none !important')
    expect(decl('*', 'letter-spacing')).toBe('normal !important')
    expect(decl('.space-toy-icon', 'filter')).toMatch(/grayscale\(1\)/)
    expect(decl('.brand-logo', 'content')).toMatch(/^url\("data:image\/svg\+xml,.*d97757/)
    expect(decl('.home-tile__rule', 'background')).toBe('none')
  })
})
