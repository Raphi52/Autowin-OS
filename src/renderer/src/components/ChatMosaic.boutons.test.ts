import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

/**
 * DEMANDE DE L'UTILISATEUR (2026-10-10, conv-166) : « refais les boutons comme il faut en mode
 * mosaique » (capture : Envoyer tombé sur la rangée du bas, poussé à droite, avec ∞ et le micro
 * collés DERRIÈRE lui). En chat plein, Envoyer est SUR la ligne d'écriture et ∞ + micro restent
 * seuls à gauche en dessous. Cause : `width: 100%` sur le champ de la tuile — il prenait toute la
 * ligne, Envoyer n'y tenait plus.
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

describe('boutons de la saisie en mosaique — meme rangee qu en chat plein', () => {
  it('aucune regle de la tuile ne force le champ a toute la largeur', () => {
    const largeursForcees: string[] = []
    postcss.parse(css).walkRules((regle) => {
      if (
        !regle.selectors.some(
          (s) => s.includes('chat-mosaic-window-composer') && /textarea/.test(s)
        )
      )
        return
      regle.walkDecls('width', (d) => {
        if (d.value.trim() === '100%') largeursForcees.push(regle.selector)
      })
    })
    expect(largeursForcees).toEqual([])
  })

  it('le champ partage sa ligne avec Envoyer : base de flex nulle, retrecissable', () => {
    const champ = declarations('.chat-mosaic-window-composer .composer-input-row > textarea')
    expect(champ.flex).toBe('1 1 0')
    expect(champ['min-width']).toBe('0')
  })

  it('∞ et micro passent SOUS la ligne d ecriture, comme sous la barre de quotas du chat plein', () => {
    const coupure = declarations('.chat-mosaic-window-composer .composer-input-row::before')
    expect(coupure.content).toBe("''")
    // order 0 = celui des outils : premier enfant, il passe juste apres champ + Envoyer (-1).
    expect(coupure.order).toBe('0')
    expect(coupure.flex).toBe('1 0 100%')
  })

  it('∞ et micro sont deux ronds de meme taille', () => {
    const auto = declarations('.chat-mosaic-window-composer .composer-input-row > .composer-auto')
    const micro = declarations(
      '.chat-mosaic-window-composer .composer-input-row > .composer-dictee'
    )
    expect(auto.width).toBe('24px')
    expect(auto.height).toBe('24px')
    expect(micro.width).toBe(auto.width)
    expect(micro.height).toBe(auto.height)
  })
})
