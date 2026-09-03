// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import {
  CALQUE_ACTIVE,
  CALQUE_TOUTES,
  effacerPeinture,
  indexSuivant,
  occurrencesDansLeDom,
  peindreOccurrences,
  positionsDuTerme,
  revelerOccurrence
} from './chat-find'

describe('positionsDuTerme', () => {
  it('trouve le terme malgré les accents et la casse', () => {
    expect(positionsDuTerme('Mise À Jour du graphe', 'a jour')).toEqual([{ debut: 5, fin: 11 }])
  })

  it('rend toutes les occurrences, sans chevauchement', () => {
    expect(positionsDuTerme('badge et badge', 'badge')).toEqual([
      { debut: 0, fin: 5 },
      { debut: 9, fin: 14 }
    ])
  })

  it('ne rend rien pour un terme vide ou absent', () => {
    expect(positionsDuTerme('rien ici', '   ')).toEqual([])
    expect(positionsDuTerme('rien ici', 'absent')).toEqual([])
  })
})

describe('occurrencesDansLeDom', () => {
  const monter = (html: string): HTMLElement => {
    const racine = document.createElement('div')
    racine.innerHTML = html
    document.body.append(racine)
    return racine
  }

  it('parcourt les nœuds de texte dans l’ordre de lecture', () => {
    const racine = monter('<p>premier terrain</p><p>second terrain</p>')
    const plages = occurrencesDansLeDom(racine, 'terrain')
    expect(plages).toHaveLength(2)
    expect(plages[0].startContainer.nodeValue).toBe('premier terrain')
    expect(plages[0].toString()).toBe('terrain')
    expect(plages[1].startContainer.nodeValue).toBe('second terrain')
  })

  it('ignore le décor annoncé comme caché aux lecteurs d’écran', () => {
    const racine = monter('<span aria-hidden="true">terrain</span><p>terrain</p>')
    expect(occurrencesDansLeDom(racine, 'terrain')).toHaveLength(1)
  })

  it('ne rend rien sans racine ou sans terme', () => {
    expect(occurrencesDansLeDom(null, 'terrain')).toEqual([])
    expect(occurrencesDansLeDom(monter('<p>terrain</p>'), '  ')).toEqual([])
  })
})

describe('indexSuivant', () => {
  it('boucle dans les deux sens', () => {
    expect(indexSuivant(-1, 3, 1)).toBe(0)
    expect(indexSuivant(2, 3, 1)).toBe(0)
    expect(indexSuivant(0, 3, -1)).toBe(2)
    expect(indexSuivant(-1, 3, -1)).toBe(2)
  })

  it('rend -1 quand il n’y a rien à parcourir', () => {
    expect(indexSuivant(0, 0, 1)).toBe(-1)
  })
})

describe('revelerOccurrence', () => {
  it('déplie les blocs repliés qui contiennent le résultat', () => {
    const racine = document.createElement('div')
    racine.innerHTML = '<details><summary>plié</summary><p>terrain</p></details>'
    document.body.append(racine)
    const repliant = racine.querySelector('details') as HTMLDetailsElement
    expect(repliant.open).toBe(false)
    const [plage] = occurrencesDansLeDom(racine, 'terrain')
    revelerOccurrence(plage)
    expect(repliant.open).toBe(true)
  })
})

/**
 * Le SURLIGNAGE passe par l'API de surlignage CSS, absente de l'environnement de test comme de
 * tout moteur trop ancien. On la simule pour prouver le câblage — et on vérifie que son absence
 * ne casse rien (la navigation doit continuer sans couleur).
 */
describe('peinture des occurrences', () => {
  const registreFactice = (): { calques: Map<string, Range[]>; retirer: () => void } => {
    const calques = new Map<string, Range[]>()
    const precedent = {
      CSS: (globalThis as Record<string, unknown>).CSS,
      Highlight: (globalThis as Record<string, unknown>).Highlight
    }
    class HighlightFactice {
      plages: Range[]
      constructor(...plages: Range[]) {
        this.plages = plages
      }
    }
    Object.assign(globalThis as Record<string, unknown>, {
      CSS: {
        highlights: {
          set: (nom: string, surlignage: { plages: Range[] }) =>
            calques.set(nom, surlignage.plages),
          delete: (nom: string) => calques.delete(nom)
        }
      },
      Highlight: HighlightFactice
    })
    return {
      calques,
      retirer: () => Object.assign(globalThis as Record<string, unknown>, precedent)
    }
  }

  it('peint toutes les occurrences et isole celle où l’on se trouve', () => {
    const faux = registreFactice()
    try {
      const racine = document.createElement('div')
      racine.innerHTML = '<p>terrain</p><p>terrain</p>'
      document.body.append(racine)
      const plages = occurrencesDansLeDom(racine, 'terrain')
      expect(peindreOccurrences(plages, plages[1])).toBe(true)
      expect(faux.calques.get(CALQUE_TOUTES)).toHaveLength(2)
      expect(faux.calques.get(CALQUE_ACTIVE)).toEqual([plages[1]])
      effacerPeinture()
      expect(faux.calques.size).toBe(0)
    } finally {
      faux.retirer()
    }
  })

  it('ne casse rien là où l’API de surlignage n’existe pas', () => {
    const precedent = (globalThis as Record<string, unknown>).CSS
    delete (globalThis as Record<string, unknown>).CSS
    try {
      expect(peindreOccurrences([], null)).toBe(false)
      expect(() => effacerPeinture()).not.toThrow()
    } finally {
      ;(globalThis as Record<string, unknown>).CSS = precedent
    }
  })
})
