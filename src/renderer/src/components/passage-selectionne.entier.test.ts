// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { passageDuFil, texteDeLActionSurPassage } from './passage-selectionne'

/**
 * PLAFOND MUET n°7 (conv-1228, 2026-10-28) : un passage sélectionné dans le fil pour le citer était
 * coupé à 4 000 caractères. L'utilisateur l'avait choisi lui-même, à la souris : la citation posée
 * dans la saisie en perdait la fin — souvent le point qu'il voulait contester.
 */
describe('un passage sélectionné se cite entier', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    document.body.replaceChildren()
  })

  it('un passage de 12 000 caractères arrive entier dans la citation', () => {
    const texte = `${'début du passage '.repeat(700)}le point contesté`
    const fil = document.createElement('div')
    fil.innerHTML = `<div class="msg assistant"><p>${texte}</p></div>`
    document.body.append(fil)
    const noeud = fil.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(noeud, 0)
    range.setEnd(noeud, texte.length)
    window.getSelection()!.addRange(range)

    const passage = passageDuFil(window.getSelection(), fil)
    expect(passage).toBe(texte.trim())
    expect(texteDeLActionSurPassage('faux', passage!)).toContain('le point contesté')
  })
})
