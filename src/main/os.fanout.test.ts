import { describe, expect, it } from 'vitest'
import { selectPhaseFanOut, type FanOutTopology } from './os'

describe('sélection du panel fan-out par phase', () => {
  const fanOut: FanOutTopology = {
    scout: [{ provider: 'scout-provider', model: 'scout-model' }],
    frame: [{ provider: 'frame-provider', model: 'frame-model' }],
    terrain: [{ provider: 'terrain-provider', model: 'terrain-model' }],
    judge: [{ provider: 'judge-provider', model: 'judge-model' }]
  }

  it('transmet le panel Terrain à la phase terrain', () => {
    expect(selectPhaseFanOut(fanOut, 'terrain')).toBe(fanOut.terrain)
  })

  it('ne transforme pas build en phase de fan-out composée', () => {
    expect(selectPhaseFanOut(fanOut, 'build')).toEqual([])
  })
})
