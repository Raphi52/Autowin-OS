// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { ajouterAuBrouillon, passageDuFil, texteDeLActionSurPassage } from './passage-selectionne'

/**
 * RÉPONDRE À UN PASSAGE (conv-1038, 2026-10-21) : pour contester un point d'une longue réponse,
 * l'utilisateur le RETAPAIT — le fil ne gérait aucune sélection. Ces tests tiennent ce qui est
 * reconnu comme un passage du fil, et le texte que chaque action pose dans la saisie.
 */

describe('texteDeLActionSurPassage', () => {
  it('Citer : chaque ligne du passage passe en citation, puis une ligne vide pour écrire', () => {
    expect(texteDeLActionSurPassage('citer', 'ligne un\nligne deux')).toBe(
      '> ligne un\n> ligne deux\n\n'
    )
  })

  it('Détaille / C’est faux / Retiens ça : la consigne, puis le passage cité', () => {
    expect(texteDeLActionSurPassage('detaille', 'le cache')).toBe(
      'Détaille ce passage :\n> le cache'
    )
    expect(texteDeLActionSurPassage('faux', 'le cache')).toBe(
      'Ce passage me paraît faux — vérifie-le et corrige-le :\n> le cache'
    )
    expect(texteDeLActionSurPassage('retenir', 'le cache')).toBe(
      'Retiens ça pour la suite — dépose-le en mémoire :\n> le cache'
    )
  })
})

describe('ajouterAuBrouillon', () => {
  it('brouillon vide : l’ajout seul', () => {
    expect(ajouterAuBrouillon('', '> a\n\n')).toBe('> a\n\n')
    expect(ajouterAuBrouillon('   \n', '> a\n\n')).toBe('> a\n\n')
  })

  // Jumeau : un brouillon NON vide n'est jamais écrasé, l'ajout vient après une ligne vide.
  it('brouillon déjà écrit : jamais écrasé, l’ajout vient après une ligne vide', () => {
    expect(ajouterAuBrouillon('ma question\n', '> a\n\n')).toBe('ma question\n\n> a\n\n')
  })
})

describe('passageDuFil', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges()
    document.body.replaceChildren()
  })

  function poser(html: string): HTMLElement {
    const fil = document.createElement('div')
    fil.innerHTML = html
    document.body.append(fil)
    return fil
  }

  function selectionner(noeud: Node, debut: number, fin: number, noeudFin: Node = noeud): void {
    const range = document.createRange()
    range.setStart(noeud, debut)
    range.setEnd(noeudFin, fin)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
  }

  it('texte sélectionné DANS un message du fil : le passage, sans blancs autour', () => {
    const fil = poser('<div class="msg assistant"><p>  La cause est un cache périmé.  </p></div>')
    const texte = fil.querySelector('p')!.firstChild!
    selectionner(texte, 2, 32)
    expect(passageDuFil(window.getSelection(), fil)).toBe('La cause est un cache périmé.')
  })

  it('sélection vide (simple clic) : rien', () => {
    const fil = poser('<div class="msg assistant"><p>texte</p></div>')
    selectionner(fil.querySelector('p')!.firstChild!, 2, 2)
    expect(passageDuFil(window.getSelection(), fil)).toBeNull()
  })

  it('sélection HORS d’un message (bandeau du fil, autre panneau) : rien', () => {
    const fil = poser('<div class="conv-load-error">⚠️ Conversation illisible</div>')
    selectionner(fil.querySelector('div')!.firstChild!, 0, 10)
    expect(passageDuFil(window.getSelection(), fil)).toBeNull()
  })

  it('sélection qui DÉBORDE du fil (fin dans la saisie) : rien', () => {
    const fil = poser('<div class="msg assistant"><p>dans le fil</p></div>')
    const dehors = document.createElement('div')
    dehors.className = 'msg'
    dehors.textContent = 'dans la saisie'
    document.body.append(dehors)
    selectionner(fil.querySelector('p')!.firstChild!, 0, 4, dehors.firstChild!)
    expect(passageDuFil(window.getSelection(), fil)).toBeNull()
  })

  it('passage géant : coupé à 4000 caractères avec « … »', () => {
    const fil = poser(`<div class="msg assistant"><p>${'a'.repeat(5000)}</p></div>`)
    selectionner(fil.querySelector('p')!.firstChild!, 0, 5000)
    const passage = passageDuFil(window.getSelection(), fil)
    expect(passage).toHaveLength(4000)
    expect(passage?.endsWith('…')).toBe(true)
  })
})
