import { existsSync, readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { APP_DESTINATIONS } from '../../../shared/navigation'
import { THEMES_EN } from '../textes'
import { THEMES } from '../theme-mode'

/**
 * Thème « Enseignes » (Signboards en anglais) — conv-1586, 2026-11-05 : « implémenter Signboards du
 * premier caroussel », la proposition 1 du tour 2 du /draft « un thème qui suit l'univers de
 * l'accueil ». Base CLAIRE : ciel pâle, panneaux blancs, coins de 14 px ; chaque entrée du menu porte
 * l'ENSEIGNE de sa tour (carré de couleur, symbole du Quartier), et la ZONE OUVERTE teinte l'en-tête,
 * le bouton Envoyer et le focus de la saisie.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST : une règle non confinée au thème (elle repeindrait tous
 * les thèmes clairs), un écran du menu sans couleur de zone, une couleur de zone trop pâle pour porter
 * du texte, ou une coque qui ne dit plus quelle zone est ouverte (`data-zone`).
 */
const lire = (chemin: string): string => readFileSync(new URL(chemin, import.meta.url), 'utf8')
const FEUILLE = './theme-enseignes.css'
const PREFIXE = ":root[data-theme='enseignes'][data-base='clair']"
const css = existsSync(new URL(FEUILLE, import.meta.url)) ? lire(FEUILLE) : ''

type Rgb = [number, number, number]
const rgb = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb
const canal = (c: number): number => {
  const v = c / 255
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}
const luminance = (h: string): number => {
  const [r, g, b] = rgb(h)
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b)
}
const contraste = (a: string, b: string): number => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** Les déclarations de la règle dont un sélecteur se termine par `fin`. */
function declarations(fin: string): Record<string, string> {
  const vues: Record<string, string> = {}
  postcss.parse(css).walkRules((regle) => {
    if (!regle.selectors.some((s) => s.trim().endsWith(fin))) return
    regle.walkDecls((d) => {
      vues[d.prop] = d.value.trim()
    })
  })
  return vues
}

describe('thème Enseignes : présent et proposé', () => {
  it('est au registre en base claire, avec son nom anglais « Signboards »', () => {
    expect(THEMES.find((t) => t.id === 'enseignes')).toEqual({
      id: 'enseignes',
      libelle: 'Enseignes',
      base: 'clair'
    })
    expect(THEMES_EN['enseignes']).toBe('Signboards')
  })

  it("sa feuille existe et l'application l'importe", () => {
    expect(css, 'feuille theme-enseignes.css absente').not.toBe('')
    expect(lire('../App.tsx')).toMatch(/import '\.\/assets\/theme-enseignes\.css'/)
  })

  it('la coque dit quelle zone est ouverte : data-zone suit l écran affiché', () => {
    // Dans la balise ouvrante de la coque elle-même (aucun `>` entre les deux).
    expect(lire('../App.tsx')).toMatch(/className="shell[^"]*"[^>]*data-zone=\{tab\}/)
  })
})

describe('thème Enseignes : confiné à lui-même', () => {
  it('chaque sélecteur commence par le préfixe du thème', () => {
    const fautifs: string[] = []
    postcss.parse(css).walkRules((regle) => {
      for (const s of regle.selectors) if (!s.trim().startsWith(PREFIXE)) fautifs.push(s)
    })
    expect(css).not.toBe('')
    expect(fautifs).toEqual([])
  })
})

describe('thème Enseignes : une enseigne par écran du menu', () => {
  for (const { id } of APP_DESTINATIONS) {
    it(`${id} a sa couleur de zone, lisible`, () => {
      const zone = declarations(`.shell[data-zone='${id}']`)
      const entree = declarations(`[data-testid='nav-${id}']`)
      expect(zone['--sb-signe'], `zone ${id} sans couleur`).toMatch(/^#[0-9a-f]{6}$/)
      // La même règle sert l'écran ouvert et son entrée du menu : une seule couleur par zone.
      expect(entree['--sb-signe']).toBe(zone['--sb-signe'])
      expect(zone['--sb-glyphe'], `zone ${id} sans symbole`).toMatch(/^url\("data:image\/svg\+xml/)
      // Le symbole sur l'enseigne : un objet graphique, 3:1 (WCAG 1.4.11).
      expect(contraste(zone['--sb-encre'], zone['--sb-signe'])).toBeGreaterThanOrEqual(3)
      // La variante foncée porte du TEXTE : titre sur le ciel, texte blanc sur elle (4,5:1).
      expect(contraste(zone['--sb-fonce'], '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contraste(zone['--sb-fonce'], '#dbeefd')).toBeGreaterThanOrEqual(4.5)
    })
  }
})

describe('thème Enseignes : le texte se lit sur le ciel', () => {
  it('texte, texte doux et texte pâle passent 4,5:1 sur le fond de page', () => {
    const jetons = declarations(PREFIXE)
    expect(jetons['--bg-0']).toBe('#dbeefd')
    for (const nom of ['--text', '--text-dim', '--text-faint', '--titlebar-symbol']) {
      expect(contraste(jetons[nom], jetons['--bg-0']), nom).toBeGreaterThanOrEqual(4.5)
    }
  })
})
