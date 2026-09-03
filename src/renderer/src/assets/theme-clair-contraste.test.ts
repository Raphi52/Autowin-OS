import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * LISIBILITÉ DU MODE CLAIR, mesurée et non supposée.
 *
 * Le piège d'un mode clair fabriqué à partir d'un thème de nuit : on inverse les fonds et on
 * garde les accents. Or le jaune `#e9bd4e` et le rose `#ef3f91` du mode sombre tombent sous
 * 3:1 sur blanc — un titre jaune pâle sur fond blanc devient illisible. Ce test CALCULE le
 * contraste réel (formule WCAG 2.1) des couleurs déclarées pour `:root[data-theme='clair']`.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : recopier telle quelle une couleur du mode sombre
 * dans le bloc clair.
 */
const css = readFileSync('src/renderer/src/assets/theme-modes.css', 'utf8')
const blocClair = css.slice(css.indexOf(":root[data-theme='clair']"))

function hex(variable: string): string {
  const trouve = new RegExp(`${variable}:\\s*(#[0-9a-f]{6})`, 'i').exec(blocClair)
  if (!trouve) throw new Error(`Variable ${variable} absente du mode clair`)
  return trouve[1]
}

function luminance(couleur: string): number {
  const canaux = [1, 3, 5].map((i) => parseInt(couleur.slice(i, i + 2), 16) / 255)
  const [r, v, b] = canaux.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * v + 0.0722 * b
}

function contraste(a: string, b: string): number {
  const [clair, sombre] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (clair + 0.05) / (sombre + 0.05)
}

describe('mode clair — contraste des couleurs sur le fond de page', () => {
  const fond = hex('--bg-0')

  it('le texte courant dépasse largement le seuil AA (4,5:1)', () => {
    expect(contraste(hex('--text'), fond)).toBeGreaterThanOrEqual(4.5)
  })

  it('le texte secondaire reste au seuil AA', () => {
    expect(contraste(hex('--text-dim'), fond)).toBeGreaterThanOrEqual(4.5)
  })

  it('le texte discret tient au moins le seuil des grands textes (3:1)', () => {
    expect(contraste(hex('--text-faint'), fond)).toBeGreaterThanOrEqual(3)
  })

  it.each(['--gold', '--rose', '--cyan', '--ok', '--err', '--violet'])(
    '%s reste lisible sur fond clair',
    (variable) => {
      expect(contraste(hex(variable), fond)).toBeGreaterThanOrEqual(3)
    }
  )
})
