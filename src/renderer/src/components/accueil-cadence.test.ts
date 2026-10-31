import { describe, expect, it } from 'vitest'
import { avancerLesAnimations } from './accueil-cadence'

const animation = (playState: string, currentTime: number | null): Animation =>
  ({
    playState,
    currentTime,
    pause(this: { playState: string }) {
      this.playState = 'paused'
    }
  }) as unknown as Animation

describe('avancerLesAnimations — la mascotte ne fait pas recomposer la fenêtre à 60 images/s', () => {
  it('arrête celles qui tournent et les avance toutes du même pas', () => {
    const neuve = animation('running', 40)
    const tenue = animation('paused', 1000)
    expect(avancerLesAnimations({ getAnimations: () => [neuve, tenue] }, 100)).toBe(2)
    expect(neuve.playState).toBe('paused')
    expect(neuve.currentTime).toBe(140)
    expect(tenue.currentTime).toBe(1100)
  })

  it('une animation sans temps part de zéro', () => {
    const sansTemps = animation('paused', null)
    avancerLesAnimations({ getAnimations: () => [sansTemps] }, 100)
    expect(sansTemps.currentTime).toBe(100)
  })
})
