import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Sans les commentaires : un commentaire qui CITE le chevron ne doit pas attirer la règle suivante.
const styles = readFileSync('src/renderer/src/assets/app-shell.css', 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  ''
)

/** Corps de la règle dont le sélecteur est EXACTEMENT `selecteur`. */
function regle(selecteur: string): string {
  const m = [...styles.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find((r) => r[1].trim() === selecteur)
  return m?.[2] ?? ''
}

/** Abscisses min et max d'un tracé `M x y l dx dy …` (coordonnées relatives après le M). */
function etendueX(d: string): [number, number] {
  const n = (d.match(/-?\d*\.?\d+/g) ?? []).map(Number)
  let x = n[0]
  const xs = [x]
  for (let i = 2; i < n.length; i += 2) {
    x += n[i]
    xs.push(x)
  }
  return [Math.min(...xs), Math.max(...xs)]
}

/**
 * DÉFAUT VÉCU (2026-10-10) : « cette flèche aussi devrait être un chouya à gauche pour être bien
 * centrée » — le chevron du rail, à côté de « Autowin OS ». Banc Electron 44, 26 crans de zoom ×
 * 40 positions du bouton, écart entre le centre de l'étendue du chevron et celui du rond :
 *  - avant : +0,5 à +2,2 px à droite à TOUS les crans (« › » replié : jusqu'à 3,8 px). Trois causes
 *    cumulées : la marge intérieure par défaut du bouton (13 px pour un dessin de 15 px, la grille
 *    débordait à droite), un <svg> arrondi au pixel à part du rond, un tracé centré sur 11,5 ;
 *  - après : ±0,1 px en moyenne à chaque cran.
 * Ces gardes verrouillent les trois corrections.
 */
describe('chevron du rail — centré dans son rond à tous les crans de zoom', () => {
  it('le bouton n’a pas de marge intérieure : le tracé dispose de toute la largeur', () => {
    expect(regle('.rail-toggle')).toMatch(/(^|\s|;)padding:\s*0\s*;/)
  })

  it('le tracé remplit le bouton et y est peint par un masque étiré à 100 %', () => {
    const corps = regle('.rail-toggle-trait')
    expect(corps).toMatch(/width:\s*100%/)
    expect(corps).toMatch(/height:\s*100%/)
    expect(corps).toMatch(/background-color:\s*currentColor/)
    expect(corps).toMatch(/mask:\s*url\("data:image\/svg\+xml,[\s\S]*center\s*\/\s*100% 100%/)
  })

  it('les deux sens du chevron sont centrés sur le milieu de leur viewBox', () => {
    const traces = [...styles.matchAll(/viewBox='([^']+)'[\s\S]*?d='([^']+)'/g)]
    expect(traces).toHaveLength(2)
    for (const [, viewBox, d] of traces) {
      const [x0, , largeur] = viewBox.split(/\s+/).map(Number)
      const [min, max] = etendueX(d)
      expect((min + max) / 2).toBeCloseTo(x0 + largeur / 2, 5)
    }
  })

  it('aucun décalage réglé à la main sur le chevron', () => {
    for (const s of ['.rail-toggle', '.rail-toggle-trait', '.rail.is-collapsed .rail-toggle-trait'])
      expect(regle(s)).not.toMatch(/translate/)
  })
})
