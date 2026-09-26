import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, 'ChatView.css'), 'utf8')

/**
 * DEUX LIGNES VISIBLES DANS LA ZONE DE SAISIE (demande utilisateur du 2026-09-18).
 * Constat a l'ecran : une seule ligne tenait, la deuxieme etait coupee derriere l'ascenseur.
 * La hauteur mini se pose en em (multiple de la hauteur de ligne 1.45) pour suivre la taille
 * de police, et `min-height` l'emporte sur la hauteur INLINE calculee par l'auto-croissance.
 */
describe('zone de saisie : au moins deux lignes visibles', () => {
  it('le composer reserve deux hauteurs de ligne', () => {
    const bloc = css.match(/\.composer textarea \{[^}]*\}/)?.[0] ?? ''
    expect(bloc, 'regle .composer textarea introuvable').not.toBe('')
    expect(bloc).toMatch(/min-height:\s*calc\(2 \* 1\.45em[^)]*\)/)
  })

  it('la variante cosmic-outline (sans marge interne) reserve aussi deux lignes', () => {
    const bloc = css.match(/\.cosmic-outline \.composer-field textarea \{[^}]*\}/)?.[0] ?? ''
    expect(bloc, 'regle cosmic-outline introuvable').not.toBe('')
    expect(bloc).toMatch(/min-height:\s*calc\(2 \* 1\.45em\)/)
  })
})
