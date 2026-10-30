import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * DEMANDE DE L'UTILISATEUR (2026-10-30, conv-1318) : « en mode mosaique la top barre du chat n'est
 * pas aligne aux autres elements (en bas c'est pareil) ». Mesure sur capture : la fenetre allait de
 * y=33 a y=867 quand la liste des conversations va de y=25 a y=875. Cause : 8 px de retrait autour
 * de la grille. Le cadre de la fenetre doit tomber au meme pixel que celui du chat plein.
 */
const css = readFileSync(new URL('./ChatMosaic.css', import.meta.url), 'utf8')

describe('alignement de la mosaique', () => {
  it('ne pose aucun retrait autour de la grille des fenetres', () => {
    const retraits: string[] = []
    postcss.parse(css).walkRules((regle) => {
      if (!regle.selectors.some((s) => s.trim() === '.chat-mosaic')) return
      regle.walkDecls(/^padding/, (d) => {
        retraits.push(`${d.prop}: ${d.value}`)
      })
    })
    expect(retraits).toEqual([])
  })
})
