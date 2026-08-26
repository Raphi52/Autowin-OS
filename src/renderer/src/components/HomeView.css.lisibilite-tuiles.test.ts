import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Lisibilite des tuiles d'accueil (conv-1417) : hierarchie et contraste, DISPOSITION INCHANGEE.
 *
 * Trois exigences verifiables sur le CSS :
 *  1. l'etiquette (titre) n'est plus peinte en `--text-dim` : un titre plus eteint que son propre
 *     contenu inverse la hierarchie ;
 *  2. le panneau pose un fond assez opaque (alpha >= 0.68) pour que le texte ne dependxe plus des
 *     nebuleuses qui passent derriere ;
 *  3. le contour du panneau est plus contraste que `rgba(255,255,255,0.18)` (alpha >= 0.24), sinon
 *     le CADRE, qui est ce qui porte la lisibilite ici, disparait sur le decor clair.
 *  4. la geometrie ne bouge pas : `.home-tile__label` garde `height: 24px` (contrat partage avec
 *     `WIDGET_LABEL_HEIGHT` de home-layout.ts) et le panneau garde son padding d'origine.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST si la correction est fausse : remettre
 * `color: var(--text-dim)` dans `.home-tile__label h2`, ou remettre
 * `background: var(--bg-1, rgba(0, 0, 0, 0.56))` / `border: 1px solid var(--line, rgba(255,255,255,0.18))`
 * dans `.home-tile__panel`. Verifie en les reintroduisant : ce test passe au rouge.
 * Et si la correction depassait son mandat en changeant la disposition (height 24px -> autre,
 * padding du panneau modifie), le point 4 passe au rouge.
 */
describe('HomeView.css — tuiles plus lisibles sans changer la disposition', () => {
  const brut = readFileSync(new URL('./HomeView.css', import.meta.url), 'utf8')
  const css = brut.replace(/\/\*[\s\S]*?\*\//g, '')

  function regle(selecteur: string): string {
    const debut = css.search(new RegExp('^' + selecteur.replace(/[.[\]$^*+?()|{}\\]/g, '\\$&') + '\\s*\\{', 'm'))
    expect(debut, `regle ${selecteur} absente`).toBeGreaterThanOrEqual(0)
    const fin = css.indexOf('}', debut)
    expect(fin).toBeGreaterThan(debut)
    return css.slice(debut, fin)
  }

  /** Alpha d'une valeur `rgba(...)`; 1 pour une couleur opaque connue. */
  function alpha(valeur: string): number {
    const rgba = valeur.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/)
    if (rgba) return Number(rgba[1])
    return 1
  }

  it('le titre de la tuile n est plus le texte le plus eteint de la tuile', () => {
    const corps = regle('.home-tile__label h2')
    const couleur = corps.match(/(?<!-)color\s*:\s*([^;]+);/)
    expect(couleur, 'le titre doit declarer sa couleur').not.toBeNull()
    const valeur = (couleur?.[1] ?? '').trim()
    expect(valeur).not.toBe('var(--text-dim)')
    expect(valeur).not.toMatch(/--text-faint/)
  })

  it('le panneau pose un fond opaque (alpha >= 0.68) et un contour contraste (alpha >= 0.24)', () => {
    const corps = regle('.home-tile__panel')
    const fond = corps.match(/(?<!-)background(-color)?\s*:\s*([^;]+);/)
    expect(fond, 'le panneau doit declarer son fond').not.toBeNull()
    expect(alpha(fond?.[2] ?? '')).toBeGreaterThanOrEqual(0.68)

    const bordure = corps.match(/border\s*:\s*([^;]+);/)
    expect(bordure, 'le panneau doit declarer son contour').not.toBeNull()
    expect(alpha(bordure?.[1] ?? '')).toBeGreaterThanOrEqual(0.24)
  })

  it('la disposition ne bouge pas : hauteur d etiquette et padding de panneau intacts', () => {
    expect(regle('.home-tile__label')).toMatch(/height\s*:\s*24px/)
    expect(regle('.home-tile__panel')).toMatch(/padding\s*:\s*8px 5px 8px 7px/)
  })
})
