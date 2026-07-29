import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const component = readFileSync(new URL('./ModelQuotaIndicator.tsx', import.meta.url), 'utf8')
const styles = readFileSync(new URL('./ModelQuotaIndicator.css', import.meta.url), 'utf8')

describe('wheel de quota G', () => {
  it('utilise un rail SVG et un arc arrondi piloté par le pourcentage restant', () => {
    expect(component).toContain('model-quota-wheel')
    expect(component).toContain('model-quota-wheel-track')
    expect(component).toContain('model-quota-wheel-value')
    expect(component).toContain("'--quota-angle': `${remaining ?? 0}`")
    expect(component.match(/pathLength="100"/g)).toHaveLength(2)
    expect(styles).toMatch(
      /\.model-quota-wheel-value\s*{[^}]*stroke-linecap:\s*round;[^}]*stroke-dasharray:\s*var\(--quota-angle\)\s+100;/s
    )
  })

  it('verrouille le diam?tre compact et les quatre ?tats de couleur', () => {
    expect(styles).toMatch(/\.model-quota-trigger\s*{[^}]*width:\s*29px;[^}]*height:\s*29px;/s)
    const stateColors = {
      healthy: '#35d07f',
      warning: '#f59e0b',
      critical: '#ef4444'
    }
    for (const [level, color] of Object.entries(stateColors)) {
      expect(styles).toMatch(
        new RegExp(`\\.model-quota-trigger\\.is-${level}\\s*{[^}]*--quota-color:\\s*${color};`, 's')
      )
    }
    expect(styles).toMatch(/\.model-quota-trigger\.is-unknown\s*{[^}]*--quota-color:\s*#687782;/s)
    expect(styles).toContain('--quota-color, #35d07f')
    expect(styles).toMatch(
      /\.model-quota-meter i\s*{[^}]*linear-gradient\(90deg,\s*#ef4444 0%,\s*#f59e0b 45%,\s*#35d07f 100%\);/s
    )
  })

  it('conserve le popover existant hors de la wheel', () => {
    expect(component).toContain('model-quota-popover')
    expect(component).toContain('Quotas fournisseurs')
  })
})
