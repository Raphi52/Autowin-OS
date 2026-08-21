import { describe, expect, it } from 'vitest'
import { defaultHomeLayout, replaceWidget } from './home-layout'
import { canUndo, emptyHistory, HISTORY_DEPTH, remember, undo } from './home-history'

const VUE = { width: 1440, height: 900 }

describe('annuler un geste sur les tuiles', () => {
  it('n a rien a annuler au depart', () => {
    expect(canUndo(emptyHistory())).toBe(false)
    expect(undo(emptyHistory())).toBeNull()
  })

  it('rend l agencement precedent AU PIXEL', () => {
    const avant = defaultHomeLayout(VUE)
    const histoire = remember(emptyHistory(), avant)
    const apres = replaceWidget(avant, { id: 'agenda', x: 137, y: 641, w: 421, h: 233, z: -30 })
    expect(apres).not.toEqual(avant)
    const defait = undo(histoire)!
    // Le signal mesurable formule par le scout : Annuler retablit la boite precedente au pixel.
    expect(defait.arrangement).toEqual(avant)
    expect(canUndo(defait.history)).toBe(false)
  })

  it('defait les gestes un par un, du plus recent au plus ancien', () => {
    const un = defaultHomeLayout(VUE)
    const deux = replaceWidget(un, { id: 'agenda', x: 10, y: 200, w: 300, h: 200, z: 0 })
    const trois = replaceWidget(deux, { id: 'mails', x: 20, y: 300, w: 300, h: 200, z: 0 })
    let histoire = remember(emptyHistory(), un)
    histoire = remember(histoire, deux)
    histoire = remember(histoire, trois)

    const a = undo(histoire)!
    expect(a.arrangement).toEqual(trois)
    const b = undo(a.history)!
    expect(b.arrangement).toEqual(deux)
    const c = undo(b.history)!
    expect(c.arrangement).toEqual(un)
    expect(undo(c.history)).toBeNull()
  })

  it('borne la profondeur, et garde les gestes les plus RECENTS', () => {
    let histoire = emptyHistory()
    for (let i = 0; i < HISTORY_DEPTH + 8; i += 1) {
      histoire = remember(
        histoire,
        replaceWidget(defaultHomeLayout(VUE), { id: 'agenda', x: i, y: 0, w: 300, h: 200, z: 0 })
      )
    }
    expect(histoire.passe).toHaveLength(HISTORY_DEPTH)
    // Le dernier empile doit etre le premier rendu : on annule le geste le plus recent, pas un vieux.
    const dernier = undo(histoire)!
    expect(dernier.arrangement.find((b) => b.id === 'agenda')!.x).toBe(HISTORY_DEPTH + 7)
  })

  it('ne modifie pas l historique qu on lui passe', () => {
    const histoire = remember(emptyHistory(), defaultHomeLayout(VUE))
    const copie = { passe: [...histoire.passe] }
    undo(histoire)
    remember(histoire, defaultHomeLayout(VUE))
    expect(histoire).toEqual(copie)
  })
})
