import { describe, expect, it } from 'vitest'
import { inventaireToursInacheves } from './inventaire-tours'

describe('inventaire des tours inachevés', () => {
  it('rend la liste AVANT que le ménage ne tourne', () => {
    const ordre: string[] = []
    let differee: (() => void) | undefined
    const liste = inventaireToursInacheves({
      lister: () => {
        ordre.push('liste')
        return ['tour-1']
      },
      menage: () => ordre.push('menage'),
      differer: (tache) => {
        differee = tache
      }
    })

    expect(liste).toEqual(['tour-1'])
    expect(ordre).toEqual(['liste'])
    differee!()
    expect(ordre).toEqual(['liste', 'menage'])
  })

  it('une panne du ménage ne remonte pas jusqu’au démarrage', () => {
    expect(() =>
      inventaireToursInacheves({
        lister: () => 0,
        menage: () => {
          throw new Error('disque plein')
        },
        differer: (tache) => tache()
      })
    ).not.toThrow()
  })

  it('sans report explicite, le ménage n’est pas joué dans le tour de boucle courant', async () => {
    let fait = false
    inventaireToursInacheves({
      lister: () => null,
      menage: () => {
        fait = true
      }
    })
    expect(fait).toBe(false)
    await new Promise((r) => setImmediate(r))
    expect(fait).toBe(true)
  })
})
