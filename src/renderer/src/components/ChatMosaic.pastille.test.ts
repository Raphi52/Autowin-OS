import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * DEMANDE DE L'UTILISATEUR (2026-10-10, conv-165) : « en mode mosaique ce bouton doit etre plus
 * haut, tout en bas de la partie chat » (capture : « ↓ Dernier message » pose SUR le champ de
 * saisie). Cause : `bottom: 72px` se mesurait depuis le bas de TOUTE la fenetre, et la saisie a
 * deux etages est plus haute que 72 px. La pastille doit suivre le bas du FIL, quelle que soit la
 * hauteur de la saisie — et chaque fenetre doit lire SON fil, pas celui de la voisine.
 */
const css = readFileSync(new URL('./ChatMosaic.css', import.meta.url), 'utf8')

function declarations(selecteur: string): Record<string, string> {
  const valeurs: Record<string, string> = {}
  postcss.parse(css).walkRules((regle) => {
    if (!regle.selectors.some((s) => s.trim() === selecteur)) return
    regle.walkDecls((d) => {
      valeurs[d.prop] = d.value
    })
  })
  return valeurs
}

describe('pastille « ↓ Dernier message » de la mosaique', () => {
  it('se pose au bas du fil de sa fenetre, pas a une hauteur fixe sur la saisie', () => {
    const pastille = declarations('.chat-mosaic-window-jump')
    expect(pastille.position).toBe('absolute')
    expect(pastille.bottom).toMatch(/anchor\(\s*--mosaic-fil\s+bottom/)
    expect(pastille.bottom).not.toMatch(/^\d+px$/)
  })

  it('le fil porte l ancre, et chaque fenetre la borne a elle-meme', () => {
    expect(declarations('.chat-mosaic-window-thread')['anchor-name']).toBe('--mosaic-fil')
    expect(declarations('.chat-mosaic-window')['anchor-scope']).toBe('--mosaic-fil')
  })
})
