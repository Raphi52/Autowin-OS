// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { mesurerBlocGraphe } from './graph-perf'
import { noterRendu, oublierRendusRecents, vueDominanteRecente } from './rendu-long'

function avecCanal(signaler: (ms: number, etiquette?: string) => unknown): () => void {
  const precedent = (window as unknown as { api?: unknown }).api
  ;(window as unknown as { api?: unknown }).api = { signalerGelRenderer: signaler }
  return () => {
    ;(window as unknown as { api?: unknown }).api = precedent
  }
}

describe('chronometre nomme du graphe', () => {
  it('nomme le bloc fautif quand il atteint le seuil de gel', () => {
    const signaler = vi.fn()
    const restaurer = avecCanal(signaler)
    let horloge = 0
    const valeur = mesurerBlocGraphe(
      'graph:layoutTree',
      () => {
        horloge = 900
        return 42
      },
      500,
      () => horloge
    )
    restaurer()
    expect(valeur).toBe(42)
    expect(signaler).toHaveBeenCalledWith(900, 'graph:layoutTree')
  })

  it('reste muet sous le seuil — l instrument ne parle que s il y a un gel', () => {
    const signaler = vi.fn()
    const restaurer = avecCanal(signaler)
    let horloge = 0
    mesurerBlocGraphe('graph:rendu', () => (horloge = 40), 500, () => horloge)
    restaurer()
    expect(signaler).not.toHaveBeenCalled()
  })

  it('rend la valeur meme sans canal, et n avale pas le resultat', () => {
    const restaurer = avecCanal(() => {
      throw new Error('canal absent')
    })
    let horloge = 0
    const valeur = mesurerBlocGraphe('graph:rendu', () => {
      horloge = 5000
      return 'ok'
    }, 500, () => horloge)
    restaurer()
    expect(valeur).toBe('ok')
  })
})

describe('les blocs du graphe nourrissent le registre qui nomme la tache longue', () => {
  it('un bloc SOUS le seuil est quand meme compte — sinon Memory repart en longtask anonyme', () => {
    oublierRendusRecents()
    let horloge = 0
    mesurerBlocGraphe('graph:objets3d', () => (horloge = 400), 1000, () => horloge)
    expect(vueDominanteRecente()).toBe('graph:objets3d')
    oublierRendusRecents()
  })

  it('le bloc le plus couteux gagne sur la vue React qui rendait en meme temps', () => {
    oublierRendusRecents()
    noterRendu('knowledge', 120)
    let horloge = 0
    mesurerBlocGraphe('graph:layoutTree', () => (horloge = 700), 1000, () => horloge)
    expect(vueDominanteRecente()).toBe('graph:layoutTree')
    oublierRendusRecents()
  })
})
