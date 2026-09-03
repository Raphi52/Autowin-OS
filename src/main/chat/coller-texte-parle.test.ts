import { describe, it, expect } from 'vitest'
import { collerTexteParle } from './coller-texte-parle'

describe('collerTexteParle — deux messages ne se soudent pas', () => {
  it('colle les fragments d’UN MÊME message, sans rien ajouter', () => {
    expect(collerTexteParle('Je bal', 'aye tout.', true)).toBe('Je balaye tout.')
  })

  it('sépare deux itérations par une ligne vide', () => {
    expect(collerTexteParle('Fin du balayage.', 'Nouveau message.', false)).toBe(
      'Fin du balayage.\n\nNouveau message.'
    )
  })

  it('n’ajoute rien quand le texte accumulé est vide', () => {
    expect(collerTexteParle('', 'Premier message.', false)).toBe('Premier message.')
  })

  it('n’empile pas les lignes vides déjà présentes', () => {
    expect(collerTexteParle('Fin.\n\n', 'Suite.', false)).toBe('Fin.\n\nSuite.')
  })

  it('retire les espaces de fin avant de séparer', () => {
    expect(collerTexteParle('Fin.   ', 'Suite.', false)).toBe('Fin.\n\nSuite.')
  })

  /**
   * LE SYMPTÔME EXACT, reproduit : une clôture de bloc Markdown ne compte que si elle commence une
   * ligne. Collée derrière une phrase, elle n'ouvre aucun bloc et la page sort en texte brut.
   */
  it('remet la clôture de bloc html-render en début de ligne', () => {
    const colle = collerTexteParle(
      'Récupéré et publié. Reste à vérifier les branches.',
      '```html-render\n<div>bonjour</div>\n```',
      false
    )
    expect(colle).toContain('\n```html-render')
    expect(colle).not.toMatch(/[^\n]```html-render/u)
  })
})
