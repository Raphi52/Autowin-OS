import { describe, expect, it } from 'vitest'
import { avancerLesPistes, prendreLaMain } from './accueil-cadence'

type Faux = { playState: string; currentTime: number | null; pause: () => void }

function animation(
  playState: string,
  currentTime: number | null,
  { visible = true, fin = Infinity }: { visible?: boolean; fin?: number } = {}
): Faux & Animation {
  return {
    playState,
    currentTime,
    effect: {
      target: { getClientRects: () => (visible ? [{}] : []) },
      getComputedTiming: () => ({ endTime: fin })
    },
    pause(this: Faux) {
      this.playState = 'paused'
    }
  } as unknown as Faux & Animation
}

describe('prendreLaMain — la mascotte ne fait pas recomposer la fenêtre à 60 images/s', () => {
  it('arrête aussi celles qu’on ne voit pas, mais ne rend que les visibles', () => {
    const vue = animation('running', 40)
    const eteinte = animation('running', 40, { visible: false })
    const pistes = prendreLaMain({ getAnimations: () => [vue, eteinte] })
    expect(vue.playState).toBe('paused')
    expect(eteinte.playState).toBe('paused')
    expect(pistes.map((p) => p.animation)).toEqual([vue])
  })

  it('ne touche pas au temps d’une animation déjà tenue', () => {
    const tenue = animation('paused', 1000)
    prendreLaMain({ getAnimations: () => [tenue] })
    expect(tenue.currentTime).toBe(1000)
  })

  it('ignore une animation sans cible', () => {
    const sansCible = { ...animation('running', 0), effect: null } as unknown as Animation
    expect(prendreLaMain({ getAnimations: () => [sansCible] })).toEqual([])
  })
})

describe('avancerLesPistes', () => {
  it('garde en phase celles qui bouclent, même éteintes jusque-là', () => {
    const toujoursVue = animation('paused', 7000)
    const rallumee = animation('paused', 300)
    avancerLesPistes(
      [
        { animation: toujoursVue, fin: Infinity },
        { animation: rallumee, fin: Infinity }
      ],
      7100,
      100
    )
    expect(toujoursVue.currentTime).toBe(7100)
    expect(rallumee.currentTime).toBe(7100)
  })

  it('une animation jouée une fois compte depuis son départ, pas depuis l’horloge', () => {
    const ouverture = animation('paused', 200)
    avancerLesPistes([{ animation: ouverture, fin: 1100 }], 9000, 100)
    expect(ouverture.currentTime).toBe(300)
  })

  it('une animation finie n’est plus touchée', () => {
    const finie = animation('finished', 1100)
    avancerLesPistes([{ animation: finie, fin: 1100 }], 9000, 100)
    expect(finie.currentTime).toBe(1100)
  })

  it('une animation sans temps part de zéro', () => {
    const neuve = animation('paused', null)
    avancerLesPistes([{ animation: neuve, fin: 1100 }], 9000, 100)
    expect(neuve.currentTime).toBe(100)
  })
})
