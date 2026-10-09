import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { THEMES, baseDuTheme } from '../theme-mode'

/**
 * Theme « Nebuleuse doree » (conv-139, 2026-10-10) : Nebuleuse de verre en or et noir. Ses deux
 * feuilles sont DERIVEES par scripts/theme-nebuleuse-verre.mjs nebuleuse-doree.
 */
const lire = (fichier: string): string => readFileSync(new URL(fichier, import.meta.url), 'utf8')
const PREFIXE = ":root[data-theme='nebuleuse-doree']"

function selecteursHorsTheme(css: string): string[] {
  const fautifs: string[] = []
  postcss.parse(css).walkRules((regle) => {
    if (regle.parent?.type === 'atrule' && /keyframes/i.test((regle.parent as postcss.AtRule).name))
      return
    for (const s of regle.selectors) if (!s.trim().startsWith(PREFIXE)) fautifs.push(s)
  })
  return fautifs
}

describe('theme Nebuleuse doree', () => {
  it('est propose dans la liste des themes, en base sombre', () => {
    expect(THEMES.find((t) => t.id === 'nebuleuse-doree')?.libelle).toBe('Nébuleuse dorée')
    expect(baseDuTheme('nebuleuse-doree')).toBe('sombre')
  })

  it('charge la couche generee AVANT la feuille principale', () => {
    const app = lire('../App.tsx')
    const genere = app.indexOf("import './assets/theme-nebuleuse-doree.genere.css'")
    const main = app.indexOf("import './assets/theme-nebuleuse-doree.css'")
    expect(genere).toBeGreaterThan(-1)
    expect(main).toBeGreaterThan(genere)
  })

  it('ne peint rien hors du theme', () => {
    expect(selecteursHorsTheme(lire('./theme-nebuleuse-doree.css'))).toEqual([])
    expect(selecteursHorsTheme(lire('./theme-nebuleuse-doree.genere.css'))).toEqual([])
  })

  it('ne garde ni le rose ni le violet de Nebuleuse de verre', () => {
    for (const f of ['./theme-nebuleuse-doree.css', './theme-nebuleuse-doree.genere.css']) {
      expect(lire(f)).not.toMatch(/#ff3d9a|#7b5cff|255, 61, 154|123, 92, 255|14, 11, 32/i)
    }
  })

  it('donne a la zone de saisie le degrade or clair -> noir et garde les couleurs d etat', () => {
    const main = lire('./theme-nebuleuse-doree.css')
    expect(main).toContain('linear-gradient(315deg, rgba(240, 207, 122, 0.42), rgba(10, 8, 6, 0.92) 58%)')
    expect(main).toContain('--ok: #4fd1a5')
    expect(main).toContain('--warn: #ffb547')
  })

  it('est a jour avec sa source : regenerer ne change rien', async () => {
    const { genererMainDoree } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    expect(genererMainDoree()).toBe(lire('./theme-nebuleuse-doree.css'))
  })
})
