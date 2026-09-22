// fix-ok: les éditions répétées venaient du shell qui avait mangé les doubles barres obliques inverses des RegExp (\[) — mesuré : bloc introuvable, puis vert après restauration
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * THEMES SPECIAL MALVOYANT : contraste CALCULE (WCAG 2.1). Texte courant >= 7:1 (AAA),
 * secondaire et accents >= 4,5:1. ENTREE QUI DOIT FAIRE ECHOUER : un --text-faint gris moyen.
 */
const css = readFileSync('src/renderer/src/assets/theme-modes.css', 'utf8')

function bloc(id: string): string {
  const m = new RegExp(`:root\\[data-theme='${id}'\\] \\{([^}]*)\\}`).exec(css)
  if (!m) throw new Error(`bloc ${id} introuvable`)
  return m[1]
}
function hex(b: string, v: string): string {
  const m = new RegExp(`${v}:\\s*(#[0-9a-f]{6})`, 'i').exec(b)
  if (!m) throw new Error(`${v} absente`)
  return m[1]
}
function lum(c: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contraste(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

describe.each(['malvoyant-sombre', 'malvoyant-clair'])('%s', (id) => {
  const b = bloc(id)
  const fonds = ['--bg-0', '--bg-1', '--bg-2'].map((v) => hex(b, v))
  it.each(fonds)('texte courant >= 7:1 sur %s', (f) => {
    expect(contraste(hex(b, '--text'), f)).toBeGreaterThanOrEqual(7)
    expect(contraste(hex(b, '--text-dim'), f)).toBeGreaterThanOrEqual(7)
  })
  it.each(['--text-faint', '--gold', '--rose', '--cyan', '--violet', '--ok', '--warn', '--err', '--accent', '--focus-malvoyant'])(
    '%s >= 4,5:1 sur tous les fonds',
    (v) => {
      for (const f of fonds) expect(contraste(hex(b, v), f)).toBeGreaterThanOrEqual(4.5)
    }
  )
})
