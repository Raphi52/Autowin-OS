import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./UpdateBanner.css', import.meta.url), 'utf8')
const component = readFileSync(new URL('./UpdateBanner.tsx', import.meta.url), 'utf8')

describe('bouton de mise à jour — direction Or royal', () => {
  it('reste une ligne système compacte dominée par le doré', () => {
    expect(css).toContain('min-height: 37px')
    expect(css).toContain(
      'border: 1px solid color-mix(in srgb, var(--gold, #e9bd4e) 48%, var(--line))'
    )
    expect(css).toContain('color: var(--gold')
    expect(css).toContain('background: transparent')
  })

  it('réserve le violet au survol et au focus', () => {
    expect(css).toContain('var(--violet')
    expect(css).toMatch(/rail-update-btn:(?:hover|focus-visible)[\s\S]*var\(--violet/)
  })

  it('utilise une icône vectorielle fine plutôt qu’un glyphe texte', () => {
    expect(component).toContain('<svg')
    expect(component).not.toContain('⟳')
  })

  it('dessine deux flèches épaisses avec des arcs nettement séparés', () => {
    expect(component).toContain('strokeWidth="2.4"')
    expect(component).toContain('M4.5 9A8 8 0 0 1 18 5.5')
    expect(component).toContain('M19.5 15A8 8 0 0 1 6 18.5')
    expect(component).not.toContain('M20 7v5h-5')
  })
})
