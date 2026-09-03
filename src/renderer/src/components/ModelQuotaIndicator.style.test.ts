import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const component = readFileSync(new URL('./ModelQuotaIndicator.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./ModelQuotaIndicator.css', import.meta.url), 'utf8')

describe('barre de quota cliquable', () => {
  it('rend une barre pilotée par le pourcentage restant, et plus aucune roue', () => {
    expect(component).toContain('model-quota-bar')
    expect(component).toContain('model-quota-bar-fill')
    expect(component).toContain("'--quota-fill': `${remaining ?? 0}%`")
    // La roue est SUPPRIMÉE : plus de SVG ni d'arc, ni dans le composant ni dans les styles.
    expect(component).not.toContain('model-quota-wheel')
    expect(component).not.toContain('pathLength')
    expect(component).not.toContain('--quota-angle')
    expect(styles).not.toContain('model-quota-wheel')
  })

  it('garde le dégradé rouge → orange → jaune → vert dans ce sens, calé sur la barre entière', () => {
    expect(styles).toMatch(
      /\.model-quota-bar-fill\s*{[^}]*linear-gradient\(\s*90deg,\s*#ef4444 0%,\s*#f59e0b 35%,\s*#facc15 65%,\s*#35d07f 100%\s*\);/s
    )
    // Le restant DÉCOUPE le dégradé au lieu de le compresser : à 10 % restant il ne reste que du
    // rouge, alors qu'une largeur portée par l'élément laisserait du vert au bord droit.
    expect(styles).toMatch(
      /\.model-quota-bar-fill\s*{[^}]*clip-path:\s*inset\(0 calc\(100% - var\(--quota-fill, 0%\)\) 0 0\);/s
    )
  })

  it('conserve les quatre états de couleur du nombre', () => {
    const stateColors = {
      healthy: '#35d07f',
      warning: '#f59e0b',
      critical: '#ef4444',
      unknown: '#687782'
    }
    for (const [level, color] of Object.entries(stateColors)) {
      expect(styles).toMatch(
        new RegExp(`\\.model-quota-trigger\\.is-${level}\\s*{[^}]*--quota-color:\\s*${color};`, 's')
      )
    }
    expect(styles).toContain('--quota-color, #35d07f')
    expect(styles).toMatch(
      /\.model-quota-meter i\s*{[^}]*linear-gradient\(90deg,\s*#ef4444 0%,\s*#f59e0b 45%,\s*#35d07f 100%\);/s
    )
  })

  it('conserve le popover existant, désormais ouvert par la barre', () => {
    expect(component).toContain('model-quota-popover')
    expect(component).toContain('Quotas fournisseurs')
  })
})
