import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, 'theme-modes.css'), 'utf8')

/**
 * LISTE « MODE » DU WIDGET TRANSCRIPTION EN MODE CLAIR (signalé avec capture le 2026-09-28).
 * `.enregistrements__champ select` a un fond `#14120d` EN DUR (HomeView.css l.1453) ; le mode
 * clair ne reprenait que la couleur du texte (theme-clair-gris.css) : liste noire, options
 * illisibles. Même défaut que les champs de Jarvis, corrigé au même endroit.
 */
describe('mode clair : liste « Mode » de la transcription', () => {
  it('le select et ses options ont un fond clair', () => {
    const i = css.indexOf(":root[data-base='clair'] .enregistrements__champ select option")
    expect(i, 'surcharge claire de .enregistrements__champ select absente').toBeGreaterThan(-1)
    const bloc = css.slice(i, css.indexOf('}', i))
    expect(bloc).toMatch(/background:\s*#ffffff/i)
    expect(bloc).toMatch(/color:\s*var\(--text\)/)
  })
})
