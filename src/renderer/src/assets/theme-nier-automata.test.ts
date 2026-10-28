import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * Theme « NieR:Automata » (conv-281, 2026-10-19) : papier beige, encre brune, coins carres. Base
 * CLAIRE, meme mecanique que Vanilla Claude :
 *   - theme-nier-automata.genere.css : les regles de la base claire qui ecrivent une couleur en dur,
 *     re-prefixees et transposees (`node scripts/theme-nebuleuse-verre.mjs nier-automata`) ;
 *   - theme-nier-automata.css : jetons, colonne, chat, jauge des quotas (ecrite a la main).
 *
 * Le risque qui compte : une regle NON confinee repeindrait le mode clair de TOUS les utilisateurs.
 */
const lire = (fichier: string): string => readFileSync(new URL(fichier, import.meta.url), 'utf8')
const PREFIXE = ":root[data-theme='nier-automata'][data-base='clair']"

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

const canal = (c: number): number => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const luminance = (h: string): number =>
  0.2126 * canal(parseInt(h.slice(1, 3), 16)) +
  0.7152 * canal(parseInt(h.slice(3, 5), 16)) +
  0.0722 * canal(parseInt(h.slice(5, 7), 16))
const contraste = (a: string, b: string): number => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** Valeur d'un jeton dans le PREMIER bloc dont le selecteur est exactement le prefixe. */
function jeton(css: string, nom: string): string {
  let valeur = ''
  postcss.parse(css).walkRules((regle) => {
    if (valeur || regle.selector.trim() !== PREFIXE) return
    regle.walkDecls(nom, (d) => {
      if (!valeur) valeur = d.value.trim()
    })
  })
  return valeur
}

/** Valeur d'une declaration dans la regle qui vise exactement `PREFIXE + suffixe`. */
function declaration(css: string, suffixe: string, nom: string): string {
  let valeur = ''
  postcss.parse(css).walkRules((regle) => {
    if (regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === `${PREFIXE} ${suffixe}`))
      regle.walkDecls(nom, (d) => {
        valeur = d.value.replace(/\s*!important/, '').trim()
      })
  })
  return valeur
}

describe('theme NieR:Automata', () => {
  /** ENTREE QUI DOIT FAIRE ECHOUER CE CAS : une regle generee ou ecrite sans le prefixe du theme. */
  it('ne peint rien hors du theme : chaque selecteur porte le prefixe', () => {
    const genere = lire('./theme-nier-automata.genere.css')
    let regles = 0
    postcss.parse(genere).walkRules(() => {
      regles += 1
    })
    expect(regles).toBeGreaterThan(40)
    expect(selecteursHorsTheme(genere)).toEqual([])
    expect(selecteursHorsTheme(lire('./theme-nier-automata.css'))).toEqual([])
  })

  it('est inscrit au registre en base claire et charge apres la base claire', () => {
    expect(lire('../theme-mode.ts')).toContain(
      "{ id: 'nier-automata', libelle: 'NieR:Automata', base: 'clair' }"
    )
    const app = lire('../App.tsx')
    const base = app.indexOf("import './assets/theme-clair-gris.css'")
    const genere = app.indexOf("import './assets/theme-nier-automata.genere.css'")
    const main = app.indexOf("import './assets/theme-nier-automata.css'")
    expect(base).toBeGreaterThan(-1)
    expect(genere).toBeGreaterThan(base)
    expect(main).toBeGreaterThan(genere)
  })

  /** Un fichier retouche a la main ou une base claire modifiee sans regenerer fait echouer ce cas. */
  it('la couche sur disque est a jour avec son generateur', async () => {
    const { genererNierAutomata } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    expect(genererNierAutomata().css).toBe(lire('./theme-nier-automata.genere.css'))
  })

  /**
   * Seuil WCAG AA (4,5:1) pour tout texte, sur la page (--bg-0) ET sur les panneaux (--bg-2).
   * ENTREE QUI DOIT FAIRE ECHOUER CE CAS : eclaircir l'encre discrete (#4f4c43 -> #7a7668).
   */
  it('garde chaque couleur de texte lisible sur le papier et sur les panneaux', () => {
    const css = lire('./theme-nier-automata.css')
    const fonds = [jeton(css, '--bg-0'), jeton(css, '--bg-2')]
    expect(fonds).toEqual(['#dad4bb', '#c8c2a8'])
    for (const texte of ['--text', '--text-dim', '--text-faint', '--gold', '--accent']) {
      const couleur = jeton(css, texte)
      expect(couleur, texte).toMatch(/^#[0-9a-f]{6}$/i)
      for (const fond of fonds)
        expect(contraste(couleur, fond), `${texte} sur ${fond}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  /** Les elements en NEGATIF (papier sur encre) : pastille du quota, etiquette « contexte », menu. */
  it('garde lisibles les elements en negatif', () => {
    const css = lire('./theme-nier-automata.css')
    for (const cible of ['.model-quota-bar-value', '.chat-context-rule-libelle', '.nav-item.active']) {
      const fond = declaration(css, cible, 'background')
      const texte = declaration(css, cible, 'color')
      expect([fond, texte], cible).toEqual(['#4e4b42', '#dad4bb'])
      expect(contraste(texte, fond)).toBeGreaterThanOrEqual(4.5)
    }
  })

  /**
   * Menu du dossier de travail (pastille 📁, conv-1218) : il gardait le #ffffff de la base claire
   * (theme-modes.css), que le generateur ne transpose pas (blanc = non sature). La colonne des
   * croix d'oubli, transparente, le montrait en bande blanche a cote des lignes peintes en beige
   * par `button:not([class])`. ENTREE QUI DOIT FAIRE ECHOUER CE CAS : retirer le fond papier du
   * menu, ou rendre aux lignes un fond different de celui du menu.
   */
  it('peint le menu des dossiers en papier, lignes et colonne des croix sur le meme fond', () => {
    const css = lire('./theme-nier-automata.css')
    const fondMenu = declaration(css, '.conv-menu-pop', 'background')
    expect(fondMenu).toBe('#cdc8b0')
    expect(declaration(css, '.conv-menu-pop button:not([class])', 'background')).toBe('transparent')
    expect(contraste(jeton(css, '--text'), fondMenu)).toBeGreaterThanOrEqual(4.5)
  })
})
