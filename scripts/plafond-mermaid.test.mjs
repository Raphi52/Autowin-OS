import { describe, expect, it } from 'vitest'
import { evaluerHauteurMermaid } from './plafond-mermaid.mjs'

describe('evaluerHauteurMermaid', () => {
  it('lit le plafond DANS la feuille, pas une valeur en dur', () => {
    // Feuille a min(45vh, 300px) : un SVG de 420px doit ETRE refuse.
    const r = evaluerHauteurMermaid({
      svgHauteur: 420,
      plafondHauteur: '300px',
      hauteurFenetre: 835
    })
    expect(r.depasse).toBe(true)
    expect(r.plafond).toBe(300)
  })

  it('accepte une hauteur egale au plafond lu', () => {
    const r = evaluerHauteurMermaid({
      svgHauteur: 300,
      plafondHauteur: '300px',
      hauteurFenetre: 835
    })
    expect(r.depasse).toBe(false)
  })

  it('tolere 1px d arrondi', () => {
    const r = evaluerHauteurMermaid({
      svgHauteur: 301,
      plafondHauteur: '300px',
      hauteurFenetre: 835
    })
    expect(r.depasse).toBe(false)
  })

  it('sans plafond lisible, ne conclut pas', () => {
    const r = evaluerHauteurMermaid({
      svgHauteur: 1544,
      plafondHauteur: 'none',
      hauteurFenetre: 835
    })
    expect(r.depasse).toBe(false)
    expect(r.plafond).toBe(null)
  })
})
